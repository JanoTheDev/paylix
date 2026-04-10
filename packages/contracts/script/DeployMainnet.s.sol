// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/PaymentVault.sol";
import "../src/SubscriptionManager.sol";

contract DeployMainnet is Script {
    address constant BASE_USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address platformWallet = vm.envAddress("PLATFORM_WALLET");
        address relayer = vm.envAddress("RELAYER_ADDRESS");
        uint256 platformFee = 50;

        vm.startBroadcast(deployerKey);

        PaymentVault vault = new PaymentVault(platformWallet, platformFee);
        SubscriptionManager subs = new SubscriptionManager(platformWallet, platformFee);

        vault.setAcceptedToken(BASE_USDC, true);
        subs.setAcceptedToken(BASE_USDC, true);

        vault.setRelayer(relayer);
        subs.setRelayer(relayer);

        vm.stopBroadcast();

        console.log("PaymentVault:", address(vault));
        console.log("SubscriptionManager:", address(subs));
        console.log("Relayer set to:", relayer);
    }
}
