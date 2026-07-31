// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/SubscriptionManager.sol";
import "../src/MockUSDC.sol";

/// SC-05: `Status.Active` used to be enum value 0, so every unwritten
/// `subscriptions[id]` slot read back as an active subscription owned by
/// address(0) — and relayer-callable helpers happily emitted PastDue /
/// Cancelled events for subscription ids that never existed, feeding junk into
/// the indexer.
contract SubscriptionManagerPhantomTest is Test {
    SubscriptionManager public subs;
    MockUSDC public usdc;

    address public owner = makeAddr("owner");
    address public platformWallet = makeAddr("platform");
    address public merchant = makeAddr("merchant");
    address public relayer = makeAddr("relayer");
    address public subscriber = makeAddr("subscriber");

    uint256 public constant MONTHLY = 30 days;
    uint256 public constant AMOUNT = 10e6;
    uint256 public constant PHANTOM_ID = 2 ** 200;

    function setUp() public {
        usdc = new MockUSDC();
        vm.startPrank(owner);
        subs = new SubscriptionManager(platformWallet, 50);
        subs.setAcceptedToken(address(usdc), true);
        subs.setRelayer(relayer);
        vm.stopPrank();

        usdc.mint(subscriber, 10000e6);
        vm.prank(subscriber);
        usdc.approve(address(subs), type(uint256).max);
    }

    function test_none_is_the_zero_status() public pure {
        assertEq(uint256(SubscriptionManager.Status.None), 0);
        assertEq(uint256(SubscriptionManager.Status.Active), 1);
    }

    function test_unwritten_slot_reads_back_as_none_not_active() public view {
        (address sub_, , , , , , , , , SubscriptionManager.Status st, ) =
            subs.subscriptions(PHANTOM_ID);
        assertEq(sub_, address(0));
        assertEq(uint256(st), uint256(SubscriptionManager.Status.None));
    }

    function test_charge_reverts_for_nonexistent_id() public {
        vm.prank(relayer);
        vm.expectRevert("No such subscription");
        subs.chargeSubscription(PHANTOM_ID);
    }

    function test_charge_emits_nothing_for_nonexistent_id() public {
        vm.recordLogs();
        vm.prank(relayer);
        try subs.chargeSubscription(PHANTOM_ID) {
            fail();
        } catch {}
        assertEq(vm.getRecordedLogs().length, 0, "no phantom events reach the indexer");
    }

    function test_relayer_cancel_for_zero_subscriber_reverts() public {
        // 0 == 0 used to pass the "Not the subscriber" check and emit
        // SubscriptionCancelled for an arbitrary id.
        vm.prank(relayer);
        vm.expectRevert("No such subscription");
        subs.cancelSubscriptionByRelayerForSubscriber(PHANTOM_ID, address(0));
    }

    function test_relayer_cancel_for_zero_merchant_reverts() public {
        vm.prank(relayer);
        vm.expectRevert("No such subscription");
        subs.cancelSubscriptionByRelayerForMerchant(PHANTOM_ID, address(0));
    }

    function test_relayer_cancel_rejects_zero_address_on_a_real_subscription() public {
        _createSub();
        vm.prank(relayer);
        vm.expectRevert("Invalid subscriber");
        subs.cancelSubscriptionByRelayerForSubscriber(0, address(0));
    }

    function test_cancel_reverts_for_nonexistent_id() public {
        vm.prank(subscriber);
        vm.expectRevert("No such subscription");
        subs.cancelSubscription(PHANTOM_ID);
    }

    function test_request_wallet_update_reverts_for_nonexistent_id() public {
        vm.prank(subscriber);
        vm.expectRevert("No such subscription");
        subs.requestSubscriptionWalletUpdate(PHANTOM_ID, makeAddr("new"));
    }

    // ----- SC-16: migration preconditions -----

    function test_wallet_migration_requires_allowance_on_the_new_wallet() public {
        uint256 subId = _createSub();
        address newWallet = makeAddr("newWallet");
        usdc.mint(newWallet, 10000e6);
        // No approval from newWallet.

        vm.prank(subscriber);
        subs.requestSubscriptionWalletUpdate(subId, newWallet);

        vm.prank(newWallet);
        vm.expectRevert("New wallet has no allowance");
        subs.acceptSubscriptionWalletUpdate(subId);
    }

    function _createSub() internal returns (uint256) {
        vm.prank(subscriber);
        return subs.createSubscription(
            address(usdc), merchant, AMOUNT, MONTHLY, keccak256("p"), keccak256("c")
        );
    }
}
