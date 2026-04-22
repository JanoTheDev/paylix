// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/SubscriptionManager.sol";
import "../src/MockUSDC.sol";

/// @dev Tests the wallet-walk flow: primary subscriber runs out of USDC,
/// contract falls through to the next backup payer that can cover.
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

    bytes32 public productId = keccak256("prod_pro");
    bytes32 public customerId = keccak256("cust_walk");

    uint256 public constant MONTHLY = 30 days;
    uint256 public constant AMOUNT = 10e6;

    bytes32 private constant SUBSCRIPTION_INTENT_TYPEHASH = keccak256(
        "SubscriptionIntent(address buyer,address token,address merchant,uint256 amount,uint256 interval,bytes32 productId,bytes32 customerId,uint256 permitValue,uint256 nonce,uint256 deadline)"
    );

    bytes32 private constant BACKUP_PAYER_AUTH_TYPEHASH = keccak256(
        "BackupPayerAuth(uint256 subscriptionId,address backup,uint256 nonce,uint256 deadline)"
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
    }

    function test_charge_walks_to_backup_when_primary_empty() public {
        uint256 subId = _createSub();
        _addBackup(subId, backup, backupPrivateKey, AMOUNT * 1000);

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

    function test_charge_still_uses_primary_when_funded() public {
        uint256 subId = _createSub();
        _addBackup(subId, backup, backupPrivateKey, AMOUNT * 1000);

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
        _addBackup(subId, backup, backupPrivateKey, AMOUNT * 1000);
        _addBackup(subId, backup2, backup2PrivateKey, AMOUNT * 1000);

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
        _addBackup(subId, backup, backupPrivateKey, AMOUNT * 1000);

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
        uint256 authDeadline = block.timestamp + 1 hours;
        bytes memory badAuth = _signBackupAuth(subId, backup, backup2PrivateKey, authDeadline);

        SubscriptionManager.BackupPayerParams memory p = _buildBackupParams(
            subId,
            backup,
            backupPrivateKey,
            AMOUNT * 1000,
            authDeadline
        );

        vm.prank(relayer);
        vm.expectRevert("Bad subscriber auth");
        subs.addSubscriptionBackupPayer(p, badAuth);
    }

    function test_add_reverts_on_duplicate() public {
        uint256 subId = _createSub();
        _addBackup(subId, backup, backupPrivateKey, AMOUNT * 1000);

        uint256 authDeadline = block.timestamp + 1 hours;
        bytes memory authSig = _signBackupAuth(subId, backup, buyerPrivateKey, authDeadline);
        SubscriptionManager.BackupPayerParams memory p = _buildBackupParams(
            subId,
            backup,
            backupPrivateKey,
            AMOUNT * 1000,
            authDeadline
        );

        vm.prank(relayer);
        vm.expectRevert("Already added");
        subs.addSubscriptionBackupPayer(p, authSig);
    }

    function test_remove_by_subscriber_success() public {
        uint256 subId = _createSub();
        _addBackup(subId, backup, backupPrivateKey, AMOUNT * 1000);

        vm.prank(buyer);
        subs.removeSubscriptionBackupPayer(subId, backup);

        address[] memory left = subs.getSubscriptionBackups(subId);
        assertEq(left.length, 0);
    }

    function test_remove_reverts_for_non_subscriber() public {
        uint256 subId = _createSub();
        _addBackup(subId, backup, backupPrivateKey, AMOUNT * 1000);

        vm.prank(backup);
        vm.expectRevert("Not subscriber");
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

        // sign SubscriptionIntent
        bytes32 intentStruct = keccak256(
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
                subs.getIntentNonce(buyer),
                p.deadline
            )
        );
        bytes32 intentDigest = keccak256(
            abi.encodePacked("\x19\x01", subs.domainSeparator(), intentStruct)
        );
        (uint8 iv, bytes32 ir, bytes32 is_) = vm.sign(buyerPrivateKey, intentDigest);
        bytes memory intentSig = abi.encodePacked(ir, is_, iv);

        vm.prank(relayer);
        return subs.createSubscriptionWithPermit(p, intentSig);
    }

    function _addBackup(
        uint256 subId,
        address backupAddr,
        uint256 backupKey,
        uint256 permitValue
    ) internal {
        uint256 authDeadline = block.timestamp + 1 hours;
        bytes memory authSig = _signBackupAuth(subId, backupAddr, buyerPrivateKey, authDeadline);
        SubscriptionManager.BackupPayerParams memory p = _buildBackupParams(
            subId,
            backupAddr,
            backupKey,
            permitValue,
            authDeadline
        );

        vm.prank(relayer);
        subs.addSubscriptionBackupPayer(p, authSig);
    }

    function _buildBackupParams(
        uint256 subId,
        address backupAddr,
        uint256 backupKey,
        uint256 permitValue,
        uint256 authDeadline
    ) internal view returns (SubscriptionManager.BackupPayerParams memory) {
        uint256 permitDeadline = block.timestamp + 1 hours;

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
                permitDeadline
            )
        );
        bytes32 permitDigest = keccak256(
            abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), permitStruct)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(backupKey, permitDigest);

        return SubscriptionManager.BackupPayerParams({
            subscriptionId: subId,
            backup: backupAddr,
            authDeadline: authDeadline,
            permitValue: permitValue,
            permitDeadline: permitDeadline,
            v: v,
            r: r,
            s: s
        });
    }

    function _signBackupAuth(
        uint256 subId,
        address backupAddr,
        uint256 signerKey,
        uint256 deadline
    ) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                BACKUP_PAYER_AUTH_TYPEHASH,
                subId,
                backupAddr,
                subs.getIntentNonce(buyer),
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
