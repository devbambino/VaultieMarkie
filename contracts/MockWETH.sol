// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract MockWETH is ERC20, Ownable {
    // Constructor: Initialize the token with name "wETH_test" and symbol "wETH"
    constructor() ERC20("wETH_test", "wETH") Ownable(msg.sender) {}

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
     * @return Number of decimals (18 for this PoC, matching WETH)
     */
    function decimals() public pure override returns (uint8) {
        return 18;
    }
}
