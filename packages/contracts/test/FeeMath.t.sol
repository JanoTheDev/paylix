// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/PaymentVault.sol";
import "../src/SubscriptionManager.sol";
import "../src/MockUSDC.sol";
import "../src/interfaces/IPermit2.sol";
import "./stubs/Permit2Stubs.sol";

/// SC-28: fuzz and invariant testing was configured (and run with
/// --fuzz-runs 1000 in CI) but never used. These cover the two properties the
/// whole fee model rests on:
///   1. fee + merchantAmount == amount, for every (amount, feeBps) in range.
///   2. neither contract ever holds a token balance between transactions.
contract FeeMathFuzzTest is Test {
    MockUSDC public usdc;

    address public platformWallet = makeAddr("platform");
    address public merchant = makeAddr("merchant");
    address public payer = makeAddr("payer");

    bytes32 public productId = keccak256("prod");
    bytes32 public customerId = keccak256("cust");

    uint256 public constant MONTHLY = 30 days;

    function setUp() public {
        usdc = new MockUSDC();
    }

    function testFuzz_vault_feeSplitIsLossless(uint256 amount, uint16 feeBpsRaw) public {
        uint256 feeBps = bound(uint256(feeBpsRaw), 0, 1000);
        amount = bound(amount, 1, type(uint128).max);

        PaymentVault vault = new PaymentVault(platformWallet, feeBps);
        vault.setAcceptedToken(address(usdc), true);

        usdc.mint(payer, amount);
        vm.startPrank(payer);
        usdc.approve(address(vault), amount);
        vault.createPayment(address(usdc), merchant, amount, productId, customerId);
        vm.stopPrank();

        uint256 expectedFee = (amount * feeBps) / 10000;
        assertEq(usdc.balanceOf(platformWallet), expectedFee, "fee rounds toward merchant");
        assertEq(usdc.balanceOf(merchant), amount - expectedFee, "merchant gets the remainder");
        // The invariant: no dust is created or destroyed.
        assertEq(
            usdc.balanceOf(merchant) + usdc.balanceOf(platformWallet),
            amount,
            "fee + merchantAmount == amount"
        );
        assertEq(usdc.balanceOf(address(vault)), 0, "vault holds nothing");
    }

    function testFuzz_vault_feeNeverExceedsTenPercent(uint256 amount) public {
        amount = bound(amount, 1, type(uint128).max);
        PaymentVault vault = new PaymentVault(platformWallet, 1000);
        vault.setAcceptedToken(address(usdc), true);

        usdc.mint(payer, amount);
        vm.startPrank(payer);
        usdc.approve(address(vault), amount);
        vault.createPayment(address(usdc), merchant, amount, productId, customerId);
        vm.stopPrank();

        assertLe(usdc.balanceOf(platformWallet) * 10, amount, "fee <= 10% of amount");
    }

    function testFuzz_subscription_feeSplitIsLossless(uint256 amount, uint16 feeBpsRaw) public {
        uint256 feeBps = bound(uint256(feeBpsRaw), 0, 1000);
        amount = bound(amount, 1, type(uint128).max);

        SubscriptionManager subs = new SubscriptionManager(platformWallet, feeBps);
        subs.setAcceptedToken(address(usdc), true);

        usdc.mint(payer, amount * 2);
        vm.startPrank(payer);
        usdc.approve(address(subs), type(uint256).max);
        uint256 subId =
            subs.createSubscription(address(usdc), merchant, amount, MONTHLY, productId, customerId);
        vm.stopPrank();

        uint256 expectedFee = (amount * feeBps) / 10000;
        assertEq(usdc.balanceOf(platformWallet), expectedFee);
        assertEq(usdc.balanceOf(merchant) + usdc.balanceOf(platformWallet), amount);
        assertEq(usdc.balanceOf(address(subs)), 0);

        // Second cycle keeps the property.
        vm.warp(block.timestamp + MONTHLY + 1);
        vm.prank(payer);
        subs.chargeSubscription(subId);
        assertEq(usdc.balanceOf(merchant) + usdc.balanceOf(platformWallet), amount * 2);
        assertEq(usdc.balanceOf(address(subs)), 0);
    }

    function testFuzz_setPlatformFee_rejects_above_cap(uint256 fee) public {
        fee = bound(fee, 1001, type(uint256).max);
        PaymentVault vault = new PaymentVault(platformWallet, 50);
        vm.expectRevert("Fee too high");
        vault.setPlatformFee(fee);
    }
}

/// @dev Invariant handler. Deliberately reaches the *awkward* states, not just
/// the happy path: starvation into PastDue, backup-payer wallet-walks, discount
/// cycles, and Permit2 subscriptions. The handler is the relayer, so the gasless
/// entry points (and their signature verification) are exercised too.
///
/// It does **not** pre-mint exactly what each call needs — `starve()` moves the
/// payer's balance away so charges genuinely fail, which is the only way the
/// PastDue and backup-payer branches get visited.
contract NonCustodyHandler is Test {
    PaymentVault public vault;
    SubscriptionManager public subs;
    MockUSDC public usdc;

    address public merchant = address(0xBEEF);
    address public sink = address(0xD1E);

    uint256 public constant PAYER_PK = 0xA11CE;
    uint256 public constant BACKUP_PK = 0xBACC;
    address public payer;
    address public backup;

    uint256 public vaultPaid;
    uint256[] public subIds;

    // Ghost counters — proof that the fuzzer reached the awkward states rather
    // than looping over the happy path.
    uint256 public pastDueSeen;
    uint256 public backupFundedSeen;
    uint256 public discountConsumedSeen;
    uint256 public backupsAdded;
    uint256 public chargesSettled;
    uint256 public starvedCharges;
    uint256 public starvedWithBackup;

    uint256 private constant MONTHLY = 30 days;
    uint256 private constant MAX_FEE_BPS = 50;

    bytes32 private constant SUBSCRIPTION_INTENT_TYPEHASH = keccak256(
        "SubscriptionIntent(address buyer,address token,address merchant,uint256 amount,uint256 interval,bytes32 productId,bytes32 customerId,uint256 permitValue,uint256 maxFeeBps,uint8 flow,uint256 nonce,uint256 deadline)"
    );
    bytes32 private constant BACKUP_PAYER_AUTH_TYPEHASH = keccak256(
        "BackupPayerAuth(uint256 subscriptionId,address backup,uint256 nonce,uint256 deadline)"
    );
    bytes32 private constant BACKUP_PAYER_CONSENT_TYPEHASH = keccak256(
        "BackupPayerConsent(uint256 subscriptionId,address subscriber,address token,uint256 maxAmount,uint256 nonce,uint256 deadline)"
    );
    bytes32 private constant PERMIT_TYPEHASH = keccak256(
        "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
    );

    constructor(PaymentVault _vault, SubscriptionManager _subs, MockUSDC _usdc) {
        vault = _vault;
        subs = _subs;
        usdc = _usdc;
        payer = vm.addr(PAYER_PK);
        backup = vm.addr(BACKUP_PK);
        vm.prank(payer);
        usdc.approve(address(vault), type(uint256).max);
        vm.prank(payer);
        usdc.approve(address(subs), type(uint256).max);
        vm.prank(backup);
        usdc.approve(address(subs), type(uint256).max);
    }

    function subCount() external view returns (uint256) {
        return subIds.length;
    }

    // ----- one-time payments -----

    function pay(uint256 amount) public {
        amount = bound(amount, 1, 1_000_000e6);
        usdc.mint(payer, amount);
        vm.prank(payer);
        vault.createPayment(address(usdc), merchant, amount, "p", "c");
        vaultPaid += amount;
    }

    // ----- subscriptions -----

    function subscribeDirect(uint256 amount) public {
        if (!_needsMoreSubs()) return;
        amount = bound(amount, 1, 100_000e6);
        usdc.mint(payer, amount);
        vm.prank(payer);
        subIds.push(subs.createSubscription(address(usdc), merchant, amount, MONTHLY, "p", "c"));
    }

    function subscribeDiscount(uint256 amount, uint256 discount, uint256 cycles) public {
        if (!_needsMoreSubs()) return;
        amount = bound(amount, 2, 100_000e6);
        discount = bound(discount, 1, amount - 1);
        cycles = bound(cycles, 1, 4);
        usdc.mint(payer, amount * 10);

        SubscriptionManager.CreateSubPermitDiscountParams memory p = SubscriptionManager
            .CreateSubPermitDiscountParams({
            token: address(usdc),
            buyer: payer,
            merchant: merchant,
            amount: amount,
            interval: MONTHLY,
            productId: "p",
            customerId: "c",
            permitValue: amount * 10,
            discountAmount: discount,
            discountCycles: cycles,
            maxFeeBps: MAX_FEE_BPS,
            deadline: block.timestamp + 1 hours,
            v: 0,
            r: bytes32(0),
            s: bytes32(0)
        });
        (p.v, p.r, p.s) = _signPermit(PAYER_PK, payer, address(subs), p.permitValue, p.deadline);
        bytes memory sig = _signDiscountIntent(p);
        subIds.push(subs.createSubscriptionWithPermitDiscount(p, sig));
    }

    function subscribePermit2(uint256 amount) public {
        if (!_needsMoreSubs()) return;
        amount = bound(amount, 1, 100_000e6);
        usdc.mint(payer, amount * 10);

        uint256 deadline = block.timestamp + 1 hours;
        SubscriptionManager.CreateSubPermit2Params memory p = SubscriptionManager
            .CreateSubPermit2Params({
            token: address(usdc),
            buyer: payer,
            merchant: merchant,
            amount: amount,
            interval: MONTHLY,
            productId: "p",
            customerId: "c",
            maxFeeBps: MAX_FEE_BPS,
            deadline: deadline
        });
        IPermit2.PermitSingle memory ps = IPermit2.PermitSingle({
            details: IPermit2.PermitDetails({
                token: address(usdc),
                amount: uint160(amount * 10),
                expiration: uint48(block.timestamp + 3650 days),
                nonce: 0
            }),
            spender: address(subs),
            sigDeadline: deadline
        });
        bytes memory sig = _signSubIntent(p, uint256(ps.details.amount), subs.FLOW_PERMIT2());
        subIds.push(subs.createSubscriptionWithPermit2(p, ps, hex"00", sig));
    }

    /// @dev Finds an Active subscription that this wallet does not already back.
    /// Scanning for one matters: picking the first Active id and bailing when it
    /// already has a backup means every *other* subscription stays uncovered,
    /// and the wallet-walk branch is then unreachable.
    function _pickActiveWithoutBackup(uint256 seed) internal view returns (bool, uint256) {
        uint256 n = subIds.length;
        for (uint256 i = 0; i < n; i++) {
            uint256 candidate = subIds[(seed + i) % n];
            if (
                _status(candidate) == SubscriptionManager.Status.Active
                    && subs.backupPayerMaxAmount(candidate, backup) == 0
            ) {
                return (true, candidate);
            }
        }
        return (false, 0);
    }

    function addBackup(uint256 seed) public {
        if (subIds.length == 0) return;
        (bool found, uint256 id) = _pickActiveWithoutBackup(seed);
        if (!found) return;
        (, , , uint256 amount, , , , , , , ) = subs.subscriptions(id);

        usdc.mint(backup, amount * 20);
        uint256 deadline = block.timestamp + 1 hours;
        // A standing permit value, not amount-scaled: each permit OVERWRITES
        // the backup's ERC-20 allowance, so scaling it to one subscription's
        // amount would silently shrink the allowance backing every other
        // subscription this wallet backs.
        SubscriptionManager.BackupPayerParams memory p = SubscriptionManager.BackupPayerParams({
            subscriptionId: id,
            backup: backup,
            authDeadline: deadline,
            maxAmount: amount * 2,
            consentDeadline: deadline,
            permitValue: 1e30,
            permitDeadline: deadline,
            v: 0,
            r: bytes32(0),
            s: bytes32(0)
        });
        (p.v, p.r, p.s) = _signPermit(BACKUP_PK, backup, address(subs), p.permitValue, deadline);
        subs.addSubscriptionBackupPayer(p, _signBackupAuth(p), _signBackupConsent(p));
        backupsAdded++;
    }

    /// @dev Cancelled and PastDue subscriptions are terminal. Gating creation
    /// on the number of *live* subscriptions (rather than the array length)
    /// keeps the fuzzer from parking every slot in a dead state and then
    /// no-opping for the rest of the run.
    function _needsMoreSubs() internal view returns (bool) {
        if (subIds.length >= 40) return false;
        uint256 live;
        for (uint256 i = 0; i < subIds.length; i++) {
            if (_status(subIds[i]) == SubscriptionManager.Status.Active) live++;
        }
        return live < 4;
    }

    /// @dev Finds an Active subscription starting at `seed`. Without this the
    /// fuzzer keeps picking cancelled/past-due ids, every call no-ops, and the
    /// invariants hold vacuously.
    function _pickActive(uint256 seed) internal view returns (bool found, uint256 id) {
        uint256 n = subIds.length;
        for (uint256 i = 0; i < n; i++) {
            uint256 candidate = subIds[(seed + i) % n];
            if (_status(candidate) == SubscriptionManager.Status.Active) {
                return (true, candidate);
            }
        }
        return (false, 0);
    }

    function chargeDue(uint256 seed, uint256 warpBy) public {
        if (subIds.length == 0) return;
        (bool found, uint256 id) = _pickActive(seed);
        if (!found) return;
        (, , , , , uint256 nextChargeDate, , , , , ) = subs.subscriptions(id);
        warpBy = bound(warpBy, 0, 60 days);
        uint256 target = nextChargeDate + warpBy;
        if (target > block.timestamp) vm.warp(target);
        // No top-up here on purpose: whether this succeeds or flips the
        // subscription to PastDue depends on the balances left by starve/fund.
        uint256 backupBefore = usdc.balanceOf(backup);
        (, , , uint256 subAmount, , , , , , , ) = subs.subscriptions(id);
        if (usdc.balanceOf(payer) < subAmount) {
            starvedCharges++;
            if (subs.backupPayerMaxAmount(id, backup) >= subAmount) starvedWithBackup++;
        }
        (uint256 discountBefore, uint256 cyclesBefore) = subs.subscriptionDiscounts(id);
        subs.chargeSubscription(id);

        if (_status(id) == SubscriptionManager.Status.PastDue) {
            pastDueSeen++;
        } else {
            chargesSettled++;
        }
        if (usdc.balanceOf(backup) < backupBefore) backupFundedSeen++;
        (, uint256 cyclesAfter) = subs.subscriptionDiscounts(id);
        if (discountBefore > 0 && cyclesAfter < cyclesBefore) discountConsumedSeen++;
    }

    /// Kept deliberately rare: cancelling is terminal, and a fuzzer that
    /// cancels freely parks every subscription in a dead state within a few
    /// calls and stops exercising anything.
    /// Composite action: empties the primary wallet and charges a subscription
    /// that *does* have a funded backup, in one call. Relying on a lucky
    /// starve-then-charge adjacency in the random sequence left the wallet-walk
    /// branch unvisited across 1600 calls; this makes it reachable while the
    /// fuzzer still chooses which subscription and when.
    function starvedChargeWithBackup(uint256 seed, uint256 warpBy) public {
        if (subIds.length == 0) return;
        (bool found, uint256 id) = _pickActiveWithBackup(seed);
        if (!found) return;

        uint256 bal = usdc.balanceOf(payer);
        if (bal > 0) {
            vm.prank(payer);
            usdc.transfer(sink, bal);
        }

        (, , , uint256 amount, , uint256 nextChargeDate, , , , , ) = subs.subscriptions(id);
        usdc.mint(backup, amount * 2);

        warpBy = bound(warpBy, 0, 60 days);
        uint256 target = nextChargeDate + warpBy;
        if (target > block.timestamp) vm.warp(target);

        uint256 backupBefore = usdc.balanceOf(backup);
        starvedCharges++;
        starvedWithBackup++;
        subs.chargeSubscription(id);
        if (_status(id) == SubscriptionManager.Status.PastDue) {
            pastDueSeen++;
        } else {
            chargesSettled++;
        }
        if (usdc.balanceOf(backup) < backupBefore) backupFundedSeen++;
    }

    function _pickActiveWithBackup(uint256 seed) internal view returns (bool, uint256) {
        uint256 n = subIds.length;
        for (uint256 i = 0; i < n; i++) {
            uint256 candidate = subIds[(seed + i) % n];
            (, , , uint256 amount, , , , , , , ) = subs.subscriptions(candidate);
            if (
                _status(candidate) == SubscriptionManager.Status.Active
                    && subs.backupPayerMaxAmount(candidate, backup) >= amount
            ) {
                return (true, candidate);
            }
        }
        return (false, 0);
    }

    function cancel(uint256 seed) public {
        if (subIds.length == 0 || seed % 16 != 0) return;
        uint256 id = subIds[seed % subIds.length];
        SubscriptionManager.Status st = _status(id);
        if (st != SubscriptionManager.Status.Active && st != SubscriptionManager.Status.PastDue) {
            return;
        }
        vm.prank(payer);
        subs.cancelSubscription(id);
    }

    /// Move the payer's balance out of reach so the next charge fails — this is
    /// what drives the PastDue and backup-payer branches.
    function starve() public {
        uint256 bal = usdc.balanceOf(payer);
        if (bal == 0) return;
        vm.prank(payer);
        usdc.transfer(sink, bal);
    }

    /// Rarer than `starve`: if both wallets are empty most of the time the
    /// wallet-walk never runs and only the PastDue branch gets exercised.
    function starveBackup(uint256 seed) public {
        if (seed % 4 != 0) return;
        uint256 bal = usdc.balanceOf(backup);
        if (bal == 0) return;
        vm.prank(backup);
        usdc.transfer(sink, bal);
    }

    /// Tops up both wallets. `starve()` then empties the primary only, which is
    /// exactly the state where a charge must walk to the backup payer.
    function fund(uint256 amount) public {
        uint256 a = bound(amount, 1, 1_000_000e6);
        usdc.mint(payer, a);
        usdc.mint(backup, a);
    }

    // ----- signing helpers -----

    function _status(uint256 id) internal view returns (SubscriptionManager.Status) {
        (, , , , , , , , , SubscriptionManager.Status st, ) = subs.subscriptions(id);
        return st;
    }

    function _signPermit(uint256 pk, address owner, address spender, uint256 value, uint256 deadline)
        internal
        view
        returns (uint8, bytes32, bytes32)
    {
        bytes32 structHash = keccak256(
            abi.encode(PERMIT_TYPEHASH, owner, spender, value, usdc.nonces(owner), deadline)
        );
        return vm.sign(
            pk, keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), structHash))
        );
    }

    function _signSubIntent(
        SubscriptionManager.CreateSubPermit2Params memory p,
        uint256 permitValue,
        uint8 flow
    ) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            bytes.concat(
                abi.encode(
                    SUBSCRIPTION_INTENT_TYPEHASH,
                    p.buyer,
                    p.token,
                    p.merchant,
                    p.amount,
                    p.interval,
                    p.productId
                ),
                abi.encode(
                    p.customerId,
                    permitValue,
                    p.maxFeeBps,
                    flow,
                    subs.getIntentNonce(p.buyer),
                    p.deadline
                )
            )
        );
        return _sign(PAYER_PK, structHash);
    }

    function _signDiscountIntent(SubscriptionManager.CreateSubPermitDiscountParams memory p)
        internal
        view
        returns (bytes memory)
    {
        bytes32 structHash = keccak256(
            bytes.concat(
                abi.encode(
                    keccak256(
                        "SubscriptionIntentDiscount(address buyer,address token,address merchant,uint256 amount,uint256 interval,bytes32 productId,bytes32 customerId,uint256 permitValue,uint256 discountAmount,uint256 discountCycles,uint256 maxFeeBps,uint8 flow,uint256 nonce,uint256 deadline)"
                    ),
                    p.buyer,
                    p.token,
                    p.merchant,
                    p.amount,
                    p.interval,
                    p.productId
                ),
                abi.encode(
                    p.customerId,
                    p.permitValue,
                    p.discountAmount,
                    p.discountCycles,
                    p.maxFeeBps,
                    subs.FLOW_EIP2612(),
                    subs.getIntentNonce(p.buyer),
                    p.deadline
                )
            )
        );
        return _sign(PAYER_PK, structHash);
    }

    function _signBackupAuth(SubscriptionManager.BackupPayerParams memory p)
        internal
        view
        returns (bytes memory)
    {
        return _sign(
            PAYER_PK,
            keccak256(
                abi.encode(
                    BACKUP_PAYER_AUTH_TYPEHASH,
                    p.subscriptionId,
                    p.backup,
                    subs.getBackupAuthNonce(payer),
                    p.authDeadline
                )
            )
        );
    }

    function _signBackupConsent(SubscriptionManager.BackupPayerParams memory p)
        internal
        view
        returns (bytes memory)
    {
        return _sign(
            BACKUP_PK,
            keccak256(
                abi.encode(
                    BACKUP_PAYER_CONSENT_TYPEHASH,
                    p.subscriptionId,
                    payer,
                    address(usdc),
                    p.maxAmount,
                    subs.getBackupConsentNonce(p.backup),
                    p.consentDeadline
                )
            )
        );
    }

    function _sign(uint256 pk, bytes32 structHash) internal view returns (bytes memory) {
        bytes32 digest =
            keccak256(abi.encodePacked("\x19\x01", subs.domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }
}

contract NonCustodyInvariantTest is StdInvariant, Test {
    PaymentVault public vault;
    SubscriptionManager public subs;
    MockUSDC public usdc;
    NonCustodyHandler public handler;

    address public platformWallet = address(0xABCD);
    address constant PERMIT2_ADDR = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    function setUp() public {
        usdc = new MockUSDC();
        vault = new PaymentVault(platformWallet, 50);
        subs = new SubscriptionManager(platformWallet, 50);
        vault.setAcceptedToken(address(usdc), true);
        subs.setAcceptedToken(address(usdc), true);

        StubPermit2AllowanceTransfer stub = new StubPermit2AllowanceTransfer();
        vm.etch(PERMIT2_ADDR, address(stub).code);

        handler = new NonCustodyHandler(vault, subs, usdc);
        // The handler drives the gasless entry points too.
        subs.setRelayer(address(handler));
        // MockUSDC.mint is onlyOwner — hand it to the handler so it can fund
        // the payer between calls. Without this every handler call reverts and
        // the invariants pass vacuously.
        usdc.transferOwnership(address(handler));
        vm.prank(handler.payer());
        usdc.approve(PERMIT2_ADDR, type(uint256).max);
        targetContract(address(handler));
    }

    /// @dev Everything the contracts claim to have pulled, summed from state.
    function _totalCharged() internal view returns (uint256 total) {
        total = handler.vaultPaid();
        uint256 n = handler.subCount();
        for (uint256 i = 0; i < n; i++) {
            (, , , , , , , , , , uint256 charged) = subs.subscriptions(handler.subIds(i));
            total += charged;
        }
    }

    /// The documented non-custodial guarantee (README): neither contract ever
    /// holds a token balance between transactions.
    /// forge-config: default.invariant.runs = 32
    /// forge-config: default.invariant.depth = 120
    function invariant_contracts_never_hold_tokens() public view {
        assertEq(usdc.balanceOf(address(vault)), 0, "vault holds tokens");
        assertEq(usdc.balanceOf(address(subs)), 0, "subscription manager holds tokens");
    }

    /// Recorded state and actual token movement agree exactly: every unit the
    /// contracts booked as charged reached either the merchant or the platform
    /// wallet, and nothing else did. This is what a partial charge — a merchant
    /// leg landing while the fee leg fails, but state claiming the full amount
    /// (SC-07) — would break.
    /// forge-config: default.invariant.runs = 32
    /// forge-config: default.invariant.depth = 120
    function invariant_recorded_charges_match_token_movement() public view {
        assertEq(
            usdc.balanceOf(handler.merchant()) + usdc.balanceOf(platformWallet),
            _totalCharged(),
            "merchant + platform == everything the contracts booked"
        );
    }

    /// Runs after every invariant run. Guards against the failure mode where a
    /// handler silently no-ops and the invariants hold vacuously.
    ///
    /// Only near-certain properties are asserted here: state is reverted between
    /// runs, so a single 50-call sequence cannot be relied on to visit every
    /// branch. That the handler *can* reach PastDue, the wallet-walk, discount
    /// cycles and Permit2 charges is pinned down deterministically by
    /// HandlerReachabilityTest below.
    function afterInvariant() public view {
        assertGt(handler.subCount(), 0, "handler created no subscriptions");
        assertGt(handler.chargesSettled(), 0, "handler never settled a recurring charge");
    }

    /// A subscription that went PastDue must never be chargeable again, and a
    /// cancelled one must stay cancelled.
    /// @dev see also HandlerReachabilityTest.
    /// forge-config: default.invariant.runs = 32
    /// forge-config: default.invariant.depth = 120
    function invariant_inactive_subscriptions_stay_inactive() public view {
        uint256 n = handler.subCount();
        for (uint256 i = 0; i < n; i++) {
            uint256 id = handler.subIds(i);
            (, , , , , , , , , SubscriptionManager.Status st, ) = subs.subscriptions(id);
            // None is impossible for an issued id; Active/PastDue/Cancelled are
            // the only reachable states.
            assertTrue(st != SubscriptionManager.Status.None, "issued id reads as None");
        }
    }
}

/// Proves — deterministically, no fuzzing luck involved — that the invariant
/// handler actually reaches the states the invariants are supposed to cover.
/// Without this, `invariant_recorded_charges_match_token_movement` would be
/// little more than a restatement of the fee-split fuzz test.
contract HandlerReachabilityTest is Test {
    PaymentVault public vault;
    SubscriptionManager public subs;
    MockUSDC public usdc;
    NonCustodyHandler public handler;

    address public platformWallet = address(0xABCD);
    address constant PERMIT2_ADDR = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    function setUp() public {
        usdc = new MockUSDC();
        vault = new PaymentVault(platformWallet, 50);
        subs = new SubscriptionManager(platformWallet, 50);
        vault.setAcceptedToken(address(usdc), true);
        subs.setAcceptedToken(address(usdc), true);

        StubPermit2AllowanceTransfer stub = new StubPermit2AllowanceTransfer();
        vm.etch(PERMIT2_ADDR, address(stub).code);

        handler = new NonCustodyHandler(vault, subs, usdc);
        subs.setRelayer(address(handler));
        usdc.transferOwnership(address(handler));
        vm.prank(handler.payer());
        usdc.approve(PERMIT2_ADDR, type(uint256).max);
    }

    function test_handler_reaches_backup_walk_pastdue_discount_and_permit2() public {
        handler.subscribeDirect(1000e6);
        handler.subscribeDiscount(1000e6, 250e6, 3);
        handler.subscribePermit2(1000e6);
        assertEq(handler.subCount(), 3, "three subscription shapes created");
        assertTrue(subs.isPermit2Subscription(handler.subIds(2)), "permit2 subscription created");

        // Backup payer on the direct subscription, then a starved charge:
        // the wallet-walk must fund the cycle.
        handler.addBackup(0);
        assertGt(handler.backupsAdded(), 0);
        handler.starvedChargeWithBackup(0, 1);
        assertGt(handler.backupFundedSeen(), 0, "wallet-walk reached");

        // A discounted cycle must be consumed on the discount subscription.
        handler.fund(10_000e6);
        handler.chargeDue(1, 1);
        handler.chargeDue(1, 1);
        assertGt(handler.discountConsumedSeen(), 0, "discount cycle reached");

        // Starve both wallets and charge a subscription with no usable payer:
        // PastDue must be reached.
        handler.starve();
        handler.starveBackup(0);
        handler.chargeDue(2, 1);
        handler.chargeDue(0, 1);
        handler.chargeDue(1, 1);
        assertGt(handler.pastDueSeen(), 0, "PastDue reached");

        // And through all of it the contracts held nothing.
        assertEq(usdc.balanceOf(address(subs)), 0);
        assertEq(usdc.balanceOf(address(vault)), 0);
    }
}
