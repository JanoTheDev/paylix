// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/PaymentVault.sol";
import "../src/SubscriptionManager.sol";
import "../src/MockUSDC.sol";

/// SC-03: `setPlatformFee` used to apply retroactively to already-signed
/// intents and to every live subscription. The fee ceiling is now part of both
/// signed intents; these tests pin that behaviour down.
contract PlatformFeeBindingTest is Test {
    PaymentVault public vault;
    SubscriptionManager public subs;
    MockUSDC public usdc;

    address public owner = makeAddr("owner");
    address public platformWallet = makeAddr("platform");
    address public merchant = makeAddr("merchant");
    address public relayer = makeAddr("relayer");

    uint256 public buyerPk = 0xA11CE;
    address public buyer = vm.addr(buyerPk);

    bytes32 public productId = keccak256("prod");
    bytes32 public customerId = keccak256("cust");

    uint256 public constant AMOUNT = 1000e6;
    uint256 public constant MONTHLY = 30 days;

    bytes32 private constant PAYMENT_INTENT_TYPEHASH = keccak256(
        "PaymentIntent(address buyer,address token,address merchant,uint256 amount,bytes32 productId,bytes32 customerId,uint256 maxFeeBps,uint8 flow,uint256 nonce,uint256 deadline)"
    );
    bytes32 private constant SUBSCRIPTION_INTENT_TYPEHASH = keccak256(
        "SubscriptionIntent(address buyer,address token,address merchant,uint256 amount,uint256 interval,bytes32 productId,bytes32 customerId,uint256 permitValue,uint256 maxFeeBps,uint8 flow,uint256 nonce,uint256 deadline)"
    );

    function setUp() public {
        usdc = new MockUSDC();
        vm.startPrank(owner);
        vault = new PaymentVault(platformWallet, 50);
        subs = new SubscriptionManager(platformWallet, 50);
        vault.setAcceptedToken(address(usdc), true);
        subs.setAcceptedToken(address(usdc), true);
        vault.setRelayer(relayer);
        subs.setRelayer(relayer);
        vm.stopPrank();

        usdc.mint(buyer, 1_000_000e6);
    }

    // ----- PaymentVault -----

    function test_vault_intent_is_void_after_owner_raises_fee() public {
        uint256 deadline = block.timestamp + 1 hours;
        PaymentVault.PaymentIntentData memory d = _vaultData(AMOUNT, 50, deadline);
        PaymentVault.PermitSig memory permitSig = _signVaultPermit(AMOUNT, deadline);
        bytes memory intentSig = _signVaultIntent(d);

        // Owner front-runs the settlement with a 20x fee raise.
        vm.prank(owner);
        vault.setPlatformFee(1000);

        vm.prank(relayer);
        vm.expectRevert("Fee above signed max");
        vault.createPaymentWithPermit(d, permitSig, intentSig);

        assertEq(usdc.balanceOf(merchant), 0, "merchant not shortchanged");
    }

    function test_vault_settles_when_fee_stays_within_signed_ceiling() public {
        uint256 deadline = block.timestamp + 1 hours;
        // Buyer explicitly agreed to up to 200 bps.
        PaymentVault.PaymentIntentData memory d = _vaultData(AMOUNT, 200, deadline);
        PaymentVault.PermitSig memory permitSig = _signVaultPermit(AMOUNT, deadline);
        bytes memory intentSig = _signVaultIntent(d);

        vm.prank(owner);
        vault.setPlatformFee(200);

        vm.prank(relayer);
        vault.createPaymentWithPermit(d, permitSig, intentSig);

        uint256 fee = (AMOUNT * 200) / 10000;
        assertEq(usdc.balanceOf(platformWallet), fee);
        assertEq(usdc.balanceOf(merchant), AMOUNT - fee);
    }

    function test_vault_rejects_ceiling_above_contract_cap() public {
        uint256 deadline = block.timestamp + 1 hours;
        PaymentVault.PaymentIntentData memory d = _vaultData(AMOUNT, 1001, deadline);
        PaymentVault.PermitSig memory permitSig = _signVaultPermit(AMOUNT, deadline);
        bytes memory intentSig = _signVaultIntent(d);

        vm.prank(relayer);
        vm.expectRevert("maxFeeBps too high");
        vault.createPaymentWithPermit(d, permitSig, intentSig);
    }

    // ----- SubscriptionManager -----

    function test_live_subscription_keeps_the_fee_its_subscriber_signed() public {
        uint256 subId = _createSubWithPermit(50);

        uint256 merchantAfterCreate = usdc.balanceOf(merchant);
        uint256 platformAfterCreate = usdc.balanceOf(platformWallet);

        // Owner raises the fee to the 10% cap mid-lifecycle.
        vm.prank(owner);
        subs.setPlatformFee(1000);

        vm.warp(block.timestamp + MONTHLY + 1);
        vm.prank(relayer);
        subs.chargeSubscription(subId);

        uint256 signedFee = (AMOUNT * 50) / 10000;
        assertEq(
            usdc.balanceOf(merchant) - merchantAfterCreate,
            AMOUNT - signedFee,
            "merchant still gets the rate the subscriber signed"
        );
        assertEq(usdc.balanceOf(platformWallet) - platformAfterCreate, signedFee);
    }

    function test_subscription_creation_rejected_when_fee_exceeds_signed_ceiling() public {
        uint256 deadline = block.timestamp + 1 hours;
        SubscriptionManager.CreateSubPermitParams memory p = _subParams(50, deadline);
        bytes memory intentSig = _signSubIntent(p);

        vm.prank(owner);
        subs.setPlatformFee(51);

        vm.prank(relayer);
        vm.expectRevert("Fee above signed max");
        subs.createSubscriptionWithPermit(p, intentSig);
    }

    function test_fee_drop_is_passed_through_to_the_subscriber() public {
        uint256 subId = _createSubWithPermit(1000); // subscriber signed a loose ceiling
        uint256 merchantAfterCreate = usdc.balanceOf(merchant);

        vm.prank(owner);
        subs.setPlatformFee(0);

        vm.warp(block.timestamp + MONTHLY + 1);
        vm.prank(relayer);
        subs.chargeSubscription(subId);

        assertEq(usdc.balanceOf(merchant) - merchantAfterCreate, AMOUNT, "zero fee honoured");
    }

    function test_direct_subscription_has_no_signed_ceiling() public {
        // createSubscription carries no signature, so the contract-wide cap
        // applies and a later raise does take effect. Asserted so the
        // asymmetry is documented rather than surprising.
        vm.startPrank(buyer);
        usdc.approve(address(subs), type(uint256).max);
        uint256 subId = subs.createSubscription(
            address(usdc), merchant, AMOUNT, MONTHLY, productId, customerId
        );
        vm.stopPrank();
        assertEq(subs.subscriptionMaxFeeBps(subId), subs.MAX_PLATFORM_FEE_BPS());

        uint256 merchantAfterCreate = usdc.balanceOf(merchant);
        vm.prank(owner);
        subs.setPlatformFee(1000);

        vm.warp(block.timestamp + MONTHLY + 1);
        vm.prank(relayer);
        subs.chargeSubscription(subId);

        uint256 fee = (AMOUNT * 1000) / 10000;
        assertEq(usdc.balanceOf(merchant) - merchantAfterCreate, AMOUNT - fee);
    }

    // ----- Helpers -----

    function _vaultData(uint256 amount, uint256 maxFeeBps, uint256 deadline)
        internal
        view
        returns (PaymentVault.PaymentIntentData memory)
    {
        return PaymentVault.PaymentIntentData({
            buyer: buyer,
            token: address(usdc),
            merchant: merchant,
            amount: amount,
            productId: productId,
            customerId: customerId,
            maxFeeBps: maxFeeBps,
            deadline: deadline
        });
    }

    function _signVaultPermit(uint256 value, uint256 deadline)
        internal
        view
        returns (PaymentVault.PermitSig memory)
    {
        bytes32 PERMIT_TYPEHASH = keccak256(
            "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
        );
        bytes32 structHash = keccak256(
            abi.encode(PERMIT_TYPEHASH, buyer, address(vault), value, usdc.nonces(buyer), deadline)
        );
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), structHash)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(buyerPk, digest);
        return PaymentVault.PermitSig({deadline: deadline, v: v, r: r, s: s});
    }

    function _signVaultIntent(PaymentVault.PaymentIntentData memory d)
        internal
        view
        returns (bytes memory)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                PAYMENT_INTENT_TYPEHASH,
                d.buyer,
                d.token,
                d.merchant,
                d.amount,
                d.productId,
                d.customerId,
                d.maxFeeBps,
                vault.FLOW_EIP2612(),
                vault.getIntentNonce(buyer),
                d.deadline
            )
        );
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", vault.domainSeparator(), structHash)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(buyerPk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _subParams(uint256 maxFeeBps, uint256 deadline)
        internal
        view
        returns (SubscriptionManager.CreateSubPermitParams memory p)
    {
        p = SubscriptionManager.CreateSubPermitParams({
            token: address(usdc),
            buyer: buyer,
            merchant: merchant,
            amount: AMOUNT,
            interval: MONTHLY,
            productId: productId,
            customerId: customerId,
            permitValue: AMOUNT * 100,
            maxFeeBps: maxFeeBps,
            deadline: deadline,
            v: 0,
            r: bytes32(0),
            s: bytes32(0)
        });

        bytes32 PERMIT_TYPEHASH = keccak256(
            "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
        );
        bytes32 structHash = keccak256(
            abi.encode(
                PERMIT_TYPEHASH, buyer, address(subs), p.permitValue, usdc.nonces(buyer), p.deadline
            )
        );
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), structHash)
        );
        (p.v, p.r, p.s) = vm.sign(buyerPk, digest);
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
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(buyerPk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _createSubWithPermit(uint256 maxFeeBps) internal returns (uint256) {
        uint256 deadline = block.timestamp + 1 hours;
        SubscriptionManager.CreateSubPermitParams memory p = _subParams(maxFeeBps, deadline);
        bytes memory intentSig = _signSubIntent(p);
        vm.prank(relayer);
        return subs.createSubscriptionWithPermit(p, intentSig);
    }
}
