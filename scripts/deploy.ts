/**
 * Deployment Script for Aave + Morpho Blue PoC
 * 
 * This script deploys the three core contracts:
 * 1. MockCCOP - Mock ERC20 token for borrowing
 * 2. WaUSDC - ERC-4626 wrapper around Aave aUSDC
 * 3. FixedPriceOracle - Simple oracle for Morpho Blue
 * 
 * Run: npm run deploy
 * npx hardhat run scripts/deploy.ts --network baseSepolia
 * 
 * After deployment, copy the addresses to:
 * 1. src/config.ts (update MOCK_CCOP, WA_USDC, FIXED_PRICE_ORACLE)
 * 2. .env file (optional, for convenience)
 */

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

interface DeployedAddresses {
  mockMXNB: string;
  mockWETH: string;
  wmUSDC: string;
  wmusdcMxnbOracle: string;
  ethUsdcOracle: string;
  deployer: string;
  timestamp: number;
}

async function main() {
  console.log("=".repeat(70));
  console.log("Deploying Morpho Blue PoC Contracts");
  console.log("=".repeat(70));

  // Get deployer account
  const [deployer] = await ethers.getSigners();
  console.log(`Deploying contracts from account: ${deployer.address}`);

  // Get network info
  const network = await ethers.provider.getNetwork();
  console.log(`Network: ${network.name} (Chain ID: ${network.chainId})`);
  console.log("");

  const deployedAddresses: DeployedAddresses = {
    mockMXNB: "",
    mockWETH: "",
    wmUSDC: "",
    wmusdcMxnbOracle: "",
    ethUsdcOracle: "",
    deployer: deployer.address,
    timestamp: Date.now(),
  };

  try {

    // ============================================================================
    // 1. Prerequisites
    // ============================================================================

    let isDeployingETH = false;
    if (isDeployingETH) {
      console.log("[1/3] Deploying MockWETH...");
      const MockWETH = await ethers.getContractFactory("MockWETH");
      const mockWETH = await MockWETH.deploy();
      await mockWETH.waitForDeployment();
      const mockWETHAddress = await mockWETH.getAddress();
      deployedAddresses.mockWETH = mockWETHAddress;
      console.log(`✓ mockWETH deployed at: ${mockWETHAddress}`);
      console.log(`  - Name: wETH_test`);
      console.log(`  - Symbol: wETH`);
      console.log(`  - Decimals: 18`);
      console.log("");
    }

    let isDeployingETHusdOracle = true;
    if (isDeployingETHusdOracle) {
      console.log("[2/3] Deploying ethUsdcOracle...");
      const EthUsdcOracle = await ethers.getContractFactory("EthUsdcOracle");
      const ethUsdcOracle = await EthUsdcOracle.deploy();
      await ethUsdcOracle.waitForDeployment();
      const oracle1Address = await ethUsdcOracle.getAddress();
      deployedAddresses.ethUsdcOracle = oracle1Address;
      console.log(`✓ EthUsdcOracle deployed at: ${oracle1Address}`);
      console.log(`  - Price: 2100 * 1e33 (1 WETH = 2100 WETH_test)`);
      console.log("");
    }


    // ============================================================================
    // 1. Deploy MockMXNB
    // ============================================================================
    let isDeployingMXNB = false;
    if (isDeployingMXNB) {
      console.log("[3/3] Deploying MockMXNB...");
      const MockMXNB = await ethers.getContractFactory("MockMXNB");
      const mockMXNB = await MockMXNB.deploy();
      await mockMXNB.waitForDeployment();
      const mockMXNBAddress = await mockMXNB.getAddress();
      deployedAddresses.mockMXNB = mockMXNBAddress;
      console.log(`✓ MockMXNB deployed at: ${mockMXNBAddress}`);
      console.log(`  - Name: MXNB_test`);
      console.log(`  - Symbol: MXNB`);
      console.log(`  - Decimals: 6`);
      console.log("");
    }

    // ============================================================================
    // 2. Deploy WmUSDC
    // ============================================================================
    let isDeployingWmUSDC = false;
    if (isDeployingWmUSDC) {
      console.log("[2/3] Deploying WmUSDC...");

      // Morpho USDC Vault mUSDC address on Base Sepolia
      const MUSDC_ADDRESS = "0xA694354Ab641DFB8C6fC47Ceb9223D12cCC373f9";

      const WmUSDC = await ethers.getContractFactory("WmUSDC");
      const wmUSDC = await WmUSDC.deploy(MUSDC_ADDRESS);
      await wmUSDC.waitForDeployment();
      const wmUSDCAddress = await wmUSDC.getAddress();
      deployedAddresses.wmUSDC = wmUSDCAddress;
      console.log(`✓ WmUSDC deployed at: ${wmUSDCAddress}`);
      console.log(`  - Name: Wrapped Morpho USDC`);
      console.log(`  - Symbol: WmUSDC`);
      console.log(`  - Decimals: 18`);
      console.log(`  - Underlying: ${MUSDC_ADDRESS}`);
      console.log("");
    }


    // ============================================================================
    // 3. Deploy WmusdcMxnbOracle
    // ============================================================================
    let isDeployingWmusdcMxnbOracle = true;
    if (isDeployingWmusdcMxnbOracle) {
      console.log("[3/3] Deploying WmusdcMxnbOracle...");
      const FixedPriceOracle = await ethers.getContractFactory("WmusdcMxnbOracle");
      const fixedPriceOracle = await FixedPriceOracle.deploy();
      await fixedPriceOracle.waitForDeployment();
      const oracleAddress = await fixedPriceOracle.getAddress();
      deployedAddresses.wmusdcMxnbOracle = oracleAddress;
      console.log(`✓ FixedPriceOracle deployed at: ${oracleAddress}`);
      console.log(`  - Price: 1e48 (1 WmUSDC = 1 MXNB_test)`);
      console.log("");
    }


    // ============================================================================
    // Summary
    // ============================================================================
    console.log("=".repeat(70));
    console.log("DEPLOYMENT COMPLETE");
    console.log("=".repeat(70));
    console.log("");
    console.log("Deployed Addresses:");
    console.log(`  MockMXNB         ${deployedAddresses.mockMXNB}`);
    console.log(`  WmUSDC:           ${deployedAddresses.wmUSDC}`);
    console.log(`  WmusdcMxnbOracle: ${deployedAddresses.wmusdcMxnbOracle}`);
    console.log("");
    console.log("Next Steps:");
    console.log("1. Update src/config.ts with the above addresses");
    console.log("2. Run: npx hardhat run scripts/createMarket.ts --network baseSepolia");
    console.log("");

    // ============================================================================
    // Save addresses to JSON for reference
    // ============================================================================
    const addressesFile = path.join(__dirname, "../deploy-addresses-mor.json");
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
