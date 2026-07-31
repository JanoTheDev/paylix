// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/PaymentVault.sol";
import "../src/SubscriptionManager.sol";

/**
 * Mainnet deploy. USDC address comes from the USDC_ADDRESS env var so the
 * same script works for every EVM mainnet Paylix supports (Ethereum, Base,
 * Arbitrum, Optimism, Polygon, Avalanche, and BNB once Permit2 lands).
 *
 * The outer deploy.sh sets USDC_ADDRESS from the active chain's canonical
 * value in packages/config/src/network-registry.ts before invoking this.
 *
 * Required env vars:
 *   DEPLOYER_PRIVATE_KEY  hot key that broadcasts; owner ONLY until the handoff
 *   PLATFORM_WALLET       receives platform fees
 *   RELAYER_ADDRESS       gasless relayer
 *   USDC_ADDRESS          accepted token on the target chain
 *   MULTISIG_OWNER        multisig that will own both contracts
 *
 * Ownership handoff is two-step (Ownable2Step): this script calls
 * transferOwnership(MULTISIG_OWNER); the multisig must then call
 * acceptOwnership() on BOTH contracts. Until it does, the deployer key is
 * still the owner — the log at the end says so explicitly.
 */
contract DeployMainnet is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address platformWallet = vm.envAddress("PLATFORM_WALLET");
        address relayer = vm.envAddress("RELAYER_ADDRESS");
        address usdc = vm.envAddress("USDC_ADDRESS");
        // No hardcoded addresses — the owner is always supplied by the operator.
        address multisig = vm.envAddress("MULTISIG_OWNER");
        uint256 platformFee = 50;

        address deployer = vm.addr(deployerKey);

        // ---- Pre-deploy assertions ----
        require(platformWallet != address(0), "PLATFORM_WALLET unset");
        require(relayer != address(0), "RELAYER_ADDRESS unset");
        require(usdc != address(0), "USDC_ADDRESS unset");
        require(multisig != address(0), "MULTISIG_OWNER unset");
        require(multisig != deployer, "MULTISIG_OWNER must not be the deployer EOA");
        // A typo'd USDC_ADDRESS would otherwise produce contracts that accept a
        // token which does not exist on this chain.
        require(usdc.code.length > 0, "USDC_ADDRESS is not a contract");

        vm.startBroadcast(deployerKey);

        PaymentVault vault = new PaymentVault(platformWallet, platformFee);
        SubscriptionManager subs = new SubscriptionManager(platformWallet, platformFee);

        vault.setAcceptedToken(usdc, true);
        subs.setAcceptedToken(usdc, true);

        vault.setRelayer(relayer);
        subs.setRelayer(relayer);

        // Hand off to the multisig. Ownable2Step: the multisig must call
        // acceptOwnership() before it is actually the owner.
        vault.transferOwnership(multisig);
        subs.transferOwnership(multisig);

        vm.stopBroadcast();

        // ---- Post-deploy assertions: fail loudly rather than ship a
        // misconfigured deployment ----
        require(vault.acceptedTokens(usdc), "vault: USDC not accepted");
        require(subs.acceptedTokens(usdc), "subs: USDC not accepted");
        require(vault.relayer() == relayer, "vault: relayer mismatch");
        require(subs.relayer() == relayer, "subs: relayer mismatch");
        require(vault.platformWallet() == platformWallet, "vault: platformWallet mismatch");
        require(subs.platformWallet() == platformWallet, "subs: platformWallet mismatch");
        require(vault.platformFee() == platformFee, "vault: platformFee mismatch");
        require(subs.platformFee() == platformFee, "subs: platformFee mismatch");
        require(vault.pendingOwner() == multisig, "vault: ownership handoff missing");
        require(subs.pendingOwner() == multisig, "subs: ownership handoff missing");

        console.log("PaymentVault:", address(vault));
        console.log("SubscriptionManager:", address(subs));
        console.log("USDC:", usdc);
        console.log("Relayer set to:", relayer);
        console.log("Ownership transfer PENDING to multisig:", multisig);
        console.log("ACTION REQUIRED: multisig must call acceptOwnership() on both contracts.");
        console.log("Until then the deployer EOA is still owner:", deployer);
    }
}
