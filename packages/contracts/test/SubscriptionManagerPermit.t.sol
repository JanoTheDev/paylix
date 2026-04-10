// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/SubscriptionManager.sol";
import "../src/MockUSDC.sol";

contract SubscriptionManagerPermitTest is Test {
    SubscriptionManager public subs;
    MockUSDC public usdc;

    address public owner = makeAddr("owner");
    address public platformWallet = makeAddr("platform");
    address public merchant = makeAddr("merchant");
    address public relayer = makeAddr("relayer");

    uint256 public buyerPrivateKey = 0xB0B;
    address public buyer = vm.addr(buyerPrivateKey);

    bytes32 public productId = keccak256("prod_pro");
    bytes32 public customerId = keccak256("cust_789");

    uint256 public constant MONTHLY = 30 days;
    uint256 public constant AMOUNT = 10e6;

    function setUp() public {
        vm.startPrank(owner);
        subs = new SubscriptionManager(platformWallet, 50);
        usdc = new MockUSDC();
        subs.setAcceptedToken(address(usdc), true);
        subs.setRelayer(relayer);
        vm.stopPrank();

        usdc.mint(buyer, 100000e6);
    }

    // ----- Happy path -----

    function test_createSubscriptionWithPermit_success() public {
        uint256 permitValue = AMOUNT * 1000;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(permitValue, block.timestamp + 1 hours);

        vm.prank(relayer);
        uint256 subId = subs.createSubscriptionWithPermit(
            address(usdc), buyer, merchant, AMOUNT, MONTHLY,
            productId, customerId,
            permitValue, block.timestamp + 1 hours, v, r, s
        );

        assertEq(subId, 0, "first subscription has id 0");

        (address subSubscriber, , , uint256 subAmount, , , , , , ,) = subs.subscriptions(subId);
        assertEq(subSubscriber, buyer, "subscriber is buyer, not relayer");
        assertEq(subAmount, AMOUNT, "amount stored");

        uint256 fee = (AMOUNT * 50) / 10000;
        assertEq(usdc.balanceOf(merchant), AMOUNT - fee, "first charge delivered to merchant");
        assertEq(usdc.balanceOf(platformWallet), fee, "fee delivered to platform");
    }

    function test_createSubscriptionWithPermit_enables_recurring_charges() public {
        uint256 permitValue = AMOUNT * 1000;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(permitValue, block.timestamp + 1 hours);

        vm.prank(relayer);
        uint256 subId = subs.createSubscriptionWithPermit(
            address(usdc), buyer, merchant, AMOUNT, MONTHLY,
            productId, customerId,
            permitValue, block.timestamp + 1 hours, v, r, s
        );

        // Fast-forward past the next charge date
        vm.warp(block.timestamp + MONTHLY + 1);

        // Keeper can now charge (no permit needed — allowance already set by the permit)
        subs.chargeSubscription(subId);

        uint256 fee = (AMOUNT * 50) / 10000;
        // Two charges total (initial + this one)
        assertEq(usdc.balanceOf(merchant), (AMOUNT - fee) * 2, "second charge succeeded");
    }

    function test_createSubscriptionWithPermit_emits_event_with_buyer() public {
        uint256 permitValue = AMOUNT * 1000;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(permitValue, block.timestamp + 1 hours);

        vm.expectEmit(true, true, true, true);
        emit SubscriptionManager.SubscriptionCreated(
            0, buyer, merchant, address(usdc), AMOUNT, MONTHLY, productId, customerId
        );

        vm.prank(relayer);
        subs.createSubscriptionWithPermit(
            address(usdc), buyer, merchant, AMOUNT, MONTHLY,
            productId, customerId,
            permitValue, block.timestamp + 1 hours, v, r, s
        );
    }

    // ----- Authorization -----

    function test_createSubscriptionWithPermit_reverts_when_not_relayer() public {
        uint256 permitValue = AMOUNT * 1000;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(permitValue, block.timestamp + 1 hours);

        vm.prank(makeAddr("attacker"));
        vm.expectRevert("Only relayer");
        subs.createSubscriptionWithPermit(
            address(usdc), buyer, merchant, AMOUNT, MONTHLY,
            productId, customerId,
            permitValue, block.timestamp + 1 hours, v, r, s
        );
    }

    // ----- Validation -----

    function test_createSubscriptionWithPermit_reverts_on_permit_under_amount() public {
        uint256 permitValue = AMOUNT - 1;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(permitValue, block.timestamp + 1 hours);

        vm.prank(relayer);
        vm.expectRevert("Permit < amount");
        subs.createSubscriptionWithPermit(
            address(usdc), buyer, merchant, AMOUNT, MONTHLY,
            productId, customerId,
            permitValue, block.timestamp + 1 hours, v, r, s
        );
    }

    function test_createSubscriptionWithPermit_reverts_on_zero_interval() public {
        uint256 permitValue = AMOUNT * 1000;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(permitValue, block.timestamp + 1 hours);

        vm.prank(relayer);
        vm.expectRevert("Invalid interval");
        subs.createSubscriptionWithPermit(
            address(usdc), buyer, merchant, AMOUNT, 0,
            productId, customerId,
            permitValue, block.timestamp + 1 hours, v, r, s
        );
    }

    function test_createSubscriptionWithPermit_reverts_on_zero_buyer() public {
        uint256 permitValue = AMOUNT * 1000;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(permitValue, block.timestamp + 1 hours);

        vm.prank(relayer);
        vm.expectRevert("Invalid buyer");
        subs.createSubscriptionWithPermit(
            address(usdc), address(0), merchant, AMOUNT, MONTHLY,
            productId, customerId,
            permitValue, block.timestamp + 1 hours, v, r, s
        );
    }

    // ----- Helpers -----

    function _signPermit(uint256 value, uint256 deadline)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 PERMIT_TYPEHASH = keccak256(
            "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
        );
        uint256 nonce = usdc.nonces(buyer);
        bytes32 structHash = keccak256(
            abi.encode(
                PERMIT_TYPEHASH,
                buyer,
                address(subs),
                value,
                nonce,
                deadline
            )
        );
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), structHash)
        );
        (v, r, s) = vm.sign(buyerPrivateKey, digest);
    }
}
