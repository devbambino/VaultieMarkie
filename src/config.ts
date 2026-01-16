/**
 * Base Sepolia Network Configuration
 * Centralized contract addresses and ABIs for the PoC
 */

export const BASE_SEPOLIA_CONFIG = {
  chainId: 84532,
  rpcUrl: process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org",
  blockExplorer: "https://sepolia.basescan.org",

  // Aave V3 Protocol
  aavePool: "0x7B4eb56E7CD4eFc5c4D044DBC3917eB21f3d5dAE", // Aave V3 Pool on Base Sepolia
  aavePoolAddressesProvider: "0x8145 dd7D7c92cDed64A766c00000BcE75fF9E7f3",
  
  // USDC Token (Base Sepolia)
  usdc: "0xba50cd2a20f6da35d788639e581bca8d0b5d4d5f",
  
  // aToken (Interest-bearing USDC from Aave)
  aUSDC: "0x10f1a9d11cdf50041f3f8cb7191cbe2f31750acc", // aBasSepLidUSDC

  // Morpho Blue V1
  morphoBlue: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb",
  
  // Morpho default IRM (permissionless)
  // This is typically a simple IRM that allows custom rates
  // For this PoC, we'll use Morpho's default or deploy our own simple one
  morphoDefaultIRM: "0x46cAcB97d52D1C1c0c3189d879fD3dAF265b2eee", // Example IRM address

  // Market parameters (to be used in createMarket)
  lltv: BigInt("770000000000000000"), // 77% as 18-decimal value (77% LLTV)
};

/**
 * Morpho Blue Market Creation Parameters
 * These are the exact parameters for the market we'll create
 */
export interface MarketParams {
  loanToken: string;       // cCOP_test (to be deployed)
  collateralToken: string; // WaUSDC (to be deployed)
  oracle: string;          // FixedPriceOracle (to be deployed)
  irm: string;             // Interest Rate Model (Morpho's default)
  lltv: bigint;            // Liquidation LTV (77%)
}

/**
 * Aave Pool Interface
 * Key function signatures for USDC supply/withdraw
 */
export const AAVE_POOL_ABI = [
  "function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external",
  "function withdraw(address asset, uint256 amount, address to) external returns (uint256)",
  "function getReserveData(address asset) external view returns (tuple(tuple(uint256,uint128,uint128,uint128,uint128,uint128,uint40,uint16,address,address,address,address,bool) configuration,uint128 liquidityIndex,uint128 currentLiquidityRate,uint128 variableBorrowIndex,uint128 currentVariableBorrowRate,uint128 currentStableBorrowRate,uint40 lastUpdateTimestamp,uint16 id,address aTokenAddress,address stableDebtTokenAddress,address variableDebtTokenAddress,address interestRateStrategyAddress,bool isActive))",
];

/**
 * ERC20 Standard Interface
 */
export const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function transfer(address to, uint256 amount) external returns (bool)",
  "function transferFrom(address from, address to, uint256 amount) external returns (bool)",
  "function balanceOf(address account) external view returns (uint256)",
  "function totalSupply() external view returns (uint256)",
  "function decimals() external view returns (uint8)",
  "function symbol() external view returns (string)",
  "function name() external view returns (string)",
];

/**
 * ERC4626 Vault Interface
 */
export const ERC4626_ABI = [
  "function deposit(uint256 assets, address receiver) external returns (uint256)",
  "function withdraw(uint256 assets, address receiver, address owner) external returns (uint256)",
  "function mint(uint256 shares, address receiver) external returns (uint256)",
  "function redeem(uint256 shares, address receiver, address owner) external returns (uint256)",
  "function totalAssets() external view returns (uint256)",
  "function convertToShares(uint256 assets) external view returns (uint256)",
  "function convertToAssets(uint256 shares) external view returns (uint256)",
  "function asset() external view returns (address)",
  "function balanceOf(address account) external view returns (uint256)",
];

/**
 * Morpho Blue Core Interface
 * Key functions for market creation and interactions
 */
export const MORPHO_BLUE_ABI = [
  // Market creation
  "function createMarket(tuple(address,address,address,address,uint256) marketParams) external",
  
  // Supply collateral
  "function supplyCollateral(tuple(address,address,address,address,uint256) marketParams, uint256 amount, address onBehalf, bytes data) external",
  
  // Withdraw collateral
  "function withdrawCollateral(tuple(address,address,address,address,uint256) marketParams, uint256 amount, address receiver) external",
  
  // Borrow
  "function borrow(tuple(address,address,address,address,uint256) marketParams, uint256 assets, uint256 shares, address onBehalf, address receiver) external returns (uint256, uint256)",
  
  // Repay
  "function repay(tuple(address,address,address,address,uint256) marketParams, uint256 assets, uint256 shares, address onBehalf, bytes data) external returns (uint256, uint256)",
  
  // View functions
  "function idToMarketParams(bytes32 id) external view returns (tuple(address,address,address,address,uint256))",
  "function market(bytes32 id) external view returns (tuple(uint128,uint128,uint32,uint32,uint32,uint160,uint128,uint128))",
  "function position(bytes32 id, address user) external view returns (tuple(uint256,uint256,uint256))",
];

/**
 * Morpho Oracle Interface
 */
export const MORPHO_ORACLE_ABI = [
  "function price() external view returns (uint256)",
];
