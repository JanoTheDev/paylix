// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "./interfaces/IPermit2.sol";

/// @dev DAI's legacy permit interface. Different shape from EIP-2612 —
/// `allowed` bool instead of `value` uint256. Ethereum-mainnet DAI uses
/// this pre-MakerDAO-MCD interface. Bridged DAI on L2s uses standard
/// EIP-2612 (or goes through Permit2).
interface IDaiLikePermit {
    function permit(
        address holder,
        address spender,
        uint256 nonce,
        uint256 expiry,
        bool allowed,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
}

/// @title PaymentVault
/// @notice Non-custodial one-time USDC payment settlement. Supports direct
///         payments and gasless (relayer + permit) flows with EIP-712 intent binding.
/// @dev Funds move directly from buyer to merchant via safeTransferFrom —
///      this contract never holds token balances.
contract PaymentVault is Ownable2Step, ReentrancyGuard, Pausable, EIP712 {
    using SafeERC20 for IERC20;

    // ---- EIP-712 PaymentIntent ----
    // Binds the buyer's signature to the exact merchant/amount/token/etc. so a
    // compromised relayer cannot redirect a signed permit to a different payee.
    // nonce is per-buyer and strictly increments on use (replay protection).
    //
    // `maxFeeBps` is the highest platform fee the signer agreed to. The owner
    // can raise `platformFee` at any time; binding the ceiling into the signature
    // means an already-signed intent can never be settled at a worse rate than
    // it was signed at (SC-03).
    //
    // `flow` binds the intent to the settlement mechanism the buyer's wallet
    // actually presented (SC-23). All three gasless entry points share this
    // typehash; without `flow`, a relayer holding an intent signed for the
    // Permit2 flow could settle it through the EIP-2612 or DAI flow instead,
    // against whatever residual allowance the buyer happens to carry.
    bytes32 private constant PAYMENT_INTENT_TYPEHASH = keccak256(
        "PaymentIntent(address buyer,address token,address merchant,uint256 amount,bytes32 productId,bytes32 customerId,uint256 maxFeeBps,uint8 flow,uint256 nonce,uint256 deadline)"
    );

    /// @notice Hard ceiling on the platform fee, in basis points (10%).
    uint256 public constant MAX_PLATFORM_FEE_BPS = 1000;

    /// @notice Settlement flow identifiers bound into every signed intent.
    uint8 public constant FLOW_EIP2612 = 1;
    uint8 public constant FLOW_PERMIT2 = 2;
    uint8 public constant FLOW_DAI_PERMIT = 3;

    mapping(address => uint256) public intentNonces;

    address public platformWallet;
    uint256 public platformFee; // basis points (50 = 0.5%, max 1000 = 10%)
    mapping(address => bool) public acceptedTokens;
    address public relayer;
    bool public gaslessPaused;

    // Permit2 canonical deployment — identical address on every EVM chain.
    // Immutable so it can't drift via owner action.
    IPermit2 public constant PERMIT2 = IPermit2(0x000000000022D473030F116dDEE9F6B43aC78BA3);

    event PaymentReceived(
        address indexed payer,
        address indexed merchant,
        address token,
        uint256 amount,
        uint256 fee,
        bytes32 productId,
        bytes32 customerId,
        uint256 timestamp
    );
    event AcceptedTokenUpdated(address indexed token, bool accepted);
    event PlatformFeeUpdated(uint256 oldFee, uint256 newFee);
    event PlatformWalletUpdated(address oldWallet, address newWallet);
    event RelayerUpdated(address indexed oldRelayer, address indexed newRelayer);
    event GaslessPausedUpdated(bool paused);
    event TokenRescued(address indexed token, address indexed to, uint256 amount);

    constructor(address _platformWallet, uint256 _platformFee)
        Ownable(msg.sender)
        EIP712("Paylix PaymentVault", "1")
    {
        require(_platformFee <= MAX_PLATFORM_FEE_BPS, "Fee too high");
        require(_platformWallet != address(0), "Invalid wallet");
        platformWallet = _platformWallet;
        platformFee = _platformFee;
        // Emit from the constructor so a deployment's fee/wallet configuration
        // is observable in logs without an archive-node storage read (SC-18).
        emit PlatformWalletUpdated(address(0), _platformWallet);
        emit PlatformFeeUpdated(0, _platformFee);
    }

    /// @notice EIP-712 domain separator — exposed for off-chain signers.
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /// @notice Current payment-intent nonce for a buyer. Off-chain signers
    /// must read this and use it in the PaymentIntent struct, then increment
    /// by 1 for the next signature.
    function getIntentNonce(address buyer) external view returns (uint256) {
        return intentNonces[buyer];
    }

    /// @dev Fields of the EIP-712 PaymentIntent, grouped so the settlement
    /// entry points stay under the EVM stack-depth limit.
    struct PaymentIntentData {
        address buyer;
        address token;
        address merchant;
        uint256 amount;
        bytes32 productId;
        bytes32 customerId;
        uint256 maxFeeBps;
        uint256 deadline;
    }

    /// @dev Verifies the buyer signed an EIP-712 PaymentIntent binding this
    /// exact merchant/amount/token/fee-ceiling, then consumes the nonce.
    /// Reverts on bad signature, expired deadline, or a platform fee above the
    /// one the buyer signed.
    function _consumePaymentIntent(
        PaymentIntentData memory d,
        uint8 flow,
        bytes calldata intentSignature
    ) internal {
        require(block.timestamp <= d.deadline, "Payment intent expired");
        require(d.maxFeeBps <= MAX_PLATFORM_FEE_BPS, "maxFeeBps too high");
        // The fee the buyer/merchant agreed to at signing time is the ceiling.
        // An owner fee raise voids outstanding signatures instead of silently
        // repricing them.
        require(platformFee <= d.maxFeeBps, "Fee above signed max");
        uint256 nonce = intentNonces[d.buyer];
        bytes32 structHash = keccak256(
            abi.encode(
                PAYMENT_INTENT_TYPEHASH,
                d.buyer,
                d.token,
                d.merchant,
                d.amount,
                d.productId,
                d.customerId,
                d.maxFeeBps,
                flow,
                nonce,
                d.deadline
            )
        );
        bytes32 digest = _hashTypedDataV4(structHash);
        address recovered = ECDSA.recover(digest, intentSignature);
        require(recovered != address(0), "Invalid signer");
        require(recovered == d.buyer, "Invalid intent signature");
        unchecked { intentNonces[d.buyer] = nonce + 1; }
    }

    /// @dev Platform fee for `amount` at the current rate. Rounds down, i.e.
    /// in the merchant's favour, so `fee + merchantAmount == amount` exactly.
    function _feeFor(uint256 amount) internal view returns (uint256) {
        if (platformFee == 0 || platformWallet == address(0)) return 0;
        return (amount * platformFee) / 10000;
    }

    /// @notice Execute a direct one-time payment. Caller (buyer) must have
    ///         pre-approved this contract for at least `amount` of `token`.
    /// @dev    No signed fee ceiling applies here: there is no intent, so the
    ///         fee is read from storage at settlement time. The owner can
    ///         therefore front-run a direct payment with a `setPlatformFee`
    ///         raise (bounded by MAX_PLATFORM_FEE_BPS). Gasless callers get the
    ///         `maxFeeBps` binding; direct callers must check `platformFee()`
    ///         themselves, or use the gasless path.
    /// @param token   ERC-20 token address (must be in acceptedTokens)
    /// @param merchant Recipient of the payment minus platform fee
    /// @param amount  Total payment amount in token units
    /// @param productId  Off-chain product identifier
    /// @param customerId Off-chain customer identifier
    function createPayment(
        address token,
        address merchant,
        uint256 amount,
        bytes32 productId,
        bytes32 customerId
    ) external nonReentrant whenNotPaused {
        require(acceptedTokens[token], "Token not accepted");
        require(amount > 0, "Amount must be > 0");
        require(merchant != address(0), "Invalid merchant");

        uint256 fee = _feeFor(amount);
        uint256 merchantAmount = amount - fee;
        require(merchantAmount > 0, "Amount too small for fee");

        IERC20(token).safeTransferFrom(msg.sender, merchant, merchantAmount);
        if (fee > 0) {
            IERC20(token).safeTransferFrom(msg.sender, platformWallet, fee);
        }

        emit PaymentReceived(msg.sender, merchant, token, amount, fee, productId, customerId, block.timestamp);
    }

    struct PermitSig {
        uint256 deadline;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    /// @notice Gasless payment: relayer submits the buyer's EIP-2612 permit and
    ///         EIP-712 PaymentIntent signature. Buyer never needs ETH.
    /// @param d          Signed PaymentIntent fields (deadline must equal permitSig.deadline)
    /// @param permitSig  EIP-2612 permit signature components
    /// @param intentSignature EIP-712 PaymentIntent signature from the buyer
    function createPaymentWithPermit(
        PaymentIntentData calldata d,
        PermitSig calldata permitSig,
        bytes calldata intentSignature
    ) external nonReentrant whenNotPaused {
        require(msg.sender == relayer, "Only relayer");
        require(!gaslessPaused, "Gasless paused");
        require(acceptedTokens[d.token], "Token not accepted");
        require(d.amount > 0, "Amount must be > 0");
        require(d.merchant != address(0), "Invalid merchant");
        require(d.buyer != address(0), "Invalid buyer");
        require(d.deadline == permitSig.deadline, "Deadline mismatch");
        require(block.timestamp <= permitSig.deadline, "Intent expired");

        // Verify the buyer signed an EIP-712 PaymentIntent committing to this
        // exact merchant/amount/fee-ceiling. Consumes the per-buyer nonce. A
        // compromised relayer cannot swap any field — recover() will fail.
        _consumePaymentIntent(d, FLOW_EIP2612, intentSignature);

        // Consume the buyer's permit signature to set allowance for this vault.
        // Wrapped in try/catch so a front-run that already consumed the nonce
        // doesn't DOS the relayer — if allowance is already sufficient, proceed.
        try IERC20Permit(d.token).permit(
            d.buyer, address(this), d.amount, permitSig.deadline, permitSig.v, permitSig.r, permitSig.s
        ) {
            // permit succeeded, allowance is now at least `amount`
        } catch {
            // permit failed (likely already consumed). Fall through — if the
            // existing allowance is sufficient, the transferFrom below will
            // succeed; otherwise it'll revert cleanly.
        }

        uint256 fee = _feeFor(d.amount);
        uint256 merchantAmount = d.amount - fee;
        require(merchantAmount > 0, "Amount too small for fee");

        // The `buyer` field is *not* arbitrary here: _consumePaymentIntent
        // above proves the buyer signed an EIP-712 PaymentIntent committing to
        // exactly this `(merchant, amount, token, productId, customerId,
        // maxFeeBps, nonce, deadline)` tuple. A compromised relayer cannot vary
        // any field — recover() would fail. See test_reverts_if_relayer_swaps_merchant
        // in test/PaymentVaultPermit.t.sol.
        // slither-disable-next-line arbitrary-send-erc20
        IERC20(d.token).safeTransferFrom(d.buyer, d.merchant, merchantAmount);
        if (fee > 0) {
            // slither-disable-next-line arbitrary-send-erc20
            IERC20(d.token).safeTransferFrom(d.buyer, platformWallet, fee);
        }

        emit PaymentReceived(d.buyer, d.merchant, d.token, d.amount, fee, d.productId, d.customerId, block.timestamp);
    }

    /// @dev Packed params for createPaymentWithPermit2. Needed to stay under
    /// the EVM stack-depth limit given the number of distinct inputs.
    struct Permit2Payment {
        address token;
        address buyer;
        address merchant;
        uint256 amount;
        bytes32 productId;
        bytes32 customerId;
        uint256 maxFeeBps;
        uint256 permit2Nonce;
        uint256 permit2Deadline;
        bytes permit2Signature;
        bytes intentSignature;
    }

    function _pullViaPermit2(
        address token,
        address owner,
        uint256 amount,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) internal {
        IPermit2.PermitTransferFrom memory permit = IPermit2.PermitTransferFrom({
            permitted: IPermit2.TokenPermissions({token: token, amount: amount}),
            nonce: nonce,
            deadline: deadline
        });
        IPermit2.SignatureTransferDetails memory td = IPermit2.SignatureTransferDetails({
            to: address(this),
            requestedAmount: amount
        });
        PERMIT2.permitTransferFrom(permit, td, owner, signature);
    }

    /// @notice Gasless payment via Permit2. For tokens that don't implement
    ///         EIP-2612 (USDT, WBTC, etc.), the buyer signs a Permit2
    ///         `PermitTransferFrom` over the token + amount + deadline. The
    ///         vault pulls the full amount into itself in one call and then
    ///         splits to merchant + platform wallet.
    ///
    ///         Holds `p.amount` for the duration of this transaction only;
    ///         no persistent custody. Reentrancy is blocked by nonReentrant.
    /// @param p Packed Permit2Payment struct (see struct definition above)
    function createPaymentWithPermit2(Permit2Payment calldata p)
        external
        nonReentrant
        whenNotPaused
    {
        require(msg.sender == relayer, "Only relayer");
        require(!gaslessPaused, "Gasless paused");
        require(acceptedTokens[p.token], "Token not accepted");
        require(p.amount > 0, "Amount must be > 0");
        require(p.merchant != address(0), "Invalid merchant");
        require(p.buyer != address(0), "Invalid buyer");
        require(block.timestamp <= p.permit2Deadline, "Intent expired");

        // Verify the buyer signed an EIP-712 PaymentIntent over the active
        // merchant/amount/token/fee-ceiling. Consumes the per-buyer nonce so a
        // compromised relayer cannot swap the merchant or amount.
        _consumePaymentIntent(
            PaymentIntentData({
                buyer: p.buyer,
                token: p.token,
                merchant: p.merchant,
                amount: p.amount,
                productId: p.productId,
                customerId: p.customerId,
                maxFeeBps: p.maxFeeBps,
                deadline: p.permit2Deadline
            }),
            FLOW_PERMIT2,
            p.intentSignature
        );

        // This is the one path where the vault takes temporary custody, so
        // measure what actually arrived. A fee-on-transfer or rebasing token
        // would otherwise let the split drain a residual balance (SC-12).
        uint256 balanceBefore = IERC20(p.token).balanceOf(address(this));
        _pullViaPermit2(p.token, p.buyer, p.amount, p.permit2Nonce, p.permit2Deadline, p.permit2Signature);
        uint256 received = IERC20(p.token).balanceOf(address(this)) - balanceBefore;
        require(received == p.amount, "Fee-on-transfer token");

        uint256 fee = _feeFor(p.amount);
        uint256 merchantAmount = p.amount - fee;
        require(merchantAmount > 0, "Amount too small for fee");

        IERC20(p.token).safeTransfer(p.merchant, merchantAmount);
        if (fee > 0) {
            IERC20(p.token).safeTransfer(platformWallet, fee);
        }

        emit PaymentReceived(p.buyer, p.merchant, p.token, p.amount, fee, p.productId, p.customerId, block.timestamp);
    }

    struct DaiPermitPayment {
        address token;
        address buyer;
        address merchant;
        uint256 amount;
        bytes32 productId;
        bytes32 customerId;
        uint256 maxFeeBps;
        uint256 daiNonce;
        uint256 permitExpiry;
        uint8 v;
        bytes32 r;
        bytes32 s;
        bytes intentSignature;
    }

    /// @notice Gasless payment via DAI's legacy `permit(holder, spender, nonce,
    ///         expiry, allowed, v, r, s)` flow. Ethereum-mainnet DAI only.
    ///         Buyer signs with `allowed=true` to grant max allowance; the
    ///         vault then executes a normal safeTransferFrom.
    /// @dev    NOTE: `allowed=true` leaves this vault with an unlimited standing
    ///         DAI allowance on the buyer. Nothing here can move it without a
    ///         fresh buyer intent signature, but buyers who want it gone must
    ///         revoke on the token itself. Documented in README.md.
    function createPaymentWithDaiPermit(DaiPermitPayment calldata p)
        external
        nonReentrant
        whenNotPaused
    {
        require(msg.sender == relayer, "Only relayer");
        require(!gaslessPaused, "Gasless paused");
        require(acceptedTokens[p.token], "Token not accepted");
        require(p.amount > 0, "Amount must be > 0");
        require(p.merchant != address(0), "Invalid merchant");
        require(p.buyer != address(0), "Invalid buyer");
        require(block.timestamp <= p.permitExpiry, "Intent expired");

        _consumePaymentIntent(
            PaymentIntentData({
                buyer: p.buyer,
                token: p.token,
                merchant: p.merchant,
                amount: p.amount,
                productId: p.productId,
                customerId: p.customerId,
                maxFeeBps: p.maxFeeBps,
                deadline: p.permitExpiry
            }),
            FLOW_DAI_PERMIT,
            p.intentSignature
        );

        // DAI permit with `allowed=true` grants uint(-1) allowance to spender.
        // A previously-used nonce would make this revert; we swallow to stay
        // idempotent on retries where allowance is already granted.
        try IDaiLikePermit(p.token).permit(
            p.buyer, address(this), p.daiNonce, p.permitExpiry, true, p.v, p.r, p.s
        ) {
        } catch {
        }

        uint256 fee = _feeFor(p.amount);
        uint256 merchantAmount = p.amount - fee;
        require(merchantAmount > 0, "Amount too small for fee");

        // slither-disable-next-line arbitrary-send-erc20
        IERC20(p.token).safeTransferFrom(p.buyer, p.merchant, merchantAmount);
        if (fee > 0) {
            // slither-disable-next-line arbitrary-send-erc20
            IERC20(p.token).safeTransferFrom(p.buyer, platformWallet, fee);
        }

        emit PaymentReceived(p.buyer, p.merchant, p.token, p.amount, fee, p.productId, p.customerId, block.timestamp);
    }

    /// @notice Add or remove a token from the accepted list.
    function setAcceptedToken(address token, bool accepted) external onlyOwner {
        acceptedTokens[token] = accepted;
        emit AcceptedTokenUpdated(token, accepted);
    }

    /// @notice Update the platform fee. Max 1000 bps (10%). Existing signed
    ///         intents carry their own `maxFeeBps` ceiling, so raising the fee
    ///         voids them rather than repricing them.
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

    /// @notice Set the authorized relayer address for gasless payments.
    function setRelayer(address _relayer) external onlyOwner {
        require(_relayer != address(0), "Invalid relayer address");
        address old = relayer;
        relayer = _relayer;
        emit RelayerUpdated(old, _relayer);
    }

    /// @notice Toggle gasless payment path without pausing the entire contract.
    function setGaslessPaused(bool _paused) external onlyOwner {
        gaslessPaused = _paused;
        emit GaslessPausedUpdated(_paused);
    }

    /// @notice Sweep tokens that were sent here directly or left behind by a
    ///         misbehaving token. The vault holds no user balances between
    ///         transactions, so an owner-only sweep cannot touch user funds.
    function rescueToken(address token, address to, uint256 amount) external onlyOwner {
        require(to != address(0), "Invalid recipient");
        emit TokenRescued(token, to, amount);
        IERC20(token).safeTransfer(to, amount);
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    /// @notice Disabled. Renouncing would permanently brick setRelayer,
    ///         setPlatformWallet, setPlatformFee, setAcceptedToken, pause and
    ///         unpause with no recovery path (SC-14).
    function renounceOwnership() public pure override {
        revert("Renounce disabled");
    }
}
