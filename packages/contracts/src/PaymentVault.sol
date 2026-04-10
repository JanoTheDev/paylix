// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

contract PaymentVault is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    address public platformWallet;
    uint256 public platformFee; // basis points (50 = 0.5%, max 1000 = 10%)
    mapping(address => bool) public acceptedTokens;
    address public relayer;
    bool public gaslessPaused;

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

    constructor(address _platformWallet, uint256 _platformFee) Ownable(msg.sender) {
        require(_platformFee <= 1000, "Fee too high");
        platformWallet = _platformWallet;
        platformFee = _platformFee;
    }

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

        IERC20(token).safeTransferFrom(msg.sender, merchant, merchantAmount);
        if (fee > 0) {
            IERC20(token).safeTransferFrom(msg.sender, platformWallet, fee);
        }

        emit PaymentReceived(msg.sender, merchant, token, amount, fee, productId, customerId, block.timestamp);
    }

    function createPaymentWithPermit(
        address token,
        address buyer,
        address merchant,
        uint256 amount,
        bytes32 productId,
        bytes32 customerId,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant whenNotPaused {
        require(msg.sender == relayer, "Only relayer");
        require(!gaslessPaused, "Gasless paused");
        require(acceptedTokens[token], "Token not accepted");
        require(amount > 0, "Amount must be > 0");
        require(merchant != address(0), "Invalid merchant");
        require(buyer != address(0), "Invalid buyer");

        // Consume the buyer's permit signature to set allowance for this vault.
        // Wrapped in try/catch so a front-run that already consumed the nonce
        // doesn't DOS the relayer — if allowance is already sufficient, proceed.
        try IERC20Permit(token).permit(buyer, address(this), amount, deadline, v, r, s) {
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

        IERC20(token).safeTransferFrom(buyer, merchant, merchantAmount);
        if (fee > 0) {
            IERC20(token).safeTransferFrom(buyer, platformWallet, fee);
        }

        emit PaymentReceived(buyer, merchant, token, amount, fee, productId, customerId, block.timestamp);
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
}
