// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/PaymentVault.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * Stand-in for mainnet DAI. Implements the legacy permit interface with
 * `allowed` bool semantics but skips actual signature verification to keep
 * the tests focused on PaymentVault's DAI-permit integration.
 */
contract MockDai {
    mapping(address => mapping(address => uint256)) private _allowance;
    mapping(address => uint256) public nonces;
    mapping(address => uint256) private _balance;

    string public constant name = "Dai Stablecoin";
    string public constant symbol = "DAI";
    uint8 public constant decimals = 18;

    function mint(address to, uint256 amount) external {
        _balance[to] += amount;
    }

    function balanceOf(address who) external view returns (uint256) {
        return _balance[who];
    }

    function allowance(address owner, address spender) external view returns (uint256) {
        return _allowance[owner][spender];
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        _allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(_balance[from] >= amount, "balance");
        require(_allowance[from][msg.sender] >= amount, "allowance");
        _balance[from] -= amount;
        _balance[to] += amount;
        _allowance[from][msg.sender] -= amount;
        return true;
    }

    // DAI permit: allowed=true → uint(-1), allowed=false → 0. Skips ecrecover.
    function permit(
        address holder,
        address spender,
        uint256 nonce,
        uint256 expiry,
        bool allowed,
        uint8 /* v */,
        bytes32 /* r */,
        bytes32 /* s */
    ) external {
        require(block.timestamp <= expiry, "DAI: expired");
        require(nonces[holder] == nonce, "DAI: bad nonce");
        nonces[holder]++;
        _allowance[holder][spender] = allowed ? type(uint256).max : 0;
    }
}

contract PaymentVaultDaiPermitTest is Test {
    PaymentVault vault;
    MockDai dai;

    address platformWallet = address(0xABCD);
    address relayer = address(0xBEEF);
    address merchant = address(0xCAFE);

    uint256 buyerPk = 0xD01D01;
    address buyer;

    uint256 constant MAX_FEE_BPS = 50;

    function setUp() public {
        buyer = vm.addr(buyerPk);
        dai = new MockDai();
        vault = new PaymentVault(platformWallet, 50);
        vault.setAcceptedToken(address(dai), true);
        vault.setRelayer(relayer);
        dai.mint(buyer, 10_000 ether);
    }

    function _signIntent(
        address merchantAddr,
        uint256 amount,
        bytes32 productId,
        bytes32 customerId,
        uint256 deadline
    ) internal view returns (bytes memory) {
        bytes32 typeHash = keccak256(
            "PaymentIntent(address buyer,address token,address merchant,uint256 amount,bytes32 productId,bytes32 customerId,uint256 maxFeeBps,uint8 flow,uint256 nonce,uint256 deadline)"
        );
        bytes32 structHash = keccak256(
            abi.encode(
                typeHash,
                buyer,
                address(dai),
                merchantAddr,
                amount,
                productId,
                customerId,
                MAX_FEE_BPS,
                vault.FLOW_DAI_PERMIT(),
                uint256(0),
                deadline
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", vault.domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(buyerPk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _payment(uint256 amount, uint256 deadline, bytes memory intent)
        internal
        view
        returns (PaymentVault.DaiPermitPayment memory)
    {
        return PaymentVault.DaiPermitPayment({
            token: address(dai),
            buyer: buyer,
            merchant: merchant,
            amount: amount,
            productId: "p",
            customerId: "c",
            maxFeeBps: MAX_FEE_BPS,
            daiNonce: 0,
            permitExpiry: deadline,
            v: 27,
            r: bytes32(0),
            s: bytes32(0),
            intentSignature: intent
        });
    }

    function test_happy_path_pulls_full_amount_and_splits_fee() public {
        uint256 amount = 100 ether;
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory intent = _signIntent(merchant, amount, "p", "c", deadline);

        vm.prank(relayer);
        vault.createPaymentWithDaiPermit(_payment(amount, deadline, intent));

        assertEq(dai.balanceOf(merchant), 99.5 ether);
        assertEq(dai.balanceOf(platformWallet), 0.5 ether);
    }

    function test_reverts_when_non_relayer_calls() public {
        uint256 amount = 100 ether;
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory intent = _signIntent(merchant, amount, "p", "c", deadline);

        vm.prank(address(0xDEAD));
        vm.expectRevert("Only relayer");
        vault.createPaymentWithDaiPermit(_payment(amount, deadline, intent));
    }

    function test_reverts_when_relayer_swaps_merchant() public {
        uint256 amount = 100 ether;
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory intent = _signIntent(merchant, amount, "p", "c", deadline);

        PaymentVault.DaiPermitPayment memory req = _payment(amount, deadline, intent);
        req.merchant = address(0xDEAD);

        vm.prank(relayer);
        vm.expectRevert("Invalid intent signature");
        vault.createPaymentWithDaiPermit(req);
    }

    function test_reverts_when_token_not_accepted() public {
        MockDai other = new MockDai();
        uint256 amount = 100 ether;
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory intent = _signIntent(merchant, amount, "p", "c", deadline);

        PaymentVault.DaiPermitPayment memory req = _payment(amount, deadline, intent);
        req.token = address(other);

        vm.prank(relayer);
        vm.expectRevert("Token not accepted");
        vault.createPaymentWithDaiPermit(req);
    }

    function test_reverts_when_paused() public {
        vault.pause();
        uint256 amount = 100 ether;
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory intent = _signIntent(merchant, amount, "p", "c", deadline);

        vm.prank(relayer);
        vm.expectRevert();
        vault.createPaymentWithDaiPermit(_payment(amount, deadline, intent));
    }
}
