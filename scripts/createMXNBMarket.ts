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
  mockMXNB: "0xF19D2F986DC0fb7E2A82cb9b55f7676967F7bC3E", // From deploy.ts output
  wmUSDC: "0xCa4625EA7F3363d7E9e3090f9a293b64229FE55B",   // From deploy.ts output
  fixedPriceOracle: "0x9f4b138BF3513866153Af9f0A2794096DFebFaD4",//"0x3fC166B4eC635B1bddcD04AfaB1a012Ac7c4105E", // From deploy.ts output
  vaultAddress: "0xd6a83595b11CCC94bCcde4c9654bcaa6D423896e",
};

// Morpho Blue on Base Sepolia
const MORPHO_BLUE_ADDRESS = "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb";

// Morpho Vault Factory on Base Sepolia
const VAULT_FACTORY_ADDRESS = "0x2c3FE6D71F8d54B063411Abb446B49f13725F784";

// LLTV: 77% = 0.77 * 10^18
const LLTV = ethers.parseEther("0.77");

// Default IRM on Base Sepolia
// Source: https://docs.morpho.org/get-started/resources/addresses
const IRM_ADDRESS = "0x46415998764C29aB2a25CbeA6254146D50D22687";

// Vault configuration
const VAULT_CONFIG = {
  name: "Morpho MXNB Vault",
  symbol: "vMXNB",
  initialTimelock: 0, // 0 seconds for testing, can be increased later to 86400 (1 day)
  supplyCapAmount: ethers.parseUnits("100000000", 6), // 100000000 MXNB cap
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
  if (!CONTRACT_ADDRESSES.mockMXNB.startsWith("0x") || CONTRACT_ADDRESSES.mockMXNB === "0x") {
    throw new Error("ERROR: mockMXNB address not set in CONTRACT_ADDRESSES. Update it from deploy.ts output.");
  }
  if (!CONTRACT_ADDRESSES.wmUSDC.startsWith("0x") || CONTRACT_ADDRESSES.wmUSDC === "0x") {
    throw new Error("ERROR: wmUSDC address not set in CONTRACT_ADDRESSES. Update it from deploy.ts output.");
  }
  if (!CONTRACT_ADDRESSES.fixedPriceOracle.startsWith("0x") || CONTRACT_ADDRESSES.fixedPriceOracle === "0x") {
    throw new Error("ERROR: fixedPriceOracle address not set in CONTRACT_ADDRESSES. Update it from deploy.ts output.");
  }

  try {
    console.log("Market Parameters:");
    console.log(`  Loan Token:      ${CONTRACT_ADDRESSES.mockMXNB}`);
    console.log(`  Collateral:      ${CONTRACT_ADDRESSES.wmUSDC}`);
    console.log(`  Oracle:          ${CONTRACT_ADDRESSES.fixedPriceOracle}`);
    console.log(`  IRM:             ${IRM_ADDRESS}`);
    console.log(`  LLTV:            77% (${LLTV.toString()})`);
    console.log("");

    // Create market params object with normalized addresses
    const marketParams: MarketParams = {
      loanToken: ethers.getAddress(CONTRACT_ADDRESSES.mockMXNB),
      collateralToken: ethers.getAddress(CONTRACT_ADDRESSES.wmUSDC),
      oracle: ethers.getAddress(CONTRACT_ADDRESSES.fixedPriceOracle),
      irm: ethers.getAddress(IRM_ADDRESS),
      lltv: LLTV,
    };

    // Calculate market ID
    const marketId = getMarketId(marketParams);
    console.log(`Calculated Market ID: ${marketId}`);
    console.log("");

    // Get Morpho Blue contract
    const MORPHO_ABI = [
      "function createMarket(tuple(address loanToken,address collateralToken,address oracle,address irm,uint256 lltv) marketParams) external",
      "function idToMarketParams(bytes32 id) external view returns (tuple(address loanToken,address collateralToken,address oracle,address irm,uint256 lltv))",
      "function market(bytes32 id) external view returns (tuple(uint128 totalSupplyAssets,uint128 totalBorrowAssets,uint32 lastUpdate,uint32 fee,uint32 timelock,uint160 totalSupplyShares,uint128 totalBorrowShares,uint128 virtualBorrowAssetsAndFees))",
    ];

    // Vault Factory ABI - MetaMorphoV1_1Factory
    const VAULT_FACTORY_ABI = [
      "function createMetaMorpho(address initialOwner, uint256 initialTimelock, address asset, string memory name, string memory symbol, bytes32 salt) external returns (address)",
    ];

    // Vault ABI
    const VAULT_ABI = [
      "function submitCap(tuple(address loanToken,address collateralToken,address oracle,address irm,uint256 lltv) marketParams, uint256 newSupplyCap) external",
      "function acceptCap(tuple(address loanToken,address collateralToken,address oracle,address irm,uint256 lltv) marketParams) external",
      "function setSupplyQueue(bytes32[] newSupplyQueue) external",
      "function supplyQueueLength() external view returns (uint256)",
      "function setIsAllocator(address allocator, bool isAllocator) external",
    ];

    const morpho = new ethers.Contract(MORPHO_BLUE_ADDRESS, MORPHO_ABI, deployer);

    console.log("[1/2] Checking if market already exists...");
    let marketExists = false;
    let receipt: any = null;
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
        marketExists = true;
      }
    } catch (e) {
      // Market doesn't exist yet, continue with creation
    }

    if (!marketExists) {
      console.log("[2/2] Creating market on Morpho Blue...");
      const tx = await morpho.createMarket(marketParams);
      receipt = await tx.wait();

      console.log(`✓ Market creation transaction confirmed!`);
      console.log(`  Transaction Hash: ${receipt?.hash}`);
      console.log(`  Block Number: ${receipt?.blockNumber}`);
      console.log(`  Gas Used: ${receipt?.gasUsed}`);
      console.log("");

      // Verify market was created
      console.log("Verifying market creation...");
      try {
        const marketData = await morpho.market(marketId);
        console.log("✓ Market verified on chain:");
        console.log(`  Market ID: ${marketId}`);
        console.log(`  Market data: ${JSON.stringify(marketData)}`);
      } catch (e) {
        console.log("✓ Market created successfully!");
        console.log(`  Market ID: ${marketId}`);
        console.log("  (Note: Could not verify full market data, but transaction was confirmed)");
      }
      console.log("");
    }

    // ============================================================================
    // Summary
    // ============================================================================
    console.log("=".repeat(70));
    console.log("MARKET CREATION COMPLETE");
    console.log("=".repeat(70));
    console.log("");


    let isCreatingVault = false;
    let vaultAddress = "";
    const vaultFactory = new ethers.Contract(VAULT_FACTORY_ADDRESS, VAULT_FACTORY_ABI, deployer);
    if (isCreatingVault) {
      // ============================================================================
      // [3/3] Create Morpho Vault for MXNB_test
      // ============================================================================
      console.log("[3/3] Creating Morpho Vault for MXNB management...");


      // Use a deterministic salt for vault creation
      const vaultSalt = ethers.id("MXNB_Vault_" + Date.now());
      let vaultReceipt: any = null;

      console.log(`Creating vault: ${VAULT_CONFIG.name} (${VAULT_CONFIG.symbol})`);
      console.log(`  Asset: ${CONTRACT_ADDRESSES.mockMXNB}`);
      console.log(`  Owner: ${deployer.address}`);
      console.log(`  Timelock: ${VAULT_CONFIG.initialTimelock} seconds`);
      console.log(`  Vault Factory: ${VAULT_FACTORY_ADDRESS}`);
      console.log(`  Salt: ${vaultSalt}`);

      try {
        const createVaultTx = await vaultFactory.createMetaMorpho(
          deployer.address,             // initialOwner
          VAULT_CONFIG.initialTimelock, // initialTimelock
          CONTRACT_ADDRESSES.mockMXNB,  // asset (mockMXNB)
          VAULT_CONFIG.name,            // name
          VAULT_CONFIG.symbol,          // symbol
          vaultSalt                     // salt
        );

        vaultReceipt = await createVaultTx.wait();
        console.log(`✓ Vault creation transaction confirmed!`);
        console.log(`  Transaction Hash: ${vaultReceipt?.hash}`);
        console.log(`  Block Number: ${vaultReceipt?.blockNumber}`);
        console.log("");

        // Parse vault address from return value in logs using the factory ABI
        const FACTORY_EVENT_ABI = [
          "event CreateMetaMorpho(address indexed metaMorpho, address indexed caller, address initialOwner, uint256 initialTimelock, address indexed asset, string name, string symbol, bytes32 salt)",
        ];
        const iface = new ethers.Interface(FACTORY_EVENT_ABI);

        if (vaultReceipt?.logs) {
          for (const log of vaultReceipt.logs) {
            try {
              // Try to parse using the factory interface
              const parsed = iface.parseLog(log);
              if (parsed && parsed.name === "CreateMetaMorpho") {
                vaultAddress = parsed.args[0]; // metaMorpho address is first indexed param
                break;
              }
            } catch (e) {
              // Continue parsing
            }
          }
        }

        // If we still couldn't find it, try a different approach
        if (!vaultAddress) {
          console.log("Note: Vault address not found in logs directly, attempting alternative detection...");
          // Log all topics for debugging
          if (vaultReceipt?.logs && vaultReceipt.logs.length > 0) {
            console.log(`Received ${vaultReceipt.logs.length} logs from transaction`);
            for (let i = 0; i < Math.min(3, vaultReceipt.logs.length); i++) {
              console.log(`  Log ${i}: topic[0] = ${vaultReceipt.logs[i].topics[0]}`);
            }
          }
        } else {
          console.log(`✓ Vault created at: ${vaultAddress}`);
        }

        console.log("");
      } catch (error: any) {
        console.error("Vault creation failed:", error?.message || error);
        if (error?.data) {
          console.error("Error data:", error.data);
        }
        console.log("Skipping vault configuration steps.");
        console.log("");
      }

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
          try {
            const acceptCapTx = await vault.acceptCap(marketParams);
            const acceptCapReceipt = await acceptCapTx.wait();

            console.log(`✓ Supply cap accepted!`);
            console.log(`  Transaction Hash: ${acceptCapReceipt?.hash}`);
            console.log("");
          } catch (e: any) {
            // If accept fails, the cap was probably already accepted or there's an issue
            console.log("⚠️  Could not accept cap immediately (cap submission may have already set it)");
            console.log(`  Error: ${e.message?.substring(0, 100)}`);
            console.log("");
          }
        } else {
          console.log(`⏱️  Supply cap is pending (timelock = ${VAULT_CONFIG.initialTimelock}s)`);
          console.log("Call acceptCap() after timelock expires.");
          console.log("");
        }

        // ============================================================================
        // [5/3] Configure Vault: Accept Cap
        // ============================================================================
        console.log("[5/3] Configure Vault:  Call acceptCap()...");
        console.log("Call acceptCap() with the market parameters to accept the pending supply cap");

        // ============================================================================
        // [5/3] Configure Vault: Set Supply Queue
        // ============================================================================
        console.log("[5/3] Configure Vault:  Call setSupplyQueue()...");
        console.log("Call setSupplyQueue() with the market ID to set the supply queue");

        // ============================================================================
        // [5/3] Configure Vault: Set Allocator
        // ============================================================================
        console.log("[5/5] Configuring vault: Setting allocator...");

        // First, set deployer as allocator so they can set the supply queue
        console.log("Setting deployer as allocator...");
        try {
          const setAllocatorTx = await vault.setIsAllocator(deployer.address, true);
          await setAllocatorTx.wait();
          console.log("✓ Deployer set as allocator");
        } catch (e: any) {
          console.log("⚠️  Could not set deployer as allocator");
          throw new Error("Failed to set allocator role. Make sure the deployer is the vault owner.");
        }
        console.log("");

        console.log(`Setting supply queue with market: ${marketId}`);
        try {
          // Try to set supply queue - this requires the market to have cap > 0
          // If it fails due to zero cap, we'll skip it (user can set it manually later)
          try {
            const setQueueTx = await vault.setSupplyQueue([marketId]);
            const queueReceipt = await setQueueTx.wait();

            console.log(`✓ Supply queue configured!`);
            console.log(`  Transaction Hash: ${queueReceipt?.hash}`);
            console.log(`  Block Number: ${queueReceipt?.blockNumber}`);

            // Verify queue was set
            const queueLength = await vault.supplyQueueLength();
            console.log(`✓ Verified: Supply queue length = ${queueLength}`);
          } catch (e: any) {
            const errorMsg = e.message || "";
            if (errorMsg.includes("UnauthorizedMarket")) {
              console.log("⚠️  Cannot set supply queue: Market has zero cap");
              console.log("    The cap needs to be accepted first.");
              console.log("    You can manually call: vault.setSupplyQueue([marketId])");
            } else {
              throw e;
            }
          }
        } catch (e: any) {
          console.error("ERROR setting supply queue:", e.message);
          console.log("⚠️  Skipping supply queue configuration - you can set it manually later");
          console.log("    Call: vault.setSupplyQueue([marketId])");
        }
        console.log("");
      }

    } else {
      vaultAddress = CONTRACT_ADDRESSES.vaultAddress;
      let nonce = await ethers.provider.getTransactionCount(deployer, "pending");

      const vault = new ethers.Contract(vaultAddress, VAULT_ABI, deployer);

      // Submit supply cap for the market
      console.log(
        `Submitting supply cap: ${ethers.formatUnits(VAULT_CONFIG.supplyCapAmount, 6)} MXNB`
      );

      const submitCapTx = await vault.submitCap(marketParams, VAULT_CONFIG.supplyCapAmount, { nonce: nonce++ });
      const submitCapReceipt = await submitCapTx.wait();

      console.log(`✓ Supply cap submitted!`);
      console.log(`  Transaction Hash: ${submitCapReceipt?.hash}`);
      console.log(`  Block Number: ${submitCapReceipt?.blockNumber}`);
      console.log("");

      // Accept cap if timelock is 0 (for testing)
      if (VAULT_CONFIG.initialTimelock === 0) {
        console.log("Accepting supply cap (timelock = 0)...");
        try {
          const acceptCapTx = await vault.acceptCap(marketParams, { nonce: nonce++ });
          const acceptCapReceipt = await acceptCapTx.wait();

          console.log(`✓ Supply cap accepted!`);
          console.log(`  Transaction Hash: ${acceptCapReceipt?.hash}`);
          console.log("");
        } catch (e: any) {
          // If accept fails, the cap was probably already accepted or there's an issue
          console.log("⚠️  Could not accept cap immediately (cap submission may have already set it)");
          console.log(`  Error: ${e.message?.substring(0, 100)}`);
          console.log("");
        }
      } else {
        console.log(`⏱️  Supply cap is pending (timelock = ${VAULT_CONFIG.initialTimelock}s)`);
        console.log("Call acceptCap() after timelock expires.");
        console.log("");
      }

      try {
        // Try to set supply queue - this requires the market to have cap > 0
        // If it fails due to zero cap, we'll skip it (user can set it manually later)
        try {
          const setQueueTx = await vault.setSupplyQueue([marketId], { nonce: nonce++ });
          const queueReceipt = await setQueueTx.wait();

          console.log(`✓ Allocator configured!`);
          console.log(`  Transaction Hash: ${queueReceipt?.hash}`);
          console.log(`  Block Number: ${queueReceipt?.blockNumber}`);

          // Verify queue was set
          const queueLength = await vault.supplyQueueLength();
          console.log(`✓ Verified: Supply queue length = ${queueLength}`);
        } catch (e: any) {
          const errorMsg = e.message || "";
          if (errorMsg.includes("UnauthorizedMarket")) {
            console.log("⚠️  Cannot set supply queue: Market has zero cap");
            console.log("    The cap needs to be accepted first.");
            console.log("    You can manually call: vault.setSupplyQueue([marketId])");
          } else {
            throw e;
          }
        }
      } catch (e: any) {
        console.error("ERROR setting supply queue:", e.message);
        console.log("⚠️  Skipping supply queue configuration - you can set it manually later");
        console.log("    Call: vault.setSupplyQueue([marketId])");
      }
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
    console.log(`  Loan Token:      ${CONTRACT_ADDRESSES.mockMXNB}`);
    console.log(`  Collateral:      ${CONTRACT_ADDRESSES.wmUSDC}`);
    console.log(`  Oracle:          ${CONTRACT_ADDRESSES.fixedPriceOracle}`);
    console.log(`  LLTV:            77%`);
    console.log("");

    if (vaultAddress) {
      console.log("Vault Details:");
      console.log(`  Vault Address:   ${vaultAddress}`);
      console.log(`  Vault Name:      ${VAULT_CONFIG.name}`);
      console.log(`  Vault Symbol:    ${VAULT_CONFIG.symbol}`);
      console.log(`  Supply Cap:      ${ethers.formatUnits(VAULT_CONFIG.supplyCapAmount, 6)} MXNB`);
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
    const marketDetailsFile = path.join(__dirname, "../market-details-mxnb.json");
    const marketDetails = {
      marketId,
      vaultAddress: vaultAddress || "pending",
      loanToken: marketParams.loanToken,
      collateralToken: marketParams.collateralToken,
      oracle: marketParams.oracle,
      irm: marketParams.irm,
      lltv: marketParams.lltv.toString(),
      vaultConfig: {
        name: VAULT_CONFIG.name,
        symbol: VAULT_CONFIG.symbol,
        initialTimelock: VAULT_CONFIG.initialTimelock,
        supplyCapAmount: VAULT_CONFIG.supplyCapAmount.toString(),
      },
      blockNumber: receipt?.blockNumber,
      marketTransactionHash: receipt?.hash,
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
