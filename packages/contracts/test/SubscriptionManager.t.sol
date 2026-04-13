// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/SubscriptionManager.sol";
import "../src/MockUSDC.sol";

contract SubscriptionManagerTest is Test {
    SubscriptionManager public subs;
    MockUSDC public usdc;

    address public owner = makeAddr("owner");
    address public platformWallet = makeAddr("platform");
    address public merchant = makeAddr("merchant");
    address public subscriber = makeAddr("subscriber");
    address public relayer = makeAddr("relayer");

    bytes32 public productId = keccak256("prod_pro");
    bytes32 public customerId = keccak256("cust_789");

    uint256 public constant MONTHLY = 30 days;
    uint256 public constant AMOUNT = 10e6;

    function setUp() public {
        usdc = new MockUSDC();
        vm.startPrank(owner);
        subs = new SubscriptionManager(platformWallet, 50);
        subs.setAcceptedToken(address(usdc), true);
        subs.setRelayer(relayer);
        vm.stopPrank();

        usdc.mint(subscriber, 10000e6);
        vm.prank(subscriber);
        usdc.approve(address(subs), type(uint256).max);
    }

    function test_createSubscription() public {
        vm.prank(subscriber);
        uint256 subId = subs.createSubscription(address(usdc), merchant, AMOUNT, MONTHLY, productId, customerId);
        assertEq(subId, 0);
        uint256 fee = (AMOUNT * 50) / 10000;
        assertEq(usdc.balanceOf(merchant), AMOUNT - fee);
        assertEq(usdc.balanceOf(platformWallet), fee);
    }

    function test_createSubscription_emits_event() public {
        vm.prank(subscriber);
        vm.expectEmit(true, true, true, false);
        emit SubscriptionManager.SubscriptionCreated(0, subscriber, merchant, address(usdc), AMOUNT, MONTHLY, productId, customerId);
        subs.createSubscription(address(usdc), merchant, AMOUNT, MONTHLY, productId, customerId);
    }

    function test_chargeSubscription() public {
        vm.prank(subscriber);
        uint256 subId = subs.createSubscription(address(usdc), merchant, AMOUNT, MONTHLY, productId, customerId);
        vm.warp(block.timestamp + MONTHLY);
        vm.prank(relayer);
        subs.chargeSubscription(subId);
        uint256 fee = (AMOUNT * 50) / 10000;
        assertEq(usdc.balanceOf(merchant), (AMOUNT - fee) * 2);
    }

    function test_chargeSubscription_by_subscriber() public {
        vm.prank(subscriber);
        uint256 subId = subs.createSubscription(address(usdc), merchant, AMOUNT, MONTHLY, productId, customerId);
        vm.warp(block.timestamp + MONTHLY);
        vm.prank(subscriber);
        subs.chargeSubscription(subId);
        uint256 fee = (AMOUNT * 50) / 10000;
        assertEq(usdc.balanceOf(merchant), (AMOUNT - fee) * 2);
    }

    function test_chargeSubscription_by_merchant() public {
        vm.prank(subscriber);
        uint256 subId = subs.createSubscription(address(usdc), merchant, AMOUNT, MONTHLY, productId, customerId);
        vm.warp(block.timestamp + MONTHLY);
        vm.prank(merchant);
        subs.chargeSubscription(subId);
        uint256 fee = (AMOUNT * 50) / 10000;
        assertEq(usdc.balanceOf(merchant), (AMOUNT - fee) * 2);
    }

    function test_chargeSubscription_unauthorized() public {
        vm.prank(subscriber);
        uint256 subId = subs.createSubscription(address(usdc), merchant, AMOUNT, MONTHLY, productId, customerId);
        vm.warp(block.timestamp + MONTHLY);
        address random = makeAddr("random");
        vm.prank(random);
        vm.expectRevert("Not authorized to charge");
        subs.chargeSubscription(subId);
    }

    function test_chargeSubscription_too_early() public {
        vm.prank(subscriber);
        uint256 subId = subs.createSubscription(address(usdc), merchant, AMOUNT, MONTHLY, productId, customerId);
        vm.prank(relayer);
        vm.expectRevert("Not due yet");
        subs.chargeSubscription(subId);
    }

    function test_chargeSubscription_insufficient_balance() public {
        address poorSub = makeAddr("poorSub");
        usdc.mint(poorSub, AMOUNT);
        vm.startPrank(poorSub);
        usdc.approve(address(subs), type(uint256).max);
        uint256 subId = subs.createSubscription(address(usdc), merchant, AMOUNT, MONTHLY, productId, customerId);
        vm.stopPrank();
        vm.warp(block.timestamp + MONTHLY);
        vm.prank(merchant);
        subs.chargeSubscription(subId);
        (,,,,,,,,, SubscriptionManager.Status status,) = subs.subscriptions(subId);
        assertEq(uint8(status), uint8(SubscriptionManager.Status.PastDue));
    }

    function test_cancelSubscription_by_subscriber() public {
        vm.prank(subscriber);
        uint256 subId = subs.createSubscription(address(usdc), merchant, AMOUNT, MONTHLY, productId, customerId);
        vm.prank(subscriber);
        subs.cancelSubscription(subId);
        (,,,,,,,,, SubscriptionManager.Status status,) = subs.subscriptions(subId);
        assertEq(uint8(status), uint8(SubscriptionManager.Status.Cancelled));
    }

    function test_cancelSubscription_by_merchant() public {
        vm.prank(subscriber);
        uint256 subId = subs.createSubscription(address(usdc), merchant, AMOUNT, MONTHLY, productId, customerId);
        vm.prank(merchant);
        subs.cancelSubscription(subId);
        (,,,,,,,,, SubscriptionManager.Status status,) = subs.subscriptions(subId);
        assertEq(uint8(status), uint8(SubscriptionManager.Status.Cancelled));
    }

    function test_cancelSubscription_unauthorized() public {
        vm.prank(subscriber);
        uint256 subId = subs.createSubscription(address(usdc), merchant, AMOUNT, MONTHLY, productId, customerId);
        address random = makeAddr("random");
        vm.prank(random);
        vm.expectRevert("Not authorized");
        subs.cancelSubscription(subId);
    }

    function test_requestAndAcceptSubscriptionWalletUpdate() public {
        vm.prank(subscriber);
        uint256 subId = subs.createSubscription(address(usdc), merchant, AMOUNT, MONTHLY, productId, customerId);
        address newWallet = makeAddr("newWallet");
        usdc.mint(newWallet, 10000e6);
        vm.prank(newWallet);
        usdc.approve(address(subs), type(uint256).max);

        vm.prank(subscriber);
        subs.requestSubscriptionWalletUpdate(subId, newWallet);
        assertEq(subs.pendingWalletUpdates(subId), newWallet);

        vm.prank(newWallet);
        subs.acceptSubscriptionWalletUpdate(subId);

        (address storedSubscriber,,,,,,,,,,) = subs.subscriptions(subId);
        assertEq(storedSubscriber, newWallet);
        assertEq(subs.pendingWalletUpdates(subId), address(0));
    }

    function test_requestSubscriptionWalletUpdate_unauthorized() public {
        vm.prank(subscriber);
        uint256 subId = subs.createSubscription(address(usdc), merchant, AMOUNT, MONTHLY, productId, customerId);
        address attacker = makeAddr("attacker");
        vm.prank(attacker);
        vm.expectRevert("Not subscriber");
        subs.requestSubscriptionWalletUpdate(subId, attacker);
    }

    function test_acceptSubscriptionWalletUpdate_unauthorized() public {
        vm.prank(subscriber);
        uint256 subId = subs.createSubscription(address(usdc), merchant, AMOUNT, MONTHLY, productId, customerId);
        address newWallet = makeAddr("newWallet");
        vm.prank(subscriber);
        subs.requestSubscriptionWalletUpdate(subId, newWallet);

        address attacker = makeAddr("attacker");
        vm.prank(attacker);
        vm.expectRevert("Not pending for caller");
        subs.acceptSubscriptionWalletUpdate(subId);
    }

    function test_cancel_clears_pendingWalletUpdate() public {
        vm.prank(subscriber);
        uint256 subId = subs.createSubscription(address(usdc), merchant, AMOUNT, MONTHLY, productId, customerId);
        address newWallet = makeAddr("newWallet");
        vm.prank(subscriber);
        subs.requestSubscriptionWalletUpdate(subId, newWallet);
        assertEq(subs.pendingWalletUpdates(subId), newWallet);

        vm.prank(subscriber);
        subs.cancelSubscription(subId);
        assertEq(subs.pendingWalletUpdates(subId), address(0));
    }

    function test_accept_wallet_update_after_cancel_reverts() public {
        vm.prank(subscriber);
        uint256 subId = subs.createSubscription(address(usdc), merchant, AMOUNT, MONTHLY, productId, customerId);
        address newWallet = makeAddr("newWallet");
        vm.prank(subscriber);
        subs.requestSubscriptionWalletUpdate(subId, newWallet);

        vm.prank(subscriber);
        subs.cancelSubscription(subId);

        // Cancel already deleted the pending entry, so accept sees no pending update
        vm.prank(newWallet);
        vm.expectRevert("Not pending for caller");
        subs.acceptSubscriptionWalletUpdate(subId);
    }

    function test_chargeSubscription_late_anchors_to_nextChargeDate() public {
        vm.prank(subscriber);
        uint256 subId = subs.createSubscription(address(usdc), merchant, AMOUNT, MONTHLY, productId, customerId);

        uint256 expectedFirstCharge = block.timestamp + MONTHLY;

        vm.warp(expectedFirstCharge + 5 days);
        vm.prank(relayer);
        subs.chargeSubscription(subId);

        (,,,,, uint256 nextChargeDate,,,,,) = subs.subscriptions(subId);
        // Should be anchored: previous nextChargeDate + interval, NOT block.timestamp + interval
        assertEq(nextChargeDate, expectedFirstCharge + MONTHLY);
        // Sanity: not equal to block.timestamp + interval
        assertTrue(nextChargeDate != block.timestamp + MONTHLY);
    }

    function test_setPlatformWallet_zero_reverts() public {
        vm.prank(owner);
        vm.expectRevert("Invalid wallet");
        subs.setPlatformWallet(address(0));
    }

    function test_pause_blocks_createSubscription() public {
        vm.prank(owner);
        subs.pause();
        vm.prank(subscriber);
        vm.expectRevert();
        subs.createSubscription(address(usdc), merchant, AMOUNT, MONTHLY, productId, customerId);
    }

    function test_pause_blocks_chargeSubscription() public {
        vm.prank(subscriber);
        uint256 subId = subs.createSubscription(address(usdc), merchant, AMOUNT, MONTHLY, productId, customerId);
        vm.warp(block.timestamp + MONTHLY);
        vm.prank(owner);
        subs.pause();
        vm.prank(relayer);
        vm.expectRevert();
        subs.chargeSubscription(subId);
    }

    function test_unpause_allows_createSubscription() public {
        vm.startPrank(owner);
        subs.pause();
        subs.unpause();
        vm.stopPrank();
        vm.prank(subscriber);
        subs.createSubscription(address(usdc), merchant, AMOUNT, MONTHLY, productId, customerId);
    }

    function test_charge_cancelled_subscription_reverts() public {
        vm.prank(subscriber);
        uint256 subId = subs.createSubscription(address(usdc), merchant, AMOUNT, MONTHLY, productId, customerId);
        vm.prank(subscriber);
        subs.cancelSubscription(subId);
        vm.warp(block.timestamp + MONTHLY);
        vm.prank(relayer);
        vm.expectRevert("Not active");
        subs.chargeSubscription(subId);
    }
}
