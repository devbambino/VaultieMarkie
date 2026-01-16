// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title FixedPriceOracle
 * @notice Simple oracle that returns a fixed price for Morpho Blue integration
 * @dev
 * - Returns a constant price scaled by 1e36 (Morpho's required precision)
 * - For this PoC: both collateral (WaUSDC) and loan (cCOP) have 6 decimals
 * - Price: 1 WaUSDC = 1 cCOP (both worth ~$1 USD)
 * - Formula: 1 * 10^(6 - 6 + 36) = 1e36
 *
 * Production oracle would use:
 * - Chainlink price feeds
 * - Uniswap TWAP
 * - Other decentralized price oracles
 */
contract FixedPriceOracle {
    /// @notice The fixed price returned by this oracle
    /// @dev Morpho requires price scaled by 1e36
    /// For our PoC: 1 WaUSDC (6 decimals) = 1 cCOP (6 decimals)
    /// So price = 1 * 10^36 = 1e36
    uint256 private constant PRICE = 1e36;

    /**
     * @notice Get the price of collateral quoted in loan token
     * @return price Price scaled by 1e36
     * @dev
     * Formula for multi-decimal tokens:
     * price = price_in_usd * 10^(loan_decimals - collateral_decimals + 36)
     *
     * For equal decimals (both 6):
     * price = 1 * 10^(6 - 6 + 36) = 1e36
     */
    function price() external pure returns (uint256) {
        return PRICE;
    }

    /**
     * @notice View function version (same as price())
     * @return price Price scaled by 1e36
     */
    function priceView() external pure returns (uint256) {
        return PRICE;
    }
}
