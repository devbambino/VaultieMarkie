// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockMXNB
 * @notice Mock ERC20 token representing MXNB_test (test collateral/loan asset)
 * @dev Mintable for PoC purposes. In production, this would be a real token.
 */
contract MockMXNB is ERC20, Ownable {
    // Constructor: Initialize the token with name "MXNB_test" and symbol "MXNB"
    constructor() ERC20("MXNB_test", "MXNB") Ownable(msg.sender) {}

    /**
     * @notice Mint new tokens to an address
     * @param to Recipient address
     * @param amount Amount to mint (in wei)
     */
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    /**
     * @notice Burn tokens from an address (onlyOwner)
     * @param from Address to burn from
     * @param amount Amount to burn
     */
    function burn(address from, uint256 amount) external onlyOwner {
        _burn(from, amount);
    }

    /**
     * @notice Get token decimals (standard ERC20)
     * @return Number of decimals (6 for this PoC, matching USDC)
     */
    function decimals() public pure override returns (uint8) {
        return 6;
    }
}
