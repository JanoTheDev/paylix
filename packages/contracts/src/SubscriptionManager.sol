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
    //
    // `maxFeeBps` is the highest platform fee the subscriber agreed to. It is
    // stored per subscription and clamps the fee on every future charge, so an
    // owner fee raise can never reprice a live subscription (SC-03).
    //
    // `flow` binds the intent to the settlement mechanism the buyer's wallet
    // actually presented (SC-23). Without it a relayer holding an intent signed
    // for the Permit2 flow could settle it through the EIP-2612 flow against a
    // residual allowance.
    bytes32 private constant SUBSCRIPTION_INTENT_TYPEHASH = keccak256(
        "SubscriptionIntent(address buyer,address token,address merchant,uint256 amount,uint256 interval,bytes32 productId,bytes32 customerId,uint256 permitValue,uint256 maxFeeBps,uint8 flow,uint256 nonce,uint256 deadline)"
    );

    /// @notice Settlement flow identifiers bound into every signed intent.
    uint8 public constant FLOW_EIP2612 = 1;
    uint8 public constant FLOW_PERMIT2 = 2;

    // Extended intent used by createSubscriptionWithPermitDiscount. Adds the
    // discount amount and cycle count so "once" / "repeating" coupon shapes
    // can be encoded on-chain at subscription creation without a dual-permit
    // checkout flow. A buyer signing this intent commits to being charged
    // `amount - discountAmount` for the first `discountCyclesRemaining`
    // charges, then `amount` every cycle after.
    bytes32 private constant SUBSCRIPTION_INTENT_DISCOUNT_TYPEHASH = keccak256(
        "SubscriptionIntentDiscount(address buyer,address token,address merchant,uint256 amount,uint256 interval,bytes32 productId,bytes32 customerId,uint256 permitValue,uint256 discountAmount,uint256 discountCycles,uint256 maxFeeBps,uint8 flow,uint256 nonce,uint256 deadline)"
    );

    // BackupPayerAuth is signed by the primary subscriber to authorize a
    // specific address as a fallback payer for their subscription.
    bytes32 private constant BACKUP_PAYER_AUTH_TYPEHASH = keccak256(
        "BackupPayerAuth(uint256 subscriptionId,address backup,uint256 nonce,uint256 deadline)"
    );

    // BackupPayerConsent is signed by the *backup wallet itself*. Without it an
    // EIP-2612 permit was the only thing standing between an attacker-authored
    // subscription and any wallet with a standing allowance — and the permit was
    // swallowed by a try/catch, so it stood for nothing (SC-01). An allowance is
    // not consent to fund subscription N; this signature is. It binds the
    // subscription id, the primary subscriber, the token, and a per-charge cap.
    bytes32 private constant BACKUP_PAYER_CONSENT_TYPEHASH = keccak256(
        "BackupPayerConsent(uint256 subscriptionId,address subscriber,address token,uint256 maxAmount,uint256 nonce,uint256 deadline)"
    );

    /// @notice Hard ceiling on the platform fee, in basis points (10%).
    uint256 public constant MAX_PLATFORM_FEE_BPS = 1000;

    /// @notice Per-subscription discount state set at creation and
    ///         decremented on each charge. Declared as a side struct so the
    ///         existing `Subscription` layout is untouched.
    struct SubscriptionDiscount {
        uint256 discountAmount;
        uint256 discountCyclesRemaining;
    }

    mapping(address => uint256) public intentNonces;

    /// @dev `None` MUST stay the zero value. Any unwritten `subscriptions[id]`
    /// slot decodes as `status = None`, so a nonexistent id can never pass an
    /// `== Status.Active` check (SC-05).
    ///
    /// There is deliberately no `Expired` member: nothing in this contract ever
    /// assigned it, and a declared-but-unreachable state misleads off-chain
    /// decoders into modelling an expiry mechanism that does not exist (SC-21).
    enum Status { None, Active, PastDue, Cancelled }

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
    // slither-disable-next-line uninitialized-state
    mapping(uint256 => address[]) public subscriptionBackups;
    uint256 public constant MAX_BACKUP_PAYERS = 5;

    // Permit2 canonical deployment. Same address on every EVM chain Paylix
    // supports. Used for the AllowanceTransfer recurring-charge path.
    IPermit2 public constant PERMIT2 = IPermit2(0x000000000022D473030F116dDEE9F6B43aC78BA3);

    /// @dev Subscriptions created via createSubscriptionWithPermit2. The
    /// buyer pre-granted Permit2 allowance; chargeSubscription dispatches
    /// to `_chargePermit2` for these instead of the ERC20-allowance path.
    mapping(uint256 => bool) public isPermit2Subscription;

    /// @dev Fee ceiling (bps) the subscriber signed at creation. Every charge
    /// clamps `platformFee` to this value.
    mapping(uint256 => uint256) public subscriptionMaxFeeBps;

    /// @dev Per-charge cap the backup wallet consented to, keyed by
    /// (subscriptionId, backup). Zero means "not an authorized backup".
    mapping(uint256 => mapping(address => uint256)) public backupPayerMaxAmount;

    /// @dev Nonce counter for BackupPayerConsent signatures. Kept separate from
    /// `intentNonces` so consenting to be someone's backup does not invalidate
    /// the backup wallet's own outstanding subscription intents.
    mapping(address => uint256) public backupConsentNonces;

    /// @dev Nonce counter for BackupPayerAuth signatures, separate from
    /// `intentNonces` for the same reason (SC-10): authorizing a backup payer
    /// must not silently void the subscriber's pending checkout intent.
    mapping(address => uint256) public backupAuthNonces;

    event SubscriptionCreated(uint256 indexed subscriptionId, address indexed subscriber, address indexed merchant, address token, uint256 amount, uint256 interval, bytes32 productId, bytes32 customerId);
    event SubscriptionTermsSet(uint256 indexed subscriptionId, uint256 discountAmount, uint256 discountCycles, bool isPermit2, uint256 maxFeeBps);
    event SubscriptionDiscountConsumed(uint256 indexed subscriptionId, uint256 remaining);
    event PaymentReceived(uint256 indexed subscriptionId, address indexed subscriber, address indexed merchant, address token, uint256 amount, uint256 fee, uint256 timestamp);
    /// @dev Emitted in addition to PaymentReceived when a backup wallet, not the
    /// subscriber, funded the cycle. PaymentReceived always carries the
    /// subscription's subscriber in its indexed slot so address filters stay
    /// correct (SC-11); this event exposes the actual funding wallet.
    event SubscriptionPaymentFunded(uint256 indexed subscriptionId, address indexed payer, uint256 amount);
    event SubscriptionPastDue(uint256 indexed subscriptionId, address indexed subscriber, address indexed merchant);
    event SubscriptionCancelled(uint256 indexed subscriptionId);
    event SubscriptionWalletUpdateRequested(uint256 indexed subscriptionId, address indexed oldSubscriber, address indexed newSubscriber);
    event SubscriptionWalletUpdated(uint256 indexed subscriptionId, address indexed oldSubscriber, address indexed newSubscriber);
    event AcceptedTokenUpdated(address indexed token, bool accepted);
    event PlatformFeeUpdated(uint256 oldFee, uint256 newFee);
    event PlatformWalletUpdated(address oldWallet, address newWallet);
    event RelayerUpdated(address indexed oldRelayer, address indexed newRelayer);
    event GaslessPausedUpdated(bool paused);
    event SubscriptionBackupPayerAdded(uint256 indexed subscriptionId, address indexed backup, uint256 maxAmount);
    event SubscriptionBackupPayerRemoved(uint256 indexed subscriptionId, address indexed backup);
    event TokenRescued(address indexed token, address indexed to, uint256 amount);

    constructor(address _platformWallet, uint256 _platformFee)
        Ownable(msg.sender)
        EIP712("Paylix SubscriptionManager", "1")
    {
        require(_platformFee <= MAX_PLATFORM_FEE_BPS, "Fee too high");
        require(_platformWallet != address(0), "Invalid wallet");
        platformWallet = _platformWallet;
        platformFee = _platformFee;
        emit PlatformWalletUpdated(address(0), _platformWallet);
        emit PlatformFeeUpdated(0, _platformFee);
    }

    /// @notice EIP-712 domain separator — exposed for off-chain signers.
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /// @notice Current subscription-intent nonce for a buyer.
    function getIntentNonce(address buyer) external view returns (uint256) {
        return intentNonces[buyer];
    }

    /// @notice Current BackupPayerConsent nonce for a wallet.
    function getBackupConsentNonce(address backup) external view returns (uint256) {
        return backupConsentNonces[backup];
    }

    /// @notice Current BackupPayerAuth nonce for a subscriber.
    function getBackupAuthNonce(address subscriber) external view returns (uint256) {
        return backupAuthNonces[subscriber];
    }

    /// @dev Reverts for ids that were never issued. Belt-and-braces alongside
    /// `Status.None` (SC-05).
    function _requireExists(uint256 subscriptionId) internal view {
        require(subscriptionId < nextSubscriptionId, "No such subscription");
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
        uint256 maxFeeBps;
        /// Settlement mechanism this entry point implements. Set by the
        /// contract, never by the relayer.
        uint8 flow;
        uint256 deadline;
    }

    /// @dev Split out of _consumeSubscriptionIntent purely to keep the
    /// 13-field abi.encode off the caller's stack.
    function _hashSubIntent(SubIntentParams memory p, uint256 nonce)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(
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
                p.maxFeeBps,
                p.flow,
                nonce,
                p.deadline
            )
        );
    }

    /// @dev Verifies the buyer signed an EIP-712 SubscriptionIntent and
    /// consumes the nonce. Reverts on bad signature, expired deadline, or a
    /// platform fee above the ceiling the buyer signed.
    function _consumeSubscriptionIntent(
        SubIntentParams memory p,
        bytes calldata intentSignature
    ) internal {
        // Deadline enforcement lives here, not only at the call sites, so a
        // future entry point cannot forget it (SC-19).
        require(block.timestamp <= p.deadline, "Intent expired");
        require(p.maxFeeBps <= MAX_PLATFORM_FEE_BPS, "maxFeeBps too high");
        require(platformFee <= p.maxFeeBps, "Fee above signed max");
        uint256 nonce = intentNonces[p.buyer];
        bytes32 digest = _hashTypedDataV4(_hashSubIntent(p, nonce));
        address recovered = ECDSA.recover(digest, intentSignature);
        require(recovered != address(0), "Invalid signer");
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
        // Direct creation carries no signature, so there is no signed ceiling —
        // the contract-wide cap applies.
        subscriptionMaxFeeBps[subId] = MAX_PLATFORM_FEE_BPS;

        _processPayment(subId);
        _emitSubscriptionCreated(subId, subscriptions[subId]);
        emit SubscriptionTermsSet(subId, 0, 0, false, MAX_PLATFORM_FEE_BPS);
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
        uint256 maxFeeBps;
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
        // to this exact merchant/amount/interval/permitValue/fee ceiling. A
        // compromised relayer cannot swap any of these fields.
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
                maxFeeBps: p.maxFeeBps,
                flow: FLOW_EIP2612,
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
        subscriptionMaxFeeBps[subId] = p.maxFeeBps;

        _processPayment(subId);
        _emitSubscriptionCreated(subId, subscriptions[subId]);
        emit SubscriptionTermsSet(subId, 0, 0, false, p.maxFeeBps);
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
        uint256 maxFeeBps;
        uint256 deadline;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    function _hashDiscountIntent(
        CreateSubPermitDiscountParams calldata p,
        uint256 nonce
    ) internal pure returns (bytes32) {
        // Split across two abi.encode calls to stay under the stack limit.
        // Every field is a value type, so each encodes to exactly one 32-byte
        // word and the concatenation is byte-identical to a single encode.
        return keccak256(
            bytes.concat(
                abi.encode(
                    SUBSCRIPTION_INTENT_DISCOUNT_TYPEHASH,
                    p.buyer,
                    p.token,
                    p.merchant,
                    p.amount,
                    p.interval,
                    p.productId
                ),
                abi.encode(
                    p.customerId,
                    p.permitValue,
                    p.discountAmount,
                    p.discountCycles,
                    p.maxFeeBps,
                    FLOW_EIP2612,
                    nonce,
                    p.deadline
                )
            )
        );
    }

    function _consumeSubscriptionIntentDiscount(
        CreateSubPermitDiscountParams calldata p,
        bytes calldata intentSignature
    ) internal {
        require(block.timestamp <= p.deadline, "Intent expired");
        require(p.maxFeeBps <= MAX_PLATFORM_FEE_BPS, "maxFeeBps too high");
        require(platformFee <= p.maxFeeBps, "Fee above signed max");
        uint256 nonce = intentNonces[p.buyer];
        bytes32 digest = _hashTypedDataV4(_hashDiscountIntent(p, nonce));
        address recovered = ECDSA.recover(digest, intentSignature);
        require(recovered != address(0), "Invalid signer");
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
        subscriptionMaxFeeBps[subId] = p.maxFeeBps;
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
        emit SubscriptionTermsSet(subId, p.discountAmount, p.discountCycles, false, p.maxFeeBps);
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
        uint256 maxFeeBps;
        /// Must equal permit2Permit.sigDeadline so one deadline value gates the
        /// intent as well as the Permit2 signature.
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
        // Permit2 transfer amounts are uint160; refuse anything that would be
        // silently truncated (SC-20).
        require(p.amount <= type(uint160).max, "Amount too large for Permit2");
        require(p.merchant != address(0), "Invalid merchant");
        require(p.buyer != address(0), "Invalid buyer");
        require(p.interval > 0, "Invalid interval");
        require(block.timestamp <= p.deadline, "Intent expired");
        require(permit2Permit.spender == address(this), "Permit2 spender mismatch");
        require(permit2Permit.details.token == p.token, "Permit2 token mismatch");
        // Without these the subscription is created and then dies on cycle 2,
        // deep inside Permit2, with no clear cause (SC-09).
        require(permit2Permit.sigDeadline == p.deadline, "Permit2 deadline mismatch");
        require(permit2Permit.details.amount >= p.amount, "Permit2 allowance < amount");
        require(
            uint256(permit2Permit.details.expiration) >= block.timestamp + p.interval,
            "Permit2 expiration too short"
        );

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
                maxFeeBps: p.maxFeeBps,
                flow: FLOW_PERMIT2,
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
        emit SubscriptionTermsSet(subId, 0, 0, true, p.maxFeeBps);
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
        subscriptionMaxFeeBps[subId] = p.maxFeeBps;
        return subId;
    }

    /// @dev Effective fee in bps for a subscription: the current platform fee,
    /// clamped to the ceiling the subscriber signed at creation (SC-03).
    function _feeBpsFor(uint256 subscriptionId) internal view returns (uint256) {
        uint256 cap = subscriptionMaxFeeBps[subscriptionId];
        uint256 bps = platformFee;
        return bps <= cap ? bps : cap;
    }

    /// @dev Platform fee owed on `amount`. Rounds down, i.e. in the merchant's
    /// favour, so `fee + merchantAmount == amount` exactly.
    function _feeFor(uint256 subscriptionId, uint256 amount) internal view returns (uint256) {
        if (platformWallet == address(0)) return 0;
        uint256 bps = _feeBpsFor(subscriptionId);
        if (bps == 0) return 0;
        return (amount * bps) / 10000;
    }

    /// @dev Charges via Permit2.transferFrom against the allowance granted at
    /// creation time. Splits fee identically to the ERC20-allowance path.
    /// Reverts on failure (used for sub creation where revert is correct).
    function _chargePermit2(uint256 subscriptionId, uint256 amount) internal {
        Subscription storage sub = subscriptions[subscriptionId];
        uint256 fee = _feeFor(subscriptionId, amount);
        uint256 merchantAmount = amount - fee;
        require(merchantAmount > 0, "Amount too small for fee");
        require(amount <= type(uint160).max, "Amount too large for Permit2");

        sub.totalCharged += amount;
        emit PaymentReceived(subscriptionId, sub.subscriber, sub.merchant, sub.token, amount, fee, block.timestamp);

        PERMIT2.transferFrom(sub.subscriber, sub.merchant, uint160(merchantAmount), sub.token);
        if (fee > 0) {
            PERMIT2.transferFrom(sub.subscriber, platformWallet, uint160(fee), sub.token);
        }
    }

    /// @dev Can the Permit2 allowance granted at creation cover `amount` right
    /// now? Read-only, so the keeper path can decide payability *before* it
    /// writes any state — the same shape as the ERC-20 path's `_selectPayer`.
    /// This also removes the old partial-charge hazard: previously the merchant
    /// leg could land and the fee leg fail, leaving state claiming a full
    /// payment with zero fee (SC-07). One allowance check now covers both legs,
    /// so they either both happen or the transaction reverts.
    function _permit2CanPay(uint256 subscriptionId, uint256 amount)
        internal
        view
        returns (bool)
    {
        if (amount == 0 || amount > type(uint160).max) return false;
        Subscription storage sub = subscriptions[subscriptionId];
        (uint160 allowed, uint48 expiration, ) =
            PERMIT2.allowance(sub.subscriber, sub.token, address(this));
        if (uint256(expiration) < block.timestamp) return false;
        if (uint256(allowed) < amount) return false;
        if (IERC20(sub.token).balanceOf(sub.subscriber) < amount) return false;
        return true;
    }

    /// @notice Charge a subscription that is due. Callable by subscriber, merchant,
    ///         or relayer.
    ///
    /// @dev Strict checks-effects-interactions: payability is decided with view
    ///      calls only, then every state write happens, then the transfers.
    ///
    ///      Failure handling is therefore split, and callers must handle both:
    ///
    ///      1. **Pre-checkable failures flip the subscription to PastDue and
    ///         return normally** — insufficient balance, insufficient ERC-20 or
    ///         Permit2 allowance, an expired Permit2 allowance, and a charge
    ///         amount that rounds to nothing. `_selectPayer` / `_permit2CanPay`
    ///         detect all of these before any transfer is attempted, so the
    ///         keeper sees a successful transaction and a `SubscriptionPastDue`
    ///         event.
    ///
    ///      2. **Token-level failures revert the whole transaction.** Once
    ///         payability is established the settlement legs are called without
    ///         a try/catch — that is what makes partial charges impossible, but
    ///         it means anything the views cannot see surfaces as a revert:
    ///         a blacklisted subscriber (USDC on Base implements this), a paused
    ///         or upgraded token, or a token that reverts on transfer for its
    ///         own reasons. The subscription stays `Active` with an unchanged
    ///         `nextChargeDate`, so a naive keeper will retry it forever.
    ///         **The keeper must treat a reverting charge as a dunning signal,
    ///         not a transient error**, and escalate off-chain rather than
    ///         retrying indefinitely. Cancellation still works in this state;
    ///         no funds are at risk.
    ///
    /// @param subscriptionId The subscription to charge
    function chargeSubscription(uint256 subscriptionId) external nonReentrant whenNotPaused {
        _requireExists(subscriptionId);
        Subscription storage sub = subscriptions[subscriptionId];
        require(
            msg.sender == sub.subscriber ||
            msg.sender == sub.merchant ||
            msg.sender == relayer,
            "Not authorized to charge"
        );
        require(sub.status == Status.Active, "Not active");
        require(block.timestamp >= sub.nextChargeDate, "Not due yet");

        // ---- checks ----
        // The discount cycle is previewed, never consumed, until the pull is
        // committed — a failed charge must not burn a discounted cycle (SC-22).
        bool viaPermit2 = isPermit2Subscription[subscriptionId];
        uint256 amount = _previewChargeAmount(subscriptionId);
        uint256 fee = _feeFor(subscriptionId, amount);
        address payer;
        if (amount > 0 && amount - fee > 0) {
            payer = viaPermit2
                ? (_permit2CanPay(subscriptionId, amount) ? sub.subscriber : address(0))
                : _selectPayer(subscriptionId, IERC20(sub.token), amount);
        }

        if (payer == address(0)) {
            sub.status = Status.PastDue;
            emit SubscriptionPastDue(subscriptionId, sub.subscriber, sub.merchant);
            return;
        }

        // ---- effects ----
        _consumeDiscountCycle(subscriptionId);
        sub.totalCharged += amount;
        require(sub.nextChargeDate <= type(uint256).max - sub.interval, "Interval overflow");
        sub.nextChargeDate = sub.nextChargeDate + sub.interval;
        // PaymentReceived always reports the subscription's subscriber in the
        // indexed slot; the funding wallet rides on SubscriptionPaymentFunded.
        emit PaymentReceived(
            subscriptionId, sub.subscriber, sub.merchant, sub.token, amount, fee, block.timestamp
        );
        if (payer != sub.subscriber) {
            emit SubscriptionPaymentFunded(subscriptionId, payer, amount);
        }

        // ---- interactions ----
        if (viaPermit2) {
            _settleViaPermit2(sub, amount - fee, fee);
        } else {
            _settleViaAllowance(sub, payer, amount - fee, fee);
        }
    }

    function _settleViaPermit2(
        Subscription storage sub,
        uint256 merchantAmount,
        uint256 fee
    ) internal {
        PERMIT2.transferFrom(sub.subscriber, sub.merchant, uint160(merchantAmount), sub.token);
        if (fee > 0) {
            PERMIT2.transferFrom(sub.subscriber, platformWallet, uint160(fee), sub.token);
        }
    }

    function _settleViaAllowance(
        Subscription storage sub,
        address payer,
        uint256 merchantAmount,
        uint256 fee
    ) internal {
        IERC20 token = IERC20(sub.token);
        // slither-disable-next-line arbitrary-send-erc20
        token.safeTransferFrom(payer, sub.merchant, merchantAmount);
        if (fee > 0) {
            // slither-disable-next-line arbitrary-send-erc20
            token.safeTransferFrom(payer, platformWallet, fee);
        }
    }

    /// @notice Cancel a subscription. Callable by subscriber or merchant.
    function cancelSubscription(uint256 subscriptionId) external nonReentrant {
        _requireExists(subscriptionId);
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
    ) external nonReentrant {
        require(msg.sender == relayer, "Only relayer");
        _requireExists(subscriptionId);
        Subscription storage sub = subscriptions[subscriptionId];
        require(subscriber != address(0), "Invalid subscriber");
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
    ) external nonReentrant {
        require(msg.sender == relayer, "Only relayer");
        _requireExists(subscriptionId);
        Subscription storage sub = subscriptions[subscriptionId];
        require(merchant != address(0), "Invalid merchant");
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
    function requestSubscriptionWalletUpdate(uint256 subscriptionId, address newSubscriber) external nonReentrant {
        _requireExists(subscriptionId);
        Subscription storage sub = subscriptions[subscriptionId];
        require(msg.sender == sub.subscriber, "Not subscriber");
        require(newSubscriber != address(0), "Invalid address");
        require(sub.status == Status.Active, "Not active");

        pendingWalletUpdates[subscriptionId] = newSubscriber;
        emit SubscriptionWalletUpdateRequested(subscriptionId, sub.subscriber, newSubscriber);
    }

    /// @notice Accept a pending wallet migration. Caller becomes the new subscriber.
    function acceptSubscriptionWalletUpdate(uint256 subscriptionId) external nonReentrant {
        require(pendingWalletUpdates[subscriptionId] == msg.sender, "Not pending for caller");

        Subscription storage sub = subscriptions[subscriptionId];
        if (sub.status != Status.Active) {
            delete pendingWalletUpdates[subscriptionId];
            revert("Subscription no longer active");
        }

        // A Permit2 allowance is keyed on the old owner inside Permit2 and
        // cannot be re-granted from here, so migration would silently guarantee
        // failure one interval later (SC-16).
        require(!isPermit2Subscription[subscriptionId], "Migrate unsupported for Permit2 subs");
        require(
            IERC20(sub.token).allowance(msg.sender, address(this)) >= sub.amount,
            "New wallet has no allowance"
        );

        address oldSubscriber = sub.subscriber;
        sub.subscriber = msg.sender;
        delete pendingWalletUpdates[subscriptionId];

        // Every BackupPayerConsent named the *old* subscriber. Migrating the
        // subscription would silently repoint that consent at a wallet the
        // backup never agreed to back, so the list is cleared and the backups
        // must re-consent under the new owner.
        _clearBackupPayers(subscriptionId);

        emit SubscriptionWalletUpdated(subscriptionId, oldSubscriber, msg.sender);
    }

    /// @notice Add or remove a token from the accepted list.
    function setAcceptedToken(address token, bool accepted) external onlyOwner {
        acceptedTokens[token] = accepted;
        emit AcceptedTokenUpdated(token, accepted);
    }

    /// @notice Update the platform fee. Max 1000 bps (10%). Live subscriptions
    ///         clamp to the ceiling their subscriber signed, so a raise only
    ///         affects subscriptions that signed for at least this much.
    function setPlatformFee(uint256 _fee) external onlyOwner {
        require(_fee <= MAX_PLATFORM_FEE_BPS, "Fee too high");
        uint256 old = platformFee;
        platformFee = _fee;
        emit PlatformFeeUpdated(old, _fee);
    }

    /// @notice Update the wallet that receives platform fees.
    function setPlatformWallet(address _wallet) external onlyOwner {
        require(_wallet != address(0), "Invalid wallet");
        address old = platformWallet;
        platformWallet = _wallet;
        emit PlatformWalletUpdated(old, _wallet);
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

    /// @notice Sweep tokens sent here directly. The manager holds no user
    ///         balances between transactions.
    function rescueToken(address token, address to, uint256 amount) external onlyOwner {
        require(to != address(0), "Invalid recipient");
        emit TokenRescued(token, to, amount);
        IERC20(token).safeTransfer(to, amount);
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    /// @notice Disabled — see PaymentVault.renounceOwnership (SC-14).
    function renounceOwnership() public pure override {
        revert("Renounce disabled");
    }

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

    /// @dev Effective charge amount for this cycle without mutating discount
    ///      state. Callers that commit to a pull follow up with
    ///      _consumeDiscountCycle.
    function _previewChargeAmount(uint256 subscriptionId) internal view returns (uint256) {
        Subscription storage sub = subscriptions[subscriptionId];
        SubscriptionDiscount storage d = subscriptionDiscounts[subscriptionId];
        if (d.discountCyclesRemaining == 0 || d.discountAmount == 0) {
            return sub.amount;
        }
        if (d.discountAmount >= sub.amount) return 0;
        return sub.amount - d.discountAmount;
    }

    /// @dev Burns one discounted cycle. No-op when no discount is active.
    function _consumeDiscountCycle(uint256 subscriptionId) internal {
        SubscriptionDiscount storage d = subscriptionDiscounts[subscriptionId];
        if (d.discountCyclesRemaining == 0 || d.discountAmount == 0) return;
        uint256 remaining = d.discountCyclesRemaining - 1;
        d.discountCyclesRemaining = remaining;
        emit SubscriptionDiscountConsumed(subscriptionId, remaining);
    }

    /// @dev Preview + consume in one step. Only for paths that revert on
    ///      payment failure (subscription creation), where the whole
    ///      transaction unwinds if the pull fails.
    function _resolveChargeAmount(uint256 subscriptionId) internal returns (uint256) {
        uint256 amount = _previewChargeAmount(subscriptionId);
        _consumeDiscountCycle(subscriptionId);
        return amount;
    }

    function _processPayment(uint256 subscriptionId) internal {
        Subscription storage sub = subscriptions[subscriptionId];
        uint256 amount = _resolveChargeAmount(subscriptionId);
        require(amount > 0, "Charge amount is zero");
        address token = sub.token;
        address subscriber = sub.subscriber;
        address merchant_ = sub.merchant;

        uint256 fee = _feeFor(subscriptionId, amount);
        uint256 merchantAmount = amount - fee;
        require(merchantAmount > 0, "Amount too small for fee");

        sub.totalCharged += amount;
        emit PaymentReceived(subscriptionId, subscriber, merchant_, token, amount, fee, block.timestamp);

        // slither-disable-next-line arbitrary-send-erc20
        IERC20(token).safeTransferFrom(subscriber, merchant_, merchantAmount);
        if (fee > 0) {
            // slither-disable-next-line arbitrary-send-erc20
            IERC20(token).safeTransferFrom(subscriber, platformWallet, fee);
        }
    }

    /// @dev Picks the funding wallet for this cycle: the primary subscriber if
    /// it can cover, else the first consented backup that can. Returns
    /// address(0) when nobody can pay.
    function _selectPayer(uint256 subscriptionId, IERC20 token, uint256 amount)
        internal
        view
        returns (address)
    {
        address primary = subscriptions[subscriptionId].subscriber;
        if (
            token.allowance(primary, address(this)) >= amount &&
            token.balanceOf(primary) >= amount
        ) {
            return primary;
        }

        address[] storage backups = subscriptionBackups[subscriptionId];
        uint256 n = backups.length;
        for (uint256 i = 0; i < n; i++) {
            address b = backups[i];
            // backupPayerMaxAmount is written only from a BackupPayerConsent
            // signature by `b` itself, and caps what this subscription may pull
            // from that wallet per cycle. A wallet may consent to less than the
            // full charge — it is then simply skipped, rather than the whole
            // authorization being refused up front.
            if (
                backupPayerMaxAmount[subscriptionId][b] >= amount &&
                token.allowance(b, address(this)) >= amount &&
                token.balanceOf(b) >= amount
            ) {
                return b;
            }
        }
        return address(0);
    }

    // -------------------------------------------------------------------
    // Backup payers (wallet-walk). Both sides must sign: the primary
    // subscriber authorizes the wallet via BackupPayerAuth, and the backup
    // wallet consents via BackupPayerConsent, which binds the subscription
    // id, the primary, the token and a per-charge cap. When the primary
    // runs out of funds, chargeSubscription walks this list and pulls from
    // the first backup that consented to at least this cycle's amount.
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
        uint256 maxAmount;
        uint256 consentDeadline;
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
        uint256 nonce = backupAuthNonces[subscriber];
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
        address recovered = ECDSA.recover(digest, subscriberAuthSig);
        require(recovered != address(0), "Invalid signer");
        require(recovered == subscriber, "Bad subscriber auth");
        unchecked { backupAuthNonces[subscriber] = nonce + 1; }
    }

    /// @dev Verifies the backup wallet's own EIP-712 consent. This is what makes
    /// the wallet-walk safe: an ERC-20 allowance grants spending power, it does
    /// not express agreement to bankroll a specific subscription (SC-01).
    function _verifyBackupConsent(
        BackupPayerParams calldata p,
        address subscriber,
        address token,
        bytes calldata backupConsentSig
    ) internal {
        uint256 nonce = backupConsentNonces[p.backup];
        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    BACKUP_PAYER_CONSENT_TYPEHASH,
                    p.subscriptionId,
                    subscriber,
                    token,
                    p.maxAmount,
                    nonce,
                    p.consentDeadline
                )
            )
        );
        address recovered = ECDSA.recover(digest, backupConsentSig);
        require(recovered != address(0), "Invalid signer");
        require(recovered == p.backup, "Bad backup consent");
        unchecked { backupConsentNonces[p.backup] = nonce + 1; }
    }

    /// @notice Add a backup payer. Relayer-submitted, gasless for both
    ///         the primary subscriber and the backup wallet. The primary
    ///         signs a BackupPayerAuth EIP-712 message; the backup signs a
    ///         BackupPayerConsent EIP-712 message *and* an EIP-2612 permit
    ///         granting the contract allowance on their token.
    function addSubscriptionBackupPayer(
        BackupPayerParams calldata p,
        bytes calldata subscriberAuthSig,
        bytes calldata backupConsentSig
    ) external nonReentrant whenNotPaused {
        require(msg.sender == relayer, "Only relayer");
        require(!gaslessPaused, "Gasless paused");
        require(block.timestamp <= p.authDeadline, "Auth expired");
        require(block.timestamp <= p.consentDeadline, "Consent expired");
        _requireExists(p.subscriptionId);

        Subscription storage sub = subscriptions[p.subscriptionId];
        // PastDue subscriptions can never be charged, so a backup added to one
        // would do nothing but burn a nonce (SC-17).
        require(sub.status == Status.Active, "Not active");
        require(
            p.backup != address(0) && p.backup != sub.subscriber,
            "Invalid backup"
        );
        // A backup names its own per-charge ceiling. It may be below
        // `sub.amount` — that wallet is then skipped at charge time instead of
        // funding a cycle it never agreed to cover.
        require(p.maxAmount > 0, "Zero backup cap");
        require(p.permitValue >= p.maxAmount, "Permit < backup cap");

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
        _verifyBackupConsent(p, sub.subscriber, sub.token, backupConsentSig);

        // Effects before interactions: the permit call below is the only
        // external call, and a failure reverts the whole transaction.
        backups.push(p.backup);
        backupPayerMaxAmount[p.subscriptionId][p.backup] = p.maxAmount;
        emit SubscriptionBackupPayerAdded(p.subscriptionId, p.backup, p.maxAmount);

        // Submit the backup's permit. A failure is only tolerable if the wallet
        // already has standing allowance — swallowing it unconditionally is what
        // let garbage permit components through (SC-01).
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
        {} catch {
            require(
                IERC20(sub.token).allowance(p.backup, address(this)) >= p.permitValue,
                "Backup permit failed"
            );
        }
    }

    /// @dev Drops every backup payer and its cap, emitting one removal event
    /// each so the indexer can follow.
    function _clearBackupPayers(uint256 subscriptionId) internal {
        address[] storage backups = subscriptionBackups[subscriptionId];
        uint256 n = backups.length;
        for (uint256 i = 0; i < n; i++) {
            address b = backups[i];
            delete backupPayerMaxAmount[subscriptionId][b];
            emit SubscriptionBackupPayerRemoved(subscriptionId, b);
        }
        delete subscriptionBackups[subscriptionId];
    }

    /// @notice Remove a backup payer. Callable by the primary subscriber or by
    ///         the backup wallet itself — the party whose funds are at risk must
    ///         always be able to walk away unilaterally (SC-02).
    function removeSubscriptionBackupPayer(uint256 subscriptionId, address backup)
        external
        nonReentrant
    {
        Subscription storage sub = subscriptions[subscriptionId];
        require(
            msg.sender == sub.subscriber || msg.sender == backup,
            "Not subscriber or backup"
        );

        address[] storage backups = subscriptionBackups[subscriptionId];
        uint256 n = backups.length;
        for (uint256 i = 0; i < n; i++) {
            if (backups[i] == backup) {
                if (i != n - 1) backups[i] = backups[n - 1];
                backups.pop();
                delete backupPayerMaxAmount[subscriptionId][backup];
                emit SubscriptionBackupPayerRemoved(subscriptionId, backup);
                return;
            }
        }
        revert("Backup not found");
    }
}
