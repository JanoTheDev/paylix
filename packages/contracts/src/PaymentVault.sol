// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract PaymentVault is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public platformWallet;
    uint256 public platformFee; // basis points (50 = 0.5%, max 1000 = 10%)
    mapping(address => bool) public acceptedTokens;

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
    ) external nonReentrant {
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
        platformWallet = _wallet;
        emit PlatformWalletUpdated(_wallet);
    }
}
