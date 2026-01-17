/**
 * Mint & Supply Script
 * 
 * This script performs the following:
 * 1. Mint 100 MockCCOP tokens to the deployer (as the owner)
 * 2. Approve MockCCOP to Morpho Blue
 * 3. Supply MockCCOP to Morpho Blue market as liquidity
 * 
 * Prerequisites:
 * 1. npx hardhat run scripts/deploy.ts --network baseSepolia
 * 2. npx hardhat run scripts/createMarket.ts --network baseSepolia
 * 
 * Run: npx hardhat run scripts/mintAndSupply.ts --network baseSepolia
 */

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// ============================================================================
// CONFIGURATION
// ============================================================================
const CONTRACT_ADDRESSES = {
  mockCCOP: "0x789D299321f194B47f3b72d33d0e028376277AA3", // From deploy.ts output
};

// Morpho Blue on Base Sepolia
const MORPHO_BLUE_ADDRESS = "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb";

// Amount to mint (100 cCOP with 6 decimals)
const MINT_AMOUNT = ethers.parseUnits("100", 6);

// Supply to Morpho
const SUPPLY_AMOUNT = ethers.parseUnits("100", 6);

// Load market details from previous script
let MARKET_ID: string;
let marketParams: any;

try {
  const marketDetailsPath = path.join(__dirname, "../market-details.json");
  const marketDetails = JSON.parse(fs.readFileSync(marketDetailsPath, "utf-8"));
  MARKET_ID = marketDetails.marketId;
  marketParams = {
    loanToken: marketDetails.loanToken,
    collateralToken: marketDetails.collateralToken,
    oracle: marketDetails.oracle,
    irm: marketDetails.irm,
    lltv: BigInt(marketDetails.lltv),
  };
  console.log(`✓ Loaded market details from market-details.json`);
  console.log(`  Market ID: ${MARKET_ID}`);
} catch (error) {
  throw new Error(
    "Could not load market details. Make sure to run createMarket.ts first.\n" +
    "Run: npx hardhat run scripts/createMarket.ts --network baseSepolia"
  );
}

async function main() {
  console.log("=".repeat(70));
  console.log("Mint & Supply MockCCOP to Morpho Blue");
  console.log("=".repeat(70));
  console.log("");

  // Get deployer account
  const [deployer] = await ethers.getSigners();
  console.log(`Deployer: ${deployer.address}`);
  console.log("");

  try {
    // ========================================================================
    // [1/3] Mint MockCCOP
    // ========================================================================
    console.log("[1/3] Minting MockCCOP tokens...");
    
    const MOCK_CCOP_ABI = [
      "function mint(address to, uint256 amount) external",
      "function balanceOf(address account) external view returns (uint256)",
      "function decimals() external view returns (uint8)",
    ];

    const mockCCOP = new ethers.Contract(CONTRACT_ADDRESSES.mockCCOP, MOCK_CCOP_ABI, deployer);

    console.log(`Minting ${ethers.formatUnits(MINT_AMOUNT, 6)} cCOP to ${deployer.address}...`);
    const mintTx = await mockCCOP.mint(deployer.address, MINT_AMOUNT);
    const mintReceipt = await mintTx.wait();

    console.log(`✓ Mint transaction confirmed!`);
    console.log(`  Transaction Hash: ${mintReceipt?.hash}`);
    console.log(`  Block Number: ${mintReceipt?.blockNumber}`);
    console.log(`  Gas Used: ${mintReceipt?.gasUsed}`);
    console.log("");

    // Verify balance
    const balance = await mockCCOP.balanceOf(deployer.address);
    console.log(`✓ MockCCOP Balance: ${ethers.formatUnits(balance, 6)} cCOP`);
    console.log("");

    // ========================================================================
    // [2/3] Approve MockCCOP to Morpho Blue
    // ========================================================================
    console.log("[2/3] Approving MockCCOP for Morpho Blue...");

    const ERC20_ABI = [
      "function approve(address spender, uint256 amount) external returns (bool)",
    ];

    const mockCCOPERC20 = new ethers.Contract(CONTRACT_ADDRESSES.mockCCOP, ERC20_ABI, deployer);

    console.log(`Approving ${ethers.formatUnits(SUPPLY_AMOUNT, 6)} cCOP to Morpho Blue...`);
    const approveTx = await mockCCOPERC20.approve(MORPHO_BLUE_ADDRESS, SUPPLY_AMOUNT);
    const approveReceipt = await approveTx.wait();

    console.log(`✓ Approval transaction confirmed!`);
    console.log(`  Transaction Hash: ${approveReceipt?.hash}`);
    console.log(`  Block Number: ${approveReceipt?.blockNumber}`);
    console.log("");

    // ========================================================================
    // [3/3] Supply MockCCOP to Morpho Blue
    // ========================================================================
    console.log("[3/3] Supplying MockCCOP to Morpho Blue market...");

    const MORPHO_ABI = [
      "function supply(tuple(address loanToken,address collateralToken,address oracle,address irm,uint256 lltv) marketParams, uint256 assets, uint256 shares, address onBehalf, bytes data) external returns (uint256, uint256)",
      "function market(bytes32 id) external view returns (tuple(uint128 totalSupplyAssets,uint128 totalBorrowAssets,uint32 lastUpdate,uint32 fee,uint32 timelock,uint160 totalSupplyShares,uint128 totalBorrowShares,uint128 virtualBorrowAssetsAndFees))",
    ];

    const morpho = new ethers.Contract(MORPHO_BLUE_ADDRESS, MORPHO_ABI, deployer);

    console.log(`Supplying ${ethers.formatUnits(SUPPLY_AMOUNT, 6)} cCOP to market...`);
    console.log(`Market ID: ${MARKET_ID}`);
    console.log(`Market Parameters:`);
    console.log(`  Loan Token: ${marketParams.loanToken}`);
    console.log(`  Collateral: ${marketParams.collateralToken}`);
    console.log(`  Oracle: ${marketParams.oracle}`);
    console.log(`  IRM: ${marketParams.irm}`);
    console.log("");

    const supplyTx = await morpho.supply(
      marketParams,
      SUPPLY_AMOUNT,  // assets
      0,              // shares (0 to specify assets instead)
      deployer.address, // onBehalf
      "0x"            // data (empty)
    );

    const supplyReceipt = await supplyTx.wait();

    console.log(`✓ Supply transaction confirmed!`);
    console.log(`  Transaction Hash: ${supplyReceipt?.hash}`);
    console.log(`  Block Number: ${supplyReceipt?.blockNumber}`);
    console.log(`  Gas Used: ${supplyReceipt?.gasUsed}`);
    console.log("");

    // Verify supply
    console.log("Verifying supply in market...");
    try {
      const marketData = await morpho.market(MARKET_ID);
      console.log(`✓ Market state verified:`);
      console.log(`  Total Supply Assets: ${marketData[0]}`);
      console.log(`  Total Borrow Assets: ${marketData[1]}`);
    } catch (e) {
      console.log("  (Could not retrieve detailed market data, but transaction was confirmed)");
    }
    console.log("");

    // ========================================================================
    // Summary
    // ========================================================================
    console.log("=".repeat(70));
    console.log("✓ MINT & SUPPLY COMPLETE");
    console.log("=".repeat(70));
    console.log("");
    console.log("Summary:");
    console.log(`  ✓ Minted: ${ethers.formatUnits(MINT_AMOUNT, 6)} cCOP`);
    console.log(`  ✓ Supplied: ${ethers.formatUnits(SUPPLY_AMOUNT, 6)} cCOP to Morpho Blue`);
    console.log(`  ✓ Market ID: ${MARKET_ID}`);
    console.log("");
    console.log("Next Steps:");
    console.log("1. Use the supplied cCOP as liquidity for borrowers");
    console.log("2. Monitor market positions and earn interest");
    console.log("3. Run: npx hardhat run scripts/demoFlow.ts --network baseSepolia");
    console.log("");

  } catch (error) {
    console.error("Mint & Supply failed:", error);
    throw error;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
