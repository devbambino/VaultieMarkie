// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title EthUsdcOracle
 * @notice Simple oracle that returns a fixed price for Morpho Blue integration
 * @dev
 * - Returns a constant price scaled by 1e36 (Morpho's required precision)
 * - For this PoC: collateral (weth) has 18 dec and loan (usdc) have 6 decimals
 * - Price: 1 weth = 2100 USDC 
 * - Formula: 1 * 10^(18 - 6 + 36) = 1e36
 *
 * Production oracle would use:
 * - Chainlink price feeds
 * - Uniswap TWAP
 * - Other decentralized price oracles
 */
contract EthUsdcOracle {
    /// @notice The fixed price returned by this oracle
    /// @dev Morpho requires price scaled by 1e36
    /// For our PoC: 1 weth (18 decs) = 2100 USDC (6 decs)
    uint256 private constant PRICE = 2100 * 10**(6 - 18 + 36) ;

    /**
     * @notice Get the price of collateral quoted in loan token
     * @return price Price scaled by 1e36
     * @dev
     * Formula for multi-decimal tokens:
     * price = price_in_usd * 10^(loan_decimals - collateral_decimals + 36)
     *
     * For equal decimals (both 6):
     * price = 2100 * 10^(6 - 6 + 36) = 1e36 = 2130644180021278234066216275 
     */
    function price() external pure returns (uint256) {
        return PRICE;
    }

    /**
     * @notice View function version (same as price())
     * @return price Price scaled by 1e24
     */
    function priceView() external pure returns (uint256) {
        return PRICE;
    }
}
