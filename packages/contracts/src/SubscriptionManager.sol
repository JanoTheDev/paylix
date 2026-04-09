// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract SubscriptionManager is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Status { Active, PastDue, Cancelled, Expired }

    struct Subscription {
        address subscriber;
        address merchant;
        address token;
        uint256 amount;
        uint256 interval;
        uint256 nextChargeDate;
        bytes32 productId;
        bytes32 customerId;
        uint256 createdAt;
        Status status;
        uint256 totalCharged;
    }

    address public platformWallet;
    uint256 public platformFee;
    mapping(address => bool) public acceptedTokens;
    uint256 public nextSubscriptionId;
    mapping(uint256 => Subscription) public subscriptions;

    event SubscriptionCreated(uint256 indexed subscriptionId, address indexed subscriber, address indexed merchant, address token, uint256 amount, uint256 interval, bytes32 productId, bytes32 customerId);
    event PaymentReceived(uint256 indexed subscriptionId, address indexed subscriber, address indexed merchant, address token, uint256 amount, uint256 fee, uint256 timestamp);
    event SubscriptionPastDue(uint256 indexed subscriptionId, address indexed subscriber, address indexed merchant);
    event SubscriptionCancelled(uint256 indexed subscriptionId);
    event SubscriptionWalletUpdated(uint256 indexed subscriptionId, address indexed oldSubscriber, address indexed newSubscriber);
    event AcceptedTokenUpdated(address indexed token, bool accepted);

    constructor(address _platformWallet, uint256 _platformFee) Ownable(msg.sender) {
        require(_platformFee <= 1000, "Fee too high");
        platformWallet = _platformWallet;
        platformFee = _platformFee;
    }

    function createSubscription(address token, address merchant, uint256 amount, uint256 interval, bytes32 productId, bytes32 customerId) external nonReentrant returns (uint256) {
        require(acceptedTokens[token], "Token not accepted");
        require(amount > 0, "Amount must be > 0");
        require(merchant != address(0), "Invalid merchant");
        require(interval > 0, "Invalid interval");

        uint256 subId = nextSubscriptionId++;
        subscriptions[subId] = Subscription({
            subscriber: msg.sender, merchant: merchant, token: token,
            amount: amount, interval: interval, nextChargeDate: block.timestamp + interval,
            productId: productId, customerId: customerId, createdAt: block.timestamp,
            status: Status.Active, totalCharged: 0
        });

        _processPayment(subId);
        emit SubscriptionCreated(subId, msg.sender, merchant, token, amount, interval, productId, customerId);
        return subId;
    }

    function chargeSubscription(uint256 subscriptionId) external nonReentrant {
        Subscription storage sub = subscriptions[subscriptionId];
        require(sub.status == Status.Active, "Not active");
        require(block.timestamp >= sub.nextChargeDate, "Not due yet");

        bool success = _tryProcessPayment(subscriptionId);
        if (success) {
            sub.nextChargeDate = block.timestamp + sub.interval;
        } else {
            sub.status = Status.PastDue;
            emit SubscriptionPastDue(subscriptionId, sub.subscriber, sub.merchant);
        }
    }

    function cancelSubscription(uint256 subscriptionId) external {
        Subscription storage sub = subscriptions[subscriptionId];
        require(msg.sender == sub.subscriber || msg.sender == sub.merchant, "Not authorized");
        require(sub.status == Status.Active || sub.status == Status.PastDue, "Already inactive");
        sub.status = Status.Cancelled;
        emit SubscriptionCancelled(subscriptionId);
    }

    function updateSubscriptionWallet(uint256 subscriptionId, address newSubscriber) external {
        Subscription storage sub = subscriptions[subscriptionId];
        require(msg.sender == sub.subscriber, "Not subscriber");
        require(newSubscriber != address(0), "Invalid address");
        require(sub.status == Status.Active, "Not active");
        address oldSubscriber = sub.subscriber;
        sub.subscriber = newSubscriber;
        emit SubscriptionWalletUpdated(subscriptionId, oldSubscriber, newSubscriber);
    }

    function setAcceptedToken(address token, bool accepted) external onlyOwner {
        acceptedTokens[token] = accepted;
        emit AcceptedTokenUpdated(token, accepted);
    }

    function setPlatformFee(uint256 _fee) external onlyOwner {
        require(_fee <= 1000, "Fee too high");
        platformFee = _fee;
    }

    function setPlatformWallet(address _wallet) external onlyOwner {
        platformWallet = _wallet;
    }

    function _processPayment(uint256 subscriptionId) internal {
        Subscription storage sub = subscriptions[subscriptionId];
        uint256 fee = 0;
        if (platformFee > 0 && platformWallet != address(0)) {
            fee = (sub.amount * platformFee) / 10000;
        }
        uint256 merchantAmount = sub.amount - fee;
        IERC20(sub.token).safeTransferFrom(sub.subscriber, sub.merchant, merchantAmount);
        if (fee > 0) {
            IERC20(sub.token).safeTransferFrom(sub.subscriber, platformWallet, fee);
        }
        sub.totalCharged += sub.amount;
        emit PaymentReceived(subscriptionId, sub.subscriber, sub.merchant, sub.token, sub.amount, fee, block.timestamp);
    }

    function _tryProcessPayment(uint256 subscriptionId) internal returns (bool) {
        Subscription storage sub = subscriptions[subscriptionId];
        uint256 fee = 0;
        if (platformFee > 0 && platformWallet != address(0)) {
            fee = (sub.amount * platformFee) / 10000;
        }
        uint256 merchantAmount = sub.amount - fee;
        IERC20 token = IERC20(sub.token);
        if (token.allowance(sub.subscriber, address(this)) < sub.amount) return false;
        if (token.balanceOf(sub.subscriber) < sub.amount) return false;
        token.safeTransferFrom(sub.subscriber, sub.merchant, merchantAmount);
        if (fee > 0) {
            token.safeTransferFrom(sub.subscriber, platformWallet, fee);
        }
        sub.totalCharged += sub.amount;
        emit PaymentReceived(subscriptionId, sub.subscriber, sub.merchant, sub.token, sub.amount, fee, block.timestamp);
        return true;
    }
}
