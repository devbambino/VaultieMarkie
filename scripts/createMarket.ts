/**
 * Morpho Blue Market Creation Script
 * 
 * This script creates a Morpho Blue market with the following parameters:
 * - Loan token: MockCCOP (cCOP_test)
 * - Collateral token: WaUSDC
 * - Oracle: FixedPriceOracle
 * - Interest Rate Model: Morpho's default IRM
 * - LLTV: 77% (0.77 * 10^18)
 * 
 * Prerequisites:
 * 1. Deploy contracts first: npx hardhat run scripts/deploy.ts --network baseSepolia
 * 2. Update the CONTRACT_ADDRESSES below with deployed contract addresses
 * 
 * Run: npx hardhat run scripts/createMarket.ts --network baseSepolia
 */

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// ============================================================================
// UPDATE THESE ADDRESSES AFTER DEPLOYMENT
// ============================================================================
const CONTRACT_ADDRESSES = {
  mockCCOP: "0x", // From deploy.ts output
  waUSDC: "0x",   // From deploy.ts output
  fixedPriceOracle: "0x", // From deploy.ts output
};

// Morpho Blue on Base Sepolia
const MORPHO_BLUE_ADDRESS = "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb";

// LLTV: 77% = 0.77 * 10^18
const LLTV = ethers.parseEther("0.77");

// Default IRM on Base Sepolia (commonly used simple IRM)
// For this PoC, we'll use Morpho's permissionless WhitelistableIRM
// If not available, we can use a simple custom one
const IRM_ADDRESS = "0x46cAcB97d52D1C1c0c3189d879fD3dAF265b2eee";

/**
 * Morpho Blue Market struct
 */
interface MarketParams {
  loanToken: string;
  collateralToken: string;
  oracle: string;
  irm: string;
  lltv: bigint;
}

/**
 * Encode market parameters as Morpho Blue expects
 * This matches the struct encoding for MarketParams
 */
function encodeMarketParams(params: MarketParams): string {
  return ethers.AbiCoder.defaultAbiCoder().encode(
    ["tuple(address,address,address,address,uint256)"],
    [[params.loanToken, params.collateralToken, params.oracle, params.irm, params.lltv]]
  );
}

/**
 * Calculate market ID (Morpho uses hash of params as ID)
 */
function getMarketId(params: MarketParams): string {
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ["tuple(address,address,address,address,uint256)"],
    [[params.loanToken, params.collateralToken, params.oracle, params.irm, params.lltv]]
  );
  return ethers.keccak256(encoded);
}

async function main() {
  console.log("=".repeat(70));
  console.log("Creating Morpho Blue Market");
  console.log("=".repeat(70));

  // Get deployer account
  const [deployer] = await ethers.getSigners();
  console.log(`Sender: ${deployer.address}`);
  console.log("");

  // Verify contract addresses are set
  if (!CONTRACT_ADDRESSES.mockCCOP.startsWith("0x") || CONTRACT_ADDRESSES.mockCCOP === "0x") {
    throw new Error("ERROR: mockCCOP address not set in CONTRACT_ADDRESSES. Update it from deploy.ts output.");
  }
  if (!CONTRACT_ADDRESSES.waUSDC.startsWith("0x") || CONTRACT_ADDRESSES.waUSDC === "0x") {
    throw new Error("ERROR: waUSDC address not set in CONTRACT_ADDRESSES. Update it from deploy.ts output.");
  }
  if (!CONTRACT_ADDRESSES.fixedPriceOracle.startsWith("0x") || CONTRACT_ADDRESSES.fixedPriceOracle === "0x") {
    throw new Error("ERROR: fixedPriceOracle address not set in CONTRACT_ADDRESSES. Update it from deploy.ts output.");
  }

  try {
    console.log("Market Parameters:");
    console.log(`  Loan Token:      ${CONTRACT_ADDRESSES.mockCCOP}`);
    console.log(`  Collateral:      ${CONTRACT_ADDRESSES.waUSDC}`);
    console.log(`  Oracle:          ${CONTRACT_ADDRESSES.fixedPriceOracle}`);
    console.log(`  IRM:             ${IRM_ADDRESS}`);
    console.log(`  LLTV:            77% (${LLTV.toString()})`);
    console.log("");

    // Create market params object
    const marketParams: MarketParams = {
      loanToken: CONTRACT_ADDRESSES.mockCCOP,
      collateralToken: CONTRACT_ADDRESSES.waUSDC,
      oracle: CONTRACT_ADDRESSES.fixedPriceOracle,
      irm: IRM_ADDRESS,
      lltv: LLTV,
    };

    // Calculate market ID
    const marketId = getMarketId(marketParams);
    console.log(`Calculated Market ID: ${marketId}`);
    console.log("");

    // Get Morpho Blue contract
    const MORPHO_ABI = [
      "function createMarket(tuple(address,address,address,address,uint256) marketParams) external",
      "function idToMarketParams(bytes32 id) external view returns (tuple(address,address,address,address,uint256))",
      "function market(bytes32 id) external view returns (tuple(uint128,uint128,uint32,uint32,uint32,uint160,uint128,uint128))",
    ];

    const morpho = new ethers.Contract(MORPHO_BLUE_ADDRESS, MORPHO_ABI, deployer);

    console.log("[1/2] Checking if market already exists...");
    try {
      const existingParams = await morpho.idToMarketParams(marketId);
      if (existingParams.loanToken !== ethers.ZeroAddress) {
        console.log("✓ Market already exists! Details:");
        console.log(`  Loan Token:  ${existingParams.loanToken}`);
        console.log(`  Collateral:  ${existingParams.collateralToken}`);
        console.log(`  Oracle:      ${existingParams.oracle}`);
        console.log(`  IRM:         ${existingParams.irm}`);
        console.log(`  LLTV:        ${existingParams.lltv.toString()}`);
        console.log("");
        return;
      }
    } catch (e) {
      // Market doesn't exist yet, continue with creation
    }

    console.log("[2/2] Creating market on Morpho Blue...");
    const tx = await morpho.createMarket(marketParams);
    const receipt = await tx.wait();
    
    console.log(`✓ Market creation transaction confirmed!`);
    console.log(`  Transaction Hash: ${receipt?.hash}`);
    console.log(`  Block Number: ${receipt?.blockNumber}`);
    console.log(`  Gas Used: ${receipt?.gasUsed}`);
    console.log("");

    // Verify market was created
    console.log("Verifying market creation...");
    const marketData = await morpho.market(marketId);
    console.log("✓ Market verified on chain:");
    console.log(`  Market ID: ${marketId}`);
    console.log(`  Total Supply Shares: ${marketData[0]}`);
    console.log(`  Total Borrow Shares: ${marketData[1]}`);
    console.log("");

    // ============================================================================
    // Summary
    // ============================================================================
    console.log("=".repeat(70));
    console.log("MARKET CREATION COMPLETE");
    console.log("=".repeat(70));
    console.log("");
    console.log("Market Details:");
    console.log(`  Market ID:       ${marketId}`);
    console.log(`  Loan Token:      ${CONTRACT_ADDRESSES.mockCCOP}`);
    console.log(`  Collateral:      ${CONTRACT_ADDRESSES.waUSDC}`);
    console.log(`  Oracle:          ${CONTRACT_ADDRESSES.fixedPriceOracle}`);
    console.log(`  LLTV:            77%`);
    console.log("");
    console.log("Next Steps:");
    console.log("1. Update MARKET_ID in scripts/demoFlow.ts");
    console.log("2. Run: npx hardhat run scripts/demoFlow.ts --network baseSepolia");
    console.log("");

    // Save market details to JSON
    const marketDetailsFile = path.join(__dirname, "../market-details.json");
    const marketDetails = {
      marketId,
      ...marketParams,
      blockNumber: receipt?.blockNumber,
      transactionHash: receipt?.hash,
      timestamp: Date.now(),
    };
    fs.writeFileSync(marketDetailsFile, JSON.stringify(marketDetails, null, 2));
    console.log(`Market details saved to: ${marketDetailsFile}`);
    console.log("");

  } catch (error) {
    console.error("Market creation failed:", error);
    throw error;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
