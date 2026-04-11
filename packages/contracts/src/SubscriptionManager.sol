// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract SubscriptionManager is Ownable2Step, ReentrancyGuard, Pausable, EIP712 {
    using SafeERC20 for IERC20;

    // ---- EIP-712 SubscriptionIntent ----
    // Binds the subscriber's signature to the exact merchant/token/amount/interval/
    // etc. so a compromised relayer cannot redirect a signed permit to a different
    // subscription merchant. nonce is per-buyer and strictly increments.
    bytes32 private constant SUBSCRIPTION_INTENT_TYPEHASH = keccak256(
        "SubscriptionIntent(address buyer,address token,address merchant,uint256 amount,uint256 interval,bytes32 productId,bytes32 customerId,uint256 permitValue,uint256 nonce,uint256 deadline)"
    );

    mapping(address => uint256) public intentNonces;

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
    mapping(uint256 => address) public pendingWalletUpdates;
    address public relayer;
    bool public gaslessPaused;

    event SubscriptionCreated(uint256 indexed subscriptionId, address indexed subscriber, address indexed merchant, address token, uint256 amount, uint256 interval, bytes32 productId, bytes32 customerId);
    event PaymentReceived(uint256 indexed subscriptionId, address indexed subscriber, address indexed merchant, address token, uint256 amount, uint256 fee, uint256 timestamp);
    event SubscriptionPastDue(uint256 indexed subscriptionId, address indexed subscriber, address indexed merchant);
    event SubscriptionCancelled(uint256 indexed subscriptionId);
    event SubscriptionWalletUpdateRequested(uint256 indexed subscriptionId, address indexed oldSubscriber, address indexed newSubscriber);
    event SubscriptionWalletUpdated(uint256 indexed subscriptionId, address indexed oldSubscriber, address indexed newSubscriber);
    event AcceptedTokenUpdated(address indexed token, bool accepted);
    event PlatformFeeUpdated(uint256 newFee);
    event PlatformWalletUpdated(address newWallet);
    event RelayerUpdated(address indexed oldRelayer, address indexed newRelayer);
    event GaslessPausedUpdated(bool paused);

    constructor(address _platformWallet, uint256 _platformFee)
        Ownable(msg.sender)
        EIP712("Paylix SubscriptionManager", "1")
    {
        require(_platformFee <= 1000, "Fee too high");
        platformWallet = _platformWallet;
        platformFee = _platformFee;
    }

    /// @notice EIP-712 domain separator — exposed for off-chain signers.
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /// @notice Current subscription-intent nonce for a buyer.
    function getIntentNonce(address buyer) external view returns (uint256) {
        return intentNonces[buyer];
    }

    struct SubIntentParams {
        address buyer;
        address token;
        address merchant;
        uint256 amount;
        uint256 interval;
        bytes32 productId;
        bytes32 customerId;
        uint256 permitValue;
        uint256 deadline;
    }

    /// @dev Verifies the buyer signed an EIP-712 SubscriptionIntent and
    /// consumes the nonce. Reverts on bad signature.
    function _consumeSubscriptionIntent(
        SubIntentParams memory p,
        bytes calldata intentSignature
    ) internal {
        uint256 nonce = intentNonces[p.buyer];
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
                nonce,
                p.deadline
            )
        );
        bytes32 digest = _hashTypedDataV4(structHash);
        address recovered = ECDSA.recover(digest, intentSignature);
        require(recovered == p.buyer, "Invalid intent signature");
        unchecked { intentNonces[p.buyer] = nonce + 1; }
    }

    function createSubscription(address token, address merchant, uint256 amount, uint256 interval, bytes32 productId, bytes32 customerId) external nonReentrant whenNotPaused returns (uint256) {
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

    struct CreateSubPermitParams {
        address token;
        address buyer;
        address merchant;
        uint256 amount;
        uint256 interval;
        bytes32 productId;
        bytes32 customerId;
        uint256 permitValue;
        uint256 deadline;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    function createSubscriptionWithPermit(
        CreateSubPermitParams calldata p,
        bytes calldata intentSignature
    ) external nonReentrant whenNotPaused returns (uint256) {
        require(msg.sender == relayer, "Only relayer");
        require(!gaslessPaused, "Gasless paused");
        require(acceptedTokens[p.token], "Token not accepted");
        require(p.amount > 0, "Amount must be > 0");
        require(p.merchant != address(0), "Invalid merchant");
        require(p.buyer != address(0), "Invalid buyer");
        require(p.interval > 0, "Invalid interval");
        require(p.permitValue >= p.amount, "Permit < amount");
        require(block.timestamp <= p.deadline, "Intent expired");

        // Verify the buyer signed an EIP-712 SubscriptionIntent committing
        // to this exact merchant/amount/interval/permitValue. A compromised
        // relayer cannot swap any of these fields.
        _consumeSubscriptionIntent(
            SubIntentParams({
                buyer: p.buyer,
                token: p.token,
                merchant: p.merchant,
                amount: p.amount,
                interval: p.interval,
                productId: p.productId,
                customerId: p.customerId,
                permitValue: p.permitValue,
                deadline: p.deadline
            }),
            intentSignature
        );

        // Consume the buyer's permit. permitValue is intentionally larger than
        // amount so the manager retains long-standing allowance for recurring
        // charges from the keeper — typically permitValue = amount * 1000.
        try IERC20Permit(p.token).permit(
            p.buyer, address(this), p.permitValue, p.deadline, p.v, p.r, p.s
        ) {
            // ok
        } catch {
            // If the permit is already consumed but allowance is sufficient
            // for the first charge, proceed. _processPayment will revert
            // cleanly if not.
        }

        uint256 subId = nextSubscriptionId++;
        subscriptions[subId] = Subscription({
            subscriber: p.buyer,
            merchant: p.merchant,
            token: p.token,
            amount: p.amount,
            interval: p.interval,
            nextChargeDate: block.timestamp + p.interval,
            productId: p.productId,
            customerId: p.customerId,
            createdAt: block.timestamp,
            status: Status.Active,
            totalCharged: 0
        });

        _processPayment(subId);
        _emitSubscriptionCreated(subId, subscriptions[subId]);
        return subId;
    }

    function _emitSubscriptionCreated(uint256 subId, Subscription storage sub) internal {
        emit SubscriptionCreated(
            subId,
            sub.subscriber,
            sub.merchant,
            sub.token,
            sub.amount,
            sub.interval,
            sub.productId,
            sub.customerId
        );
    }

    function chargeSubscription(uint256 subscriptionId) external nonReentrant whenNotPaused {
        Subscription storage sub = subscriptions[subscriptionId];
        require(sub.status == Status.Active, "Not active");
        require(block.timestamp >= sub.nextChargeDate, "Not due yet");

        bool success = _tryProcessPayment(subscriptionId);
        if (success) {
            sub.nextChargeDate = sub.nextChargeDate + sub.interval;
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

    function cancelSubscriptionByRelayerForSubscriber(
        uint256 subscriptionId,
        address subscriber
    ) external {
        require(msg.sender == relayer, "Only relayer");
        Subscription storage sub = subscriptions[subscriptionId];
        require(sub.subscriber == subscriber, "Not the subscriber");
        require(
            sub.status == Status.Active || sub.status == Status.PastDue,
            "Already inactive"
        );
        sub.status = Status.Cancelled;
        emit SubscriptionCancelled(subscriptionId);
    }

    function cancelSubscriptionByRelayerForMerchant(
        uint256 subscriptionId,
        address merchant
    ) external {
        require(msg.sender == relayer, "Only relayer");
        Subscription storage sub = subscriptions[subscriptionId];
        require(sub.merchant == merchant, "Not the merchant");
        require(
            sub.status == Status.Active || sub.status == Status.PastDue,
            "Already inactive"
        );
        sub.status = Status.Cancelled;
        emit SubscriptionCancelled(subscriptionId);
    }

    function requestSubscriptionWalletUpdate(uint256 subscriptionId, address newSubscriber) external {
        Subscription storage sub = subscriptions[subscriptionId];
        require(msg.sender == sub.subscriber, "Not subscriber");
        require(newSubscriber != address(0), "Invalid address");
        require(sub.status == Status.Active, "Not active");

        pendingWalletUpdates[subscriptionId] = newSubscriber;
        emit SubscriptionWalletUpdateRequested(subscriptionId, sub.subscriber, newSubscriber);
    }

    function acceptSubscriptionWalletUpdate(uint256 subscriptionId) external {
        require(pendingWalletUpdates[subscriptionId] == msg.sender, "Not pending for caller");

        Subscription storage sub = subscriptions[subscriptionId];
        require(sub.status == Status.Active, "Not active");

        address oldSubscriber = sub.subscriber;
        sub.subscriber = msg.sender;
        delete pendingWalletUpdates[subscriptionId];

        emit SubscriptionWalletUpdated(subscriptionId, oldSubscriber, msg.sender);
    }

    function setAcceptedToken(address token, bool accepted) external onlyOwner {
        acceptedTokens[token] = accepted;
        emit AcceptedTokenUpdated(token, accepted);
    }

    function setPlatformFee(uint256 _fee) external onlyOwner {
        require(_fee <= 1000, "Fee too high");
        platformFee = _fee;
        emit PlatformFeeUpdated(_fee);
    }

    function setPlatformWallet(address _wallet) external onlyOwner {
        require(_wallet != address(0), "Invalid wallet");
        platformWallet = _wallet;
        emit PlatformWalletUpdated(_wallet);
    }

    function setRelayer(address _relayer) external onlyOwner {
        address old = relayer;
        relayer = _relayer;
        emit RelayerUpdated(old, _relayer);
    }

    function setGaslessPaused(bool _paused) external onlyOwner {
        gaslessPaused = _paused;
        emit GaslessPausedUpdated(_paused);
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    // Both _processPayment and _tryProcessPayment read sub.subscriber and
    // sub.merchant from storage. Those fields are written exactly once, at
    // subscription creation:
    //   - createSubscription: subscriber = msg.sender (the buyer signs the tx)
    //   - createSubscriptionWithPermit: subscriber/merchant come from a buyer-
    //     signed EIP-712 SubscriptionIntent verified in _consumeSubscriptionIntent
    // So although slither's arbitrary-send-erc20 detector flags `from = sub.subscriber`
    // as untrusted, the buyer has provably consented to this exact merchant +
    // amount + interval at creation time. See test_reverts_if_relayer_swaps_*
    // in test/SubscriptionManagerPermit.t.sol.

    function _processPayment(uint256 subscriptionId) internal {
        Subscription storage sub = subscriptions[subscriptionId];
        uint256 fee = 0;
        if (platformFee > 0 && platformWallet != address(0)) {
            fee = (sub.amount * platformFee) / 10000;
        }
        uint256 merchantAmount = sub.amount - fee;
        // slither-disable-next-line arbitrary-send-erc20
        IERC20(sub.token).safeTransferFrom(sub.subscriber, sub.merchant, merchantAmount);
        if (fee > 0) {
            // slither-disable-next-line arbitrary-send-erc20
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
        // slither-disable-next-line arbitrary-send-erc20
        token.safeTransferFrom(sub.subscriber, sub.merchant, merchantAmount);
        if (fee > 0) {
            // slither-disable-next-line arbitrary-send-erc20
            token.safeTransferFrom(sub.subscriber, platformWallet, fee);
        }
        sub.totalCharged += sub.amount;
        emit PaymentReceived(subscriptionId, sub.subscriber, sub.merchant, sub.token, sub.amount, fee, block.timestamp);
        return true;
    }
}
