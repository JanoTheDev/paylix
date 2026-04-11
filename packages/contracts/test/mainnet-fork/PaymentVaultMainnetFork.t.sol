// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../../src/PaymentVault.sol";

/**
 * Fork test against Base mainnet to verify that createPaymentWithPermit
 * works with Circle's native USDC. MockUSDC is fine for unit tests, but
 * real USDC has a different EIP-712 domain (name: "USD Coin", version: "2")
 * and we need to prove our signing logic matches across the boundary.
 *
 * To run:
 *   FORK_RPC_URL=https://mainnet.base.org forge test \
 *     --match-path "test/mainnet-fork/*" \
 *     --fork-url $FORK_RPC_URL -vvv
 *
 * Or via the fork profile:
 *   FORK_RPC_URL=https://mainnet.base.org forge test --profile fork -vvv
 *
 * If FORK_RPC_URL is not set, setUp() skips the test.
 */

interface IUSDC {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function DOMAIN_SEPARATOR() external view returns (bytes32);
    function nonces(address) external view returns (uint256);
    function version() external view returns (string memory);
    function name() external view returns (string memory);
}

contract PaymentVaultMainnetForkTest is Test {
    // Circle's native USDC on Base mainnet
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    // A whale address with plenty of USDC on mainnet. Coinbase hot wallet —
    // holds billions in USDC. If this goes cold in the future, pick another
    // from https://basescan.org/token/0x833589fCD6eDb6E08f4c7C32D4f71b54bDA02913#balances
    address constant USDC_WHALE = 0xF977814e90dA44bFA03b6295A0616a897441aceC;

    PaymentVault public vault;
    address public platformWallet = makeAddr("platform");
    address public merchant = makeAddr("merchant");
    address public relayer = makeAddr("relayer");
    address public owner = makeAddr("owner");

    uint256 public buyerPrivateKey = 0xCAFE;
    address public buyer = vm.addr(buyerPrivateKey);

    bytes32 public productId = keccak256("prod_fork");
    bytes32 public customerId = keccak256("cust_fork");

    bytes32 private constant PAYMENT_INTENT_TYPEHASH = keccak256(
        "PaymentIntent(address buyer,address token,address merchant,uint256 amount,bytes32 productId,bytes32 customerId,uint256 nonce,uint256 deadline)"
    );

    function setUp() public {
        // Skip unless FORK_RPC_URL is set
        try vm.envString("FORK_RPC_URL") returns (string memory url) {
            vm.createSelectFork(url);
        } catch {
            vm.skip(true);
            return;
        }

        vm.startPrank(owner);
        vault = new PaymentVault(platformWallet, 50);
        vault.setAcceptedToken(USDC, true);
        vault.setRelayer(relayer);
        vm.stopPrank();

        // Fund the buyer with real USDC from the whale
        vm.prank(USDC_WHALE);
        IUSDC(USDC).transfer(buyer, 1000e6);
    }

    function test_fork_USDC_version_is_2() public view {
        // Sanity check: Circle's native USDC on Base mainnet uses domain
        // version "2". If this changes, the dynamic version() read in the
        // client code still handles it.
        assertEq(IUSDC(USDC).version(), "2");
    }

    function _signPermit(uint256 amount, uint256 deadline)
        internal
        view
        returns (PaymentVault.PermitSig memory sig)
    {
        bytes32 PERMIT_TYPEHASH = keccak256(
            "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
        );
        uint256 nonce = IUSDC(USDC).nonces(buyer);
        bytes32 structHash = keccak256(
            abi.encode(
                PERMIT_TYPEHASH,
                buyer,
                address(vault),
                amount,
                nonce,
                deadline
            )
        );
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", IUSDC(USDC).DOMAIN_SEPARATOR(), structHash)
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
                USDC,
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

    function test_fork_createPaymentWithPermit_against_real_USDC() public {
        uint256 amount = 100e6;
        uint256 deadline = block.timestamp + 1 hours;

        PaymentVault.PermitSig memory permitSig = _signPermit(amount, deadline);
        bytes memory intentSig = _signIntent(amount, deadline);

        uint256 merchantBefore = IUSDC(USDC).balanceOf(merchant);
        uint256 platformBefore = IUSDC(USDC).balanceOf(platformWallet);

        vm.prank(relayer);
        vault.createPaymentWithPermit(
            USDC, buyer, merchant, amount, productId, customerId, permitSig, intentSig
        );

        uint256 fee = (amount * 50) / 10000;
        assertEq(IUSDC(USDC).balanceOf(merchant) - merchantBefore, amount - fee);
        assertEq(IUSDC(USDC).balanceOf(platformWallet) - platformBefore, fee);
        assertEq(IUSDC(USDC).balanceOf(buyer), 1000e6 - amount);
    }
}
