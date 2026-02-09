/**
 * End-to-End Demo Flow Script
 * 
 * This script demonstrates the complete lifecycle:
 * 1. Supply USDC to Morpho Vaults → receive vaultUSDC (The USDC Vault and ETH market should be created in Base Sepolia using the createMarket.ts script as reference)
 * 2. Wrap vaultUSDC into WaUSDC
 * 3. Supply WaUSDC as collateral to Morpho
 * 4. Borrow cCOP_test from Morpho
 * 5. Repay cCOP_test
 * 6. Withdraw WaUSDC collateral from Morpho
 * 7. Unwrap WaUSDC back into vaultUSDC
 * 8. Withdraw from Morpho → receive USDC
 * 
 * Prerequisites:
 * 1. npx hardhat run scripts/deploy.ts --network baseSepolia
 * 2. npx hardhat run scripts/createMarket.ts --network baseSepolia
 * 3. Create Morpho USDC Vault using Vault Factory (similar to createMarket.ts)
 * 
 * Run: npx hardhat run scripts/demoFlow.ts --network baseSepolia
 */

import { ethers } from "hardhat";
import type { ethers as ethersType } from "ethers";
import * as ethersLib from "ethers";

// ============================================================================
// UPDATE THESE ADDRESSES AFTER DEPLOYMENT
// ============================================================================
const CONTRACT_ADDRESSES = {
  mockCCOP: "0x789D299321f194B47f3b72d33d0e028376277AA3", // From deploy.ts output
  waUSDC: "0x1DA5199ecaAe23F85c7fd7611703E81273041149",   // From deploy.ts output
  fixedPriceOracle: "0xa8B8bBc0A572803A9153336122EBc971DeF60672", // From deploy.ts output
  morphoUSDCVault: "0x0000000000000000000000000000000000000000", // Morpho USDC Vault - UPDATE AFTER CREATION
};

// Base Sepolia addresses (do not change)
const BASE_SEPOLIA = {
  usdc: "0xba50cd2a20f6da35d788639e581bca8d0b5d4d5f", // Aave's Testnet USDC
  morphoBlue: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb",
};

// UPDATE THIS from market-details.json after createMarket.ts
const MARKET_ID = "0x9e745eaf869d3f5112802a512d07f3ccab77233e8cb245a7d762bb6e8fdc9f69"; // Will be set after createMarket.ts

// Amount to supply (10 USDC = 10 * 10^6 wei)
const SUPPLY_AMOUNT = ethers.parseUnits("100", 6);

// Amount to borrow (5 cCOP = 5 * 10^6 wei)
const BORROW_AMOUNT = ethers.parseUnits("50", 6);

/**
 * Log helper with formatting
 */
function logStep(step: number, title: string, color: string = "\x1b[36m") {
  console.log("");
  console.log(`${color}${"=".repeat(70)}`);
  console.log(`[STEP ${step}] ${title}`);
  console.log(`${"=".repeat(70)}\x1b[0m`);
}

/**
 * Get token balance with formatting
 */
async function getBalance(token: ethersLib.Contract, account: string, symbol: string, decimals: number = 6): Promise<bigint> {
  const balance = await token.balanceOf(account);
  const formatted = ethers.formatUnits(balance, decimals);
  console.log(`${symbol} Balance: ${formatted}`);
  return balance;
}

/**
 * Calculate the actual debt in assets from borrow shares
 * Formula: debtAssets = (borrowShares * totalBorrowAssets) / totalBorrowShares
 */
async function calculateDebtFromShares(
  morpho: ethersLib.Contract,
  marketId: string,
  borrowShares: bigint
): Promise<bigint> {
  if (borrowShares === 0n) return 0n;

  const marketABI = [
    "function market(bytes32 id) external view returns (tuple(uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee) returns ((uint128, uint128, uint128, uint128, uint128, uint128)))"
  ];

  try {
    // Try to get market data if morpho has a market() function
    const market = await morpho.market(marketId);
    const totalBorrowAssets = market[2];
    const totalBorrowShares = market[3];

    if (totalBorrowShares === 0n) return totalBorrowAssets;

    const debtAssets = (borrowShares * totalBorrowAssets) / totalBorrowShares;
    return debtAssets;
  } catch (e) {
    // If market() is not available, we'll need to handle differently
    console.log(`Note: Could not fetch market data to calculate exact debt`);
    return borrowShares;
  }
}

  async function main() {
  console.log("\x1b[32m");
  console.log("╔" + "═".repeat(68) + "╗");
  console.log("║" + " ".repeat(68) + "║");
  console.log("║" + "  MORPHO BLUE V1 END-TO-END PoC DEMO".padStart(68) + "║");
  console.log("║" + "  Base Sepolia Testnet".padStart(68) + "║");
  console.log("║" + " ".repeat(68) + "║");
  console.log("╚" + "═".repeat(68) + "╝");
  console.log("\x1b[0m");

  // Verify addresses are configured
  if (!CONTRACT_ADDRESSES.mockCCOP.startsWith("0x") || CONTRACT_ADDRESSES.mockCCOP === "0x") {
    throw new Error("ERROR: Update CONTRACT_ADDRESSES in this script with values from deploy.ts");
  }
  if (!CONTRACT_ADDRESSES.morphoUSDCVault.startsWith("0x") || CONTRACT_ADDRESSES.morphoUSDCVault === "0x") {
    throw new Error("ERROR: morphoUSDCVault address not configured. Run: npx hardhat run scripts/createUSDCVault.ts --network baseSepolia");
  }
  /*if (!MARKET_ID.startsWith("0x") || MARKET_ID === "0x") {
    throw new Error("ERROR: Update MARKET_ID in this script with value from createMarket.ts");
  }*/

  const [signer] = await ethers.getSigners();
  const signerAddress = await signer.getAddress();
  console.log(`\nSigner: ${signerAddress}`);
  console.log(`Network: ${(await ethers.provider.getNetwork()).name}`);
  console.log("");

  try {
    // ========================================================================
    // STEP 1: Get USDC Balance
    // ========================================================================
    logStep(1, "Check Test USDC Balance", "\x1b[33m");

    const usdcABI = [
      "function transfer(address to, uint256 amount) external returns (bool)",
      "function approve(address spender, uint256 amount) external returns (bool)",
      "function balanceOf(address account) external view returns (uint256)",
      "function decimals() external view returns (uint8)",
    ];

    const usdc = new ethers.Contract(BASE_SEPOLIA.usdc, usdcABI, signer);

    console.log(`Checking USDC balance...`);
    let usdcBalance = await getBalance(usdc, signerAddress, "USDC");

    // If balance is low, we'd need to get USDC from a faucet
    if (usdcBalance < SUPPLY_AMOUNT) {
      console.log(`\n⚠️  USDC balance (${ethers.formatUnits(usdcBalance, 6)}) is less than needed (${ethers.formatUnits(SUPPLY_AMOUNT, 6)})`);
      console.log(`Please get USDC from a testnet faucet`);
      return;
    }

    // ========================================================================
    // STEP 2: Approve USDC to Morpho USDC Vault
    // ========================================================================
    logStep(2, "Approve USDC for Morpho Vault", "\x1b[33m");

    console.log(`Approving ${ethers.formatUnits(SUPPLY_AMOUNT, 6)} USDC to Morpho USDC Vault...`);
    let approveTx = await usdc.approve(CONTRACT_ADDRESSES.morphoUSDCVault, SUPPLY_AMOUNT);
    await approveTx.wait();
    console.log(`✓ Approval confirmed (${approveTx.hash})`);

    // ========================================================================
    // STEP 3: Supply USDC to Morpho USDC Vault
    // ========================================================================
    logStep(3, "Supply USDC to Morpho Vault", "\x1b[33m");

    const morphoVaultABI = [
      "function deposit(uint256 assets, address receiver) external returns (uint256)",
      "function withdraw(uint256 assets, address receiver, address owner) external returns (uint256)",
      "function balanceOf(address) external view returns (uint256)",
      "function approve(address spender, uint256 amount) external returns (bool)"
    ];

    const morphoUSDCVault = new ethers.Contract(CONTRACT_ADDRESSES.morphoUSDCVault, morphoVaultABI, signer);

    console.log(`Supplying ${ethers.formatUnits(SUPPLY_AMOUNT, 6)} USDC to Morpho USDC Vault...`);
    const depositTx = await morphoUSDCVault.deposit(SUPPLY_AMOUNT, signerAddress);
    await depositTx.wait();
    console.log(`✓ Supply confirmed (${depositTx.hash})`);

    // Verify vaultUSDC received
    const vaultUsdcBalance = await getBalance(morphoUSDCVault, signerAddress, "vaultUSDC");

    // ========================================================================
    // STEP 4: Wrap vaultUSDC into WaUSDC
    // ========================================================================
    logStep(4, "Wrap vaultUSDC into WaUSDC", "\x1b[33m");

    const waUSDCABI = [
      "function deposit(uint256 assets, address receiver) external returns (uint256)",
      "function balanceOf(address) external view returns (uint256)",
      "function approve(address spender, uint256 amount) external returns (bool)"
    ];

    const waUSDC = new ethers.Contract(CONTRACT_ADDRESSES.waUSDC, waUSDCABI, signer);

    // Get vaultUSDC balance
    const vaultUsdcBalanceFinal = await morphoUSDCVault.balanceOf(signerAddress);
    console.log(`Approving vaultUSDC to WaUSDC wrapper...`);
    approveTx = await morphoUSDCVault.approve(CONTRACT_ADDRESSES.waUSDC, vaultUsdcBalanceFinal);
    await approveTx.wait();
    console.log(`✓ Approval confirmed (${approveTx.hash})`);

    console.log(`Wrapping ${ethers.formatUnits(vaultUsdcBalanceFinal, 6)} vaultUSDC into WaUSDC...`);
    const wrapTx = await waUSDC.deposit(vaultUsdcBalanceFinal, signerAddress);
    await wrapTx.wait();
    console.log(`✓ Wrap confirmed (${wrapTx.hash})`);

    const waUsdcBalance = await getBalance(waUSDC, signerAddress, "WaUSDC");

    // Get aUSDC balance
    const aUsdcBalance = await aUsdc.balanceOf(signerAddress);
    console.log(`Approving aUSDC to WaUSDC wrapper...`);
    approveTx = await aUsdc.approve(CONTRACT_ADDRESSES.waUSDC, aUsdcBalance);
    await approveTx.wait();
    console.log(`✓ Approval confirmed (${approveTx.hash})`);

    console.log(`Wrapping ${ethers.formatUnits(aUsdcBalance, 6)} aUSDC into WaUSDC...`);
    /*const depositTx = await waUSDC.deposit(aUsdcBalance, signerAddress);
    await depositTx.wait();
    console.log(`✓ Deposit confirmed (${depositTx.hash})`);*/

    const waUsdcBalance = await getBalance(waUSDC, signerAddress, "WaUSDC");

    // ========================================================================
    // STEP 5: Approve WaUSDC to Morpho Blue
    // ========================================================================
    logStep(5, "Approve WaUSDC for Morpho Collateral", "\x1b[33m");

    console.log(`Approving WaUSDC to Morpho Blue...`);
    const approveForMorphoTx = await waUSDC.approve(BASE_SEPOLIA.morphoBlue, waUsdcBalance);
    await approveForMorphoTx.wait();
    console.log(`✓ Approval confirmed (${approveForMorphoTx.hash})`);

    // ========================================================================
    // STEP 6: Supply WaUSDC as Collateral to Morpho
    // ========================================================================
    logStep(6, "Supply WaUSDC as Collateral to Morpho Blue", "\x1b[33m");

    const morphoABI = [
      "function supplyCollateral(tuple(address,address,address,address,uint256) marketParams, uint256 amount, address onBehalf, bytes data) external",
      "function position(bytes32 id, address user) external view returns (tuple(uint256,uint256,uint256))",
      "function borrow(tuple(address,address,address,address,uint256) marketParams, uint256 assets, uint256 shares, address onBehalf, address receiver) external returns (uint256, uint256)",
      "function repay(tuple(address,address,address,address,uint256) marketParams, uint256 assets, uint256 shares, address onBehalf, bytes data) external returns (uint256, uint256)",
      "function withdrawCollateral(tuple(address,address,address,address,uint256) marketParams, uint256 amount, address onBehalf, address receiver) external",
    ];

    const morpho = new ethers.Contract(BASE_SEPOLIA.morphoBlue, morphoABI, signer);

    // Create market params
    const marketParams = [
      CONTRACT_ADDRESSES.mockCCOP,     // loanToken
      CONTRACT_ADDRESSES.waUSDC,       // collateralToken
      CONTRACT_ADDRESSES.fixedPriceOracle, // oracle
      "0x46415998764C29aB2a25CbeA6254146D50D22687", // irm (default)
      ethers.parseEther("0.77"),       // lltv (77%)
    ];

    console.log(`Supplying ${ethers.formatUnits(waUsdcBalance, 6)} WaUSDC as collateral...`);
    const supplyCollateralTx = await morpho.supplyCollateral(marketParams, waUsdcBalance, signerAddress, "0x");
    await supplyCollateralTx.wait();
    console.log(`✓ Collateral supply confirmed (${supplyCollateralTx.hash})`);

    // ========================================================================
    // STEP 7: Borrow cCOP_test from Morpho
    // ========================================================================
    logStep(7, "Borrow cCOP_test from Morpho Blue", "\x1b[33m");

    console.log(`Borrowing ${ethers.formatUnits(BORROW_AMOUNT, 6)} cCOP_test...`);
    const borrowTx = await morpho.borrow(
      marketParams,
      BORROW_AMOUNT,  // assets
      0,              // shares (0 = calculate from assets)
      signerAddress,
      signerAddress
    );
    await borrowTx.wait();
    console.log(`✓ Borrow confirmed (${borrowTx.hash})`);

    // Verify cCOP balance
    const ccop = new ethers.Contract(CONTRACT_ADDRESSES.mockCCOP, usdcABI, signer);
    await getBalance(ccop, signerAddress, "cCOP");

    // ========================================================================
    // STEP 8: Repay cCOP_test Loan
    // ========================================================================
    logStep(8, "Repay cCOP_test Loan", "\x1b[33m");

    // Get current position to check borrowShares
    const positionBeforeRepay = await morpho.position(MARKET_ID, signerAddress);
    const borrowShares = positionBeforeRepay[1]; // borrowShares is the second element

    console.log(`Current borrow shares: ${borrowShares.toString()}`);

    // Calculate actual debt
    const debtAssets = await calculateDebtFromShares(morpho, MARKET_ID, borrowShares);
    console.log(`Calculated debt: ${ethers.formatUnits(debtAssets, 6)} cCOP`);

    const ccopBalance = await ccop.balanceOf(signerAddress);
    console.log(`Available cCOP balance: ${ethers.formatUnits(ccopBalance, 6)}`);

    // If balance is 0 but we have debt, need to handle it
    if (borrowShares === 0n) {
      console.log(`✓ No outstanding debt`);
    } else if (ccopBalance === 0n) {
      console.log(`⚠ No cCOP balance but have outstanding debt of ${ethers.formatUnits(debtAssets, 6)} cCOP`);
      console.log(`   Cannot repay without cCOP tokens`);
      return;
    } else {
      // Repay using shares directly to avoid arithmetic issues
      // Pass borrowShares and 0 assets to repay the exact shares owed

      console.log(`Approving cCOP to Morpho for repayment...`);
      const approveCcopTx = await ccop.approve(BASE_SEPOLIA.morphoBlue, ccopBalance);
      await approveCcopTx.wait();
      console.log(`✓ Approval confirmed (${approveCcopTx.hash})`);

      console.log(`Repaying ${ethers.formatUnits(debtAssets, 6)} cCOP (${borrowShares.toString()} shares)...`);
      const repayTx = await morpho.repay(
        marketParams,
        0,              // assets (0 = let shares determine the amount)
        borrowShares,   // shares - repay exact shares to close position
        signerAddress,
        "0x"
      );
      await repayTx.wait();
      console.log(`✓ Repayment confirmed (${repayTx.hash})`);

      // Check updated position
      const positionAfterRepay = await morpho.position(MARKET_ID, signerAddress);
      const borrowSharesAfter = positionAfterRepay[1];
      console.log(`Borrow shares after repay: ${borrowSharesAfter.toString()}`);
    }

    // ========================================================================
    // STEP 9: Withdraw WaUSDC Collateral from Morpho
    // ========================================================================
    logStep(9, "Withdraw WaUSDC Collateral from Morpho", "\x1b[33m");

    const updatedPosition = await morpho.position(MARKET_ID, signerAddress);
    let collateralToWithdraw = updatedPosition[2];
    console.log("Position after repay:", updatedPosition);

    console.log(`Withdrawing ${ethers.formatUnits(collateralToWithdraw, 6)} WaUSDC from Morpho...`);

    // Handle potential precision issues by reducing withdrawal amount by 1 wei if needed
    try {
      const withdrawCollateralTx = await morpho.withdrawCollateral(
        marketParams,
        collateralToWithdraw,
        signerAddress,
        signerAddress
      );
      await withdrawCollateralTx.wait();
      console.log(`✓ Withdrawal confirmed (${withdrawCollateralTx.hash})`);
    } catch (error: any) {
      console.log(`⚠ Withdrawal failed...`);
      // Reduce by 1 wei to handle rounding issues
      const reducedAmount = collateralToWithdraw - 1n;
      console.log(`Retrying withdrawal with ${ethers.formatUnits(reducedAmount, 6)} WaUSDC...`);

      const withdrawCollateralTx = await morpho.withdrawCollateral(
        marketParams,
        reducedAmount,
        signerAddress,
        signerAddress
      );
      await withdrawCollateralTx.wait();
      console.log(`✓ Withdrawal confirmed (${withdrawCollateralTx.hash})`);
      collateralToWithdraw = reducedAmount;
    }

    await getBalance(waUSDC, signerAddress, "WaUSDC");

    // ========================================================================
    // STEP 10: Unwrap WaUSDC back to vaultUSDC
    // ========================================================================
    logStep(10, "Unwrap WaUSDC back to vaultUSDC", "\x1b[33m");

    const waUsdcFinalBalance = await waUSDC.balanceOf(signerAddress);
    console.log(`Redeeming ${ethers.formatUnits(waUsdcFinalBalance, 6)} WaUSDC for vaultUSDC...`);

    const redeemABI = ["function redeem(uint256 shares, address receiver, address owner) external returns (uint256)"];
    const waUsdcRedeem = new ethers.Contract(CONTRACT_ADDRESSES.waUSDC, redeemABI, signer);

    const redeemTx = await waUsdcRedeem.redeem(waUsdcFinalBalance, signerAddress, signerAddress);
    await redeemTx.wait();
    console.log(`✓ Redeem confirmed (${redeemTx.hash})`);

    const vaultUsdcFinal = await getBalance(morphoUSDCVault, signerAddress, "vaultUSDC");

    // ========================================================================
    // STEP 11: Withdraw from Morpho USDC Vault
    // ========================================================================
    logStep(11, "Withdraw from Morpho USDC Vault", "\x1b[33m");

    console.log(`Withdrawing ${ethers.formatUnits(vaultUsdcFinal, 6)} vaultUSDC from Morpho Vault...`);

    const withdrawTx = await morphoUSDCVault.withdraw(vaultUsdcFinal, signerAddress, signerAddress);
    await withdrawTx.wait();
    console.log(`✓ Withdrawal confirmed (${withdrawTx.hash})`);

    const usdcFinal = await getBalance(usdc, signerAddress, "USDC");

    // ========================================================================
    // FINAL SUMMARY
    // ========================================================================
    console.log("\x1b[32m");
    console.log("=".repeat(70));
    console.log("✓ DEMO COMPLETE!");
    console.log("=".repeat(70));
    console.log("\x1b[0m");
    console.log("\nFinal Balances:");
    console.log(`  USDC: ${ethers.formatUnits(usdcFinal, 6)}`);
    console.log(`  vaultUSDC: ${ethers.formatUnits(await morphoUSDCVault.balanceOf(signerAddress), 6)}`);
    console.log(`  WaUSDC: ${ethers.formatUnits(await waUSDC.balanceOf(signerAddress), 6)}`);
    console.log(`  cCOP: ${ethers.formatUnits(await ccop.balanceOf(signerAddress), 6)}`);
    console.log("");
    console.log("Flow completed successfully:");
    console.log("  ✓ Supplied USDC to Morpho USDC Vault");
    console.log("  ✓ Wrapped vaultUSDC into WaUSDC");
    console.log("  ✓ Supplied WaUSDC as collateral to Morpho");
    console.log("  ✓ Borrowed cCOP_test");
    console.log("  ✓ Repaid loan");
    console.log("  ✓ Withdrew collateral");
    console.log("  ✓ Unwrapped back to vaultUSDC");
    console.log("  ✓ Withdrew from Morpho USDC Vault");
    console.log("");

  } catch (error) {
    console.error("\n\x1b[31m");
    console.error("ERROR DURING DEMO FLOW:");
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
