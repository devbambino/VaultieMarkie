// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * Simple mock that allows setting accrued interest per (marketId,user)
 * Returns a uint256 representing CCOP interest in 6 decimals.
 */
contract MockDebtLens {
    mapping(bytes32 => mapping(address => uint256)) public interest;

    function setAccruedInterest(bytes32 marketId, address user, uint256 amount) external {
        interest[marketId][user] = amount;
    }

    function getAccruedInterest(bytes32 marketId, address user) external view returns (uint256) {
        return interest[marketId][user];
    }
}