// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/SubscriptionManager.sol";
import "../src/MockUSDC.sol";

contract SubscriptionManagerPermitTest is Test {
    SubscriptionManager public subs;
    MockUSDC public usdc;

    address public owner = makeAddr("owner");
    address public platformWallet = makeAddr("platform");
    address public merchant = makeAddr("merchant");
    address public attacker = makeAddr("attacker");
    address public relayer = makeAddr("relayer");

    uint256 public buyerPrivateKey = 0xB0B;
    address public buyer = vm.addr(buyerPrivateKey);

    uint256 public otherPrivateKey = 0xBAD;

    bytes32 public productId = keccak256("prod_pro");
    bytes32 public customerId = keccak256("cust_789");

    uint256 public constant MONTHLY = 30 days;
    uint256 public constant AMOUNT = 10e6;

    bytes32 private constant SUBSCRIPTION_INTENT_TYPEHASH = keccak256(
        "SubscriptionIntent(address buyer,address token,address merchant,uint256 amount,uint256 interval,bytes32 productId,bytes32 customerId,uint256 permitValue,uint256 nonce,uint256 deadline)"
    );

    function setUp() public {
        usdc = new MockUSDC();
        vm.startPrank(owner);
        subs = new SubscriptionManager(platformWallet, 50);
        subs.setAcceptedToken(address(usdc), true);
        subs.setRelayer(relayer);
        vm.stopPrank();

        usdc.mint(buyer, 100000e6);
    }

    // ----- Happy path -----

    function test_success() public {
        (SubscriptionManager.CreateSubPermitParams memory p, bytes memory intentSig) =
            _buildCall(merchant, AMOUNT, MONTHLY, AMOUNT * 1000, block.timestamp + 1 hours);

        vm.prank(relayer);
        uint256 subId = subs.createSubscriptionWithPermit(p, intentSig);

        assertEq(subId, 0);
        (address subSubscriber, , , uint256 subAmount, , , , , , ,) = subs.subscriptions(subId);
        assertEq(subSubscriber, buyer);
        assertEq(subAmount, AMOUNT);

        uint256 fee = (AMOUNT * 50) / 10000;
        assertEq(usdc.balanceOf(merchant), AMOUNT - fee);
        assertEq(usdc.balanceOf(platformWallet), fee);
        assertEq(subs.getIntentNonce(buyer), 1);
    }

    function test_enables_recurring_charges() public {
        (SubscriptionManager.CreateSubPermitParams memory p, bytes memory intentSig) =
            _buildCall(merchant, AMOUNT, MONTHLY, AMOUNT * 1000, block.timestamp + 1 hours);

        vm.prank(relayer);
        uint256 subId = subs.createSubscriptionWithPermit(p, intentSig);

        vm.warp(block.timestamp + MONTHLY + 1);
        vm.prank(relayer);
        subs.chargeSubscription(subId);

        uint256 fee = (AMOUNT * 50) / 10000;
        assertEq(usdc.balanceOf(merchant), (AMOUNT - fee) * 2);
    }

    function test_emits_event_with_buyer() public {
        (SubscriptionManager.CreateSubPermitParams memory p, bytes memory intentSig) =
            _buildCall(merchant, AMOUNT, MONTHLY, AMOUNT * 1000, block.timestamp + 1 hours);

        vm.expectEmit(true, true, true, true);
        emit SubscriptionManager.SubscriptionCreated(
            0, buyer, merchant, address(usdc), AMOUNT, MONTHLY, productId, customerId
        );

        vm.prank(relayer);
        subs.createSubscriptionWithPermit(p, intentSig);
    }

    // ----- Authorization -----

    function test_reverts_when_not_relayer() public {
        (SubscriptionManager.CreateSubPermitParams memory p, bytes memory intentSig) =
            _buildCall(merchant, AMOUNT, MONTHLY, AMOUNT * 1000, block.timestamp + 1 hours);

        vm.prank(attacker);
        vm.expectRevert("Only relayer");
        subs.createSubscriptionWithPermit(p, intentSig);
    }

    // ----- Validation -----

    function test_reverts_on_permit_under_amount() public {
        (SubscriptionManager.CreateSubPermitParams memory p, bytes memory intentSig) =
            _buildCall(merchant, AMOUNT, MONTHLY, AMOUNT - 1, block.timestamp + 1 hours);

        vm.prank(relayer);
        vm.expectRevert("Permit < amount");
        subs.createSubscriptionWithPermit(p, intentSig);
    }

    function test_reverts_on_zero_interval() public {
        (SubscriptionManager.CreateSubPermitParams memory p, bytes memory intentSig) =
            _buildCall(merchant, AMOUNT, 0, AMOUNT * 1000, block.timestamp + 1 hours);

        vm.prank(relayer);
        vm.expectRevert("Invalid interval");
        subs.createSubscriptionWithPermit(p, intentSig);
    }

    function test_reverts_on_zero_buyer() public {
        (SubscriptionManager.CreateSubPermitParams memory p, bytes memory intentSig) =
            _buildCall(merchant, AMOUNT, MONTHLY, AMOUNT * 1000, block.timestamp + 1 hours);
        p.buyer = address(0);

        vm.prank(relayer);
        vm.expectRevert("Invalid buyer");
        subs.createSubscriptionWithPermit(p, intentSig);
    }

    // ----- SubscriptionIntent: security tests -----

    function test_reverts_if_relayer_swaps_merchant() public {
        (SubscriptionManager.CreateSubPermitParams memory p, bytes memory intentSig) =
            _buildCall(merchant, AMOUNT, MONTHLY, AMOUNT * 1000, block.timestamp + 1 hours);
        // Intent was signed for `merchant` — relayer tries to route to `attacker`.
        p.merchant = attacker;

        vm.prank(relayer);
        vm.expectRevert("Invalid intent signature");
        subs.createSubscriptionWithPermit(p, intentSig);

        assertEq(usdc.balanceOf(attacker), 0);
    }

    function test_reverts_if_relayer_swaps_amount() public {
        (SubscriptionManager.CreateSubPermitParams memory p, bytes memory intentSig) =
            _buildCall(merchant, AMOUNT, MONTHLY, AMOUNT * 1000, block.timestamp + 1 hours);
        // Intent was signed for AMOUNT — relayer tries to charge 100x.
        p.amount = AMOUNT * 100;

        vm.prank(relayer);
        vm.expectRevert("Invalid intent signature");
        subs.createSubscriptionWithPermit(p, intentSig);
    }

    function test_reverts_if_relayer_swaps_interval() public {
        (SubscriptionManager.CreateSubPermitParams memory p, bytes memory intentSig) =
            _buildCall(merchant, AMOUNT, MONTHLY, AMOUNT * 1000, block.timestamp + 1 hours);
        // Intent was signed for monthly — relayer tries weekly (4x more charges).
        p.interval = 7 days;

        vm.prank(relayer);
        vm.expectRevert("Invalid intent signature");
        subs.createSubscriptionWithPermit(p, intentSig);
    }

    function test_reverts_if_relayer_inflates_permit_value() public {
        (SubscriptionManager.CreateSubPermitParams memory p, bytes memory intentSig) =
            _buildCall(merchant, AMOUNT, MONTHLY, AMOUNT * 1000, block.timestamp + 1 hours);
        // Intent was signed for permitValue = AMOUNT * 1000 (~83 years of charges).
        // Relayer tries to request max allowance so they can drain on-schedule later.
        p.permitValue = type(uint256).max;
        // Re-sign the permit for the new value so that leg passes — we want to
        // isolate the intent check.
        SubscriptionManager.CreateSubPermitParams memory resignedPermit = _signPermitOnly(
            p, buyerPrivateKey
        );
        p.v = resignedPermit.v;
        p.r = resignedPermit.r;
        p.s = resignedPermit.s;

        vm.prank(relayer);
        vm.expectRevert("Invalid intent signature");
        subs.createSubscriptionWithPermit(p, intentSig);
    }

    function test_reverts_on_signature_by_non_buyer() public {
        SubscriptionManager.CreateSubPermitParams memory p =
            _buildParams(merchant, AMOUNT, MONTHLY, AMOUNT * 1000, block.timestamp + 1 hours);
        p = _signPermitOnly(p, buyerPrivateKey);
        // Intent signed by wrong key
        bytes memory intentSig = _signIntent(p, otherPrivateKey);

        vm.prank(relayer);
        vm.expectRevert("Invalid intent signature");
        subs.createSubscriptionWithPermit(p, intentSig);
    }

    function test_reverts_on_replayed_intent() public {
        (SubscriptionManager.CreateSubPermitParams memory p, bytes memory intentSig) =
            _buildCall(merchant, AMOUNT, MONTHLY, AMOUNT * 1000, block.timestamp + 1 hours);

        vm.prank(relayer);
        subs.createSubscriptionWithPermit(p, intentSig);

        // Rebuild the permit with a fresh token-nonce (so permit step doesn't
        // mask the intent check), reuse the same intent signature — nonce has
        // already been incremented so recovery fails.
        SubscriptionManager.CreateSubPermitParams memory p2 = _signPermitOnly(p, buyerPrivateKey);
        vm.prank(relayer);
        vm.expectRevert("Invalid intent signature");
        subs.createSubscriptionWithPermit(p2, intentSig);
    }

    function test_reverts_on_expired_deadline() public {
        (SubscriptionManager.CreateSubPermitParams memory p, bytes memory intentSig) =
            _buildCall(merchant, AMOUNT, MONTHLY, AMOUNT * 1000, block.timestamp + 1 hours);

        vm.warp(p.deadline + 1);

        vm.prank(relayer);
        vm.expectRevert("Intent expired");
        subs.createSubscriptionWithPermit(p, intentSig);
    }

    // ----- Helpers -----

    function _buildCall(
        address merchant_,
        uint256 amount,
        uint256 interval,
        uint256 permitValue,
        uint256 deadline
    )
        internal
        view
        returns (SubscriptionManager.CreateSubPermitParams memory p, bytes memory intentSig)
    {
        p = _buildParams(merchant_, amount, interval, permitValue, deadline);
        p = _signPermitOnly(p, buyerPrivateKey);
        intentSig = _signIntent(p, buyerPrivateKey);
    }

    function _buildParams(
        address merchant_,
        uint256 amount,
        uint256 interval,
        uint256 permitValue,
        uint256 deadline
    ) internal view returns (SubscriptionManager.CreateSubPermitParams memory p) {
        p = SubscriptionManager.CreateSubPermitParams({
            token: address(usdc),
            buyer: buyer,
            merchant: merchant_,
            amount: amount,
            interval: interval,
            productId: productId,
            customerId: customerId,
            permitValue: permitValue,
            deadline: deadline,
            v: 0,
            r: bytes32(0),
            s: bytes32(0)
        });
    }

    function _signPermitOnly(
        SubscriptionManager.CreateSubPermitParams memory p,
        uint256 signerKey
    ) internal view returns (SubscriptionManager.CreateSubPermitParams memory) {
        bytes32 PERMIT_TYPEHASH = keccak256(
            "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
        );
        uint256 nonce = usdc.nonces(buyer);
        bytes32 structHash = keccak256(
            abi.encode(PERMIT_TYPEHASH, buyer, address(subs), p.permitValue, nonce, p.deadline)
        );
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), structHash)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, digest);
        p.v = v;
        p.r = r;
        p.s = s;
        return p;
    }

    function _signIntent(
        SubscriptionManager.CreateSubPermitParams memory p,
        uint256 signerKey
    ) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                SUBSCRIPTION_INTENT_TYPEHASH,
                p.buyer,
                p.token,
                p.merchant,
                p.amount,
                p.interval,
                p.productId,
                p.customerId,
                p.permitValue,
                subs.getIntentNonce(buyer),
                p.deadline
            )
        );
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", subs.domainSeparator(), structHash)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, digest);
        return abi.encodePacked(r, s, v);
    }
}
