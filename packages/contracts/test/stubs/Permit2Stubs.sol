// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../../src/interfaces/IPermit2.sol";

/// @dev Shared Permit2 stand-ins for tests that need Permit2 etched at the
/// canonical address. Signature verification is deliberately skipped — that is
/// Uniswap's code, not ours. What these do model faithfully is the *token
/// movement*, which is what our custody and reentrancy assertions depend on.

/// SignatureTransfer flow, used by PaymentVault.createPaymentWithPermit2.
contract StubPermit2SignatureTransfer {
    mapping(address => mapping(uint256 => bool)) public usedNonces;

    function permitTransferFrom(
        IPermit2.PermitTransferFrom calldata permit,
        IPermit2.SignatureTransferDetails calldata transferDetails,
        address owner,
        bytes calldata /* signature */
    ) external {
        require(!usedNonces[owner][permit.nonce], "Permit2: nonce used");
        require(block.timestamp <= permit.deadline, "Permit2: expired");
        require(transferDetails.requestedAmount <= permit.permitted.amount, "Permit2: over");

        usedNonces[owner][permit.nonce] = true;

        IERC20(permit.permitted.token).transferFrom(
            owner, transferDetails.to, transferDetails.requestedAmount
        );
    }

    function DOMAIN_SEPARATOR() external pure returns (bytes32) {
        return bytes32(0);
    }
}

/// AllowanceTransfer flow, used by SubscriptionManager's Permit2 subscriptions.
contract StubPermit2AllowanceTransfer {
    mapping(address => mapping(address => mapping(address => uint160))) public allowed;
    mapping(address => mapping(address => mapping(address => uint48))) public expiry;

    function permit(
        address owner,
        IPermit2.PermitSingle calldata p,
        bytes calldata /* signature */
    ) external {
        require(block.timestamp <= p.sigDeadline, "Permit2: sig expired");
        allowed[owner][p.details.token][p.spender] = p.details.amount;
        expiry[owner][p.details.token][p.spender] = p.details.expiration;
    }

    function allowance(address user, address token, address spender)
        external
        view
        returns (uint160, uint48, uint48)
    {
        return (allowed[user][token][spender], expiry[user][token][spender], 0);
    }

    function transferFrom(address from, address to, uint160 amount, address token) external {
        require(block.timestamp <= expiry[from][token][msg.sender], "Permit2: allowance expired");
        uint160 current = allowed[from][token][msg.sender];
        require(current >= amount, "Permit2: insufficient allowance");
        allowed[from][token][msg.sender] = current - amount;
        IERC20(token).transferFrom(from, to, amount);
    }
}
