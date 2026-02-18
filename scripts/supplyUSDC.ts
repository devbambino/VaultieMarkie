import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// ============================================================================
// CONFIGURATION
// ============================================================================
const CONTRACT_ADDRESSES = {
  mockUSDC: "0xba50cd2a20f6da35d788639e581bca8d0b5d4d5f", // From Aave
  mockWETH: "0x1ddebA64A8B13060e13d15504500Dd962eECD35B", // From deploy.ts
};

let isDepositingUSDC = true;
// Amount to mint (100 mockWETH with 18 decimals)
const MINT_AMOUNT = ethers.parseUnits("100", 18);
// Amount to deposit to vault, 200 USDC
const DEPOSIT_AMOUNT = ethers.parseUnits("200", 6);

// Load market details from previous script
let VAULT_ADDRESS: string;
let MARKET_ID: string;
let marketParams: any;

try {
  const marketDetailsPath = path.join(__dirname, "../market-details-usdc.json");
  const marketDetails = JSON.parse(fs.readFileSync(marketDetailsPath, "utf-8"));
  VAULT_ADDRESS = marketDetails.vaultAddress;
  MARKET_ID = marketDetails.marketId;
  marketParams = {
    loanToken: marketDetails.loanToken,
    collateralToken: marketDetails.collateralToken,
    oracle: marketDetails.oracle,
    irm: marketDetails.irm,
    lltv: BigInt(marketDetails.lltv),
  };
  console.log(`✓ Loaded market details from market-details.json`);
  console.log(`  Vault Address: ${VAULT_ADDRESS}`);
  console.log(`  Market ID: ${MARKET_ID}`);
} catch (error) {
  throw new Error(
    "Could not load market details. Make sure to run createMarket.ts first.\n" +
    "Run: npx hardhat run scripts/createMarket.ts --network baseSepolia"
  );
}

async function main() {
  console.log("=".repeat(70));
  console.log("Mint & Deposit MockUSDC to MetaMorpho Vault");
  console.log("=".repeat(70));
  console.log("");

  // Get deployer account
  const [deployer] = await ethers.getSigners();
  console.log(`Deployer: ${deployer.address}`);
  console.log("");

  

  try {
    // ========================================================================
    // [1/3] Mint MockWETH
    // ========================================================================
    console.log("[1/3] Minting MockWETH tokens...");

    const VAULT_ABI = [
      "function deposit(uint256 assets, address receiver) external returns (uint256)",
      "function withdraw(uint256 assets, address receiver, address owner) external returns (uint256)",
      "function balanceOf(address account) external view returns (uint256)",
      "function redeem(uint256 shares, address receiver, address owner) external returns (uint256)",
      "function asset() external view returns (address)",
      "function supplyQueueLength() external view returns (uint256)",
      "function supplyQueue(uint256 index) external view returns (bytes32)",
      "function approve(address spender, uint256 amount) external returns (bool)"
    ];
    const ERC20_ABI = [
      "function approve(address spender, uint256 amount) external returns (bool)",
      "function mint(address to, uint256 amount) external",
      "function balanceOf(address account) external view returns (uint256)",
      "function decimals() external view returns (uint8)",
    ];
    const usdc = new ethers.Contract(CONTRACT_ADDRESSES.mockUSDC, ERC20_ABI, deployer);
    const mockWETH = new ethers.Contract(CONTRACT_ADDRESSES.mockWETH, ERC20_ABI, deployer);
    const vault = new ethers.Contract(VAULT_ADDRESS, VAULT_ABI, deployer);

    const balance = await mockWETH.balanceOf(deployer.address);
    if (balance > 0) {
      console.log(`✓ mockWETH Balance Before: ${ethers.formatUnits(balance, 18)} WETH`);
    } else {
      console.log(`Minting ${ethers.formatUnits(MINT_AMOUNT, 6)} WETH to ${deployer.address}...`);
      const mintTx = await mockWETH.mint(deployer.address, MINT_AMOUNT);
      const mintReceipt = await mintTx.wait();

      console.log(`✓ Mint transaction confirmed!`);
      console.log(`  Transaction Hash: ${mintReceipt?.hash}`);
      console.log(`  Block Number: ${mintReceipt?.blockNumber}`);
      console.log(`  Gas Used: ${mintReceipt?.gasUsed}`);

      // Verify balance
      const balanceAfter = await mockWETH.balanceOf(deployer.address);
      console.log(`✓ mockWETH Balance After: ${ethers.formatUnits(balanceAfter, 18)} WETH`);
      console.log("");
    }

    console.log("");


    // ========================================================================
    // [2/3] Approve MockUSDC to MetaMorpho Vault
    // ========================================================================


    if (isDepositingUSDC) {
      console.log("[2/3] Approving MockUSDC for MetaMorpho Vault...");

      console.log(`Approving ${ethers.formatUnits(DEPOSIT_AMOUNT, 6)} USDC to Vault (${VAULT_ADDRESS})...`);
      const approveTx = await usdc.approve(VAULT_ADDRESS, DEPOSIT_AMOUNT);
      const approveReceipt = await approveTx.wait();

      console.log(`✓ Approval transaction confirmed!`);
      console.log(`  Transaction Hash: ${approveReceipt?.hash}`);
      console.log(`  Block Number: ${approveReceipt?.blockNumber}`);
      console.log("");

      // ========================================================================
      // [3/3] Verify Vault Configuration Before Deposit
      // ========================================================================
      console.log("[3/3] Verifying vault configuration...");

      const queueLength = await vault.supplyQueueLength();
      const queueLengthNum = Number(queueLength);
      console.log(`Vault supply queue length: ${queueLengthNum}`);

      if (queueLengthNum === 0) {
        console.log("");
        console.log("❌ VAULT NOT CONFIGURED - Cannot deposit!");
        console.log("");
        console.log("The vault needs to be configured with the market in its supply queue.");
        console.log("");
        console.log("STEPS TO MANUALLY CONFIGURE THE VAULT:");
        console.log("");
        console.log("1. Call acceptCap() with the market parameters to accept the pending supply cap");
        console.log("2. Call setSupplyQueue() with the market ID to set the supply queue");
        console.log("");
        console.log("DETAILS:");
        console.log(`  Vault Address: ${VAULT_ADDRESS}`);
        console.log(`  Market ID:     ${MARKET_ID}`);
        console.log("");
        console.log("After configuring these, run this script again.");
        console.log("");
        process.exit(0);
      }

      console.log("✓ Vault is properly configured");
      for (let i = 0; i < Math.min(queueLengthNum, 3); i++) {
        const queuedMarket = await vault.supplyQueue(i);
        console.log(`  Queue[${i}]: ${queuedMarket}`);
      }
      console.log("");

      // ========================================================================
      // [4/4] Deposit MockUSDC to MetaMorpho Vault
      // ========================================================================
      console.log("[4/4] Depositing MockUSDC to MetaMorpho Vault...");

      console.log(`Depositing ${ethers.formatUnits(DEPOSIT_AMOUNT, 6)} USDC to vault...`);
      console.log(`Vault Address: ${VAULT_ADDRESS}`);
      console.log("");

      const depositTx = await vault.deposit(DEPOSIT_AMOUNT, deployer.address);
      const depositReceipt = await depositTx.wait();

      console.log(`✓ Deposit transaction confirmed!`);
      console.log(`  Transaction Hash: ${depositReceipt?.hash}`);
      console.log(`  Block Number: ${depositReceipt?.blockNumber}`);
      console.log(`  Gas Used: ${depositReceipt?.gasUsed}`);
      console.log("");

      // Verify deposit
      console.log("Verifying deposit in vault...");
      try {
        const vaultShares = await vault.balanceOf(deployer.address);
        console.log(`✓ Vault shares received:`);
        console.log(`  Shares Balance: ${ethers.formatUnits(vaultShares, 6)}`);
      } catch (e) {
        console.log("  (Could not retrieve vault balance, but transaction was confirmed)");
      }
      console.log("");
    } else {
      // ========================================================================
      // STEP 11: Withdraw from Morpho USDC Vault
      // ========================================================================
      const vaultUsdcFinal = await vault.balanceOf(deployer.address);
      console.log(`Withdrawing ${ethers.formatUnits(vaultUsdcFinal, 6)} USDC from Morpho Vault...`);

      if (vaultUsdcFinal > 0) {
        const withdrawTx = await vault.redeem(vaultUsdcFinal, deployer.address, deployer.address);
        await withdrawTx.wait();
        console.log(`✓ Withdrawal confirmed (${withdrawTx.hash})`);
      }
      const usdcFinal = await usdc.balanceOf(deployer.address);
    }



    // ========================================================================
    // Summary
    // ========================================================================
    console.log("=".repeat(70));
    console.log("✓ MINT & DEPOSIT COMPLETE");
    console.log("=".repeat(70));
    console.log("");
    console.log("Summary:");
    console.log(`  ✓ Minted: ${ethers.formatUnits(MINT_AMOUNT, 6)} WETH`);
    console.log(`  ✓ Deposited: ${ethers.formatUnits(DEPOSIT_AMOUNT, 6)} USDC to MetaMorpho Vault`);
    console.log(`  ✓ Vault Address: ${VAULT_ADDRESS}`);
    console.log("");
    console.log("Next Steps:");
    console.log("1. The vault will automatically allocate your deposit to Morpho Blue markets");
    console.log("2. Monitor your vault shares and earn interest");
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
