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

    bytes32 public productId = keccak256("prod_pro");
    bytes32 public customerId = keccak256("cust_789");

    uint256 public constant MONTHLY = 30 days;
    uint256 public constant AMOUNT = 10e6;

    function setUp() public {
        vm.startPrank(owner);
        subs = new SubscriptionManager(platformWallet, 50);
        usdc = new MockUSDC();
        subs.setAcceptedToken(address(usdc), true);
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
        subs.chargeSubscription(subId);
        uint256 fee = (AMOUNT * 50) / 10000;
        assertEq(usdc.balanceOf(merchant), (AMOUNT - fee) * 2);
    }

    function test_chargeSubscription_too_early() public {
        vm.prank(subscriber);
        uint256 subId = subs.createSubscription(address(usdc), merchant, AMOUNT, MONTHLY, productId, customerId);
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

    function test_updateSubscriptionWallet() public {
        vm.prank(subscriber);
        uint256 subId = subs.createSubscription(address(usdc), merchant, AMOUNT, MONTHLY, productId, customerId);
        address newWallet = makeAddr("newWallet");
        usdc.mint(newWallet, 10000e6);
        vm.prank(newWallet);
        usdc.approve(address(subs), type(uint256).max);
        vm.prank(subscriber);
        subs.updateSubscriptionWallet(subId, newWallet);
        (address storedSubscriber,,,,,,,,,,) = subs.subscriptions(subId);
        assertEq(storedSubscriber, newWallet);
    }

    function test_charge_cancelled_subscription_reverts() public {
        vm.prank(subscriber);
        uint256 subId = subs.createSubscription(address(usdc), merchant, AMOUNT, MONTHLY, productId, customerId);
        vm.prank(subscriber);
        subs.cancelSubscription(subId);
        vm.warp(block.timestamp + MONTHLY);
        vm.expectRevert("Not active");
        subs.chargeSubscription(subId);
    }
}
