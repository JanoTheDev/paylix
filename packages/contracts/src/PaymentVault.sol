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
    bytes32 private constant PAYMENT_INTENT_TYPEHASH = keccak256(
        "PaymentIntent(address buyer,address token,address merchant,uint256 amount,bytes32 productId,bytes32 customerId,uint256 nonce,uint256 deadline)"
    );

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
    event PlatformFeeUpdated(uint256 newFee);
    event PlatformWalletUpdated(address newWallet);
    event RelayerUpdated(address indexed oldRelayer, address indexed newRelayer);
    event GaslessPausedUpdated(bool paused);

    constructor(address _platformWallet, uint256 _platformFee)
        Ownable(msg.sender)
        EIP712("Paylix PaymentVault", "1")
    {
        require(_platformFee <= 1000, "Fee too high");
        platformWallet = _platformWallet;
        platformFee = _platformFee;
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

    /// @dev Verifies the buyer signed an EIP-712 PaymentIntent binding this
    /// exact merchant/amount/token/etc., then consumes the nonce. Reverts on
    /// bad signature or wrong nonce.
    function _consumePaymentIntent(
        address buyer,
        address token,
        address merchant,
        uint256 amount,
        bytes32 productId,
        bytes32 customerId,
        uint256 deadline,
        bytes calldata intentSignature
    ) internal {
        require(block.timestamp <= deadline, "Payment intent expired");
        uint256 nonce = intentNonces[buyer];
        bytes32 structHash = keccak256(
            abi.encode(
                PAYMENT_INTENT_TYPEHASH,
                buyer,
                token,
                merchant,
                amount,
                productId,
                customerId,
                nonce,
                deadline
            )
        );
        bytes32 digest = _hashTypedDataV4(structHash);
        address recovered = ECDSA.recover(digest, intentSignature);
        require(recovered == buyer, "Invalid intent signature");
        unchecked { intentNonces[buyer] = nonce + 1; }
    }

    /// @notice Execute a direct one-time payment. Caller (buyer) must have
    ///         pre-approved this contract for at least `amount` of `token`.
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

        uint256 fee = 0;
        if (platformFee > 0 && platformWallet != address(0)) {
            fee = (amount * platformFee) / 10000;
        }
        uint256 merchantAmount = amount - fee;
        require(merchantAmount > 0, "Amount too small for fee");

        IERC20(token).safeTransferFrom(msg.sender, merchant, merchantAmount);
        if (fee > 0) {
            require(platformWallet != address(0), "Invalid platform wallet");
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
    /// @param token   ERC-20 token address (must be in acceptedTokens)
    /// @param buyer   Wallet that signed the permit and intent
    /// @param merchant Recipient of the payment minus platform fee
    /// @param amount  Total payment amount in token units
    /// @param productId  Off-chain product identifier
    /// @param customerId Off-chain customer identifier
    /// @param permitSig  EIP-2612 permit signature components
    /// @param intentSignature EIP-712 PaymentIntent signature from the buyer
    function createPaymentWithPermit(
        address token,
        address buyer,
        address merchant,
        uint256 amount,
        bytes32 productId,
        bytes32 customerId,
        PermitSig calldata permitSig,
        bytes calldata intentSignature
    ) external nonReentrant whenNotPaused {
        require(msg.sender == relayer, "Only relayer");
        require(!gaslessPaused, "Gasless paused");
        require(acceptedTokens[token], "Token not accepted");
        require(amount > 0, "Amount must be > 0");
        require(merchant != address(0), "Invalid merchant");
        require(buyer != address(0), "Invalid buyer");
        require(block.timestamp <= permitSig.deadline, "Intent expired");

        // Verify the buyer signed an EIP-712 PaymentIntent committing to this
        // exact merchant/amount. Consumes the per-buyer nonce. A compromised
        // relayer cannot swap the merchant or amount — recover() will fail.
        _consumePaymentIntent(
            buyer,
            token,
            merchant,
            amount,
            productId,
            customerId,
            permitSig.deadline,
            intentSignature
        );

        // Consume the buyer's permit signature to set allowance for this vault.
        // Wrapped in try/catch so a front-run that already consumed the nonce
        // doesn't DOS the relayer — if allowance is already sufficient, proceed.
        try IERC20Permit(token).permit(
            buyer, address(this), amount, permitSig.deadline, permitSig.v, permitSig.r, permitSig.s
        ) {
            // permit succeeded, allowance is now at least `amount`
        } catch {
            // permit failed (likely already consumed). Fall through — if the
            // existing allowance is sufficient, the transferFrom below will
            // succeed; otherwise it'll revert cleanly.
        }

        uint256 fee = 0;
        if (platformFee > 0 && platformWallet != address(0)) {
            fee = (amount * platformFee) / 10000;
        }
        uint256 merchantAmount = amount - fee;
        require(merchantAmount > 0, "Amount too small for fee");

        // The `buyer` parameter is *not* arbitrary here: _consumePaymentIntent
        // above proves the buyer signed an EIP-712 PaymentIntent committing to
        // exactly this `(merchant, amount, token, productId, customerId, nonce,
        // deadline)` tuple. A compromised relayer cannot vary any field —
        // recover() would fail. See test_reverts_if_relayer_swaps_merchant
        // in test/PaymentVaultPermit.t.sol.
        // slither-disable-next-line arbitrary-send-erc20
        IERC20(token).safeTransferFrom(buyer, merchant, merchantAmount);
        if (fee > 0) {
            require(platformWallet != address(0), "Invalid platform wallet");
            // slither-disable-next-line arbitrary-send-erc20
            IERC20(token).safeTransferFrom(buyer, platformWallet, fee);
        }

        emit PaymentReceived(buyer, merchant, token, amount, fee, productId, customerId, block.timestamp);
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
        // merchant/amount/token/etc. Consumes the per-buyer nonce so a
        // compromised relayer cannot swap the merchant or amount.
        _consumePaymentIntent(
            p.buyer,
            p.token,
            p.merchant,
            p.amount,
            p.productId,
            p.customerId,
            p.permit2Deadline,
            p.intentSignature
        );

        _pullViaPermit2(p.token, p.buyer, p.amount, p.permit2Nonce, p.permit2Deadline, p.permit2Signature);

        uint256 fee = 0;
        if (platformFee > 0 && platformWallet != address(0)) {
            fee = (p.amount * platformFee) / 10000;
        }
        uint256 merchantAmount = p.amount - fee;
        require(merchantAmount > 0, "Amount too small for fee");

        IERC20(p.token).safeTransfer(p.merchant, merchantAmount);
        if (fee > 0) {
            require(platformWallet != address(0), "Invalid platform wallet");
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
            p.buyer,
            p.token,
            p.merchant,
            p.amount,
            p.productId,
            p.customerId,
            p.permitExpiry,
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

        uint256 fee = 0;
        if (platformFee > 0 && platformWallet != address(0)) {
            fee = (p.amount * platformFee) / 10000;
        }
        uint256 merchantAmount = p.amount - fee;
        require(merchantAmount > 0, "Amount too small for fee");

        // slither-disable-next-line arbitrary-send-erc20
        IERC20(p.token).safeTransferFrom(p.buyer, p.merchant, merchantAmount);
        if (fee > 0) {
            require(platformWallet != address(0), "Invalid platform wallet");
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

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }
}
