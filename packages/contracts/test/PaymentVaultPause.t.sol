// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/PaymentVault.sol";
import "../src/MockUSDC.sol";

contract PaymentVaultPauseTest is Test {
    PaymentVault public vault;
    MockUSDC public usdc;

    address public owner = makeAddr("owner");
    address public platformWallet = makeAddr("platform");
    address public merchant = makeAddr("merchant");
    address public relayer = makeAddr("relayer");

    uint256 public buyerPrivateKey = 0xA11CE;
    address public buyer = vm.addr(buyerPrivateKey);

    bytes32 public productId = keccak256("prod_pause");
    bytes32 public customerId = keccak256("cust_pause");

    bytes32 private constant PAYMENT_INTENT_TYPEHASH = keccak256(
        "PaymentIntent(address buyer,address token,address merchant,uint256 amount,bytes32 productId,bytes32 customerId,uint256 nonce,uint256 deadline)"
    );

    function setUp() public {
        vm.startPrank(owner);
        vault = new PaymentVault(platformWallet, 50);
        usdc = new MockUSDC();
        vault.setAcceptedToken(address(usdc), true);
        vault.setRelayer(relayer);
        vm.stopPrank();

        usdc.mint(buyer, 10000e6);
    }

    function test_default_is_unpaused() public view {
        assertFalse(vault.gaslessPaused(), "starts unpaused");
    }

    function test_owner_can_pause() public {
        vm.prank(owner);
        vault.setGaslessPaused(true);
        assertTrue(vault.gaslessPaused());
    }

    function test_owner_can_unpause() public {
        vm.startPrank(owner);
        vault.setGaslessPaused(true);
        vault.setGaslessPaused(false);
        vm.stopPrank();
        assertFalse(vault.gaslessPaused());
    }

    function test_non_owner_cannot_pause() public {
        vm.prank(makeAddr("attacker"));
        vm.expectRevert();
        vault.setGaslessPaused(true);
    }

    function test_emits_GaslessPausedUpdated() public {
        vm.expectEmit(true, true, true, true);
        emit PaymentVault.GaslessPausedUpdated(true);
        vm.prank(owner);
        vault.setGaslessPaused(true);
    }

    function test_createPaymentWithPermit_reverts_when_paused() public {
        vm.prank(owner);
        vault.setGaslessPaused(true);

        uint256 amount = 100e6;
        uint256 deadline = block.timestamp + 1 hours;
        PaymentVault.PermitSig memory permitSig = _signPermit(amount, deadline);
        bytes memory intentSig = _signIntent(amount, deadline);

        vm.prank(relayer);
        vm.expectRevert("Gasless paused");
        vault.createPaymentWithPermit(
            address(usdc), buyer, merchant, amount, productId, customerId, permitSig, intentSig
        );
    }

    function test_createPayment_still_works_when_gasless_paused() public {
        vm.prank(owner);
        vault.setGaslessPaused(true);

        uint256 amount = 100e6;
        vm.startPrank(buyer);
        usdc.approve(address(vault), amount);
        vault.createPayment(address(usdc), merchant, amount, productId, customerId);
        vm.stopPrank();

        uint256 fee = (amount * 50) / 10000;
        assertEq(usdc.balanceOf(merchant), amount - fee);
    }

    function test_createPaymentWithPermit_works_after_unpause() public {
        vm.startPrank(owner);
        vault.setGaslessPaused(true);
        vault.setGaslessPaused(false);
        vm.stopPrank();

        uint256 amount = 100e6;
        uint256 deadline = block.timestamp + 1 hours;
        PaymentVault.PermitSig memory permitSig = _signPermit(amount, deadline);
        bytes memory intentSig = _signIntent(amount, deadline);

        vm.prank(relayer);
        vault.createPaymentWithPermit(
            address(usdc), buyer, merchant, amount, productId, customerId, permitSig, intentSig
        );

        uint256 fee = (amount * 50) / 10000;
        assertEq(usdc.balanceOf(merchant), amount - fee);
    }

    function _signPermit(uint256 value, uint256 deadline)
        internal
        view
        returns (PaymentVault.PermitSig memory sig)
    {
        bytes32 PERMIT_TYPEHASH = keccak256(
            "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
        );
        uint256 nonce = usdc.nonces(buyer);
        bytes32 structHash = keccak256(
            abi.encode(PERMIT_TYPEHASH, buyer, address(vault), value, nonce, deadline)
        );
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), structHash)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(buyerPrivateKey, digest);
        sig = PaymentVault.PermitSig({deadline: deadline, v: v, r: r, s: s});
    }

    function _signIntent(uint256 amount, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                PAYMENT_INTENT_TYPEHASH,
                buyer,
                address(usdc),
                merchant,
                amount,
                productId,
                customerId,
                vault.getIntentNonce(buyer),
                deadline
            )
        );
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", vault.domainSeparator(), structHash)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(buyerPrivateKey, digest);
        return abi.encodePacked(r, s, v);
    }
}
