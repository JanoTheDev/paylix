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
import "./interfaces/IPermit2.sol";

/// @title SubscriptionManager
/// @notice Non-custodial recurring USDC billing with keeper-driven charges.
///         Supports direct and gasless (relayer + permit) subscription creation,
///         automatic past-due handling, and subscriber wallet migration.
/// @dev Like PaymentVault, this contract never holds token balances — all
///      transfers are direct buyer-to-merchant via safeTransferFrom.
contract SubscriptionManager is Ownable2Step, ReentrancyGuard, Pausable, EIP712 {
    using SafeERC20 for IERC20;

    // ---- EIP-712 SubscriptionIntent ----
    // Binds the subscriber's signature to the exact merchant/token/amount/interval/
    // etc. so a compromised relayer cannot redirect a signed permit to a different
    // subscription merchant. nonce is per-buyer and strictly increments.
    bytes32 private constant SUBSCRIPTION_INTENT_TYPEHASH = keccak256(
        "SubscriptionIntent(address buyer,address token,address merchant,uint256 amount,uint256 interval,bytes32 productId,bytes32 customerId,uint256 permitValue,uint256 nonce,uint256 deadline)"
    );

    // Extended intent used by createSubscriptionWithPermitDiscount. Adds the
    // discount amount and cycle count so "once" / "repeating" coupon shapes
    // can be encoded on-chain at subscription creation without a dual-permit
    // checkout flow. A buyer signing this intent commits to being charged
    // `amount - discountAmount` for the first `discountCyclesRemaining`
    // charges, then `amount` every cycle after.
    bytes32 private constant SUBSCRIPTION_INTENT_DISCOUNT_TYPEHASH = keccak256(
        "SubscriptionIntentDiscount(address buyer,address token,address merchant,uint256 amount,uint256 interval,bytes32 productId,bytes32 customerId,uint256 permitValue,uint256 discountAmount,uint256 discountCycles,uint256 nonce,uint256 deadline)"
    );

    // BackupPayerAuth is signed by the primary subscriber to authorize a
    // specific address as a fallback payer for their subscription. The
    // backup wallet separately signs an EIP-2612 permit granting the
    // contract USDC allowance so the keeper can draw from it.
    bytes32 private constant BACKUP_PAYER_AUTH_TYPEHASH = keccak256(
        "BackupPayerAuth(uint256 subscriptionId,address backup,uint256 nonce,uint256 deadline)"
    );

    /// @notice Per-subscription discount state set at creation and
    ///         decremented on each charge. Declared as a side struct so the
    ///         existing `Subscription` layout is untouched.
    struct SubscriptionDiscount {
        uint256 discountAmount;
        uint256 discountCyclesRemaining;
    }

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

    /// @dev New in the discount release. Appended at the end so existing
    /// storage slots are untouched — a redeploy gets the same layout for
    /// everything that was there before.
    mapping(uint256 => SubscriptionDiscount) public subscriptionDiscounts;

    /// @dev Per-subscription ordered list of fallback payer addresses. When
    /// the primary subscriber runs out of USDC balance/allowance,
    /// _tryProcessPayment walks this list and pulls from the first
    /// wallet that can cover the charge.
    mapping(uint256 => address[]) public subscriptionBackups;
    uint256 public constant MAX_BACKUP_PAYERS = 5;

    // Permit2 canonical deployment. Same address on every EVM chain Paylix
    // supports. Used for the AllowanceTransfer recurring-charge path.
    IPermit2 public constant PERMIT2 = IPermit2(0x000000000022D473030F116dDEE9F6B43aC78BA3);

    /// @dev Subscriptions created via createSubscriptionWithPermit2. The
    /// buyer pre-granted Permit2 allowance; chargeSubscription dispatches
    /// to `_chargePermit2` for these instead of the ERC20-allowance path.
    mapping(uint256 => bool) public isPermit2Subscription;

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
    event SubscriptionBackupPayerAdded(uint256 indexed subscriptionId, address indexed backup);
    event SubscriptionBackupPayerRemoved(uint256 indexed subscriptionId, address indexed backup);

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

    /// @notice Create a subscription and process the first charge immediately.
    /// @param token    ERC-20 token address (must be in acceptedTokens)
    /// @param merchant Recipient of recurring payments minus platform fee
    /// @param amount   Charge amount per interval in token units
    /// @param interval Seconds between charges
    /// @param productId  Off-chain product identifier
    /// @param customerId Off-chain customer identifier
    /// @return Subscription ID
    function createSubscription(address token, address merchant, uint256 amount, uint256 interval, bytes32 productId, bytes32 customerId) external nonReentrant whenNotPaused returns (uint256) {
        require(acceptedTokens[token], "Token not accepted");
        require(amount > 0, "Amount must be > 0");
        require(merchant != address(0), "Invalid merchant");
        require(interval > 0, "Invalid interval");
        require(block.timestamp <= type(uint256).max - interval, "Interval too large");

        uint256 subId = nextSubscriptionId++;
        subscriptions[subId] = Subscription({
            subscriber: msg.sender, merchant: merchant, token: token,
            amount: amount, interval: interval, nextChargeDate: block.timestamp + interval,
            productId: productId, customerId: customerId, createdAt: block.timestamp,
            status: Status.Active, totalCharged: 0
        });

        _processPayment(subId);
        _emitSubscriptionCreated(subId, subscriptions[subId]);
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

    /// @notice Gasless subscription creation: relayer submits buyer's permit +
    ///         EIP-712 SubscriptionIntent signature. The permit value is typically
    ///         amount * N to cover many billing cycles without re-signing.
    /// @param p Struct with token, buyer, merchant, amount, interval, permit components
    /// @param intentSignature EIP-712 SubscriptionIntent signature from the buyer
    /// @return Subscription ID
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
        require(block.timestamp <= type(uint256).max - p.interval, "Interval too large");
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

    struct CreateSubPermitDiscountParams {
        address token;
        address buyer;
        address merchant;
        uint256 amount;
        uint256 interval;
        bytes32 productId;
        bytes32 customerId;
        uint256 permitValue;
        uint256 discountAmount;
        uint256 discountCycles;
        uint256 deadline;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    function _hashDiscountIntent(
        CreateSubPermitDiscountParams calldata p,
        uint256 nonce
    ) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                SUBSCRIPTION_INTENT_DISCOUNT_TYPEHASH,
                p.buyer,
                p.token,
                p.merchant,
                p.amount,
                p.interval,
                p.productId,
                p.customerId,
                p.permitValue,
                p.discountAmount,
                p.discountCycles,
                nonce,
                p.deadline
            )
        );
    }

    function _consumeSubscriptionIntentDiscount(
        CreateSubPermitDiscountParams calldata p,
        bytes calldata intentSignature
    ) internal {
        uint256 nonce = intentNonces[p.buyer];
        bytes32 digest = _hashTypedDataV4(_hashDiscountIntent(p, nonce));
        address recovered = ECDSA.recover(digest, intentSignature);
        require(recovered == p.buyer, "Invalid intent signature");
        unchecked { intentNonces[p.buyer] = nonce + 1; }
    }

    /// @notice Like createSubscriptionWithPermit but stores a per-subscription
    ///         discount that applies to the first `discountCycles` charges
    ///         (the first of which is the creation charge). The buyer's
    ///         SubscriptionIntentDiscount signature commits to all fields
    ///         including discountAmount and discountCycles, so a compromised
    ///         relayer cannot swap them.
    function _validateDiscountParams(CreateSubPermitDiscountParams calldata p) internal view {
        require(msg.sender == relayer, "Only relayer");
        require(!gaslessPaused, "Gasless paused");
        require(acceptedTokens[p.token], "Token not accepted");
        require(p.amount > 0, "Amount must be > 0");
        require(p.merchant != address(0), "Invalid merchant");
        require(p.buyer != address(0), "Invalid buyer");
        require(p.interval > 0, "Invalid interval");
        require(block.timestamp <= type(uint256).max - p.interval, "Interval too large");
        require(p.permitValue >= p.amount, "Permit < amount");
        require(block.timestamp <= p.deadline, "Intent expired");
        require(p.discountAmount < p.amount, "Discount >= amount");
        require(p.discountCycles > 0, "Zero discount cycles");
    }

    function _storeDiscountSubscription(
        CreateSubPermitDiscountParams calldata p
    ) internal returns (uint256 subId) {
        subId = nextSubscriptionId++;
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
        subscriptionDiscounts[subId] = SubscriptionDiscount({
            discountAmount: p.discountAmount,
            discountCyclesRemaining: p.discountCycles
        });
    }

    function createSubscriptionWithPermitDiscount(
        CreateSubPermitDiscountParams calldata p,
        bytes calldata intentSignature
    ) external nonReentrant whenNotPaused returns (uint256) {
        _validateDiscountParams(p);
        _consumeSubscriptionIntentDiscount(p, intentSignature);

        try IERC20Permit(p.token).permit(
            p.buyer, address(this), p.permitValue, p.deadline, p.v, p.r, p.s
        ) {
            // ok
        } catch {
            // Same permissive fallback as createSubscriptionWithPermit.
        }

        uint256 subId = _storeDiscountSubscription(p);
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

    /// @dev Packed params for createSubscriptionWithPermit2 — same stack-depth
    /// concern as PaymentVault.Permit2Payment.
    struct CreateSubPermit2Params {
        address token;
        address buyer;
        address merchant;
        uint256 amount;
        uint256 interval;
        bytes32 productId;
        bytes32 customerId;
        /// Expected to match permit2Permit.sigDeadline so one deadline value
        /// gates the intent as well as the Permit2 signature.
        uint256 deadline;
    }

    /// @notice Create a subscription backed by a Permit2 AllowanceTransfer
    ///         grant. The buyer signs the allowance once; the keeper charges
    ///         via Permit2.transferFrom each cycle.
    /// @param p                 Packed subscription params
    /// @param permit2Permit     Permit2 PermitSingle (spender must be this contract)
    /// @param permit2Signature  Buyer's Permit2 signature
    /// @param intentSignature   EIP-712 SubscriptionIntent signature
    function createSubscriptionWithPermit2(
        CreateSubPermit2Params calldata p,
        IPermit2.PermitSingle calldata permit2Permit,
        bytes calldata permit2Signature,
        bytes calldata intentSignature
    ) external nonReentrant whenNotPaused returns (uint256) {
        require(msg.sender == relayer, "Only relayer");
        require(!gaslessPaused, "Gasless paused");
        require(acceptedTokens[p.token], "Token not accepted");
        require(p.amount > 0, "Amount must be > 0");
        require(p.merchant != address(0), "Invalid merchant");
        require(p.interval > 0, "Invalid interval");
        require(block.timestamp <= p.deadline, "Intent expired");
        require(permit2Permit.spender == address(this), "Permit2 spender mismatch");
        require(permit2Permit.details.token == p.token, "Permit2 token mismatch");

        _consumeSubscriptionIntent(
            SubIntentParams({
                buyer: p.buyer,
                token: p.token,
                merchant: p.merchant,
                amount: p.amount,
                interval: p.interval,
                productId: p.productId,
                customerId: p.customerId,
                // permitValue is part of the legacy (EIP-2612) SubscriptionIntent
                // typehash; for Permit2 subs we reuse the allowance amount so the
                // intent signature still binds the buyer to a concrete number.
                permitValue: permit2Permit.details.amount,
                deadline: p.deadline
            }),
            intentSignature
        );

        // Grant Permit2 allowance from buyer to this contract. Permit2 verifies
        // the signature over its own EIP-712 domain and reverts on failure.
        PERMIT2.permit(p.buyer, permit2Permit, permit2Signature);

        uint256 subId = _storePermit2Subscription(p);
        _chargePermit2(subId, p.amount);
        _emitSubscriptionCreated(subId, subscriptions[subId]);
        return subId;
    }

    function _storePermit2Subscription(CreateSubPermit2Params calldata p) internal returns (uint256) {
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
        isPermit2Subscription[subId] = true;
        return subId;
    }

    /// @dev Charges via Permit2.transferFrom against the allowance granted at
    /// creation time. Splits fee identically to the ERC20-allowance path.
    function _chargePermit2(uint256 subscriptionId, uint256 amount) internal {
        Subscription storage sub = subscriptions[subscriptionId];
        uint256 fee = 0;
        if (platformFee > 0 && platformWallet != address(0)) {
            fee = (amount * platformFee) / 10000;
        }
        uint256 merchantAmount = amount - fee;
        require(merchantAmount > 0, "Amount too small for fee");

        PERMIT2.transferFrom(sub.subscriber, sub.merchant, uint160(merchantAmount), sub.token);
        if (fee > 0) {
            require(platformWallet != address(0), "Invalid platform wallet");
            PERMIT2.transferFrom(sub.subscriber, platformWallet, uint160(fee), sub.token);
        }
        sub.totalCharged += amount;
        emit PaymentReceived(subscriptionId, sub.subscriber, sub.merchant, sub.token, amount, fee, block.timestamp);
    }

    /// @notice Charge a subscription that is due. Callable by subscriber, merchant,
    ///         or relayer. Moves subscription to PastDue on payment failure instead
    ///         of reverting, so the keeper stays healthy.
    /// @param subscriptionId The subscription to charge
    function chargeSubscription(uint256 subscriptionId) external nonReentrant whenNotPaused {
        Subscription storage sub = subscriptions[subscriptionId];
        require(
            msg.sender == sub.subscriber ||
            msg.sender == sub.merchant ||
            msg.sender == relayer,
            "Not authorized to charge"
        );
        require(sub.status == Status.Active, "Not active");
        require(block.timestamp >= sub.nextChargeDate, "Not due yet");

        if (isPermit2Subscription[subscriptionId]) {
            // Permit2 path: pull directly via Permit2.transferFrom. Let the
            // revert propagate — the keeper is expected to handle allowance
            // exhaustion off-chain by looping status into PastDue via a
            // follow-up call. Simpler than the try/catch dance the ERC20
            // path needs because there's no backup-payer concept here yet.
            uint256 amount = _resolveChargeAmount(subscriptionId);
            require(amount > 0, "Charge amount is zero");
            _chargePermit2(subscriptionId, amount);
            require(sub.nextChargeDate <= type(uint256).max - sub.interval, "Interval overflow");
            sub.nextChargeDate = sub.nextChargeDate + sub.interval;
            return;
        }

        bool success = _tryProcessPayment(subscriptionId);
        if (success) {
            require(sub.nextChargeDate <= type(uint256).max - sub.interval, "Interval overflow");
            sub.nextChargeDate = sub.nextChargeDate + sub.interval;
        } else {
            sub.status = Status.PastDue;
            emit SubscriptionPastDue(subscriptionId, sub.subscriber, sub.merchant);
        }
    }

    /// @notice Cancel a subscription. Callable by subscriber or merchant.
    function cancelSubscription(uint256 subscriptionId) external {
        Subscription storage sub = subscriptions[subscriptionId];
        require(msg.sender == sub.subscriber || msg.sender == sub.merchant, "Not authorized");
        require(sub.status == Status.Active || sub.status == Status.PastDue, "Already inactive");
        sub.status = Status.Cancelled;
        delete pendingWalletUpdates[subscriptionId];
        emit SubscriptionCancelled(subscriptionId);
    }

    /// @notice Gasless cancellation on behalf of a subscriber. Relayer-only.
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
        delete pendingWalletUpdates[subscriptionId];
        emit SubscriptionCancelled(subscriptionId);
    }

    /// @notice Gasless cancellation on behalf of a merchant. Relayer-only.
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
        delete pendingWalletUpdates[subscriptionId];
        emit SubscriptionCancelled(subscriptionId);
    }

    /// @notice Request migrating a subscription to a new wallet. The new wallet
    ///         must call acceptSubscriptionWalletUpdate to complete the transfer.
    function requestSubscriptionWalletUpdate(uint256 subscriptionId, address newSubscriber) external {
        Subscription storage sub = subscriptions[subscriptionId];
        require(msg.sender == sub.subscriber, "Not subscriber");
        require(newSubscriber != address(0), "Invalid address");
        require(sub.status == Status.Active, "Not active");

        pendingWalletUpdates[subscriptionId] = newSubscriber;
        emit SubscriptionWalletUpdateRequested(subscriptionId, sub.subscriber, newSubscriber);
    }

    /// @notice Accept a pending wallet migration. Caller becomes the new subscriber.
    function acceptSubscriptionWalletUpdate(uint256 subscriptionId) external {
        require(pendingWalletUpdates[subscriptionId] == msg.sender, "Not pending for caller");

        Subscription storage sub = subscriptions[subscriptionId];
        if (sub.status != Status.Active) {
            delete pendingWalletUpdates[subscriptionId];
            revert("Subscription no longer active");
        }

        address oldSubscriber = sub.subscriber;
        sub.subscriber = msg.sender;
        delete pendingWalletUpdates[subscriptionId];

        emit SubscriptionWalletUpdated(subscriptionId, oldSubscriber, msg.sender);
    }

    /// @notice Add or remove a token from the accepted list.
    function setAcceptedToken(address token, bool accepted) external onlyOwner {
        acceptedTokens[token] = accepted;
        emit AcceptedTokenUpdated(token, accepted);
    }

    /// @notice Update the platform fee. Max 1000 bps (10%).
    function setPlatformFee(uint256 _fee) external onlyOwner {
        require(_fee <= 1000, "Fee too high");
        platformFee = _fee;
        emit PlatformFeeUpdated(_fee);
    }

    /// @notice Update the wallet that receives platform fees.
    function setPlatformWallet(address _wallet) external onlyOwner {
        require(_wallet != address(0), "Invalid wallet");
        platformWallet = _wallet;
        emit PlatformWalletUpdated(_wallet);
    }

    /// @notice Set the authorized relayer address for gasless operations.
    function setRelayer(address _relayer) external onlyOwner {
        require(_relayer != address(0), "Invalid relayer address");
        address old = relayer;
        relayer = _relayer;
        emit RelayerUpdated(old, _relayer);
    }

    /// @notice Toggle gasless paths without pausing the entire contract.
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

    /// @dev Resolves the effective charge amount for this cycle. If the sub
    ///      has remaining discount cycles, applies `discountAmount` and
    ///      decrements. Returns the charge amount the caller should pull.
    function _resolveChargeAmount(uint256 subscriptionId) internal returns (uint256) {
        Subscription storage sub = subscriptions[subscriptionId];
        SubscriptionDiscount storage d = subscriptionDiscounts[subscriptionId];
        if (d.discountCyclesRemaining == 0 || d.discountAmount == 0) {
            return sub.amount;
        }
        d.discountCyclesRemaining--;
        if (d.discountAmount >= sub.amount) return 0;
        return sub.amount - d.discountAmount;
    }

    function _processPayment(uint256 subscriptionId) internal {
        Subscription storage sub = subscriptions[subscriptionId];
        uint256 amount = _resolveChargeAmount(subscriptionId);
        require(amount > 0, "Charge amount is zero");
        address token = sub.token;
        address subscriber = sub.subscriber;
        address merchant_ = sub.merchant;

        uint256 fee = 0;
        if (platformFee > 0 && platformWallet != address(0)) {
            fee = (amount * platformFee) / 10000;
        }
        uint256 merchantAmount = amount - fee;
        require(merchantAmount > 0, "Amount too small for fee");
        // slither-disable-next-line arbitrary-send-erc20
        IERC20(token).safeTransferFrom(subscriber, merchant_, merchantAmount);
        if (fee > 0) {
            require(platformWallet != address(0), "Invalid platform wallet");
            // slither-disable-next-line arbitrary-send-erc20
            IERC20(token).safeTransferFrom(subscriber, platformWallet, fee);
        }
        sub.totalCharged += amount;
        emit PaymentReceived(subscriptionId, subscriber, merchant_, token, amount, fee, block.timestamp);
    }

    function _tryProcessPayment(uint256 subscriptionId) internal returns (bool) {
        Subscription storage sub = subscriptions[subscriptionId];
        SubscriptionDiscount storage d = subscriptionDiscounts[subscriptionId];

        // Preview the charge WITHOUT decrementing — if balance/allowance is
        // insufficient we must leave the discount state intact so the retry
        // gets the same discounted amount.
        uint256 amount = sub.amount;
        if (d.discountCyclesRemaining > 0 && d.discountAmount > 0) {
            amount = d.discountAmount >= sub.amount ? 0 : sub.amount - d.discountAmount;
        }
        address tokenAddr = sub.token;
        address merchant_ = sub.merchant;

        uint256 fee = 0;
        if (platformFee > 0 && platformWallet != address(0)) {
            fee = (amount * platformFee) / 10000;
        }
        uint256 merchantAmount = amount - fee;
        if (merchantAmount == 0) return false;
        IERC20 token = IERC20(tokenAddr);

        // Pick the first wallet (primary, then each backup in order) that
        // can cover the full charge. Backups were pre-authorized by the
        // primary subscriber via BackupPayerAuth; they signed their own
        // EIP-2612 permit at the time they were added.
        address payer = sub.subscriber;
        if (
            token.allowance(payer, address(this)) < amount ||
            token.balanceOf(payer) < amount
        ) {
            address[] storage backups = subscriptionBackups[subscriptionId];
            payer = address(0);
            uint256 n = backups.length;
            for (uint256 i = 0; i < n; i++) {
                address b = backups[i];
                if (
                    token.allowance(b, address(this)) >= amount &&
                    token.balanceOf(b) >= amount
                ) {
                    payer = b;
                    break;
                }
            }
            if (payer == address(0)) return false;
        }

        // Committed to pulling — decrement discount state now.
        if (d.discountCyclesRemaining > 0 && d.discountAmount > 0) {
            d.discountCyclesRemaining--;
        }

        // slither-disable-next-line arbitrary-send-erc20
        token.safeTransferFrom(payer, merchant_, merchantAmount);
        if (fee > 0) {
            require(platformWallet != address(0), "Invalid platform wallet");
            // slither-disable-next-line arbitrary-send-erc20
            token.safeTransferFrom(payer, platformWallet, fee);
        }
        sub.totalCharged += amount;
        emit PaymentReceived(subscriptionId, payer, merchant_, tokenAddr, amount, fee, block.timestamp);
        return true;
    }

    // -------------------------------------------------------------------
    // Backup payers (wallet-walk). The primary subscriber authorizes a
    // backup via an EIP-712 BackupPayerAuth signature; the backup wallet
    // signs its own EIP-2612 permit so the contract can pull USDC from
    // it. When the primary runs out of funds, chargeSubscription walks
    // this list and pulls from the first backup that can cover.
    // -------------------------------------------------------------------

    /// @notice View list of backup payer addresses for a subscription.
    function getSubscriptionBackups(uint256 subscriptionId)
        external
        view
        returns (address[] memory)
    {
        return subscriptionBackups[subscriptionId];
    }

    struct BackupPayerParams {
        uint256 subscriptionId;
        address backup;
        uint256 authDeadline;
        uint256 permitValue;
        uint256 permitDeadline;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    function _verifyBackupAuth(
        uint256 subscriptionId,
        address backup,
        address subscriber,
        uint256 authDeadline,
        bytes calldata subscriberAuthSig
    ) internal {
        uint256 nonce = intentNonces[subscriber];
        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    BACKUP_PAYER_AUTH_TYPEHASH,
                    subscriptionId,
                    backup,
                    nonce,
                    authDeadline
                )
            )
        );
        require(
            ECDSA.recover(digest, subscriberAuthSig) == subscriber,
            "Bad subscriber auth"
        );
        intentNonces[subscriber] = nonce + 1;
    }

    /// @notice Add a backup payer. Relayer-submitted, gasless for both
    ///         the primary subscriber and the backup wallet. The primary
    ///         signs a BackupPayerAuth EIP-712 message; the backup signs
    ///         an EIP-2612 permit granting the contract standing
    ///         allowance on their USDC.
    function addSubscriptionBackupPayer(
        BackupPayerParams calldata p,
        bytes calldata subscriberAuthSig
    ) external nonReentrant whenNotPaused {
        require(msg.sender == relayer, "Only relayer");
        require(!gaslessPaused, "Gasless paused");
        require(block.timestamp <= p.authDeadline, "Auth expired");

        Subscription storage sub = subscriptions[p.subscriptionId];
        require(
            sub.status == Status.Active || sub.status == Status.PastDue,
            "Not active"
        );
        require(
            p.backup != address(0) && p.backup != sub.subscriber,
            "Invalid backup"
        );

        address[] storage backups = subscriptionBackups[p.subscriptionId];
        require(backups.length < MAX_BACKUP_PAYERS, "Too many backups");
        for (uint256 i = 0; i < backups.length; i++) {
            require(backups[i] != p.backup, "Already added");
        }

        _verifyBackupAuth(
            p.subscriptionId,
            p.backup,
            sub.subscriber,
            p.authDeadline,
            subscriberAuthSig
        );

        // Submit backup's permit. Caught permit failure is non-fatal —
        // the backup may already have a standing allowance that covers
        // charges without needing a permit this call.
        try
            IERC20Permit(sub.token).permit(
                p.backup,
                address(this),
                p.permitValue,
                p.permitDeadline,
                p.v,
                p.r,
                p.s
            )
        {} catch {}

        backups.push(p.backup);
        emit SubscriptionBackupPayerAdded(p.subscriptionId, p.backup);
    }

    /// @notice Remove a backup payer. Callable by the primary subscriber only.
    ///         Not relayer-gated — the subscriber already holds gas on a
    ///         wallet they control (the primary).
    function removeSubscriptionBackupPayer(uint256 subscriptionId, address backup)
        external
    {
        Subscription storage sub = subscriptions[subscriptionId];
        require(msg.sender == sub.subscriber, "Not subscriber");

        address[] storage backups = subscriptionBackups[subscriptionId];
        uint256 n = backups.length;
        for (uint256 i = 0; i < n; i++) {
            if (backups[i] == backup) {
                if (i != n - 1) backups[i] = backups[n - 1];
                backups.pop();
                emit SubscriptionBackupPayerRemoved(subscriptionId, backup);
                return;
            }
        }
        revert("Backup not found");
    }
}
