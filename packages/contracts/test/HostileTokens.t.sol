// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../src/PaymentVault.sol";
import "./stubs/Permit2Stubs.sol";

/// A token that skims a percentage on every transfer. `createPaymentWithPermit2`
/// is the one path where the vault takes custody, and it used to assume the
/// received balance equals `p.amount` — with a fee-on-transfer token that
/// assumption either reverts on the way out or, if the vault holds a residual
/// balance, pays it out to a caller-chosen merchant (SC-12).
contract FeeOnTransferToken is ERC20 {
    uint256 public feeBps;

    constructor(uint256 _feeBps) ERC20("Skim", "SKIM") {
        feeBps = _feeBps;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _skim(address from, address to, uint256 value) internal {
        uint256 fee = (value * feeBps) / 10000;
        super._update(from, to, value - fee);
        if (fee > 0) super._update(from, address(0xdead), fee);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from == address(0) || to == address(0)) {
            super._update(from, to, value);
        } else {
            _skim(from, to, value);
        }
    }
}

contract HostileTokensTest is Test {
    PaymentVault public vault;
    FeeOnTransferToken public skim;

    address public platformWallet = makeAddr("platform");
    address public merchant = makeAddr("merchant");
    address public relayer = makeAddr("relayer");

    uint256 public buyerPk = 0xB0FF;
    address public buyer;

    address constant PERMIT2_ADDR = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    uint256 public constant MAX_FEE_BPS = 50;

    bytes32 private constant PAYMENT_INTENT_TYPEHASH = keccak256(
        "PaymentIntent(address buyer,address token,address merchant,uint256 amount,bytes32 productId,bytes32 customerId,uint256 maxFeeBps,uint8 flow,uint256 nonce,uint256 deadline)"
    );

    function setUp() public {
        buyer = vm.addr(buyerPk);
        skim = new FeeOnTransferToken(100); // 1% skim
        vault = new PaymentVault(platformWallet, 50);
        vault.setAcceptedToken(address(skim), true);
        vault.setRelayer(relayer);

        StubPermit2SignatureTransfer stub = new StubPermit2SignatureTransfer();
        vm.etch(PERMIT2_ADDR, address(stub).code);

        skim.mint(buyer, 1_000_000e6);
        vm.prank(buyer);
        skim.approve(PERMIT2_ADDR, type(uint256).max);
    }

    function test_permit2_path_rejects_fee_on_transfer_token() public {
        uint256 amount = 100_000e6;
        uint256 deadline = block.timestamp + 1 hours;
        // Build fully before pranking: argument evaluation makes view calls,
        // and vm.prank / vm.expectRevert both apply to the *next* call.
        PaymentVault.Permit2Payment memory p =
            _payment(amount, deadline, 1, _signIntent(amount, deadline));

        vm.prank(relayer);
        vm.expectRevert("Fee-on-transfer token");
        vault.createPaymentWithPermit2(p);
    }

    function test_fee_on_transfer_cannot_drain_a_residual_vault_balance() public {
        // Strand a residual balance in the vault, then try to settle a payment
        // whose actual receipt is short. Without the delta check the split would
        // pay the merchant out of the residual.
        skim.mint(address(vault), 500_000e6);
        uint256 residual = skim.balanceOf(address(vault));

        uint256 amount = 100_000e6;
        uint256 deadline = block.timestamp + 1 hours;
        PaymentVault.Permit2Payment memory p =
            _payment(amount, deadline, 1, _signIntent(amount, deadline));

        vm.prank(relayer);
        vm.expectRevert("Fee-on-transfer token");
        vault.createPaymentWithPermit2(p);

        assertEq(skim.balanceOf(address(vault)), residual, "residual untouched");
        assertEq(skim.balanceOf(merchant), 0);
    }

    function test_owner_can_rescue_a_stranded_balance() public {
        skim.mint(address(vault), 1_000e6);
        address to = makeAddr("rescue");
        uint256 stuck = skim.balanceOf(address(vault));

        vault.rescueToken(address(skim), to, stuck);

        assertEq(skim.balanceOf(address(vault)), 0);
        // The token skims the rescue transfer too; what matters is the vault
        // no longer holds it.
        assertGt(skim.balanceOf(to), 0);
    }

    function test_wellbehaved_token_still_settles_through_permit2() public {
        FeeOnTransferToken clean = new FeeOnTransferToken(0);
        vault.setAcceptedToken(address(clean), true);
        clean.mint(buyer, 1_000_000e6);
        vm.prank(buyer);
        clean.approve(PERMIT2_ADDR, type(uint256).max);

        uint256 amount = 100_000e6;
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory intent = _signIntentForToken(address(clean), amount, deadline);
        PaymentVault.Permit2Payment memory p = _payment(amount, deadline, 7, intent);
        p.token = address(clean);

        vm.prank(relayer);
        vault.createPaymentWithPermit2(p);

        uint256 fee = (amount * 50) / 10000;
        assertEq(clean.balanceOf(merchant), amount - fee);
        assertEq(clean.balanceOf(platformWallet), fee);
        assertEq(clean.balanceOf(address(vault)), 0);
    }

    // ----- helpers -----

    function _payment(uint256 amount, uint256 deadline, uint256 nonce, bytes memory intent)
        internal
        view
        returns (PaymentVault.Permit2Payment memory)
    {
        return PaymentVault.Permit2Payment({
            token: address(skim),
            buyer: buyer,
            merchant: merchant,
            amount: amount,
            productId: "p",
            customerId: "c",
            maxFeeBps: MAX_FEE_BPS,
            permit2Nonce: nonce,
            permit2Deadline: deadline,
            permit2Signature: hex"00",
            intentSignature: intent
        });
    }

    function _signIntent(uint256 amount, uint256 deadline) internal view returns (bytes memory) {
        return _signIntentForToken(address(skim), amount, deadline);
    }

    function _signIntentForToken(address token, uint256 amount, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                PAYMENT_INTENT_TYPEHASH,
                buyer,
                token,
                merchant,
                amount,
                bytes32("p"),
                bytes32("c"),
                MAX_FEE_BPS,
                vault.FLOW_PERMIT2(),
                vault.getIntentNonce(buyer),
                deadline
            )
        );
        bytes32 digest =
            keccak256(abi.encodePacked("\x19\x01", vault.domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(buyerPk, digest);
        return abi.encodePacked(r, s, v);
    }
}
