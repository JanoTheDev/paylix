// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/PaymentVault.sol";
import "../src/MockUSDC.sol";

contract PaymentVaultTest is Test {
    PaymentVault public vault;
    MockUSDC public usdc;

    address public owner = makeAddr("owner");
    address public platformWallet = makeAddr("platform");
    address public merchant = makeAddr("merchant");
    address public payer = makeAddr("payer");

    bytes32 public productId = keccak256("prod_123");
    bytes32 public customerId = keccak256("cust_456");

    function setUp() public {
        vm.startPrank(owner);
        vault = new PaymentVault(platformWallet, 50);
        usdc = new MockUSDC();
        vault.setAcceptedToken(address(usdc), true);
        vm.stopPrank();
        usdc.mint(payer, 10000e6);
    }

    function test_constructor() public view {
        assertEq(vault.platformWallet(), platformWallet);
        assertEq(vault.platformFee(), 50);
        assertEq(vault.owner(), owner);
    }

    function test_setAcceptedToken() public view {
        assertTrue(vault.acceptedTokens(address(usdc)));
    }

    function test_createPayment_success() public {
        uint256 amount = 1000e6;
        vm.startPrank(payer);
        usdc.approve(address(vault), amount);
        vault.createPayment(address(usdc), merchant, amount, productId, customerId);
        vm.stopPrank();

        uint256 fee = (amount * 50) / 10000;
        assertEq(usdc.balanceOf(merchant), amount - fee);
        assertEq(usdc.balanceOf(platformWallet), fee);
        assertEq(usdc.balanceOf(payer), 10000e6 - amount);
    }

    function test_createPayment_emits_event() public {
        uint256 amount = 100e6;
        vm.startPrank(payer);
        usdc.approve(address(vault), amount);
        uint256 fee = (amount * 50) / 10000;
        vm.expectEmit(true, true, true, true);
        emit PaymentVault.PaymentReceived(payer, merchant, address(usdc), amount, fee, productId, customerId, block.timestamp);
        vault.createPayment(address(usdc), merchant, amount, productId, customerId);
        vm.stopPrank();
    }

    function test_createPayment_zero_fee() public {
        vm.startPrank(owner);
        PaymentVault zeroFeeVault = new PaymentVault(platformWallet, 0);
        zeroFeeVault.setAcceptedToken(address(usdc), true);
        vm.stopPrank();

        uint256 amount = 100e6;
        vm.startPrank(payer);
        usdc.approve(address(zeroFeeVault), amount);
        zeroFeeVault.createPayment(address(usdc), merchant, amount, productId, customerId);
        vm.stopPrank();

        assertEq(usdc.balanceOf(merchant), amount);
        assertEq(usdc.balanceOf(platformWallet), 0);
    }

    function test_revert_unaccepted_token() public {
        MockUSDC fakeToken = new MockUSDC();
        fakeToken.mint(payer, 1000e6);
        vm.startPrank(payer);
        fakeToken.approve(address(vault), 100e6);
        vm.expectRevert("Token not accepted");
        vault.createPayment(address(fakeToken), merchant, 100e6, productId, customerId);
        vm.stopPrank();
    }

    function test_revert_zero_amount() public {
        vm.startPrank(payer);
        usdc.approve(address(vault), 100e6);
        vm.expectRevert("Amount must be > 0");
        vault.createPayment(address(usdc), merchant, 0, productId, customerId);
        vm.stopPrank();
    }

    function test_revert_zero_merchant() public {
        vm.startPrank(payer);
        usdc.approve(address(vault), 100e6);
        vm.expectRevert("Invalid merchant");
        vault.createPayment(address(usdc), address(0), 100e6, productId, customerId);
        vm.stopPrank();
    }

    function test_setPlatformFee_max() public {
        vm.prank(owner);
        vm.expectRevert("Fee too high");
        vault.setPlatformFee(1001);
    }

    function test_only_owner_can_set_fee() public {
        vm.prank(payer);
        vm.expectRevert();
        vault.setPlatformFee(100);
    }
}
