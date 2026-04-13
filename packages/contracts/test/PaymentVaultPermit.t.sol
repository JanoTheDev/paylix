// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/PaymentVault.sol";
import "../src/MockUSDC.sol";

contract PaymentVaultPermitTest is Test {
    PaymentVault public vault;
    MockUSDC public usdc;

    address public owner = makeAddr("owner");
    address public platformWallet = makeAddr("platform");
    address public merchant = makeAddr("merchant");
    address public relayer = makeAddr("relayer");
    address public attacker = makeAddr("attacker");

    // Buyer is derived from a private key so we can sign permits + intents
    uint256 public buyerPrivateKey = 0xA11CE;
    address public buyer = vm.addr(buyerPrivateKey);

    uint256 public otherPrivateKey = 0xB0B;

    bytes32 public productId = keccak256("prod_123");
    bytes32 public customerId = keccak256("cust_456");

    bytes32 private constant PAYMENT_INTENT_TYPEHASH = keccak256(
        "PaymentIntent(address buyer,address token,address merchant,uint256 amount,bytes32 productId,bytes32 customerId,uint256 nonce,uint256 deadline)"
    );

    function setUp() public {
        usdc = new MockUSDC();
        vm.startPrank(owner);
        vault = new PaymentVault(platformWallet, 50);
        vault.setAcceptedToken(address(usdc), true);
        vault.setRelayer(relayer);
        vm.stopPrank();

        usdc.mint(buyer, 10000e6);
    }

    // ----- Happy path -----

    function test_createPaymentWithPermit_success() public {
        uint256 amount = 1000e6;
        uint256 deadline = block.timestamp + 1 hours;
        PaymentVault.PermitSig memory permitSig = _signPermit(amount, deadline);
        bytes memory intentSig = _signIntent(
            address(usdc), merchant, amount, productId, customerId, deadline, buyerPrivateKey
        );

        vm.prank(relayer);
        vault.createPaymentWithPermit(
            address(usdc), buyer, merchant, amount, productId, customerId, permitSig, intentSig
        );

        uint256 fee = (amount * 50) / 10000;
        assertEq(usdc.balanceOf(merchant), amount - fee, "merchant received amount - fee");
        assertEq(usdc.balanceOf(platformWallet), fee, "platform received fee");
        assertEq(usdc.balanceOf(buyer), 10000e6 - amount, "buyer balance decreased");
        assertEq(vault.getIntentNonce(buyer), 1, "nonce incremented");
    }

    function test_createPaymentWithPermit_emits_event_with_buyer_as_payer() public {
        uint256 amount = 500e6;
        uint256 deadline = block.timestamp + 1 hours;
        PaymentVault.PermitSig memory permitSig = _signPermit(amount, deadline);
        bytes memory intentSig = _signIntent(
            address(usdc), merchant, amount, productId, customerId, deadline, buyerPrivateKey
        );

        uint256 fee = (amount * 50) / 10000;

        vm.expectEmit(true, true, true, true);
        emit PaymentVault.PaymentReceived(
            buyer, merchant, address(usdc), amount, fee, productId, customerId, block.timestamp
        );

        vm.prank(relayer);
        vault.createPaymentWithPermit(
            address(usdc), buyer, merchant, amount, productId, customerId, permitSig, intentSig
        );
    }

    // ----- Authorization -----

    function test_reverts_when_not_relayer() public {
        uint256 amount = 100e6;
        uint256 deadline = block.timestamp + 1 hours;
        PaymentVault.PermitSig memory permitSig = _signPermit(amount, deadline);
        bytes memory intentSig = _signIntent(
            address(usdc), merchant, amount, productId, customerId, deadline, buyerPrivateKey
        );

        vm.prank(makeAddr("random"));
        vm.expectRevert("Only relayer");
        vault.createPaymentWithPermit(
            address(usdc), buyer, merchant, amount, productId, customerId, permitSig, intentSig
        );
    }

    function test_reverts_when_buyer_calls_directly() public {
        uint256 amount = 100e6;
        uint256 deadline = block.timestamp + 1 hours;
        PaymentVault.PermitSig memory permitSig = _signPermit(amount, deadline);
        bytes memory intentSig = _signIntent(
            address(usdc), merchant, amount, productId, customerId, deadline, buyerPrivateKey
        );

        vm.prank(buyer);
        vm.expectRevert("Only relayer");
        vault.createPaymentWithPermit(
            address(usdc), buyer, merchant, amount, productId, customerId, permitSig, intentSig
        );
    }

    // ----- Validation -----

    function test_reverts_on_zero_amount() public {
        uint256 amount = 100e6;
        uint256 deadline = block.timestamp + 1 hours;
        PaymentVault.PermitSig memory permitSig = _signPermit(amount, deadline);
        bytes memory intentSig = _signIntent(
            address(usdc), merchant, 0, productId, customerId, deadline, buyerPrivateKey
        );

        vm.prank(relayer);
        vm.expectRevert("Amount must be > 0");
        vault.createPaymentWithPermit(
            address(usdc), buyer, merchant, 0, productId, customerId, permitSig, intentSig
        );
    }

    function test_reverts_on_zero_merchant() public {
        uint256 amount = 100e6;
        uint256 deadline = block.timestamp + 1 hours;
        PaymentVault.PermitSig memory permitSig = _signPermit(amount, deadline);
        bytes memory intentSig = _signIntent(
            address(usdc), address(0), amount, productId, customerId, deadline, buyerPrivateKey
        );

        vm.prank(relayer);
        vm.expectRevert("Invalid merchant");
        vault.createPaymentWithPermit(
            address(usdc), buyer, address(0), amount, productId, customerId, permitSig, intentSig
        );
    }

    function test_reverts_on_zero_buyer() public {
        uint256 amount = 100e6;
        uint256 deadline = block.timestamp + 1 hours;
        PaymentVault.PermitSig memory permitSig = _signPermit(amount, deadline);

        vm.prank(relayer);
        vm.expectRevert("Invalid buyer");
        vault.createPaymentWithPermit(
            address(usdc), address(0), merchant, amount, productId, customerId, permitSig, ""
        );
    }

    function test_reverts_on_unaccepted_token() public {
        MockUSDC otherToken = new MockUSDC();
        otherToken.mint(buyer, 1000e6);
        uint256 amount = 100e6;
        uint256 deadline = block.timestamp + 1 hours;
        PaymentVault.PermitSig memory permitSig = _signPermitForToken(otherToken, amount, deadline);
        bytes memory intentSig = _signIntent(
            address(otherToken), merchant, amount, productId, customerId, deadline, buyerPrivateKey
        );

        vm.prank(relayer);
        vm.expectRevert("Token not accepted");
        vault.createPaymentWithPermit(
            address(otherToken), buyer, merchant, amount, productId, customerId, permitSig, intentSig
        );
    }

    // ----- PaymentIntent: the whole point of this file -----

    function test_reverts_if_relayer_swaps_merchant() public {
        // Buyer signs for `merchant`, relayer tries to route to `attacker`.
        // This is the vulnerability the PaymentIntent binding fixes.
        uint256 amount = 100e6;
        uint256 deadline = block.timestamp + 1 hours;
        PaymentVault.PermitSig memory permitSig = _signPermit(amount, deadline);
        bytes memory intentSig = _signIntent(
            address(usdc), merchant, amount, productId, customerId, deadline, buyerPrivateKey
        );

        vm.prank(relayer);
        vm.expectRevert("Invalid intent signature");
        vault.createPaymentWithPermit(
            address(usdc), buyer, attacker, amount, productId, customerId, permitSig, intentSig
        );

        assertEq(usdc.balanceOf(attacker), 0, "attacker received nothing");
    }

    function test_reverts_if_relayer_swaps_amount() public {
        uint256 signedAmount = 100e6;
        uint256 tamperedAmount = 9999e6;
        uint256 deadline = block.timestamp + 1 hours;
        PaymentVault.PermitSig memory permitSig = _signPermit(tamperedAmount, deadline);
        bytes memory intentSig = _signIntent(
            address(usdc), merchant, signedAmount, productId, customerId, deadline, buyerPrivateKey
        );

        vm.prank(relayer);
        vm.expectRevert("Invalid intent signature");
        vault.createPaymentWithPermit(
            address(usdc), buyer, merchant, tamperedAmount, productId, customerId, permitSig, intentSig
        );
    }

    function test_reverts_on_signature_by_non_buyer() public {
        uint256 amount = 100e6;
        uint256 deadline = block.timestamp + 1 hours;
        PaymentVault.PermitSig memory permitSig = _signPermit(amount, deadline);
        // Signed by someone other than buyer
        bytes memory intentSig = _signIntent(
            address(usdc), merchant, amount, productId, customerId, deadline, otherPrivateKey
        );

        vm.prank(relayer);
        vm.expectRevert("Invalid intent signature");
        vault.createPaymentWithPermit(
            address(usdc), buyer, merchant, amount, productId, customerId, permitSig, intentSig
        );
    }

    function test_reverts_on_replayed_intent() public {
        uint256 amount = 100e6;
        uint256 deadline = block.timestamp + 1 hours;
        PaymentVault.PermitSig memory permitSig = _signPermit(amount, deadline);
        bytes memory intentSig = _signIntent(
            address(usdc), merchant, amount, productId, customerId, deadline, buyerPrivateKey
        );

        vm.prank(relayer);
        vault.createPaymentWithPermit(
            address(usdc), buyer, merchant, amount, productId, customerId, permitSig, intentSig
        );

        // Same signature used a second time — nonce has already been incremented,
        // so recovery now evaluates against a different digest and fails.
        PaymentVault.PermitSig memory permitSig2 = _signPermit(amount, deadline);
        vm.prank(relayer);
        vm.expectRevert("Invalid intent signature");
        vault.createPaymentWithPermit(
            address(usdc), buyer, merchant, amount, productId, customerId, permitSig2, intentSig
        );
    }

    function test_reverts_on_expired_deadline() public {
        uint256 amount = 100e6;
        uint256 deadline = block.timestamp + 1 hours;
        PaymentVault.PermitSig memory permitSig = _signPermit(amount, deadline);
        bytes memory intentSig = _signIntent(
            address(usdc), merchant, amount, productId, customerId, deadline, buyerPrivateKey
        );

        vm.warp(deadline + 1);

        vm.prank(relayer);
        vm.expectRevert("Intent expired");
        vault.createPaymentWithPermit(
            address(usdc), buyer, merchant, amount, productId, customerId, permitSig, intentSig
        );
    }

    function test_nonce_increments_across_payments() public {
        // Two separate payments from the same buyer should succeed with
        // sequential nonces.
        uint256 amount = 100e6;
        uint256 deadline = block.timestamp + 1 hours;

        PaymentVault.PermitSig memory p1 = _signPermit(amount, deadline);
        bytes memory i1 = _signIntentWithNonce(
            address(usdc), merchant, amount, productId, customerId, 0, deadline, buyerPrivateKey
        );
        vm.prank(relayer);
        vault.createPaymentWithPermit(
            address(usdc), buyer, merchant, amount, productId, customerId, p1, i1
        );
        assertEq(vault.getIntentNonce(buyer), 1);

        PaymentVault.PermitSig memory p2 = _signPermit(amount, deadline);
        bytes memory i2 = _signIntentWithNonce(
            address(usdc), merchant, amount, productId, customerId, 1, deadline, buyerPrivateKey
        );
        vm.prank(relayer);
        vault.createPaymentWithPermit(
            address(usdc), buyer, merchant, amount, productId, customerId, p2, i2
        );
        assertEq(vault.getIntentNonce(buyer), 2);
    }

    // ----- Permit edge cases -----

    function test_tampered_permit_signature_reverts() public {
        uint256 amount = 100e6;
        uint256 deadline = block.timestamp + 1 hours;
        PaymentVault.PermitSig memory permitSig = _signPermit(amount, deadline);
        permitSig.r = bytes32(uint256(permitSig.r) + 1);

        bytes memory intentSig = _signIntent(
            address(usdc), merchant, amount, productId, customerId, deadline, buyerPrivateKey
        );

        vm.prank(relayer);
        vm.expectRevert();
        vault.createPaymentWithPermit(
            address(usdc), buyer, merchant, amount, productId, customerId, permitSig, intentSig
        );
    }

    // ----- Helpers -----

    function _signPermit(uint256 value, uint256 deadline)
        internal
        view
        returns (PaymentVault.PermitSig memory)
    {
        return _signPermitForToken(usdc, value, deadline);
    }

    function _signPermitForToken(MockUSDC token, uint256 value, uint256 deadline)
        internal
        view
        returns (PaymentVault.PermitSig memory sig)
    {
        bytes32 PERMIT_TYPEHASH = keccak256(
            "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
        );
        uint256 nonce = token.nonces(buyer);
        bytes32 structHash = keccak256(
            abi.encode(PERMIT_TYPEHASH, buyer, address(vault), value, nonce, deadline)
        );
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), structHash)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(buyerPrivateKey, digest);
        sig = PaymentVault.PermitSig({deadline: deadline, v: v, r: r, s: s});
    }

    function _signIntent(
        address token,
        address merchant_,
        uint256 amount,
        bytes32 productId_,
        bytes32 customerId_,
        uint256 deadline,
        uint256 signerKey
    ) internal view returns (bytes memory) {
        return _signIntentWithNonce(
            token, merchant_, amount, productId_, customerId_, vault.getIntentNonce(buyer), deadline, signerKey
        );
    }

    function _signIntentWithNonce(
        address token,
        address merchant_,
        uint256 amount,
        bytes32 productId_,
        bytes32 customerId_,
        uint256 nonce,
        uint256 deadline,
        uint256 signerKey
    ) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                PAYMENT_INTENT_TYPEHASH,
                buyer,
                token,
                merchant_,
                amount,
                productId_,
                customerId_,
                nonce,
                deadline
            )
        );
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", vault.domainSeparator(), structHash)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, digest);
        return abi.encodePacked(r, s, v);
    }
}
