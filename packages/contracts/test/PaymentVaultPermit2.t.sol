// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/PaymentVault.sol";
import "../src/MockUSDC.sol";
import "../src/interfaces/IPermit2.sol";

/**
 * Minimal stand-in for Uniswap's Permit2. Etched at the canonical address so
 * PaymentVault's `PERMIT2` constant finds it.
 *
 * Intentionally skips signature validation — these tests cover PaymentVault's
 * integration (intent binding, merchant routing, fee split). Permit2's own
 * cryptographic guarantees are Uniswap's responsibility and covered there.
 */
contract StubPermit2 {
    mapping(address => mapping(uint256 => bool)) public usedNonces;

    function permitTransferFrom(
        IPermit2.PermitTransferFrom calldata permit,
        IPermit2.SignatureTransferDetails calldata transferDetails,
        address owner,
        bytes calldata /* signature */
    ) external {
        require(!usedNonces[owner][permit.nonce], "Permit2: nonce used");
        require(block.timestamp <= permit.deadline, "Permit2: expired");
        require(transferDetails.requestedAmount <= permit.permitted.amount, "Permit2: over");

        usedNonces[owner][permit.nonce] = true;

        IERC20(permit.permitted.token).transferFrom(
            owner,
            transferDetails.to,
            transferDetails.requestedAmount
        );
    }

    function DOMAIN_SEPARATOR() external pure returns (bytes32) {
        return bytes32(0);
    }
}

contract PaymentVaultPermit2Test is Test {
    PaymentVault vault;
    MockUSDC usdc;
    StubPermit2 stub;

    address platformWallet = address(0xABCD);
    address relayer = address(0xBEEF);
    address merchant = address(0xCAFE);

    uint256 buyerPk = 0xA11CE;
    address buyer;

    address constant PERMIT2_ADDR = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    uint256 constant MAX_FEE_BPS = 50;

    function setUp() public {
        buyer = vm.addr(buyerPk);

        usdc = new MockUSDC();
        vault = new PaymentVault(platformWallet, 50);
        vault.setAcceptedToken(address(usdc), true);
        vault.setRelayer(relayer);

        stub = new StubPermit2();
        vm.etch(PERMIT2_ADDR, address(stub).code);

        vm.prank(buyer);
        usdc.approve(PERMIT2_ADDR, type(uint256).max);

        usdc.mint(buyer, 10_000_000_000);
    }

    function signIntent(
        address token,
        address m,
        uint256 amount,
        bytes32 productId,
        bytes32 customerId,
        uint256 deadline,
        uint256 nonce
    ) internal view returns (bytes memory) {
        bytes32 typeHash = keccak256(
            "PaymentIntent(address buyer,address token,address merchant,uint256 amount,bytes32 productId,bytes32 customerId,uint256 maxFeeBps,uint8 flow,uint256 nonce,uint256 deadline)"
        );
        bytes32 structHash = keccak256(
            abi.encode(typeHash, buyer, token, m, amount, productId, customerId, MAX_FEE_BPS, vault.FLOW_PERMIT2(), nonce, deadline)
        );
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", vault.domainSeparator(), structHash)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(buyerPk, digest);
        return abi.encodePacked(r, s, v);
    }

    /// Build a Permit2Payment struct with sane defaults. Tests override fields
    /// they care about using the returned memory copy.
    function defaultPayment(uint256 amount, uint256 deadline, uint256 p2nonce, bytes memory intent)
        internal
        view
        returns (PaymentVault.Permit2Payment memory)
    {
        return PaymentVault.Permit2Payment({
            token: address(usdc),
            buyer: buyer,
            merchant: merchant,
            amount: amount,
            productId: "p",
            customerId: "c",
            maxFeeBps: MAX_FEE_BPS,
            permit2Nonce: p2nonce,
            permit2Deadline: deadline,
            permit2Signature: hex"00",
            intentSignature: intent
        });
    }

    function test_happy_path_splits_fee_and_emits_event() public {
        uint256 amount = 100_000_000;
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory intent = signIntent(address(usdc), merchant, amount, "p", "c", deadline, 0);

        vm.prank(relayer);
        vault.createPaymentWithPermit2(defaultPayment(amount, deadline, 1, intent));

        assertEq(usdc.balanceOf(merchant), 99_500_000);
        assertEq(usdc.balanceOf(platformWallet), 500_000);
        assertEq(usdc.balanceOf(address(vault)), 0);
    }

    function test_reverts_when_non_relayer_calls() public {
        uint256 amount = 100_000_000;
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory intent = signIntent(address(usdc), merchant, amount, "p", "c", deadline, 0);

        vm.prank(address(0xDEAD));
        vm.expectRevert("Only relayer");
        vault.createPaymentWithPermit2(defaultPayment(amount, deadline, 1, intent));
    }

    function test_reverts_when_relayer_swaps_merchant() public {
        uint256 amount = 100_000_000;
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory intent = signIntent(address(usdc), merchant, amount, "p", "c", deadline, 0);

        PaymentVault.Permit2Payment memory req = defaultPayment(amount, deadline, 1, intent);
        req.merchant = address(0xDEAD);

        vm.prank(relayer);
        vm.expectRevert("Invalid intent signature");
        vault.createPaymentWithPermit2(req);
    }

    function test_reverts_when_relayer_inflates_amount() public {
        uint256 amount = 100_000_000;
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory intent = signIntent(address(usdc), merchant, amount, "p", "c", deadline, 0);

        PaymentVault.Permit2Payment memory req = defaultPayment(amount * 2, deadline, 1, intent);

        vm.prank(relayer);
        vm.expectRevert("Invalid intent signature");
        vault.createPaymentWithPermit2(req);
    }

    function test_reverts_on_permit2_nonce_replay() public {
        uint256 amount = 100_000_000;
        uint256 deadline = block.timestamp + 1 hours;

        bytes memory intent1 = signIntent(address(usdc), merchant, amount, "p", "c", deadline, 0);
        vm.prank(relayer);
        vault.createPaymentWithPermit2(defaultPayment(amount, deadline, 1, intent1));

        bytes memory intent2 = signIntent(address(usdc), merchant, amount, "p", "c", deadline, 1);
        vm.prank(relayer);
        vm.expectRevert("Permit2: nonce used");
        vault.createPaymentWithPermit2(defaultPayment(amount, deadline, 1, intent2));
    }

    function test_reverts_when_token_not_accepted() public {
        MockUSDC other = new MockUSDC();
        uint256 amount = 100_000_000;
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory intent = signIntent(address(other), merchant, amount, "p", "c", deadline, 0);

        PaymentVault.Permit2Payment memory req = defaultPayment(amount, deadline, 1, intent);
        req.token = address(other);

        vm.prank(relayer);
        vm.expectRevert("Token not accepted");
        vault.createPaymentWithPermit2(req);
    }

    function test_reverts_when_paused() public {
        vault.pause();
        uint256 amount = 100_000_000;
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory intent = signIntent(address(usdc), merchant, amount, "p", "c", deadline, 0);

        vm.prank(relayer);
        vm.expectRevert();
        vault.createPaymentWithPermit2(defaultPayment(amount, deadline, 1, intent));
    }

    function test_reverts_when_gasless_paused() public {
        vault.setGaslessPaused(true);
        uint256 amount = 100_000_000;
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory intent = signIntent(address(usdc), merchant, amount, "p", "c", deadline, 0);

        vm.prank(relayer);
        vm.expectRevert("Gasless paused");
        vault.createPaymentWithPermit2(defaultPayment(amount, deadline, 1, intent));
    }

    function test_intent_nonce_increments_after_use() public {
        uint256 amount = 100_000_000;
        uint256 deadline = block.timestamp + 1 hours;

        assertEq(vault.getIntentNonce(buyer), 0);
        bytes memory intent = signIntent(address(usdc), merchant, amount, "p", "c", deadline, 0);

        vm.prank(relayer);
        vault.createPaymentWithPermit2(defaultPayment(amount, deadline, 1, intent));

        assertEq(vault.getIntentNonce(buyer), 1);
    }
}
