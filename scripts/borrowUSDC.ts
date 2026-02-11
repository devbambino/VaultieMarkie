/**
 * End-to-End Demo Flow Script
 * 
 * This script demonstrates the complete lifecycle:
 * 1. Supply USDC to Morpho Vaults → receive vaultUSDC (The USDC Vault and ETH market should be created in Base Sepolia using the createMarket.ts script as reference)
 * 2. Wrap vaultUSDC into WmUSDC
 * 3. Supply WmUSDC as collateral to Morpho
 * 4. Borrow MXNB_test from Morpho
 * 5. Repay MXNB_test
 * 6. Withdraw WmUSDC collateral from Morpho
 * 7. Unwrap WmUSDC back into vaultUSDC
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
  mockMXNB: "0xF19D2F986DC0fb7E2A82cb9b55f7676967F7bC3E",
  mockWETH: "0x1ddebA64A8B13060e13d15504500Dd962eECD35B",
  mockUSDC: "0xba50cd2a20f6da35d788639e581bca8d0b5d4d5f",
  wmUSDC: "0xCa4625EA7F3363d7E9e3090f9a293b64229FE55B",
  wmusdcMxnbOracle: "0x9f4b138BF3513866153Af9f0A2794096DFebFaD4",
  ethUsdcOracle: "0x97EBCdb0F784CDc9F91490bEBC9C8756491814a3",//"0x42BD63952Bb102120031EB8c8Ca3160b1Af8B28D",
  morphoUSDCVault: "0xA694354Ab641DFB8C6fC47Ceb9223D12cCC373f9", // Morpho USDC Vault - UPDATE AFTER CREATION
  morphoMXNBVault: "0xd6a83595b11CCC94bCcde4c9654bcaa6D423896e", // Morpho MXNB Vault - UPDATE AFTER CREATION
};

// Base Sepolia addresses (do not change)
const BASE_SEPOLIA = {
  usdc: "0xba50cd2a20f6da35d788639e581bca8d0b5d4d5f", // Aave's Testnet USDC
  morphoBlue: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb",
};

// UPDATE THIS from market-details.json after createMarket.ts
const USDC_MARKET_ID = "0x6af42641dd1ddc4fd0c3648e45497a29b78eb50d21fd0f6eac7b8eae2192dd47";//"0x4fc5ba3c0ecfa8df29548fc2988c55cb5fc10eb0b805d281c407ff9966ef244c"; // Will be set after createMarket.ts

// Collateral Amount to supply (0.1 WETH = 1 * 10^17 wei = 194 USD)
const SUPPLY_AMOUNT = ethers.parseUnits("0", 18);

// Amount to borrow (5 USDC = 5 * 10^6 wei)
const BORROW_AMOUNT = ethers.parseUnits("5", 6);

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

  if (!CONTRACT_ADDRESSES.morphoUSDCVault.startsWith("0x") || CONTRACT_ADDRESSES.morphoUSDCVault === "0x") {
    throw new Error("ERROR: morphoUSDCVault address not configured. Run: npx hardhat run scripts/createUSDCVault.ts --network baseSepolia");
  }
  /*if (!CONTRACT_ADDRESSES.mockMXNB.startsWith("0x") || CONTRACT_ADDRESSES.mockMXNB === "0x") {
    throw new Error("ERROR: Update CONTRACT_ADDRESSES in this script with values from deploy.ts");
  }
  if (!MXNB_MARKET_ID.startsWith("0x") || MXNB_MARKET_ID === "0x") {
    throw new Error("ERROR: Update MARKET_ID in this script with value from createMarket.ts");
  }*/

  const [signer] = await ethers.getSigners();
  const signerAddress = await signer.getAddress();
  console.log(`\nSigner: ${signerAddress}`);
  console.log(`Network: ${(await ethers.provider.getNetwork()).name}`);
  console.log("");

  try {
    // ========================================================================
    // STEP 1: Get Collateral Balance
    // ========================================================================
    logStep(1, "Check Test WETH Balance", "\x1b[33m");

    const collateralABI = [
      "function transfer(address to, uint256 amount) external returns (bool)",
      "function approve(address spender, uint256 amount) external returns (bool)",
      "function balanceOf(address account) external view returns (uint256)",
      "function decimals() external view returns (uint8)",
    ];

    const collateral = new ethers.Contract(CONTRACT_ADDRESSES.mockWETH, collateralABI, signer);

    console.log(`Checking weth balance...`);
    let collateralBalance = await getBalance(collateral, signerAddress, "wETH", 18);

    // If balance is low, we'd need to get USDC from a faucet
    if (collateralBalance < SUPPLY_AMOUNT) {
      console.log(`\n⚠️  wETH balance (${ethers.formatUnits(collateralBalance, 18)}) is less than needed (${ethers.formatUnits(SUPPLY_AMOUNT, 18)})`);
      console.log(`Please get weth from a testnet faucet`);
      return;
    }

    const morphoVaultABI = [
      "function deposit(uint256 assets, address receiver) external returns (uint256)",
      "function withdraw(uint256 assets, address receiver, address owner) external returns (uint256)",
      "function redeem(uint256 shares, address receiver, address owner) external returns (uint256)",
      "function balanceOf(address) external view returns (uint256)",
      "function approve(address spender, uint256 amount) external returns (bool)"
    ];

    const morphoABI = [
      "function supplyCollateral(tuple(address,address,address,address,uint256) marketParams, uint256 amount, address onBehalf, bytes data) external",
      "function position(bytes32 id, address user) external view returns (tuple(uint256,uint256,uint256))",
      "function borrow(tuple(address,address,address,address,uint256) marketParams, uint256 assets, uint256 shares, address onBehalf, address receiver) external returns (uint256, uint256)",
      "function repay(tuple(address,address,address,address,uint256) marketParams, uint256 assets, uint256 shares, address onBehalf, bytes data) external returns (uint256, uint256)",
      "function withdrawCollateral(tuple(address,address,address,address,uint256) marketParams, uint256 amount, address onBehalf, address receiver) external",
    ];

    // Create market params
    const marketParams = [
      CONTRACT_ADDRESSES.mockUSDC,     // loanToken
      CONTRACT_ADDRESSES.mockWETH,       // collateralToken
      CONTRACT_ADDRESSES.ethUsdcOracle, // oracle
      "0x46415998764C29aB2a25CbeA6254146D50D22687", // irm (default)
      ethers.parseEther("0.77"),       // lltv (77%)
    ];

    //const morphoUSDCVault = new ethers.Contract(CONTRACT_ADDRESSES.morphoUSDCVault, morphoVaultABI, signer);
    const morpho = new ethers.Contract(BASE_SEPOLIA.morphoBlue, morphoABI, signer);
    const usdc = new ethers.Contract(CONTRACT_ADDRESSES.mockUSDC, collateralABI, signer);

    await getBalance(usdc, signerAddress, "USDC", 6);

    // ========================================================================
    // STEP: Check  Loan
    // ========================================================================
    logStep(8, "Loan Info", "\x1b[33m");

    // Get current position to check borrowShares
    const positionBeforeRepay = await morpho.position(USDC_MARKET_ID, signerAddress);
    const borrowShares = positionBeforeRepay[1]; // borrowShares is the second element
    console.log("Position before repay:", positionBeforeRepay);
    console.log(`Current borrow shares: ${borrowShares.toString()}`);

    // Calculate actual debt
    const debtAssets = await calculateDebtFromShares(morpho, USDC_MARKET_ID, borrowShares);
    console.log(`Calculated debt: ${debtAssets} loan token`);

    const loanBalance = await usdc.balanceOf(signerAddress);
    console.log(`Available loan token balance: ${ethers.formatUnits(loanBalance, 6)}`);

    let isRepayment = false;
    console.log(`⚠ Is a repayment? ${isRepayment}`);
    if (isRepayment) {
      // If balance is 0 but we have debt, need to handle it
      // ========================================================================
      // STEP 8: Repay  Loan
      // ========================================================================

      if (borrowShares === 0n) {
        console.log(`✓ No outstanding debt`);
      } else if (loanBalance === 0n) {
        console.log(`⚠ No loan token balance but have outstanding debt of ${ethers.formatUnits(debtAssets, 6)} loan tokens`);
        console.log(`   Cannot repay without loan tokens`);
        return;
      } else {
        // Repay using shares directly to avoid arithmetic issues
        // Pass borrowShares and 0 assets to repay the exact shares owed

        console.log(`Approving loan tokens to Morpho for repayment...`);
        const approveCcopTx = await usdc.approve(BASE_SEPOLIA.morphoBlue, loanBalance);
        await approveCcopTx.wait();
        console.log(`✓ Approval confirmed (${approveCcopTx.hash})`);

        console.log(`Repaying ${debtAssets} loan tokens (${borrowShares.toString()} shares)...`);
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
        const positionAfterRepay = await morpho.position(USDC_MARKET_ID, signerAddress);
        const borrowSharesAfter = positionAfterRepay[1];
        console.log(`Borrow shares after repay: ${borrowSharesAfter.toString()}`);
      }

      // ========================================================================
      // STEP 9: Withdraw Collateral from Morpho
      // ========================================================================
      logStep(9, "Withdraw Collateral from Morpho", "\x1b[33m");

      const updatedPosition = await morpho.position(USDC_MARKET_ID, signerAddress);
      let collateralToWithdraw = updatedPosition[2];
      console.log("Position after repay:", updatedPosition);

      console.log(`Withdrawing ${ethers.formatUnits(collateralToWithdraw, 18)} collateral from Morpho...`);

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
      }

      await getBalance(collateral, signerAddress, "wETH", 18);

    } else {
      let nonce = 0;
      if (SUPPLY_AMOUNT > 0) {
        // ========================================================================
        // STEP 5: Approve collateral to Morpho Blue
        // ========================================================================
        logStep(5, "Approve collateral for Morpho", "\x1b[33m");
        console.log(`Approving collateral to Morpho Blue...`);
        const approveForMorphoTx = await collateral.approve(BASE_SEPOLIA.morphoBlue, SUPPLY_AMOUNT);
        await approveForMorphoTx.wait();
        console.log(`✓ Approval confirmed (${approveForMorphoTx.hash})`);

        // ========================================================================
        // STEP 6: Supply Collateral to Morpho
        // ========================================================================
        logStep(6, "Supply Collateral to Morpho Blue", "\x1b[33m");
        nonce = await ethers.provider.getTransactionCount(signerAddress, "pending");
        console.log(`Starting execution with Nonce: ${nonce}`);

        console.log(`Supplying ${SUPPLY_AMOUNT} weth as collateral...`);
        const supplyCollateralTx = await morpho.supplyCollateral(marketParams, SUPPLY_AMOUNT, signerAddress, "0x", { nonce: nonce });
        await supplyCollateralTx.wait();
        console.log(`✓ Collateral supply confirmed (${supplyCollateralTx.hash})`);
        await getBalance(collateral, signerAddress, "wETH");
      }

      // ========================================================================
      // STEP 7: Borrow loan token from Morpho
      // ========================================================================
      logStep(7, "Borrow loan token from Morpho Blue", "\x1b[33m");

      console.log(`Borrowing ${ethers.formatUnits(BORROW_AMOUNT, 6)} loan token...`);
      if (nonce === 0 ){
        nonce = await ethers.provider.getTransactionCount(signerAddress, "pending");
      }else{
        nonce = nonce++;
      }
      const borrowTx = await morpho.borrow(
        marketParams,
        BORROW_AMOUNT,  // assets
        0,              // shares (0 = calculate from assets)
        signerAddress,
        signerAddress, { nonce: nonce }
      );
      await borrowTx.wait();
      console.log(`✓ Borrow confirmed (${borrowTx.hash})`);

      // Verify loan token balance
      //await getBalance(usdc, signerAddress, "USDC", 6);
    }

    const usdcFinal = await getBalance(usdc, signerAddress, "USDC", 6);

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
    console.log(`  wETH: ${ethers.formatUnits(await collateral.balanceOf(signerAddress), 18)}`);
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
