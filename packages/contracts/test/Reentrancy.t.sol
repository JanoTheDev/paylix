// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../src/PaymentVault.sol";
import "../src/SubscriptionManager.sol";
import "./stubs/Permit2Stubs.sol";

/// `nonReentrant` is claimed in README.md but was never demonstrated. A
/// malicious token is the realistic vector: `acceptedTokens` is owner-managed,
/// but a token can also change behaviour after being listed.
contract MaliciousToken is ERC20 {
    address public vault;
    address public subsManager;
    address public merchant;

    bool public armVault;
    bool public armSubs;
    bool public reentryAttempted;
    bool public reentryBlocked;

    constructor() ERC20("Malicious", "EVIL") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function arm(address _vault, address _subs, address _merchant) external {
        vault = _vault;
        subsManager = _subs;
        merchant = _merchant;
    }

    function armForVault() external { armVault = true; }
    function armForSubs() external { armSubs = true; }

    function transferFrom(address from, address to, uint256 value)
        public
        override
        returns (bool)
    {
        if (armVault) {
            armVault = false;
            reentryAttempted = true;
            try PaymentVault(vault).createPayment(address(this), merchant, 1, "p", "c") {
                reentryBlocked = false;
            } catch {
                reentryBlocked = true;
            }
        }
        if (armSubs) {
            armSubs = false;
            reentryAttempted = true;
            try SubscriptionManager(subsManager).createSubscription(
                address(this), merchant, 1, 30 days, "p", "c"
            ) returns (uint256) {
                reentryBlocked = false;
            } catch {
                reentryBlocked = true;
            }
        }
        return super.transferFrom(from, to, value);
    }
}

contract ReentrancyTest is Test {
    PaymentVault public vault;
    SubscriptionManager public subs;
    MaliciousToken public evil;

    address public platformWallet = makeAddr("platform");
    address public merchant = makeAddr("merchant");
    address public payer = makeAddr("payer");

    function setUp() public {
        evil = new MaliciousToken();
        vault = new PaymentVault(platformWallet, 50);
        subs = new SubscriptionManager(platformWallet, 50);
        vault.setAcceptedToken(address(evil), true);
        subs.setAcceptedToken(address(evil), true);
        evil.arm(address(vault), address(subs), merchant);

        evil.mint(payer, 1_000_000e6);
        vm.startPrank(payer);
        evil.approve(address(vault), type(uint256).max);
        evil.approve(address(subs), type(uint256).max);
        vm.stopPrank();
    }

    function test_vault_blocks_reentrancy_from_a_malicious_token() public {
        evil.armForVault();

        vm.prank(payer);
        vault.createPayment(address(evil), merchant, 1000e6, "p", "c");

        assertTrue(evil.reentryAttempted(), "token did try to re-enter");
        assertTrue(evil.reentryBlocked(), "nonReentrant rejected the re-entry");
        // Exactly one payment settled.
        uint256 fee = (1000e6 * 50) / 10000;
        assertEq(evil.balanceOf(merchant), 1000e6 - fee);
        assertEq(evil.balanceOf(address(vault)), 0);
    }

    function test_subscriptionManager_blocks_reentrancy_from_a_malicious_token() public {
        evil.armForSubs();

        vm.prank(payer);
        subs.createSubscription(address(evil), merchant, 1000e6, 30 days, "p", "c");

        assertTrue(evil.reentryAttempted(), "token did try to re-enter");
        assertTrue(evil.reentryBlocked(), "nonReentrant rejected the re-entry");
        assertEq(subs.nextSubscriptionId(), 1, "no second subscription created");
        assertEq(evil.balanceOf(address(subs)), 0);
    }
}

/// The Permit2 settlement path is the only one where the vault holds a real
/// balance mid-transaction, so it is the only place where a successful
/// re-entrancy would have something to steal. This exercises re-entry from
/// inside the Permit2 pull, while the vault is holding `amount`.
contract Permit2ReentrancyTest is Test {
    PaymentVault public vault;
    MaliciousToken public evil;

    address public platformWallet = makeAddr("platform");
    address public merchant = makeAddr("merchant");
    address public attackerMerchant = makeAddr("attackerMerchant");
    address public relayer = makeAddr("relayer");

    uint256 public buyerPk = 0xE7117;
    address public buyer;

    address constant PERMIT2_ADDR = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    uint256 public constant MAX_FEE_BPS = 50;

    bytes32 private constant PAYMENT_INTENT_TYPEHASH = keccak256(
        "PaymentIntent(address buyer,address token,address merchant,uint256 amount,bytes32 productId,bytes32 customerId,uint256 maxFeeBps,uint8 flow,uint256 nonce,uint256 deadline)"
    );

    function setUp() public {
        buyer = vm.addr(buyerPk);
        evil = new MaliciousToken();
        vault = new PaymentVault(platformWallet, 50);
        vault.setAcceptedToken(address(evil), true);
        vault.setRelayer(relayer);
        evil.arm(address(vault), address(0), attackerMerchant);

        StubPermit2SignatureTransfer stub = new StubPermit2SignatureTransfer();
        vm.etch(PERMIT2_ADDR, address(stub).code);

        evil.mint(buyer, 1_000_000e6);
        vm.prank(buyer);
        evil.approve(PERMIT2_ADDR, type(uint256).max);
    }

    function test_permit2_path_blocks_reentrancy_while_holding_a_balance() public {
        uint256 amount = 100_000e6;
        uint256 deadline = block.timestamp + 1 hours;

        // Build the request before pranking — argument evaluation makes view
        // calls of its own, and vm.prank applies to the next call.
        PaymentVault.Permit2Payment memory p = PaymentVault.Permit2Payment({
            token: address(evil),
            buyer: buyer,
            merchant: merchant,
            amount: amount,
            productId: "p",
            customerId: "c",
            maxFeeBps: MAX_FEE_BPS,
            permit2Nonce: 1,
            permit2Deadline: deadline,
            permit2Signature: hex"00",
            intentSignature: _signIntent(amount, deadline)
        });

        // Arms re-entry inside the Permit2 pull — i.e. while the vault holds
        // the full amount.
        evil.armForVault();

        vm.prank(relayer);
        vault.createPaymentWithPermit2(p);

        assertTrue(evil.reentryAttempted(), "token did try to re-enter mid-custody");
        assertTrue(evil.reentryBlocked(), "nonReentrant rejected the re-entry");
        assertEq(evil.balanceOf(attackerMerchant), 0, "attacker got nothing");

        uint256 fee = (amount * 50) / 10000;
        assertEq(evil.balanceOf(merchant), amount - fee);
        assertEq(evil.balanceOf(platformWallet), fee);
        assertEq(evil.balanceOf(address(vault)), 0, "no custody left behind");
    }

    function _signIntent(uint256 amount, uint256 deadline) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                PAYMENT_INTENT_TYPEHASH,
                buyer,
                address(evil),
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
