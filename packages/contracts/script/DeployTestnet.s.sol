// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/MockUSDC.sol";
import "../src/PaymentVault.sol";
import "../src/SubscriptionManager.sol";

/**
 * Testnet deploy. Same shape as DeployMainnet, but the ownership handoff is
 * optional: set MULTISIG_OWNER to hand off, leave it unset to keep the
 * deployer EOA as owner (acceptable on a throwaway testnet only).
 */
contract DeployTestnet is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address platformWallet = vm.envAddress("PLATFORM_WALLET");
        address relayer = vm.envAddress("RELAYER_ADDRESS");
        address multisig = vm.envOr("MULTISIG_OWNER", address(0));
        uint256 platformFee = 50;

        require(platformWallet != address(0), "PLATFORM_WALLET unset");
        require(relayer != address(0), "RELAYER_ADDRESS unset");

        vm.startBroadcast(deployerKey);

        MockUSDC usdc = new MockUSDC();
        PaymentVault vault = new PaymentVault(platformWallet, platformFee);
        SubscriptionManager subs = new SubscriptionManager(platformWallet, platformFee);

        vault.setAcceptedToken(address(usdc), true);
        subs.setAcceptedToken(address(usdc), true);

        vault.setRelayer(relayer);
        subs.setRelayer(relayer);

        if (multisig != address(0)) {
            vault.transferOwnership(multisig);
            subs.transferOwnership(multisig);
        }

        vm.stopBroadcast();

        require(vault.acceptedTokens(address(usdc)), "vault: USDC not accepted");
        require(subs.acceptedTokens(address(usdc)), "subs: USDC not accepted");
        require(vault.relayer() == relayer, "vault: relayer mismatch");
        require(subs.relayer() == relayer, "subs: relayer mismatch");
        require(vault.platformFee() == platformFee, "vault: platformFee mismatch");
        require(subs.platformFee() == platformFee, "subs: platformFee mismatch");
        if (multisig != address(0)) {
            require(vault.pendingOwner() == multisig, "vault: ownership handoff missing");
            require(subs.pendingOwner() == multisig, "subs: ownership handoff missing");
        }

        console.log("MockUSDC:", address(usdc));
        console.log("PaymentVault:", address(vault));
        console.log("SubscriptionManager:", address(subs));
        console.log("Relayer set to:", relayer);
        if (multisig != address(0)) {
            console.log("Ownership transfer PENDING to:", multisig);
        } else {
            console.log("WARNING: owner is the deployer EOA (MULTISIG_OWNER unset)");
        }
    }
}
