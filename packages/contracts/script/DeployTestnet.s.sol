// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/MockUSDC.sol";
import "../src/PaymentVault.sol";
import "../src/SubscriptionManager.sol";

contract DeployTestnet is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address platformWallet = vm.envAddress("PLATFORM_WALLET");
        address relayer = vm.envAddress("RELAYER_ADDRESS");
        uint256 platformFee = 50;

        vm.startBroadcast(deployerKey);

        MockUSDC usdc = new MockUSDC();
        PaymentVault vault = new PaymentVault(platformWallet, platformFee);
        SubscriptionManager subs = new SubscriptionManager(platformWallet, platformFee);

        vault.setAcceptedToken(address(usdc), true);
        subs.setAcceptedToken(address(usdc), true);

        vault.setRelayer(relayer);
        subs.setRelayer(relayer);

        vm.stopBroadcast();

        console.log("MockUSDC:", address(usdc));
        console.log("PaymentVault:", address(vault));
        console.log("SubscriptionManager:", address(subs));
        console.log("Relayer set to:", relayer);
    }
}
