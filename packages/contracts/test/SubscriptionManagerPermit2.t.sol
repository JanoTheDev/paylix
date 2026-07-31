// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/SubscriptionManager.sol";
import "../src/MockUSDC.sol";
import "../src/interfaces/IPermit2.sol";

/**
 * Stand-in for Permit2 AllowanceTransfer. Like PaymentVaultPermit2's stub, we
 * validate the allowance + expiration mechanics without re-implementing
 * Permit2's EIP-712 signature verification — that's Uniswap's problem.
 */
contract StubPermit2Allowance {
    mapping(address => mapping(address => mapping(address => uint160))) public allowed;
    mapping(address => mapping(address => mapping(address => uint48))) public expiry;

    function permit(
        address owner,
        IPermit2.PermitSingle calldata p,
        bytes calldata /* signature */
    ) external {
        require(block.timestamp <= p.sigDeadline, "Permit2: sig expired");
        allowed[owner][p.details.token][p.spender] = p.details.amount;
        expiry[owner][p.details.token][p.spender] = p.details.expiration;
    }

    /// Mirrors Permit2's AllowanceTransfer view; the manager reads this to
    /// decide payability before writing state.
    function allowance(address user, address token, address spender)
        external
        view
        returns (uint160, uint48, uint48)
    {
        return (allowed[user][token][spender], expiry[user][token][spender], 0);
    }

    function transferFrom(
        address from,
        address to,
        uint160 amount,
        address token
    ) external {
        require(
            block.timestamp <= expiry[from][token][msg.sender],
            "Permit2: allowance expired"
        );
        uint160 current = allowed[from][token][msg.sender];
        require(current >= amount, "Permit2: insufficient allowance");
        allowed[from][token][msg.sender] = current - amount;
        IERC20(token).transferFrom(from, to, amount);
    }
}

contract SubscriptionManagerPermit2Test is Test {
    SubscriptionManager public subs;
    MockUSDC public usdc;
    StubPermit2Allowance public stub;

    address public platformWallet = makeAddr("platform");
    address public merchant = makeAddr("merchant");
    address public relayer = makeAddr("relayer");

    uint256 public buyerPk = 0xB0B;
    address public buyer;

    address constant PERMIT2_ADDR = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    bytes32 public productId = keccak256("prod_pro");
    bytes32 public customerId = keccak256("cust_789");

    uint256 public constant MONTHLY = 30 days;
    uint256 public constant AMOUNT = 10e6;

    uint256 constant MAX_FEE_BPS = 50;

    bytes32 constant SUBSCRIPTION_INTENT_TYPEHASH = keccak256(
        "SubscriptionIntent(address buyer,address token,address merchant,uint256 amount,uint256 interval,bytes32 productId,bytes32 customerId,uint256 permitValue,uint256 maxFeeBps,uint8 flow,uint256 nonce,uint256 deadline)"
    );

    function setUp() public {
        buyer = vm.addr(buyerPk);
        usdc = new MockUSDC();
        subs = new SubscriptionManager(platformWallet, 50);
        subs.setAcceptedToken(address(usdc), true);
        subs.setRelayer(relayer);

        stub = new StubPermit2Allowance();
        vm.etch(PERMIT2_ADDR, address(stub).code);

        // Buyer grants classic ERC-20 allowance to Permit2 once (mirrors real
        // Permit2 usage pattern — users approve Permit2 as spender of their
        // token once, then use Permit2 allowances per counterparty after).
        vm.prank(buyer);
        usdc.approve(PERMIT2_ADDR, type(uint256).max);

        usdc.mint(buyer, 100_000e6);
    }

    function _defaultParams(uint256 deadline)
        internal
        view
        returns (SubscriptionManager.CreateSubPermit2Params memory p, IPermit2.PermitSingle memory ps)
    {
        p = SubscriptionManager.CreateSubPermit2Params({
            token: address(usdc),
            buyer: buyer,
            merchant: merchant,
            amount: AMOUNT,
            interval: MONTHLY,
            productId: productId,
            customerId: customerId,
            maxFeeBps: MAX_FEE_BPS,
            deadline: deadline
        });
        ps = IPermit2.PermitSingle({
            details: IPermit2.PermitDetails({
                token: address(usdc),
                amount: uint160(AMOUNT * 1000),
                expiration: uint48(deadline + 365 days),
                nonce: 0
            }),
            spender: address(subs),
            sigDeadline: deadline
        });
    }

    function _signIntent(SubscriptionManager.CreateSubPermit2Params memory p, uint160 permitValue)
        internal
        view
        returns (bytes memory)
    {
        bytes32 structHash = keccak256(
            bytes.concat(
                abi.encode(
                    SUBSCRIPTION_INTENT_TYPEHASH,
                    p.buyer,
                    p.token,
                    p.merchant,
                    p.amount,
                    p.interval,
                    p.productId
                ),
                abi.encode(
                    p.customerId,
                    uint256(permitValue),
                    p.maxFeeBps,
                    subs.FLOW_PERMIT2(),
                    subs.getIntentNonce(p.buyer),
                    p.deadline
                )
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", subs.domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(buyerPk, digest);
        return abi.encodePacked(r, s, v);
    }

    function test_happy_path_creates_and_charges_first_cycle() public {
        uint256 deadline = block.timestamp + 1 hours;
        (
            SubscriptionManager.CreateSubPermit2Params memory p,
            IPermit2.PermitSingle memory ps
        ) = _defaultParams(deadline);
        bytes memory intent = _signIntent(p, ps.details.amount);

        vm.prank(relayer);
        uint256 subId = subs.createSubscriptionWithPermit2(p, ps, hex"00", intent);

        assertEq(subId, 0);
        assertTrue(subs.isPermit2Subscription(subId));

        uint256 fee = (AMOUNT * 50) / 10000;
        assertEq(usdc.balanceOf(merchant), AMOUNT - fee);
        assertEq(usdc.balanceOf(platformWallet), fee);
    }

    function test_recurring_charge_after_interval_passes() public {
        uint256 deadline = block.timestamp + 1 hours;
        (
            SubscriptionManager.CreateSubPermit2Params memory p,
            IPermit2.PermitSingle memory ps
        ) = _defaultParams(deadline);
        bytes memory intent = _signIntent(p, ps.details.amount);

        vm.prank(relayer);
        uint256 subId = subs.createSubscriptionWithPermit2(p, ps, hex"00", intent);

        vm.warp(block.timestamp + MONTHLY + 1);
        vm.prank(relayer);
        subs.chargeSubscription(subId);

        uint256 fee = (AMOUNT * 50) / 10000;
        assertEq(usdc.balanceOf(merchant), (AMOUNT - fee) * 2);
    }

    function test_reverts_when_non_relayer_calls() public {
        uint256 deadline = block.timestamp + 1 hours;
        (
            SubscriptionManager.CreateSubPermit2Params memory p,
            IPermit2.PermitSingle memory ps
        ) = _defaultParams(deadline);
        bytes memory intent = _signIntent(p, ps.details.amount);

        vm.prank(address(0xDEAD));
        vm.expectRevert("Only relayer");
        subs.createSubscriptionWithPermit2(p, ps, hex"00", intent);
    }

    function test_reverts_on_spender_mismatch() public {
        uint256 deadline = block.timestamp + 1 hours;
        (
            SubscriptionManager.CreateSubPermit2Params memory p,
            IPermit2.PermitSingle memory ps
        ) = _defaultParams(deadline);
        ps.spender = address(0xBAD);
        bytes memory intent = _signIntent(p, ps.details.amount);

        vm.prank(relayer);
        vm.expectRevert("Permit2 spender mismatch");
        subs.createSubscriptionWithPermit2(p, ps, hex"00", intent);
    }

    function test_reverts_on_token_mismatch() public {
        uint256 deadline = block.timestamp + 1 hours;
        (
            SubscriptionManager.CreateSubPermit2Params memory p,
            IPermit2.PermitSingle memory ps
        ) = _defaultParams(deadline);
        ps.details.token = address(0xABCD);
        bytes memory intent = _signIntent(p, ps.details.amount);

        vm.prank(relayer);
        vm.expectRevert("Permit2 token mismatch");
        subs.createSubscriptionWithPermit2(p, ps, hex"00", intent);
    }

    function test_reverts_when_relayer_swaps_merchant() public {
        uint256 deadline = block.timestamp + 1 hours;
        (
            SubscriptionManager.CreateSubPermit2Params memory p,
            IPermit2.PermitSingle memory ps
        ) = _defaultParams(deadline);
        bytes memory intent = _signIntent(p, ps.details.amount);
        p.merchant = address(0xDEAD);

        vm.prank(relayer);
        vm.expectRevert("Invalid intent signature");
        subs.createSubscriptionWithPermit2(p, ps, hex"00", intent);
    }

    function test_chargeSubscription_dispatches_to_permit2_path() public {
        uint256 deadline = block.timestamp + 1 hours;
        (
            SubscriptionManager.CreateSubPermit2Params memory p,
            IPermit2.PermitSingle memory ps
        ) = _defaultParams(deadline);
        bytes memory intent = _signIntent(p, ps.details.amount);

        vm.prank(relayer);
        uint256 subId = subs.createSubscriptionWithPermit2(p, ps, hex"00", intent);

        // Warp three intervals forward, charge three times.
        for (uint256 i = 0; i < 3; i++) {
            vm.warp(block.timestamp + MONTHLY + 1);
            vm.prank(relayer);
            subs.chargeSubscription(subId);
        }

        uint256 fee = (AMOUNT * 50) / 10000;
        assertEq(usdc.balanceOf(merchant), (AMOUNT - fee) * 4); // 1 create + 3 recurring
    }

    function test_reverts_when_gasless_paused() public {
        subs.setGaslessPaused(true);
        uint256 deadline = block.timestamp + 1 hours;
        (
            SubscriptionManager.CreateSubPermit2Params memory p,
            IPermit2.PermitSingle memory ps
        ) = _defaultParams(deadline);
        bytes memory intent = _signIntent(p, ps.details.amount);

        vm.prank(relayer);
        vm.expectRevert("Gasless paused");
        subs.createSubscriptionWithPermit2(p, ps, hex"00", intent);
    }
}
