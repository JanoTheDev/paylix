// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/PaymentVault.sol";
import "../src/SubscriptionManager.sol";
import "../src/MockUSDC.sol";

/// Ownable2Step is the entire admin security story for both contracts and had
/// zero tests (SC-04, SC-14). This file covers the handoff, the disabled
/// renounce, and every onlyOwner / relayer-gated revert path.
contract OwnershipTest is Test {
    PaymentVault public vault;
    SubscriptionManager public subs;
    MockUSDC public usdc;

    address public owner = makeAddr("owner");
    address public multisig = makeAddr("multisig");
    address public attacker = makeAddr("attacker");
    address public platformWallet = makeAddr("platform");
    address public relayer = makeAddr("relayer");

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
    }

    // ----- Two-step handoff -----

    function test_transferOwnership_does_not_change_owner_until_accepted() public {
        vm.prank(owner);
        vault.transferOwnership(multisig);

        assertEq(vault.owner(), owner, "owner unchanged until accept");
        assertEq(vault.pendingOwner(), multisig);

        vm.prank(multisig);
        vault.acceptOwnership();

        assertEq(vault.owner(), multisig);
        assertEq(vault.pendingOwner(), address(0));
    }

    function test_subscriptionManager_transferOwnership_two_step() public {
        vm.prank(owner);
        subs.transferOwnership(multisig);
        assertEq(subs.owner(), owner);

        vm.prank(multisig);
        subs.acceptOwnership();
        assertEq(subs.owner(), multisig);
    }

    function test_non_pending_owner_cannot_accept() public {
        vm.prank(owner);
        vault.transferOwnership(multisig);

        vm.prank(attacker);
        vm.expectRevert();
        vault.acceptOwnership();

        assertEq(vault.owner(), owner);
    }

    function test_non_owner_cannot_transfer_ownership() public {
        vm.prank(attacker);
        vm.expectRevert();
        vault.transferOwnership(attacker);
    }

    function test_old_owner_loses_admin_rights_after_handoff() public {
        vm.prank(owner);
        vault.transferOwnership(multisig);
        vm.prank(multisig);
        vault.acceptOwnership();

        vm.prank(owner);
        vm.expectRevert();
        vault.setPlatformFee(100);

        vm.prank(multisig);
        vault.setPlatformFee(100);
        assertEq(vault.platformFee(), 100);
    }

    // ----- renounceOwnership is disabled (SC-14) -----

    function test_vault_renounceOwnership_reverts() public {
        vm.prank(owner);
        vm.expectRevert("Renounce disabled");
        vault.renounceOwnership();
        assertEq(vault.owner(), owner);
    }

    function test_subs_renounceOwnership_reverts() public {
        vm.prank(owner);
        vm.expectRevert("Renounce disabled");
        subs.renounceOwnership();
        assertEq(subs.owner(), owner);
    }

    // ----- onlyOwner revert paths -----

    function test_vault_onlyOwner_functions_revert_for_attacker() public {
        vm.startPrank(attacker);
        vm.expectRevert();
        vault.setPlatformFee(100);
        vm.expectRevert();
        vault.setPlatformWallet(attacker);
        vm.expectRevert();
        vault.setRelayer(attacker);
        vm.expectRevert();
        vault.setAcceptedToken(address(usdc), false);
        vm.expectRevert();
        vault.setGaslessPaused(true);
        vm.expectRevert();
        vault.pause();
        vm.expectRevert();
        vault.rescueToken(address(usdc), attacker, 1);
        vm.stopPrank();
    }

    function test_subs_onlyOwner_functions_revert_for_attacker() public {
        vm.startPrank(attacker);
        vm.expectRevert();
        subs.setPlatformFee(100);
        vm.expectRevert();
        subs.setPlatformWallet(attacker);
        vm.expectRevert();
        subs.setRelayer(attacker);
        vm.expectRevert();
        subs.setAcceptedToken(address(usdc), false);
        vm.expectRevert();
        subs.setGaslessPaused(true);
        vm.expectRevert();
        subs.pause();
        vm.expectRevert();
        subs.rescueToken(address(usdc), attacker, 1);
        vm.stopPrank();
    }

    function test_setRelayer_rejects_zero() public {
        vm.prank(owner);
        vm.expectRevert("Invalid relayer address");
        vault.setRelayer(address(0));
    }

    function test_constructor_rejects_zero_platform_wallet() public {
        vm.expectRevert("Invalid wallet");
        new PaymentVault(address(0), 50);

        vm.expectRevert("Invalid wallet");
        new SubscriptionManager(address(0), 50);
    }

    function test_constructor_rejects_fee_above_cap() public {
        vm.expectRevert("Fee too high");
        new PaymentVault(platformWallet, 1001);
    }

    // ----- rescueToken (SC-12) -----

    function test_rescueToken_recovers_stray_tokens() public {
        usdc.mint(address(vault), 1234e6);
        address to = makeAddr("rescueTo");

        vm.prank(owner);
        vault.rescueToken(address(usdc), to, 1234e6);

        assertEq(usdc.balanceOf(to), 1234e6);
        assertEq(usdc.balanceOf(address(vault)), 0);
    }

    function test_rescueToken_rejects_zero_recipient() public {
        vm.prank(owner);
        vm.expectRevert("Invalid recipient");
        vault.rescueToken(address(usdc), address(0), 1);
    }
}
