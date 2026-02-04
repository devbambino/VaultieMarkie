/**
 * Morpho USDC Vault Creation Script
 * 
 * This script creates a Morpho Vault (MetaMorpho) with USDC as the underlying asset.
 * 
 * The vault will be used in the demo flow to generate yield on USDC deposits before
 * wrapping into WaUSDC for use as collateral in Morpho Blue.
 * 
 * Prerequisites:
 * 1. npx hardhat run scripts/deploy.ts --network baseSepolia
 * 2. npx hardhat run scripts/createMarket.ts --network baseSepolia
 * 
 * Run: npx hardhat run scripts/createUSDCVault.ts --network baseSepolia
 */

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// ============================================================================
// BASE SEPOLIA ADDRESSES
// ============================================================================
const BASE_SEPOLIA = {
    usdc: "0xba50cd2a20f6da35d788639e581bca8d0b5d4d5f", // USDC on Base Sepolia
    morphoBlue: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb",
};

// Morpho Vault Factory on Base Sepolia
const VAULT_FACTORY_ADDRESS = "0x2c3FE6D71F8d54B063411Abb446B49f13725F784";

// Vault configuration
const VAULT_CONFIG = {
    name: "Morpho USDC Vault",
    symbol: "mUSDC",
    initialTimelock: 0, // 1 second for testing, can be increased later to 86400 (1 day)
    supplyCapAmount: ethers.parseUnits("1000000000", 6), // 1 billion USDC cap
};

// ============================================================================
// UPDATE THESE ADDRESSES AFTER DEPLOYMENT
// ============================================================================
const CONTRACT_ADDRESSES = {
  USDC: "0xba50cd2a20f6da35d788639e581bca8d0b5d4d5f", // From deploy.ts output
  ETH: "0x1DA5199ecaAe23F85c7fd7611703E81273041149",   // From deploy.ts output
  fixedPriceOracle: "0xa8B8bBc0A572803A9153336122EBc971DeF60672", // From deploy.ts output
};

// Morpho Blue on Base Sepolia
const MORPHO_BLUE_ADDRESS = "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb";

// LLTV: 77% = 0.77 * 10^18
const LLTV = ethers.parseEther("0.77");

// Default IRM on Base Sepolia
// Source: https://docs.morpho.org/get-started/resources/addresses
const IRM_ADDRESS = "0x46415998764C29aB2a25CbeA6254146D50D22687";

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
 * Calculate market ID (Morpho uses hash of params as ID)
 */
function getMarketId(params: MarketParams): string {
    const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
        ["tuple(address,address,address,address,uint256)"],
        [[params.loanToken, params.collateralToken, params.oracle, params.irm, params.lltv]]
    );
    return ethers.keccak256(encoded);
}

/**
 * Log helper with colors
 */
function logSection(title: string) {
    console.log("\n" + "=".repeat(70));
    console.log(title);
    console.log("=".repeat(70));
}

async function main() {
    console.log("\x1b[36m");
    console.log("╔" + "═".repeat(68) + "╗");
    console.log("║" + " ".repeat(68) + "║");
    console.log("║" + "  MORPHO USDC VAULT CREATION".padStart(68) + "║");
    console.log("║" + "  Base Sepolia Testnet".padStart(68) + "║");
    console.log("║" + " ".repeat(68) + "║");
    console.log("╚" + "═".repeat(68) + "╝");
    console.log("\x1b[0m");

    const [deployer] = await ethers.getSigners();
    console.log(`\nDeployer: ${deployer.address}`);
    console.log(`Network: ${(await ethers.provider.getNetwork()).name}`);

    try {

        console.log("Market Parameters:");
        console.log(`  Loan Token:      ${CONTRACT_ADDRESSES.mockCCOP}`);
        console.log(`  Collateral:      ${CONTRACT_ADDRESSES.waUSDC}`);
        console.log(`  Oracle:          ${CONTRACT_ADDRESSES.fixedPriceOracle}`);
        console.log(`  IRM:             ${IRM_ADDRESS}`);
        console.log(`  LLTV:            77% (${LLTV.toString()})`);
        console.log("");

        // Create market params object with normalized addresses
        const marketParams: MarketParams = {
            loanToken: ethers.getAddress(CONTRACT_ADDRESSES.mockCCOP),
            collateralToken: ethers.getAddress(CONTRACT_ADDRESSES.waUSDC),
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



        logSection("Vault Configuration");
        console.log(`Name:              ${VAULT_CONFIG.name}`);
        console.log(`Symbol:            ${VAULT_CONFIG.symbol}`);
        console.log(`Asset:             USDC (${BASE_SEPOLIA.usdc})`);
        console.log(`Initial Timelock:  ${VAULT_CONFIG.initialTimelock} seconds`);
        console.log(`Supply Cap:        ${ethers.formatUnits(VAULT_CONFIG.supplyCapAmount, 6)} USDC`);

        // Vault Factory ABI
        const VAULT_FACTORY_ABI = [
            "function createMetaMorpho(address initialOwner, uint256 initialTimelock, address asset, string memory name, string memory symbol, bytes32 salt) external returns (address)",
        ];

        const vaultFactory = new ethers.Contract(
            VAULT_FACTORY_ADDRESS,
            VAULT_FACTORY_ABI,
            deployer
        );

        logSection("Creating Morpho USDC Vault");

        // Create a unique salt for the vault (using timestamp)
        const salt = ethers.id(`Morpho-USDC-Vault-${Date.now()}`);
        console.log(`Salt: ${salt}`);
        console.log("\nSubmitting vault creation transaction...");

        // Create the vault
        const tx = await vaultFactory.createMetaMorpho(
            deployer.address,              // initialOwner
            VAULT_CONFIG.initialTimelock,  // initialTimelock
            BASE_SEPOLIA.usdc,             // asset
            VAULT_CONFIG.name,             // name
            VAULT_CONFIG.symbol,           // symbol
            salt                           // salt for deterministic address
        );

        console.log(`Transaction Hash: ${tx.hash}`);
        console.log("Waiting for confirmation...");

        const receipt = await tx.wait();
        console.log(`✓ Vault creation confirmed in block ${receipt?.blockNumber}`);
        console.log(`Gas Used: ${receipt?.gasUsed}`);

        // Extract vault address from transaction logs
        const vaultFactory_iface = new ethers.Interface(VAULT_FACTORY_ABI);
        let vaultAddress: string | null = null;

        if (receipt?.logs) {
            for (const log of receipt.logs) {
                try {
                    // Try to parse using the factory interface
                    const parsed = vaultFactory_iface.parseLog(log);
                    if (parsed && parsed.name === "CreateMetaMorpho") {
                        vaultAddress = parsed.args[0]; // metaMorpho address is first indexed param
                        break;
                    }
                } catch (e) {
                    // Continue parsing
                }
            }
        }

        /*if (receipt?.logs) {
          for (const log of receipt.logs) {
            try {
              // Look for MetaMorpho creation events
              if (log.address.toLowerCase() === VAULT_FACTORY_ADDRESS.toLowerCase()) {
                // The vault address is typically in the transaction receipt
                // For MetaMorpho, we can extract it from the logs or use deterministic address calculation
                const topics = log.topics;
                if (topics.length > 0) {
                  // Check if this is a creation event
                  const data = log.data;
                  // Decode as address (remove 0x and pad to 64 chars)
                  if (data.length === 66) { // 0x + 64 hex chars
                    vaultAddress = ethers.getAddress("0x" + data.slice(-40));
                    break;
                  }
                }
              }
            } catch (e) {
              // Continue searching
            }
          }
        }*/

        // If we couldn't extract from logs, try to predict the address
        // If we still couldn't find it, try a different approach
        if (!vaultAddress) {
            console.log("Note: Vault address not found in logs directly, attempting alternative detection...");
            // Log all topics for debugging
            if (receipt?.logs && receipt.logs.length > 0) {
                console.log(`Received ${receipt.logs.length} logs from transaction`);
                for (let i = 0; i < Math.min(3, receipt.logs.length); i++) {
                    console.log(`  Log ${i}: topic[0] = ${receipt.logs[i].topics[0]}`);
                }
            }
        } else {
            console.log(`✓ Vault created at: ${vaultAddress}`);
        }
        /*if (!vaultAddress) {
          logSection("Vault Address Prediction");
          console.log("Vault address not found in transaction logs.");
          console.log("Using deterministic address prediction...\n");
    
          // The MetaMorpho factory uses CREATE2 with a specific salt
          // Calculate expected address
          try {
            const VAULT_IMPL_ABI = [
              "function factory() external view returns (address)",
              "function owner() external view returns (address)",
              "function asset() external view returns (address)",
            ];
    
            // Get all recent events to find vault creation
            const filter = vaultFactory.filters.MetaMorphoCreated?.();
            const events = await vaultFactory.queryFilter(filter || {}, -1000);
    
            if (events.length > 0) {
              const lastEvent = events[events.length - 1];
              console.log(`Found MetaMorphoCreated event in block ${lastEvent.blockNumber}`);
              // Event should contain vault address
              if (lastEvent.args && lastEvent.args[0]) {
                vaultAddress = lastEvent.args[0];
              }
            }
          } catch (e) {
            console.log("Could not extract vault address from events");
          }
        }*/

        logSection("Vault Creation Complete");

        if (vaultAddress) {
            console.log(`✓ Morpho USDC Vault created successfully!`);
            console.log(`\nVault Address: \x1b[32m${vaultAddress}\x1b[0m`);
            console.log(`\n⭐ UPDATE YOUR CONFIG FILES:`);
            console.log(`\nIn scripts/demoFlow.ts (around line 35):`);
            console.log(`  morphoUSDCVault: "${vaultAddress}",`);
            console.log(`\nIn src/config.ts (around line 18):`);
            console.log(`  morphoUSDCVault: "${vaultAddress}",`);

            // Save to a JSON file for reference
            const vaultDetails = {
                vaultAddress: vaultAddress,
                asset: BASE_SEPOLIA.usdc,
                name: VAULT_CONFIG.name,
                symbol: VAULT_CONFIG.symbol,
                initialTimelock: VAULT_CONFIG.initialTimelock,
                supplyCapAmount: VAULT_CONFIG.supplyCapAmount.toString(),
                deployer: deployer.address,
                transactionHash: tx.hash,
                blockNumber: receipt?.blockNumber,
                timestamp: new Date().toISOString(),
            };

            const outputPath = path.join(__dirname, "../vault-details.json");
            fs.writeFileSync(outputPath, JSON.stringify(vaultDetails, null, 2));
            console.log(`\n✓ Vault details saved to: vault-details.json`);
        } else {
            console.log("⚠️  Could not determine vault address from transaction");
            console.log("\nPlease check the transaction hash for the vault creation:");
            console.log(`${tx.hash}`);
            console.log("\nThe vault address should be in the transaction receipt or events.");
        }

        console.log("\n" + "=".repeat(70));
        console.log("Vault Creation Script Complete");
        console.log("=".repeat(70) + "\n");

    } catch (error) {
        console.error("\n\x1b[31m");
        console.error("ERROR DURING VAULT CREATION:");
        console.error("=".repeat(70));
        console.error(error);
        console.error("=".repeat(70));
        console.error("\x1b[0m");
        throw error;
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
