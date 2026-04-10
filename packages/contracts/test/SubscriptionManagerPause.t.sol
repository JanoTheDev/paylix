// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/SubscriptionManager.sol";
import "../src/MockUSDC.sol";

contract SubscriptionManagerPauseTest is Test {
    SubscriptionManager public subs;
    MockUSDC public usdc;

    address public owner = makeAddr("owner");
    address public platformWallet = makeAddr("platform");
    address public merchant = makeAddr("merchant");
    address public relayer = makeAddr("relayer");

    uint256 public buyerPrivateKey = 0xB0B;
    address public buyer = vm.addr(buyerPrivateKey);

    bytes32 public productId = keccak256("prod_pause_sub");
    bytes32 public customerId = keccak256("cust_pause_sub");

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

    // ----- Pause -----

    function test_default_is_unpaused() public view {
        assertFalse(subs.gaslessPaused());
    }

    function test_createSubscriptionWithPermit_reverts_when_paused() public {
        vm.prank(owner);
        subs.setGaslessPaused(true);

        uint256 permitValue = AMOUNT * 1000;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(permitValue, block.timestamp + 1 hours);

        vm.prank(relayer);
        vm.expectRevert("Gasless paused");
        subs.createSubscriptionWithPermit(
            address(usdc), buyer, merchant, AMOUNT, MONTHLY,
            productId, customerId, permitValue, block.timestamp + 1 hours, v, r, s
        );
    }

    function test_direct_createSubscription_still_works_when_paused() public {
        vm.prank(owner);
        subs.setGaslessPaused(true);

        vm.prank(buyer);
        usdc.approve(address(subs), type(uint256).max);

        vm.prank(buyer);
        subs.createSubscription(address(usdc), merchant, AMOUNT, MONTHLY, productId, customerId);

        uint256 fee = (AMOUNT * 50) / 10000;
        assertEq(usdc.balanceOf(merchant), AMOUNT - fee);
    }

    // ----- Relayer cancellation: subscriber -----

    function test_cancelForSubscriber_success() public {
        uint256 subId = _createSub();

        vm.prank(relayer);
        subs.cancelSubscriptionByRelayerForSubscriber(subId, buyer);

        (, , , , , , , , , SubscriptionManager.Status status, ) = subs.subscriptions(subId);
        assertEq(uint8(status), uint8(SubscriptionManager.Status.Cancelled));
    }

    function test_cancelForSubscriber_reverts_when_not_relayer() public {
        uint256 subId = _createSub();

        vm.prank(makeAddr("attacker"));
        vm.expectRevert("Only relayer");
        subs.cancelSubscriptionByRelayerForSubscriber(subId, buyer);
    }

    function test_cancelForSubscriber_reverts_on_address_mismatch() public {
        uint256 subId = _createSub();

        vm.prank(relayer);
        vm.expectRevert("Not the subscriber");
        subs.cancelSubscriptionByRelayerForSubscriber(subId, makeAddr("stranger"));
    }

    function test_cancelForSubscriber_reverts_when_already_cancelled() public {
        uint256 subId = _createSub();

        vm.prank(relayer);
        subs.cancelSubscriptionByRelayerForSubscriber(subId, buyer);

        vm.prank(relayer);
        vm.expectRevert("Already inactive");
        subs.cancelSubscriptionByRelayerForSubscriber(subId, buyer);
    }

    function test_cancelForSubscriber_emits_SubscriptionCancelled() public {
        uint256 subId = _createSub();

        vm.expectEmit(true, true, true, true);
        emit SubscriptionManager.SubscriptionCancelled(subId);

        vm.prank(relayer);
        subs.cancelSubscriptionByRelayerForSubscriber(subId, buyer);
    }

    // ----- Relayer cancellation: merchant -----

    function test_cancelForMerchant_success() public {
        uint256 subId = _createSub();

        vm.prank(relayer);
        subs.cancelSubscriptionByRelayerForMerchant(subId, merchant);

        (, , , , , , , , , SubscriptionManager.Status status, ) = subs.subscriptions(subId);
        assertEq(uint8(status), uint8(SubscriptionManager.Status.Cancelled));
    }

    function test_cancelForMerchant_reverts_on_wrong_merchant() public {
        uint256 subId = _createSub();

        vm.prank(relayer);
        vm.expectRevert("Not the merchant");
        subs.cancelSubscriptionByRelayerForMerchant(subId, makeAddr("wrong"));
    }

    function test_cancelForMerchant_reverts_when_not_relayer() public {
        uint256 subId = _createSub();

        vm.prank(merchant);
        vm.expectRevert("Only relayer");
        subs.cancelSubscriptionByRelayerForMerchant(subId, merchant);
    }

    // ----- Helpers -----

    function _createSub() internal returns (uint256) {
        uint256 permitValue = AMOUNT * 1000;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(permitValue, block.timestamp + 1 hours);

        vm.prank(relayer);
        return subs.createSubscriptionWithPermit(
            address(usdc), buyer, merchant, AMOUNT, MONTHLY,
            productId, customerId, permitValue, block.timestamp + 1 hours, v, r, s
        );
    }

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
