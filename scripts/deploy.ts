/**
 * Deployment Script for Aave + Morpho Blue PoC
 * 
 * This script deploys the three core contracts:
 * 1. MockCCOP - Mock ERC20 token for borrowing
 * 2. WaUSDC - ERC-4626 wrapper around Aave aUSDC
 * 3. FixedPriceOracle - Simple oracle for Morpho Blue
 * 
 * Run: npx hardhat run scripts/deploy.ts --network baseSepolia
 * 
 * After deployment, copy the addresses to:
 * 1. src/config.ts (update MOCK_CCOP, WA_USDC, FIXED_PRICE_ORACLE)
 * 2. .env file (optional, for convenience)
 */

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

interface DeployedAddresses {
  mockCCOP: string;
  waUSDC: string;
  fixedPriceOracle: string;
  deployer: string;
  timestamp: number;
}

async function main() {
  console.log("=".repeat(70));
  console.log("Deploying Aave + Morpho Blue PoC Contracts");
  console.log("=".repeat(70));

  // Get deployer account
  const [deployer] = await ethers.getSigners();
  console.log(`Deploying contracts from account: ${deployer.address}`);

  // Get network info
  const network = await ethers.provider.getNetwork();
  console.log(`Network: ${network.name} (Chain ID: ${network.chainId})`);
  console.log("");

  const deployedAddresses: DeployedAddresses = {
    mockCCOP: "",
    waUSDC: "",
    fixedPriceOracle: "",
    deployer: deployer.address,
    timestamp: Date.now(),
  };

  try {
    // ============================================================================
    // 1. Deploy MockCCOP
    // ============================================================================
    console.log("[1/3] Deploying MockCCOP...");
    const MockCCOP = await ethers.getContractFactory("MockCCOP");
    const mockCCOP = await MockCCOP.deploy();
    await mockCCOP.waitForDeployment();
    const mockCCOPAddress = await mockCCOP.getAddress();
    deployedAddresses.mockCCOP = mockCCOPAddress;
    console.log(`✓ MockCCOP deployed at: ${mockCCOPAddress}`);
    console.log(`  - Name: cCOP_test`);
    console.log(`  - Symbol: cCOP`);
    console.log(`  - Decimals: 6`);
    console.log("");

    // ============================================================================
    // 2. Deploy WaUSDC
    // ============================================================================
    console.log("[2/3] Deploying WaUSDC...");
    
    // Aave aUSDC address on Base Sepolia
    const AUSDC_ADDRESS = "0x10f1a9d11cdf50041f3f8cb7191cbe2f31750acc";
    
    const WaUSDC = await ethers.getContractFactory("WaUSDC");
    const waUSDC = await WaUSDC.deploy(AUSDC_ADDRESS);
    await waUSDC.waitForDeployment();
    const waUSDCAddress = await waUSDC.getAddress();
    deployedAddresses.waUSDC = waUSDCAddress;
    console.log(`✓ WaUSDC deployed at: ${waUSDCAddress}`);
    console.log(`  - Name: Wrapped Aave USDC`);
    console.log(`  - Symbol: WaUSDC`);
    console.log(`  - Decimals: 6`);
    console.log(`  - Underlying: ${AUSDC_ADDRESS}`);
    console.log("");

    // ============================================================================
    // 3. Deploy FixedPriceOracle
    // ============================================================================
    console.log("[3/3] Deploying FixedPriceOracle...");
    const FixedPriceOracle = await ethers.getContractFactory("FixedPriceOracle");
    const fixedPriceOracle = await FixedPriceOracle.deploy();
    await fixedPriceOracle.waitForDeployment();
    const oracleAddress = await fixedPriceOracle.getAddress();
    deployedAddresses.fixedPriceOracle = oracleAddress;
    console.log(`✓ FixedPriceOracle deployed at: ${oracleAddress}`);
    console.log(`  - Price: 1e36 (1 WaUSDC = 1 cCOP_test)`);
    console.log("");

    // ============================================================================
    // Summary
    // ============================================================================
    console.log("=".repeat(70));
    console.log("DEPLOYMENT COMPLETE");
    console.log("=".repeat(70));
    console.log("");
    console.log("Deployed Addresses:");
    console.log(`  MockCCOP:         ${deployedAddresses.mockCCOP}`);
    console.log(`  WaUSDC:           ${deployedAddresses.waUSDC}`);
    console.log(`  FixedPriceOracle: ${deployedAddresses.fixedPriceOracle}`);
    console.log("");
    console.log("Next Steps:");
    console.log("1. Update src/config.ts with the above addresses");
    console.log("2. Run: npx hardhat run scripts/createMarket.ts --network baseSepolia");
    console.log("");

    // ============================================================================
    // Save addresses to JSON for reference
    // ============================================================================
    const addressesFile = path.join(__dirname, "../deploy-addresses.json");
    fs.writeFileSync(addressesFile, JSON.stringify(deployedAddresses, null, 2));
    console.log(`Addresses saved to: ${addressesFile}`);
    console.log("");

  } catch (error) {
    console.error("Deployment failed:", error);
    throw error;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
