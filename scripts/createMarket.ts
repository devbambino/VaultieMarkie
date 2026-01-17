/**
 * Morpho Blue Market Creation & Vault Setup Script
 * 
 * This script performs the following:
 * 1. Creates a Morpho Blue market with the following parameters:
 *    - Loan token: MockCCOP (cCOP_test)
 *    - Collateral token: WaUSDC
 *    - Oracle: FixedPriceOracle
 *    - Interest Rate Model: Morpho's default IRM
 *    - LLTV: 77% (0.77 * 10^18)
 * 
 * 2. Creates a Morpho Vault with MockCCOP as the asset
 * 
 * 3. Sets up the vault to manage the created market with:
 *    - Supply cap (100000000 cCOP)
 *    - Supply queue configuration
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
  mockCCOP: "0x789D299321f194B47f3b72d33d0e028376277AA3", // From deploy.ts output
  waUSDC: "0x1DA5199ecaAe23F85c7fd7611703E81273041149",   // From deploy.ts output
  fixedPriceOracle: "0xa8B8bBc0A572803A9153336122EBc971DeF60672", // From deploy.ts output
};

// Morpho Blue on Base Sepolia
const MORPHO_BLUE_ADDRESS = "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb";

// Morpho Vault Factory on Base Sepolia
const VAULT_FACTORY_ADDRESS = "0x33bAFb0aEb3D76eAF65126C1Afc75cf05e6E1F5E";

// LLTV: 77% = 0.77 * 10^18
const LLTV = ethers.parseEther("0.77");

// Default IRM on Base Sepolia (commonly used simple IRM)
// For this PoC, we'll use Morpho's permissionless WhitelistableIRM
// If not available, we can use a simple custom one
const IRM_ADDRESS = "0x46cAcB97d52D1C1c0c3189d879fD3dAF265b2eee";

// Vault configuration
const VAULT_CONFIG = {
  name: "cCOP Vault",
  symbol: "vcCOP",
  initialTimelock: 0, // 0 seconds for testing, can be increased later to 86400 (1 day)
  supplyCapAmount: ethers.parseUnits("100000000", 6), // 100000000 cCOP cap
};

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

    // Vault Factory ABI
    const VAULT_FACTORY_ABI = [
      "function createVault(address asset, string memory name, string memory symbol, address owner, uint256 timelock, bytes32 salt) external returns (address)",
    ];

    // Vault ABI
    const VAULT_ABI = [
      "function submitCap(tuple(address,address,address,address,uint256) marketParams, uint256 newSupplyCap) external",
      "function acceptCap(tuple(address,address,address,address,uint256) marketParams) external",
      "function setSupplyQueue(bytes32[] newSupplyQueue) external",
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

    // ============================================================================
    // [3/3] Create Morpho Vault for cCOP_test
    // ============================================================================
    console.log("[3/3] Creating Morpho Vault for cCOP management...");

    const vaultFactory = new ethers.Contract(VAULT_FACTORY_ADDRESS, VAULT_FACTORY_ABI, deployer);

    // Use a deterministic salt for vault creation
    const vaultSalt = ethers.id("cCOP_Vault_" + Date.now());

    console.log(`Creating vault: ${VAULT_CONFIG.name} (${VAULT_CONFIG.symbol})`);
    console.log(`  Asset: ${CONTRACT_ADDRESSES.mockCCOP}`);
    console.log(`  Owner: ${deployer.address}`);
    console.log(`  Timelock: ${VAULT_CONFIG.initialTimelock} seconds`);

    const createVaultTx = await vaultFactory.createVault(
      CONTRACT_ADDRESSES.mockCCOP, // asset (mockCCOP)
      VAULT_CONFIG.name,           // name
      VAULT_CONFIG.symbol,         // symbol
      deployer.address,            // owner
      VAULT_CONFIG.initialTimelock,// timelock
      vaultSalt                    // salt
    );

    const vaultReceipt = await createVaultTx.wait();
    console.log(`✓ Vault creation transaction confirmed!`);
    console.log(`  Transaction Hash: ${vaultReceipt?.hash}`);
    console.log(`  Block Number: ${vaultReceipt?.blockNumber}`);
    console.log("");

    // Parse vault address from events
    let vaultAddress = "";
    if (vaultReceipt?.logs) {
      for (const log of vaultReceipt.logs) {
        try {
          // Look for VaultCreated event
          if (log.topics[0] === ethers.id("VaultCreated(address,string,string)")) {
            const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
              ["address", "string", "string"],
              log.data
            );
            vaultAddress = log.topics[1]?.replace("0x000000000000000000000000", "0x") || "";
            if (!vaultAddress) {
              vaultAddress = decoded[0];
            }
          }
        } catch (e) {
          // Continue parsing
        }
      }
    }

    // If we couldn't find it in logs, estimate from factory pattern
    if (!vaultAddress) {
      console.log("Note: Vault address not found in logs. Check transaction details.");
      console.log("Vault may have been created at a computed address.");
    } else {
      console.log(`✓ Vault created at: ${vaultAddress}`);
    }

    console.log("");

    // ============================================================================
    // [4/3] Configure Vault: Set Market Cap
    // ============================================================================
    console.log("[4/4] Configuring vault: Setting market supply cap...");

    if (vaultAddress) {
      const vault = new ethers.Contract(vaultAddress, VAULT_ABI, deployer);

      // Submit supply cap for the market
      console.log(
        `Submitting supply cap: ${ethers.formatUnits(VAULT_CONFIG.supplyCapAmount, 6)} cCOP`
      );

      const submitCapTx = await vault.submitCap(marketParams, VAULT_CONFIG.supplyCapAmount);
      const submitCapReceipt = await submitCapTx.wait();

      console.log(`✓ Supply cap submitted!`);
      console.log(`  Transaction Hash: ${submitCapReceipt?.hash}`);
      console.log(`  Block Number: ${submitCapReceipt?.blockNumber}`);
      console.log("");

      // Accept cap if timelock is 0 (for testing)
      if (VAULT_CONFIG.initialTimelock === 0) {
        console.log("Accepting supply cap (timelock = 0)...");
        const acceptCapTx = await vault.acceptCap(marketParams);
        const acceptCapReceipt = await acceptCapTx.wait();

        console.log(`✓ Supply cap accepted!`);
        console.log(`  Transaction Hash: ${acceptCapReceipt?.hash}`);
        console.log("");
      } else {
        console.log(`⏱️  Supply cap is pending (timelock = ${VAULT_CONFIG.initialTimelock}s)`);
        console.log("Call acceptCap() after timelock expires.");
        console.log("");
      }

      // ============================================================================
      // [5/3] Configure Vault: Set Supply Queue
      // ============================================================================
      console.log("[5/5] Configuring vault: Setting supply queue...");

      console.log(`Setting supply queue with market: ${marketId}`);
      const setQueueTx = await vault.setSupplyQueue([marketId]);
      const queueReceipt = await setQueueTx.wait();

      console.log(`✓ Supply queue configured!`);
      console.log(`  Transaction Hash: ${queueReceipt?.hash}`);
      console.log(`  Block Number: ${queueReceipt?.blockNumber}`);
      console.log("");
    }

    // ============================================================================
    // Summary
    // ============================================================================
    console.log("=".repeat(70));
    console.log("✓ MARKET & VAULT CREATION COMPLETE");
    console.log("=".repeat(70));
    console.log("");

    console.log("Market Details:");
    console.log(`  Market ID:       ${marketId}`);
    console.log(`  Loan Token:      ${CONTRACT_ADDRESSES.mockCCOP}`);
    console.log(`  Collateral:      ${CONTRACT_ADDRESSES.waUSDC}`);
    console.log(`  Oracle:          ${CONTRACT_ADDRESSES.fixedPriceOracle}`);
    console.log(`  LLTV:            77%`);
    console.log("");

    if (vaultAddress) {
      console.log("Vault Details:");
      console.log(`  Vault Address:   ${vaultAddress}`);
      console.log(`  Vault Name:      ${VAULT_CONFIG.name}`);
      console.log(`  Vault Symbol:    ${VAULT_CONFIG.symbol}`);
      console.log(`  Supply Cap:      ${ethers.formatUnits(VAULT_CONFIG.supplyCapAmount, 6)} cCOP`);
      console.log("");
    }

    console.log("Next Steps:");
    console.log("1. Update MARKET_ID in scripts/demoFlow.ts: " + marketId);
    if (vaultAddress) {
      console.log("2. Update VAULT_ADDRESS in frontend/app.js: " + vaultAddress);
    }
    console.log("3. Run: npx hardhat run scripts/demoFlow.ts --network baseSepolia");
    console.log("");

    // Save market details to JSON
    const marketDetailsFile = path.join(__dirname, "../market-details.json");
    const marketDetails = {
      marketId,
      vaultAddress: vaultAddress || "pending",
      ...marketParams,
      vaultConfig: VAULT_CONFIG,
      blockNumber: receipt?.blockNumber,
      vaultBlockNumber: vaultReceipt?.blockNumber,
      marketTransactionHash: receipt?.hash,
      vaultTransactionHash: vaultReceipt?.hash,
      timestamp: Date.now(),
    };
    fs.writeFileSync(marketDetailsFile, JSON.stringify(marketDetails, null, 2));
    console.log(`Market & vault details saved to: ${marketDetailsFile}`);
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
