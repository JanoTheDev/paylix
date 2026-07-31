// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/SubscriptionManager.sol";
import "../src/MockUSDC.sol";

/// @dev Tests the wallet-walk flow: primary subscriber runs out of USDC,
/// contract falls through to the next backup payer that can cover.
///
/// Both sides must have signed: the primary's BackupPayerAuth AND the backup
/// wallet's own BackupPayerConsent (SC-01). A wallet that never signed can
/// never be walked to, no matter what allowance it happens to carry.
contract SubscriptionManagerBackupTest is Test {
    SubscriptionManager public subs;
    MockUSDC public usdc;

    address public owner = makeAddr("owner");
    address public platformWallet = makeAddr("platform");
    address public merchant = makeAddr("merchant");
    address public relayer = makeAddr("relayer");

    uint256 public buyerPrivateKey = 0xB0B;
    address public buyer = vm.addr(buyerPrivateKey);

    uint256 public backupPrivateKey = 0xBACF;
    address public backup = vm.addr(backupPrivateKey);

    uint256 public backup2PrivateKey = 0xBAC2;
    address public backup2 = vm.addr(backup2PrivateKey);

    uint256 public malloryPrivateKey = 0x1337;
    address public mallory = vm.addr(malloryPrivateKey);

    bytes32 public productId = keccak256("prod_pro");
    bytes32 public customerId = keccak256("cust_walk");

    uint256 public constant MONTHLY = 30 days;
    uint256 public constant AMOUNT = 10e6;
    uint256 public constant MAX_FEE_BPS = 50;
    uint256 public constant BACKUP_CAP = AMOUNT * 10;

    bytes32 private constant SUBSCRIPTION_INTENT_TYPEHASH = keccak256(
        "SubscriptionIntent(address buyer,address token,address merchant,uint256 amount,uint256 interval,bytes32 productId,bytes32 customerId,uint256 permitValue,uint256 maxFeeBps,uint8 flow,uint256 nonce,uint256 deadline)"
    );

    bytes32 private constant BACKUP_PAYER_AUTH_TYPEHASH = keccak256(
        "BackupPayerAuth(uint256 subscriptionId,address backup,uint256 nonce,uint256 deadline)"
    );

    bytes32 private constant BACKUP_PAYER_CONSENT_TYPEHASH = keccak256(
        "BackupPayerConsent(uint256 subscriptionId,address subscriber,address token,uint256 maxAmount,uint256 nonce,uint256 deadline)"
    );

    function setUp() public {
        usdc = new MockUSDC();
        vm.startPrank(owner);
        subs = new SubscriptionManager(platformWallet, 50);
        subs.setAcceptedToken(address(usdc), true);
        subs.setRelayer(relayer);
        vm.stopPrank();

        usdc.mint(buyer, 100000e6);
        usdc.mint(backup, 100000e6);
        usdc.mint(backup2, 100000e6);
        usdc.mint(mallory, 100000e6);
    }

    function test_charge_walks_to_backup_when_primary_empty() public {
        uint256 subId = _createSub();
        _addBackup(subId, backup, backupPrivateKey, AMOUNT * 1000, BACKUP_CAP);

        // Drain primary so it can't cover the next charge.
        uint256 primaryBal = usdc.balanceOf(buyer);
        vm.startPrank(buyer);
        usdc.transfer(address(0xdead), primaryBal);
        vm.stopPrank();

        vm.warp(block.timestamp + MONTHLY + 1);

        uint256 backupBefore = usdc.balanceOf(backup);
        uint256 merchantBefore = usdc.balanceOf(merchant);

        vm.prank(relayer);
        subs.chargeSubscription(subId);

        uint256 fee = (AMOUNT * 50) / 10000;
        // Backup paid; primary untouched.
        assertEq(usdc.balanceOf(backup), backupBefore - AMOUNT);
        assertEq(usdc.balanceOf(merchant), merchantBefore + AMOUNT - fee);
    }

    function test_backup_funded_cycle_emits_subscriber_not_payer() public {
        uint256 subId = _createSub();
        _addBackup(subId, backup, backupPrivateKey, AMOUNT * 1000, BACKUP_CAP);

        uint256 primaryBal = usdc.balanceOf(buyer);
        vm.prank(buyer);
        usdc.transfer(address(0xdead), primaryBal);

        vm.warp(block.timestamp + MONTHLY + 1);

        uint256 fee = (AMOUNT * 50) / 10000;
        // PaymentReceived keeps the subscription's subscriber in the indexed
        // slot so address filters stay correct (SC-11)...
        vm.expectEmit(true, true, true, true);
        emit SubscriptionManager.PaymentReceived(
            subId, buyer, merchant, address(usdc), AMOUNT, fee, block.timestamp
        );
        // ...and the real funding wallet rides on its own event.
        vm.expectEmit(true, true, true, true);
        emit SubscriptionManager.SubscriptionPaymentFunded(subId, backup, AMOUNT);

        vm.prank(relayer);
        subs.chargeSubscription(subId);
    }

    function test_charge_still_uses_primary_when_funded() public {
        uint256 subId = _createSub();
        _addBackup(subId, backup, backupPrivateKey, AMOUNT * 1000, BACKUP_CAP);

        vm.warp(block.timestamp + MONTHLY + 1);
        uint256 primaryBefore = usdc.balanceOf(buyer);
        uint256 backupBefore = usdc.balanceOf(backup);

        vm.prank(relayer);
        subs.chargeSubscription(subId);

        // Primary paid; backup untouched.
        assertEq(usdc.balanceOf(buyer), primaryBefore - AMOUNT);
        assertEq(usdc.balanceOf(backup), backupBefore);
    }

    function test_charge_walks_through_second_backup_when_first_empty() public {
        uint256 subId = _createSub();
        _addBackup(subId, backup, backupPrivateKey, AMOUNT * 1000, BACKUP_CAP);
        _addBackup(subId, backup2, backup2PrivateKey, AMOUNT * 1000, BACKUP_CAP);

        // Drain primary AND first backup. Cache balances before prank —
        // vm.prank only applies to the next call, and balanceOf is a call.
        uint256 buyerBal = usdc.balanceOf(buyer);
        vm.prank(buyer);
        usdc.transfer(address(0xdead), buyerBal);
        uint256 backupBal = usdc.balanceOf(backup);
        vm.prank(backup);
        usdc.transfer(address(0xdead), backupBal);

        vm.warp(block.timestamp + MONTHLY + 1);

        uint256 backup2Before = usdc.balanceOf(backup2);
        vm.prank(relayer);
        subs.chargeSubscription(subId);

        assertEq(usdc.balanceOf(backup2), backup2Before - AMOUNT);
    }

    function test_past_due_when_all_payers_empty() public {
        uint256 subId = _createSub();
        _addBackup(subId, backup, backupPrivateKey, AMOUNT * 1000, BACKUP_CAP);

        uint256 buyerBal = usdc.balanceOf(buyer);
        vm.prank(buyer);
        usdc.transfer(address(0xdead), buyerBal);
        uint256 backupBal = usdc.balanceOf(backup);
        vm.prank(backup);
        usdc.transfer(address(0xdead), backupBal);

        vm.warp(block.timestamp + MONTHLY + 1);

        vm.prank(relayer);
        subs.chargeSubscription(subId);

        (, , , , , , , , , SubscriptionManager.Status st, ) = subs.subscriptions(subId);
        assertEq(uint256(st), uint256(SubscriptionManager.Status.PastDue));
    }

    function test_add_reverts_on_bad_subscriber_sig() public {
        uint256 subId = _createSub();

        // Sign auth with the WRONG key (backup2's key, not buyer's).
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory badAuth = _signBackupAuth(subId, backup, buyer, backup2PrivateKey, deadline);
        bytes memory consent =
            _signBackupConsent(subId, buyer, backup, backupPrivateKey, BACKUP_CAP, deadline);

        SubscriptionManager.BackupPayerParams memory p =
            _buildBackupParams(subId, backup, backupPrivateKey, AMOUNT * 1000, BACKUP_CAP, deadline);

        vm.prank(relayer);
        vm.expectRevert("Bad subscriber auth");
        subs.addSubscriptionBackupPayer(p, badAuth, consent);
    }

    function test_add_reverts_on_duplicate() public {
        uint256 subId = _createSub();
        _addBackup(subId, backup, backupPrivateKey, AMOUNT * 1000, BACKUP_CAP);

        uint256 deadline = block.timestamp + 1 hours;
        bytes memory authSig = _signBackupAuth(subId, backup, buyer, buyerPrivateKey, deadline);
        bytes memory consent =
            _signBackupConsent(subId, buyer, backup, backupPrivateKey, BACKUP_CAP, deadline);
        SubscriptionManager.BackupPayerParams memory p =
            _buildBackupParams(subId, backup, backupPrivateKey, AMOUNT * 1000, BACKUP_CAP, deadline);

        vm.prank(relayer);
        vm.expectRevert("Already added");
        subs.addSubscriptionBackupPayer(p, authSig, consent);
    }

    // ----- SC-01: the backup wallet's own consent is mandatory -----

    function test_add_reverts_when_backup_never_consented() public {
        uint256 subId = _createSub();

        uint256 deadline = block.timestamp + 1 hours;
        bytes memory authSig = _signBackupAuth(subId, backup, buyer, buyerPrivateKey, deadline);
        // "Consent" signed by the subscriber, not by the backup wallet.
        bytes memory forgedConsent =
            _signBackupConsent(subId, buyer, backup, buyerPrivateKey, BACKUP_CAP, deadline);
        SubscriptionManager.BackupPayerParams memory p =
            _buildBackupParams(subId, backup, backupPrivateKey, AMOUNT * 1000, BACKUP_CAP, deadline);

        vm.prank(relayer);
        vm.expectRevert("Bad backup consent");
        subs.addSubscriptionBackupPayer(p, authSig, forgedConsent);

        assertEq(subs.getSubscriptionBackups(subId).length, 0);
    }

    function test_add_reverts_when_consent_is_for_a_different_subscription() public {
        uint256 subId = _createSub();
        uint256 deadline = block.timestamp + 1 hours;

        bytes memory authSig = _signBackupAuth(subId, backup, buyer, buyerPrivateKey, deadline);
        // Backup consented to subscription 999, not this one.
        bytes memory consent =
            _signBackupConsent(999, buyer, backup, backupPrivateKey, BACKUP_CAP, deadline);
        SubscriptionManager.BackupPayerParams memory p =
            _buildBackupParams(subId, backup, backupPrivateKey, AMOUNT * 1000, BACKUP_CAP, deadline);

        vm.prank(relayer);
        vm.expectRevert("Bad backup consent");
        subs.addSubscriptionBackupPayer(p, authSig, consent);
    }

    function test_add_reverts_on_replayed_consent() public {
        uint256 subId = _createSub();
        uint256 subId2 = _createSub();
        uint256 deadline = block.timestamp + 1 hours;

        bytes memory consent =
            _signBackupConsent(subId, buyer, backup, backupPrivateKey, BACKUP_CAP, deadline);
        bytes memory authSig = _signBackupAuth(subId, backup, buyer, buyerPrivateKey, deadline);
        SubscriptionManager.BackupPayerParams memory p =
            _buildBackupParams(subId, backup, backupPrivateKey, AMOUNT * 1000, BACKUP_CAP, deadline);
        vm.prank(relayer);
        subs.addSubscriptionBackupPayer(p, authSig, consent);

        // Same consent signature, second subscription — the consent nonce moved.
        bytes memory authSig2 = _signBackupAuth(subId2, backup, buyer, buyerPrivateKey, deadline);
        SubscriptionManager.BackupPayerParams memory p2 =
            _buildBackupParams(subId2, backup, backupPrivateKey, AMOUNT * 1000, BACKUP_CAP, deadline);
        vm.prank(relayer);
        vm.expectRevert("Bad backup consent");
        subs.addSubscriptionBackupPayer(p2, authSig2, consent);
    }

    function test_add_reverts_when_permit_fails_and_allowance_missing() public {
        // No allowance and garbage permit components: the permit failure must
        // not be swallowed (SC-01).
        uint256 subId = _createSub();
        uint256 deadline = block.timestamp + 1 hours;
        address noAllowance = vm.addr(0xFEED);
        usdc.mint(noAllowance, 100000e6);

        bytes memory authSig = _signBackupAuth(subId, noAllowance, buyer, buyerPrivateKey, deadline);
        bytes memory consent =
            _signBackupConsent(subId, buyer, noAllowance, 0xFEED, BACKUP_CAP, deadline);

        SubscriptionManager.BackupPayerParams memory p = SubscriptionManager.BackupPayerParams({
            subscriptionId: subId,
            backup: noAllowance,
            authDeadline: deadline,
            maxAmount: BACKUP_CAP,
            consentDeadline: deadline,
            permitValue: AMOUNT * 1000,
            permitDeadline: deadline,
            v: 27,
            r: bytes32(uint256(1)),
            s: bytes32(uint256(2))
        });

        vm.prank(relayer);
        vm.expectRevert("Backup permit failed");
        subs.addSubscriptionBackupPayer(p, authSig, consent);

        assertEq(subs.getSubscriptionBackups(subId).length, 0);
    }

    function test_wallet_with_standing_allowance_is_not_drainable() public {
        // The Critical scenario: Mallory owns a subscription that pays Mallory,
        // and tries to attach the victim — who already granted this contract a
        // standing allowance for their own subscription — as her backup payer.
        uint256 victimSub = _createSub(); // buyer grants AMOUNT * 1000 allowance
        assertGt(usdc.allowance(buyer, address(subs)), AMOUNT);

        vm.startPrank(mallory);
        usdc.approve(address(subs), type(uint256).max);
        uint256 malloryFee = (AMOUNT * 50) / 10000;
        uint256 subId = subs.createSubscription(
            address(usdc), mallory, AMOUNT, MONTHLY, productId, customerId
        );
        vm.stopPrank();

        uint256 deadline = block.timestamp + 1 hours;
        bytes memory authSig = _signBackupAuth(subId, buyer, mallory, malloryPrivateKey, deadline);
        // Mallory cannot produce the victim's consent; the best she can do is
        // sign it herself.
        bytes memory forged =
            _signBackupConsent(subId, mallory, buyer, malloryPrivateKey, BACKUP_CAP, deadline);
        SubscriptionManager.BackupPayerParams memory p = SubscriptionManager.BackupPayerParams({
            subscriptionId: subId,
            backup: buyer,
            authDeadline: deadline,
            maxAmount: BACKUP_CAP,
            consentDeadline: deadline,
            permitValue: AMOUNT * 1000,
            permitDeadline: deadline,
            v: 27,
            r: bytes32(uint256(1)),
            s: bytes32(uint256(2))
        });

        vm.prank(relayer);
        vm.expectRevert("Bad backup consent");
        subs.addSubscriptionBackupPayer(p, authSig, forged);

        // Mallory drains her own wallet and tries to make the keeper pull from
        // the victim instead. The subscription just goes PastDue.
        uint256 victimBefore = usdc.balanceOf(buyer);
        uint256 malloryBal = usdc.balanceOf(mallory);
        vm.prank(mallory);
        usdc.transfer(address(0xdead), malloryBal);

        vm.warp(block.timestamp + MONTHLY + 1);
        vm.prank(relayer);
        subs.chargeSubscription(subId);

        (, , , , , , , , , SubscriptionManager.Status st, ) = subs.subscriptions(subId);
        assertEq(uint256(st), uint256(SubscriptionManager.Status.PastDue));
        assertEq(usdc.balanceOf(buyer), victimBefore, "victim funds untouched");
        assertEq(subs.getSubscriptionBackups(subId).length, 0);
        // The victim's own subscription is unharmed.
        (, , , , , , , , , SubscriptionManager.Status victimStatus, ) = subs.subscriptions(victimSub);
        assertEq(uint256(victimStatus), uint256(SubscriptionManager.Status.Active));
        assertGt(malloryFee, 0);
    }

    /// The cap is the backup's own number and may be below the cycle amount.
    /// That wallet must then be skipped — not silently topped up to the full
    /// charge. This is the negative side of the `_selectPayer` cap guard.
    function test_charge_skips_backup_whose_consented_cap_is_below_amount() public {
        uint256 subId = _createSub();
        // Backup consented to at most AMOUNT - 1 per cycle; the charge is AMOUNT.
        _addBackup(subId, backup, backupPrivateKey, AMOUNT * 1000, AMOUNT - 1);

        uint256 buyerBal = usdc.balanceOf(buyer);
        vm.prank(buyer);
        usdc.transfer(address(0xdead), buyerBal);

        vm.warp(block.timestamp + MONTHLY + 1);
        uint256 backupBefore = usdc.balanceOf(backup);
        vm.prank(relayer);
        subs.chargeSubscription(subId);

        assertEq(usdc.balanceOf(backup), backupBefore, "under-cap backup not charged");
        (, , , , , , , , , SubscriptionManager.Status st, ) = subs.subscriptions(subId);
        assertEq(uint256(st), uint256(SubscriptionManager.Status.PastDue));
    }

    /// A backup whose cap is under the full amount is skipped, but one behind
    /// it in the list with a sufficient cap still pays.
    function test_charge_walks_past_under_cap_backup_to_the_next_one() public {
        uint256 subId = _createSub();
        _addBackup(subId, backup, backupPrivateKey, AMOUNT * 1000, AMOUNT - 1);
        _addBackup(subId, backup2, backup2PrivateKey, AMOUNT * 1000, AMOUNT);

        uint256 buyerBal = usdc.balanceOf(buyer);
        vm.prank(buyer);
        usdc.transfer(address(0xdead), buyerBal);

        vm.warp(block.timestamp + MONTHLY + 1);
        uint256 backupBefore = usdc.balanceOf(backup);
        uint256 backup2Before = usdc.balanceOf(backup2);
        vm.prank(relayer);
        subs.chargeSubscription(subId);

        assertEq(usdc.balanceOf(backup), backupBefore, "under-cap backup skipped");
        assertEq(usdc.balanceOf(backup2), backup2Before - AMOUNT, "next backup paid");
    }

    function test_charge_uses_backup_when_cap_exactly_equals_amount() public {
        uint256 subId = _createSub();
        _addBackup(subId, backup, backupPrivateKey, AMOUNT * 1000, AMOUNT);

        uint256 buyerBal = usdc.balanceOf(buyer);
        vm.prank(buyer);
        usdc.transfer(address(0xdead), buyerBal);

        vm.warp(block.timestamp + MONTHLY + 1);
        uint256 backupBefore = usdc.balanceOf(backup);
        vm.prank(relayer);
        subs.chargeSubscription(subId);
        assertEq(usdc.balanceOf(backup), backupBefore - AMOUNT);
    }

    function test_add_reverts_on_zero_cap() public {
        uint256 subId = _createSub();
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory authSig = _signBackupAuth(subId, backup, buyer, buyerPrivateKey, deadline);
        bytes memory consent =
            _signBackupConsent(subId, buyer, backup, backupPrivateKey, 0, deadline);
        SubscriptionManager.BackupPayerParams memory p =
            _buildBackupParams(subId, backup, backupPrivateKey, AMOUNT * 1000, 0, deadline);

        vm.prank(relayer);
        vm.expectRevert("Zero backup cap");
        subs.addSubscriptionBackupPayer(p, authSig, consent);
    }

    // ----- SC-10: nonce isolation -----

    function test_adding_a_backup_does_not_void_a_pending_subscription_intent() public {
        uint256 subId = _createSub();

        // Buyer signs a second subscription intent (a checkout tab left open).
        uint256 nonceBefore = subs.getIntentNonce(buyer);

        _addBackup(subId, backup, backupPrivateKey, AMOUNT * 1000, BACKUP_CAP);

        assertEq(subs.getIntentNonce(buyer), nonceBefore, "checkout intent nonce untouched");
        assertEq(subs.getBackupAuthNonce(buyer), 1, "auth consumed its own counter");

        // ...and that pending intent still settles.
        uint256 secondSub = _createSub();
        assertEq(secondSub, subId + 1);
    }

    function test_backup_consent_does_not_burn_the_backup_wallets_intent_nonce() public {
        uint256 subId = _createSub();
        uint256 backupIntentNonce = subs.getIntentNonce(backup);

        _addBackup(subId, backup, backupPrivateKey, AMOUNT * 1000, BACKUP_CAP);

        assertEq(subs.getIntentNonce(backup), backupIntentNonce);
        assertEq(subs.getBackupConsentNonce(backup), 1);
    }

    // ----- Wallet migration clears consent -----

    function test_wallet_migration_clears_backup_payers() public {
        uint256 subId = _createSub();
        _addBackup(subId, backup, backupPrivateKey, AMOUNT * 1000, BACKUP_CAP);

        address newWallet = vm.addr(0xACE);
        usdc.mint(newWallet, 100000e6);
        vm.prank(newWallet);
        usdc.approve(address(subs), type(uint256).max);

        vm.prank(buyer);
        subs.requestSubscriptionWalletUpdate(subId, newWallet);

        vm.expectEmit(true, true, true, true);
        emit SubscriptionManager.SubscriptionBackupPayerRemoved(subId, backup);

        vm.prank(newWallet);
        subs.acceptSubscriptionWalletUpdate(subId);

        // Bob consented to back the buyer, not newWallet.
        assertEq(subs.getSubscriptionBackups(subId).length, 0);
        assertEq(subs.backupPayerMaxAmount(subId, backup), 0);

        // Proof it is not just bookkeeping: drain the new owner and the charge
        // goes PastDue instead of reaching into the old backup.
        uint256 newBal = usdc.balanceOf(newWallet);
        vm.prank(newWallet);
        usdc.transfer(address(0xdead), newBal);

        uint256 backupBefore = usdc.balanceOf(backup);
        vm.warp(block.timestamp + MONTHLY + 1);
        vm.prank(relayer);
        subs.chargeSubscription(subId);

        assertEq(usdc.balanceOf(backup), backupBefore, "old backup untouched after migration");
        (, , , , , , , , , SubscriptionManager.Status st, ) = subs.subscriptions(subId);
        assertEq(uint256(st), uint256(SubscriptionManager.Status.PastDue));
    }

    function test_add_reverts_when_not_relayer() public {
        uint256 subId = _createSub();
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory authSig = _signBackupAuth(subId, backup, buyer, buyerPrivateKey, deadline);
        bytes memory consent =
            _signBackupConsent(subId, buyer, backup, backupPrivateKey, BACKUP_CAP, deadline);
        SubscriptionManager.BackupPayerParams memory p =
            _buildBackupParams(subId, backup, backupPrivateKey, AMOUNT * 1000, BACKUP_CAP, deadline);

        vm.prank(makeAddr("stranger"));
        vm.expectRevert("Only relayer");
        subs.addSubscriptionBackupPayer(p, authSig, consent);
    }

    function test_add_reverts_for_nonexistent_subscription() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory authSig = _signBackupAuth(4242, backup, buyer, buyerPrivateKey, deadline);
        bytes memory consent =
            _signBackupConsent(4242, buyer, backup, backupPrivateKey, BACKUP_CAP, deadline);
        SubscriptionManager.BackupPayerParams memory p =
            _buildBackupParams(4242, backup, backupPrivateKey, AMOUNT * 1000, BACKUP_CAP, deadline);

        vm.prank(relayer);
        vm.expectRevert("No such subscription");
        subs.addSubscriptionBackupPayer(p, authSig, consent);
    }

    // ----- Removal -----

    function test_remove_by_subscriber_success() public {
        uint256 subId = _createSub();
        _addBackup(subId, backup, backupPrivateKey, AMOUNT * 1000, BACKUP_CAP);

        vm.prank(buyer);
        subs.removeSubscriptionBackupPayer(subId, backup);

        address[] memory left = subs.getSubscriptionBackups(subId);
        assertEq(left.length, 0);
        assertEq(subs.backupPayerMaxAmount(subId, backup), 0);
    }

    /// SC-02: the wallet whose funds are at risk can always walk away.
    function test_backup_can_remove_itself() public {
        uint256 subId = _createSub();
        _addBackup(subId, backup, backupPrivateKey, AMOUNT * 1000, BACKUP_CAP);

        vm.expectEmit(true, true, true, true);
        emit SubscriptionManager.SubscriptionBackupPayerRemoved(subId, backup);

        vm.prank(backup);
        subs.removeSubscriptionBackupPayer(subId, backup);

        assertEq(subs.getSubscriptionBackups(subId).length, 0);

        // And it stays removed: the next charge falls through to PastDue
        // rather than pulling from the ex-backup.
        uint256 buyerBal = usdc.balanceOf(buyer);
        vm.prank(buyer);
        usdc.transfer(address(0xdead), buyerBal);

        uint256 backupBefore = usdc.balanceOf(backup);
        vm.warp(block.timestamp + MONTHLY + 1);
        vm.prank(relayer);
        subs.chargeSubscription(subId);

        assertEq(usdc.balanceOf(backup), backupBefore, "ex-backup untouched");
        (, , , , , , , , , SubscriptionManager.Status st, ) = subs.subscriptions(subId);
        assertEq(uint256(st), uint256(SubscriptionManager.Status.PastDue));
    }

    function test_remove_reverts_for_unrelated_caller() public {
        uint256 subId = _createSub();
        _addBackup(subId, backup, backupPrivateKey, AMOUNT * 1000, BACKUP_CAP);

        vm.prank(makeAddr("stranger"));
        vm.expectRevert("Not subscriber or backup");
        subs.removeSubscriptionBackupPayer(subId, backup);
    }

    // ----- Helpers -----

    function _createSub() internal returns (uint256) {
        uint256 deadline = block.timestamp + 1 hours;
        SubscriptionManager.CreateSubPermitParams memory p = SubscriptionManager.CreateSubPermitParams({
            token: address(usdc),
            buyer: buyer,
            merchant: merchant,
            amount: AMOUNT,
            interval: MONTHLY,
            productId: productId,
            customerId: customerId,
            permitValue: AMOUNT * 1000,
            maxFeeBps: MAX_FEE_BPS,
            deadline: deadline,
            v: 0,
            r: bytes32(0),
            s: bytes32(0)
        });

        // sign permit for USDC allowance
        bytes32 PERMIT_TYPEHASH = keccak256(
            "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
        );
        bytes32 permitStruct = keccak256(
            abi.encode(
                PERMIT_TYPEHASH,
                buyer,
                address(subs),
                p.permitValue,
                usdc.nonces(buyer),
                p.deadline
            )
        );
        bytes32 permitDigest = keccak256(
            abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), permitStruct)
        );
        (p.v, p.r, p.s) = vm.sign(buyerPrivateKey, permitDigest);

        // Build the signature BEFORE the prank — vm.prank applies to the next
        // call, and the signing helper makes view calls of its own.
        bytes memory intentSig = _signSubIntent(p);
        vm.prank(relayer);
        return subs.createSubscriptionWithPermit(p, intentSig);
    }

    function _signSubIntent(SubscriptionManager.CreateSubPermitParams memory p)
        internal
        view
        returns (bytes memory)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                SUBSCRIPTION_INTENT_TYPEHASH,
                p.buyer,
                p.token,
                p.merchant,
                p.amount,
                p.interval,
                p.productId,
                p.customerId,
                p.permitValue,
                p.maxFeeBps,
                subs.FLOW_EIP2612(),
                subs.getIntentNonce(buyer),
                p.deadline
            )
        );
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", subs.domainSeparator(), structHash)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(buyerPrivateKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function _addBackup(
        uint256 subId,
        address backupAddr,
        uint256 backupKey,
        uint256 permitValue,
        uint256 maxAmount
    ) internal {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory authSig = _signBackupAuth(subId, backupAddr, buyer, buyerPrivateKey, deadline);
        bytes memory consentSig =
            _signBackupConsent(subId, buyer, backupAddr, backupKey, maxAmount, deadline);
        SubscriptionManager.BackupPayerParams memory p =
            _buildBackupParams(subId, backupAddr, backupKey, permitValue, maxAmount, deadline);

        vm.prank(relayer);
        subs.addSubscriptionBackupPayer(p, authSig, consentSig);
    }

    function _buildBackupParams(
        uint256 subId,
        address backupAddr,
        uint256 backupKey,
        uint256 permitValue,
        uint256 maxAmount,
        uint256 deadline
    ) internal view returns (SubscriptionManager.BackupPayerParams memory) {
        bytes32 PERMIT_TYPEHASH = keccak256(
            "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
        );
        bytes32 permitStruct = keccak256(
            abi.encode(
                PERMIT_TYPEHASH,
                backupAddr,
                address(subs),
                permitValue,
                usdc.nonces(backupAddr),
                deadline
            )
        );
        bytes32 permitDigest = keccak256(
            abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), permitStruct)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(backupKey, permitDigest);

        return SubscriptionManager.BackupPayerParams({
            subscriptionId: subId,
            backup: backupAddr,
            authDeadline: deadline,
            maxAmount: maxAmount,
            consentDeadline: deadline,
            permitValue: permitValue,
            permitDeadline: deadline,
            v: v,
            r: r,
            s: s
        });
    }

    /// @dev The BackupPayerAuth nonce is the *subscriber's* intent nonce.
    /// `signerKey` is separate so tests can sign with the wrong key.
    function _signBackupAuth(
        uint256 subId,
        address backupAddr,
        address subscriberAddr,
        uint256 signerKey,
        uint256 deadline
    ) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                BACKUP_PAYER_AUTH_TYPEHASH,
                subId,
                backupAddr,
                subs.getBackupAuthNonce(subscriberAddr),
                deadline
            )
        );
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", subs.domainSeparator(), structHash)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function _signBackupConsent(
        uint256 subId,
        address subscriberAddr,
        address backupAddr,
        uint256 signerKey,
        uint256 maxAmount,
        uint256 deadline
    ) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                BACKUP_PAYER_CONSENT_TYPEHASH,
                subId,
                subscriberAddr,
                address(usdc),
                maxAmount,
                subs.getBackupConsentNonce(backupAddr),
                deadline
            )
        );
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", subs.domainSeparator(), structHash)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, digest);
        return abi.encodePacked(r, s, v);
    }
}
