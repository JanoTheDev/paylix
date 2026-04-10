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

    // Buyer is derived from a private key so we can sign permits
    uint256 public buyerPrivateKey = 0xA11CE;
    address public buyer = vm.addr(buyerPrivateKey);

    bytes32 public productId = keccak256("prod_123");
    bytes32 public customerId = keccak256("cust_456");

    function setUp() public {
        vm.startPrank(owner);
        vault = new PaymentVault(platformWallet, 50);
        usdc = new MockUSDC();
        vault.setAcceptedToken(address(usdc), true);
        vault.setRelayer(relayer);
        vm.stopPrank();

        usdc.mint(buyer, 10000e6);
    }

    // ----- Happy path -----

    function test_createPaymentWithPermit_success() public {
        uint256 amount = 1000e6;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(amount, block.timestamp + 1 hours);

        vm.prank(relayer);
        vault.createPaymentWithPermit(
            address(usdc), buyer, merchant, amount,
            productId, customerId,
            block.timestamp + 1 hours, v, r, s
        );

        uint256 fee = (amount * 50) / 10000;
        assertEq(usdc.balanceOf(merchant), amount - fee, "merchant received amount - fee");
        assertEq(usdc.balanceOf(platformWallet), fee, "platform received fee");
        assertEq(usdc.balanceOf(buyer), 10000e6 - amount, "buyer balance decreased");
    }

    function test_createPaymentWithPermit_emits_event_with_buyer_as_payer() public {
        uint256 amount = 500e6;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(amount, block.timestamp + 1 hours);

        uint256 fee = (amount * 50) / 10000;

        vm.expectEmit(true, true, true, true);
        emit PaymentVault.PaymentReceived(
            buyer, merchant, address(usdc), amount, fee,
            productId, customerId, block.timestamp
        );

        vm.prank(relayer);
        vault.createPaymentWithPermit(
            address(usdc), buyer, merchant, amount,
            productId, customerId,
            block.timestamp + 1 hours, v, r, s
        );
    }

    // ----- Authorization -----

    function test_createPaymentWithPermit_reverts_when_not_relayer() public {
        uint256 amount = 100e6;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(amount, block.timestamp + 1 hours);

        address randomCaller = makeAddr("random");
        vm.prank(randomCaller);
        vm.expectRevert("Only relayer");
        vault.createPaymentWithPermit(
            address(usdc), buyer, merchant, amount,
            productId, customerId,
            block.timestamp + 1 hours, v, r, s
        );
    }

    function test_createPaymentWithPermit_reverts_when_buyer_calls_directly() public {
        uint256 amount = 100e6;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(amount, block.timestamp + 1 hours);

        vm.prank(buyer);
        vm.expectRevert("Only relayer");
        vault.createPaymentWithPermit(
            address(usdc), buyer, merchant, amount,
            productId, customerId,
            block.timestamp + 1 hours, v, r, s
        );
    }

    // ----- Validation -----

    function test_createPaymentWithPermit_reverts_on_zero_amount() public {
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(100e6, block.timestamp + 1 hours);

        vm.prank(relayer);
        vm.expectRevert("Amount must be > 0");
        vault.createPaymentWithPermit(
            address(usdc), buyer, merchant, 0,
            productId, customerId,
            block.timestamp + 1 hours, v, r, s
        );
    }

    function test_createPaymentWithPermit_reverts_on_zero_merchant() public {
        uint256 amount = 100e6;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(amount, block.timestamp + 1 hours);

        vm.prank(relayer);
        vm.expectRevert("Invalid merchant");
        vault.createPaymentWithPermit(
            address(usdc), buyer, address(0), amount,
            productId, customerId,
            block.timestamp + 1 hours, v, r, s
        );
    }

    function test_createPaymentWithPermit_reverts_on_zero_buyer() public {
        uint256 amount = 100e6;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(amount, block.timestamp + 1 hours);

        vm.prank(relayer);
        vm.expectRevert("Invalid buyer");
        vault.createPaymentWithPermit(
            address(usdc), address(0), merchant, amount,
            productId, customerId,
            block.timestamp + 1 hours, v, r, s
        );
    }

    function test_createPaymentWithPermit_reverts_on_unaccepted_token() public {
        MockUSDC otherToken = new MockUSDC();
        otherToken.mint(buyer, 1000e6);
        uint256 amount = 100e6;

        (uint8 v, bytes32 r, bytes32 s) = _signPermitForToken(otherToken, amount, block.timestamp + 1 hours);

        vm.prank(relayer);
        vm.expectRevert("Token not accepted");
        vault.createPaymentWithPermit(
            address(otherToken), buyer, merchant, amount,
            productId, customerId,
            block.timestamp + 1 hours, v, r, s
        );
    }

    // ----- Permit edge cases -----

    function test_createPaymentWithPermit_reverts_on_expired_permit() public {
        uint256 amount = 100e6;
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(amount, deadline);

        // Warp past the deadline
        vm.warp(deadline + 1);

        vm.prank(relayer);
        // The permit call will revert internally. Our try/catch swallows it,
        // and since allowance is zero, the transferFrom below reverts. Either
        // revert is acceptable — we just want the tx to fail.
        vm.expectRevert();
        vault.createPaymentWithPermit(
            address(usdc), buyer, merchant, amount,
            productId, customerId, deadline, v, r, s
        );
    }

    function test_createPaymentWithPermit_reverts_on_tampered_signature() public {
        uint256 amount = 100e6;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(amount, block.timestamp + 1 hours);

        // Corrupt r
        bytes32 badR = bytes32(uint256(r) + 1);

        vm.prank(relayer);
        vm.expectRevert();
        vault.createPaymentWithPermit(
            address(usdc), buyer, merchant, amount,
            productId, customerId,
            block.timestamp + 1 hours, v, badR, s
        );
    }

    function test_createPaymentWithPermit_cannot_replay_permit() public {
        uint256 amount = 100e6;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(amount, block.timestamp + 1 hours);

        // First submission succeeds
        vm.prank(relayer);
        vault.createPaymentWithPermit(
            address(usdc), buyer, merchant, amount,
            productId, customerId,
            block.timestamp + 1 hours, v, r, s
        );

        // Second submission with the same signature must fail. The first
        // consumed the permit nonce, so the permit call throws; allowance
        // is now back to 0, and transferFrom fails.
        vm.prank(relayer);
        vm.expectRevert();
        vault.createPaymentWithPermit(
            address(usdc), buyer, merchant, amount,
            productId, customerId,
            block.timestamp + 1 hours, v, r, s
        );
    }

    // ----- Helpers -----

    function _signPermit(uint256 value, uint256 deadline)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        return _signPermitForToken(usdc, value, deadline);
    }

    function _signPermitForToken(MockUSDC token, uint256 value, uint256 deadline)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 PERMIT_TYPEHASH = keccak256(
            "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
        );
        uint256 nonce = token.nonces(buyer);
        bytes32 structHash = keccak256(
            abi.encode(
                PERMIT_TYPEHASH,
                buyer,
                address(vault),
                value,
                nonce,
                deadline
            )
        );
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), structHash)
        );
        (v, r, s) = vm.sign(buyerPrivateKey, digest);
    }
}
