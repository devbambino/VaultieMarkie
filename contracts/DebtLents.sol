// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/** * @dev Simplified interfaces for Remix compatibility
 */
interface IMorpho {
    struct MarketParams {
        address loanToken;
        address collateralToken;
        address oracle;
        address irm;
        uint256 lltv;
    }

    struct Market {
        uint128 totalSupplyAssets;
        uint128 totalSupplyShares;
        uint128 totalBorrowAssets;
        uint128 totalBorrowShares;
        uint128 lastUpdate;
        uint128 fee;
    }

    struct Position {
        uint256 supplyShares;
        uint256 borrowShares;
        uint256 collateral;
    }

    function idToMarketParams(bytes32 id) external view returns (MarketParams memory);
    function market(bytes32 id) external view returns (Market memory);
    function position(bytes32 id, address user) external view returns (Position memory);
}

interface IIrm {
    function borrowRateView(IMorpho.MarketParams memory marketParams, IMorpho.Market memory market) external view returns (uint256);
}

/**
 * @title MorphoDebtLens
 * @notice Calculate real-time debt on Morpho Blue without external library dependencies.
 */
contract DebtLens {
    // Constant for WAD math (18 decimals)
    uint256 internal constant WAD = 1e18;

    // Morpho Blue Mainnet Address (Works for Base and Optimism too if address is the same)
    // Check Morpho docs if you are on a different chain.
    address public constant MORPHO_ADDRESS = 0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb;

    function getAccruedDebt(bytes32 marketId, address user) external view returns (uint256) {
        IMorpho morpho = IMorpho(MORPHO_ADDRESS);
        
        // 1. Fetch data from Morpho Blue
        IMorpho.MarketParams memory params = morpho.idToMarketParams(marketId);
        IMorpho.Market memory market = morpho.market(marketId);
        IMorpho.Position memory pos = morpho.position(marketId, user);

        if (pos.borrowShares == 0) return 0;

        // 2. Simulate interest accrual since last update
        uint256 elapsed = block.timestamp - uint256(market.lastUpdate);
        uint256 currentTotalBorrowAssets = uint256(market.totalBorrowAssets);

        if (elapsed > 0 && currentTotalBorrowAssets > 0 && params.irm != address(0)) {
            // Get the annual rate from the Interest Rate Model
            uint256 borrowRate = IIrm(params.irm).borrowRateView(params, market);
            
            // Calculate compounding interest using Taylor expansion
            uint256 interest = (currentTotalBorrowAssets * _wTaylorCompounded(borrowRate, elapsed)) / WAD;
            currentTotalBorrowAssets += interest;
        }

        // 3. Convert user shares to assets (Rounding UP for debt)
        // Formula: (shares * totalAssets) / totalShares (rounded up)
        uint256 totalBorrowShares = uint256(market.totalBorrowShares);
        return (pos.borrowShares * currentTotalBorrowAssets + totalBorrowShares - 1) / totalBorrowShares;
    }

    /**
     * @notice Calculate only the accrued interest for a user's position
     * @param marketId The unique identifier of the market
     * @param user The user's address
     * @return The accrued interest amount (in loan token units)
     */
    function getAccruedInterest(bytes32 marketId, address user) external view returns (uint256) {
        IMorpho morpho = IMorpho(MORPHO_ADDRESS);
        
        // 1. Fetch data from Morpho Blue
        IMorpho.MarketParams memory params = morpho.idToMarketParams(marketId);
        IMorpho.Market memory market = morpho.market(marketId);
        IMorpho.Position memory pos = morpho.position(marketId, user);

        if (pos.borrowShares == 0) return 0;

        // 2. Calculate principal (original borrowed amount)
        uint256 totalBorrowShares = uint256(market.totalBorrowShares);
        uint256 principal = (pos.borrowShares * uint256(market.totalBorrowAssets) + totalBorrowShares - 1) / totalBorrowShares;

        // 3. Calculate current total debt (with accrued interest)
        uint256 elapsed = block.timestamp - uint256(market.lastUpdate);
        uint256 currentTotalBorrowAssets = uint256(market.totalBorrowAssets);

        if (elapsed > 0 && currentTotalBorrowAssets > 0 && params.irm != address(0)) {
            // Get the annual rate from the Interest Rate Model
            uint256 borrowRate = IIrm(params.irm).borrowRateView(params, market);
            
            // Calculate compounding interest using Taylor expansion
            uint256 interest = (currentTotalBorrowAssets * _wTaylorCompounded(borrowRate, elapsed)) / WAD;
            currentTotalBorrowAssets += interest;
        }

        uint256 totalDebt = (pos.borrowShares * currentTotalBorrowAssets + totalBorrowShares - 1) / totalBorrowShares;

        // 4. Return accrued interest (total debt - principal)
        return totalDebt > principal ? totalDebt - principal : 0;
    }

    /**
     * @dev Morpho's Taylor expansion for e^(rate * dt) - 1
     * This is the exact math used by Morpho Blue for interest.
     */
    function _wTaylorCompounded(uint256 rate, uint256 dt) internal pure returns (uint256) {
        uint256 x = rate * dt;
        uint256 res = x;
        uint256 x2 = (x * x) / (2 * WAD);
        uint256 x3 = (x2 * x) / (3 * WAD);
        return res + x2 + x3;
    }
}