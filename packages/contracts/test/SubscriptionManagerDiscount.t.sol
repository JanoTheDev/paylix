// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/SubscriptionManager.sol";
import "../src/MockUSDC.sol";

/// Covers createSubscriptionWithPermitDiscount: on-chain encoding of
/// "once" and "repeating" subscription coupon shapes.
contract SubscriptionManagerDiscountTest is Test {
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
    uint256 public constant DISCOUNT = 2_500_000; // 25%

    bytes32 private constant SUBSCRIPTION_INTENT_DISCOUNT_TYPEHASH = keccak256(
        "SubscriptionIntentDiscount(address buyer,address token,address merchant,uint256 amount,uint256 interval,bytes32 productId,bytes32 customerId,uint256 permitValue,uint256 discountAmount,uint256 discountCycles,uint256 nonce,uint256 deadline)"
    );

    function setUp() public {
        usdc = new MockUSDC();
        vm.startPrank(owner);
        subs = new SubscriptionManager(platformWallet, 50);
        subs.setAcceptedToken(address(usdc), true);
        subs.setRelayer(relayer);
        vm.stopPrank();
        usdc.mint(buyer, 100_000e6);
    }

    function test_once_discounts_only_first_charge() public {
        (
            SubscriptionManager.CreateSubPermitDiscountParams memory p,
            bytes memory intentSig
        ) = _build(DISCOUNT, 1);

        vm.prank(relayer);
        uint256 subId = subs.createSubscriptionWithPermitDiscount(p, intentSig);

        // Cycle 0: charged AMOUNT - DISCOUNT.
        uint256 expectedFirstMerchant = _afterFee(AMOUNT - DISCOUNT);
        assertEq(usdc.balanceOf(merchant), expectedFirstMerchant);

        // Cycle 1: full AMOUNT — discount exhausted.
        vm.warp(block.timestamp + MONTHLY + 1);
        vm.prank(relayer);
        subs.chargeSubscription(subId);
        assertEq(
            usdc.balanceOf(merchant),
            expectedFirstMerchant + _afterFee(AMOUNT)
        );

        // State: remaining should be 0.
        (, uint256 remaining) = subs.subscriptionDiscounts(subId);
        assertEq(remaining, 0);
    }

    function test_repeating_applies_for_N_cycles() public {
        (
            SubscriptionManager.CreateSubPermitDiscountParams memory p,
            bytes memory intentSig
        ) = _build(DISCOUNT, 3);

        vm.prank(relayer);
        uint256 subId = subs.createSubscriptionWithPermitDiscount(p, intentSig);

        uint256 running = _afterFee(AMOUNT - DISCOUNT); // cycle 0 (creation)
        for (uint256 i = 0; i < 4; i++) {
            vm.warp(block.timestamp + MONTHLY + 1);
            vm.prank(relayer);
            subs.chargeSubscription(subId);
            // 3 total discounted cycles: 0, 1, 2. i is the post-creation
            // charge index (0..3); first two of these (cycles 1, 2) are
            // still discounted; cycles 3 and 4 run at full price.
            bool discounted = i < 2;
            running += discounted
                ? _afterFee(AMOUNT - DISCOUNT)
                : _afterFee(AMOUNT);
        }
        assertEq(usdc.balanceOf(merchant), running);
    }

    function test_rejects_zero_cycles() public {
        (
            SubscriptionManager.CreateSubPermitDiscountParams memory p,
            bytes memory intentSig
        ) = _build(DISCOUNT, 0);
        vm.prank(relayer);
        vm.expectRevert("Zero discount cycles");
        subs.createSubscriptionWithPermitDiscount(p, intentSig);
    }

    function test_rejects_discount_gte_amount() public {
        (
            SubscriptionManager.CreateSubPermitDiscountParams memory p,
            bytes memory intentSig
        ) = _build(AMOUNT, 1);
        vm.prank(relayer);
        vm.expectRevert("Discount >= amount");
        subs.createSubscriptionWithPermitDiscount(p, intentSig);
    }

    function test_rejects_tampered_discount() public {
        (
            SubscriptionManager.CreateSubPermitDiscountParams memory p,
            bytes memory intentSig
        ) = _build(DISCOUNT, 1);
        p.discountAmount = DISCOUNT + 1; // relayer tries to lower the charge
        vm.prank(relayer);
        vm.expectRevert("Invalid intent signature");
        subs.createSubscriptionWithPermitDiscount(p, intentSig);
    }

    // ----- Helpers -----

    function _afterFee(uint256 charge) internal view returns (uint256) {
        return charge - (charge * subs.platformFee()) / 10000;
    }

    function _build(uint256 discount, uint256 cycles)
        internal
        view
        returns (
            SubscriptionManager.CreateSubPermitDiscountParams memory p,
            bytes memory intentSig
        )
    {
        p = SubscriptionManager.CreateSubPermitDiscountParams({
            token: address(usdc),
            buyer: buyer,
            merchant: merchant,
            amount: AMOUNT,
            interval: MONTHLY,
            productId: productId,
            customerId: customerId,
            permitValue: AMOUNT * 1000,
            discountAmount: discount,
            discountCycles: cycles,
            deadline: block.timestamp + 1 hours,
            v: 0,
            r: bytes32(0),
            s: bytes32(0)
        });
        p = _signPermit(p);
        intentSig = _signIntent(p);
    }

    function _signPermit(
        SubscriptionManager.CreateSubPermitDiscountParams memory p
    ) internal view returns (SubscriptionManager.CreateSubPermitDiscountParams memory) {
        bytes32 PERMIT_TYPEHASH = keccak256(
            "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
        );
        uint256 nonce = usdc.nonces(buyer);
        bytes32 structHash = keccak256(
            abi.encode(PERMIT_TYPEHASH, buyer, address(subs), p.permitValue, nonce, p.deadline)
        );
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), structHash)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(buyerPrivateKey, digest);
        p.v = v;
        p.r = r;
        p.s = s;
        return p;
    }

    function _signIntent(
        SubscriptionManager.CreateSubPermitDiscountParams memory p
    ) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                SUBSCRIPTION_INTENT_DISCOUNT_TYPEHASH,
                p.buyer,
                p.token,
                p.merchant,
                p.amount,
                p.interval,
                p.productId,
                p.customerId,
                p.permitValue,
                p.discountAmount,
                p.discountCycles,
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
}
