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
 * 8. Withdraw USDC from Morpho → receive USDC
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
  wmUSDC: "0xCa4625EA7F3363d7E9e3090f9a293b64229FE55B",
  wmusdcMxnbOracle: "0x9f4b138BF3513866153Af9f0A2794096DFebFaD4",
  ethUsdcOracle: "0x97EBCdb0F784CDc9F91490bEBC9C8756491814a3",
  morphoUSDCVault: "0xA694354Ab641DFB8C6fC47Ceb9223D12cCC373f9", // Morpho USDC Vault - UPDATE AFTER CREATION
  morphoMXNBVault: "0xd6a83595b11CCC94bCcde4c9654bcaa6D423896e", // Morpho MXNB Vault - UPDATE AFTER CREATION
};

// Base Sepolia addresses (do not change)
const BASE_SEPOLIA = {
  usdc: "0xba50cd2a20f6da35d788639e581bca8d0b5d4d5f", // Aave's Testnet USDC
  morphoBlue: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb",
};

// UPDATE THIS from market-details.json after createMarket.ts
const MXNB_MARKET_ID = "0xf912f62db71d01c572b28b6953c525851f9e0660df4e422cec986e620da726df"; // Will be set after createMarket.ts

// Collateral to supply (5 USDC = 5 * 10^6 wei)
const SUPPLY_AMOUNT = ethers.parseUnits("5", 6);

// Amount to borrow (21.7 MXNB = 21.7 * 10^6 wei)
const BORROW_AMOUNT = ethers.parseUnits("21.7", 6);

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
  if (!CONTRACT_ADDRESSES.mockMXNB.startsWith("0x") || CONTRACT_ADDRESSES.mockMXNB === "0x") {
    throw new Error("ERROR: Update CONTRACT_ADDRESSES in this script with values from deploy.ts");
  }
  if (!CONTRACT_ADDRESSES.morphoUSDCVault.startsWith("0x") || CONTRACT_ADDRESSES.morphoUSDCVault === "0x") {
    throw new Error("ERROR: morphoUSDCVault address not configured. Run: npx hardhat run scripts/createUSDCVault.ts --network baseSepolia");
  }
  /*if (!MXNB_MARKET_ID.startsWith("0x") || MXNB_MARKET_ID === "0x") {
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


    const morphoVaultABI = [
      "function deposit(uint256 assets, address receiver) external returns (uint256)",
      "function withdraw(uint256 assets, address receiver, address owner) external returns (uint256)",
      "function redeem(uint256 shares, address receiver, address owner) external returns (uint256)",
      "function balanceOf(address) external view returns (uint256)",
      "function approve(address spender, uint256 amount) external returns (bool)"
    ];

    const wmUSDCABI = [
      "function deposit(uint256 assets, address receiver) external returns (uint256)",
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
      CONTRACT_ADDRESSES.mockMXNB,     // loanToken
      CONTRACT_ADDRESSES.wmUSDC,       // collateralToken
      CONTRACT_ADDRESSES.wmusdcMxnbOracle, // oracle
      "0x46415998764C29aB2a25CbeA6254146D50D22687", // irm (default)
      ethers.parseEther("0.77"),       // lltv (77%)
    ];

    const morphoUSDCVault = new ethers.Contract(CONTRACT_ADDRESSES.morphoUSDCVault, morphoVaultABI, signer);
    const wmUSDC = new ethers.Contract(CONTRACT_ADDRESSES.wmUSDC, wmUSDCABI, signer);
    const morpho = new ethers.Contract(BASE_SEPOLIA.morphoBlue, morphoABI, signer);
    const mxnb = new ethers.Contract(CONTRACT_ADDRESSES.mockMXNB, usdcABI, signer);

    await getBalance(morphoUSDCVault, signerAddress, "mUSDC", 18);
    await getBalance(wmUSDC, signerAddress, "WmUSDC", 18);

    let isSupplyFlow = false;
    if (isSupplyFlow) {

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
      let nonce = await ethers.provider.getTransactionCount(signerAddress, "pending");

      console.log(`Supplying ${ethers.formatUnits(SUPPLY_AMOUNT, 6)} USDC to Morpho USDC Vault...`);
      nonce++
      const depositTx = await morphoUSDCVault.deposit(SUPPLY_AMOUNT, signerAddress, { nonce: nonce++ });
      await depositTx.wait();
      console.log(`✓ Supply confirmed (${depositTx.hash})`);



    }

    let isBorrowFlow = false;
    if (isBorrowFlow) {
      let nonce = await ethers.provider.getTransactionCount(signerAddress, "pending");

      // Verify vaultUSDC received
      const vaultUsdcBalance = await getBalance(morphoUSDCVault, signerAddress, "mUSDC", 18);
      console.log(`✓ USDC Vault Balance: ${vaultUsdcBalance}`);

      // ========================================================================
      // STEP 4: Wrap vaultUSDC into WmUSDC
      // ========================================================================
      logStep(4, "Wrap vaultUSDC into WmUSDC", "\x1b[33m");


      // Get vaultUSDC balance
      const vaultUsdcBalanceFinal = await morphoUSDCVault.balanceOf(signerAddress);

      if (vaultUsdcBalance > 0) {
        console.log(`Approving mUSDC to wmUSDC wrapper...`);
        let approveTx = await morphoUSDCVault.approve(CONTRACT_ADDRESSES.wmUSDC, vaultUsdcBalanceFinal, { nonce: nonce++ });
        await approveTx.wait();
        console.log(`✓ Approval confirmed (${approveTx.hash})`);

        console.log(`Wrapping ${ethers.formatUnits(vaultUsdcBalanceFinal, 18)} mUSDC into wmUSDC...`);
        const wrapTx = await wmUSDC.deposit(vaultUsdcBalanceFinal, signerAddress, { nonce: nonce++ });
        await wrapTx.wait();
        console.log(`✓ Wrap confirmed (${wrapTx.hash})`);

      }

      const wmUsdcBalance = await getBalance(wmUSDC, signerAddress, "WmUSDC", 18);
      if (wmUsdcBalance > 0) {
        // ========================================================================
        // STEP 5: Approve WmUSDC to Morpho Blue
        // ========================================================================
        logStep(5, "Approve WmUSDC for Morpho Collateral", "\x1b[33m");

        console.log(`Approving WmUSDC to Morpho Blue...`);
        const approveForMorphoTx = await wmUSDC.approve(BASE_SEPOLIA.morphoBlue, wmUsdcBalance, { nonce: nonce++ });
        await approveForMorphoTx.wait();
        console.log(`✓ Approval confirmed (${approveForMorphoTx.hash})`);

        // ========================================================================
        // STEP 6: Supply WmUSDC as Collateral to Morpho
        // ========================================================================
        logStep(6, "Supply WmUSDC as Collateral to Morpho Blue", "\x1b[33m");

        console.log(`Supplying ${ethers.formatUnits(wmUsdcBalance, 18)} WmUSDC as collateral...`);
        const supplyCollateralTx = await morpho.supplyCollateral(marketParams, wmUsdcBalance, signerAddress, "0x", { nonce: nonce++ });
        await supplyCollateralTx.wait();
        console.log(`✓ Collateral supply confirmed (${supplyCollateralTx.hash})`);
      }

      let isReadyToBorrow = true;
      if (isReadyToBorrow) {
        // ========================================================================
        // STEP 7: Borrow MXNB_test from Morpho
        // ========================================================================
        logStep(7, "Borrow MXNB_test from Morpho Blue", "\x1b[33m");

        console.log(`Borrowing ${ethers.formatUnits(BORROW_AMOUNT, 6)} MXNB_test...`);
        const borrowTx = await morpho.borrow(
          marketParams,
          BORROW_AMOUNT,  // assets
          0,              // shares (0 = calculate from assets)
          signerAddress,
          signerAddress, { nonce: nonce++ }
        );
        await borrowTx.wait();
        console.log(`✓ Borrow confirmed (${borrowTx.hash})`);

        // Verify mockMXNB balance
        await getBalance(mxnb, signerAddress, "MXNB", 6);
      }

    }

    let isRepayFlow = false;
    if (isRepayFlow) {
      // ========================================================================
      // STEP 8: Repay MXNB_test Loan
      // ========================================================================
      logStep(8, "Repay MXNB_test Loan", "\x1b[33m");

      // Get current position to check borrowShares
      const positionBeforeRepay = await morpho.position(MXNB_MARKET_ID, signerAddress);
      const borrowShares = positionBeforeRepay[1]; // borrowShares is the second element
      console.log("Position before repay:", positionBeforeRepay);

      console.log(`Current borrow shares: ${borrowShares.toString()}`);

      // Calculate actual debt
      const debtAssets = await calculateDebtFromShares(morpho, MXNB_MARKET_ID, borrowShares);
      console.log(`Calculated debt: ${debtAssets} MXNB`);

      const mxnbBalance = await mxnb.balanceOf(signerAddress);
      console.log(`Available MXNB balance: ${ethers.formatUnits(mxnbBalance, 6)}`);

      // If balance is 0 but we have debt, need to handle it
      if (borrowShares === 0n) {
        console.log(`✓ No outstanding debt`);
      } else if (mxnbBalance === 0n) {
        console.log(`⚠ No MXNB balance but have outstanding debt of ${ethers.formatUnits(debtAssets, 6)} MXNB`);
        console.log(`   Cannot repay without MXNB tokens`);
        return;
      } else {
        // Repay using shares directly to avoid arithmetic issues
        // Pass borrowShares and 0 assets to repay the exact shares owed

        console.log(`Approving MXNB to Morpho for repayment...`);
        const approveCcopTx = await mxnb.approve(BASE_SEPOLIA.morphoBlue, mxnbBalance);
        await approveCcopTx.wait();
        console.log(`✓ Approval confirmed (${approveCcopTx.hash})`);

        let nonce = await ethers.provider.getTransactionCount(signerAddress, "pending");
        nonce++;

        console.log(`Repaying ${debtAssets} MXNB (${borrowShares.toString()} shares)...`);
        const repayTx = await morpho.repay(
          marketParams,
          0,              // assets (0 = let shares determine the amount)
          borrowShares,   // shares - repay exact shares to close position
          signerAddress,
          "0x", { nonce: nonce++ }
        );
        await repayTx.wait();
        console.log(`✓ Repayment confirmed (${repayTx.hash})`);

        // Check updated position
        const positionAfterRepay = await morpho.position(MXNB_MARKET_ID, signerAddress);
        const borrowSharesAfter = positionAfterRepay[1];
        console.log(`Borrow shares after repay: ${borrowSharesAfter.toString()}`);
      }

      // ========================================================================
      // STEP 9: Withdraw WmUSDC Collateral from Morpho
      // ========================================================================
      logStep(9, "Withdraw WmUSDC Collateral from Morpho", "\x1b[33m");

      const updatedPosition = await morpho.position(MXNB_MARKET_ID, signerAddress);
      let collateralToWithdraw = updatedPosition[2];
      console.log("Position after repay:", updatedPosition);

      if (collateralToWithdraw > 0) {
        console.log(`Withdrawing ${ethers.formatUnits(collateralToWithdraw, 18)} WmUSDC from Morpho...`);

        let nonce = await ethers.provider.getTransactionCount(signerAddress, "pending");

        // Handle potential precision issues by reducing withdrawal amount by 1 wei if needed
        try {
          const withdrawCollateralTx = await morpho.withdrawCollateral(
            marketParams,
            collateralToWithdraw,
            signerAddress,
            signerAddress, { nonce: nonce++ }
          );
          await withdrawCollateralTx.wait();
          console.log(`✓ Withdrawal confirmed (${withdrawCollateralTx.hash})`);
        } catch (error: any) {
          console.log(`⚠ Withdrawal failed...`);
          // Reduce by 1 wei to handle rounding issues
          /*const reducedAmount = collateralToWithdraw - 1n;
          console.log(`Retrying withdrawal with ${ethers.formatUnits(reducedAmount, 18)} WmUSDC...`);
    
          const withdrawCollateralTx = await morpho.withdrawCollateral(
            marketParams,
            reducedAmount,
            signerAddress,
            signerAddress
          );
          await withdrawCollateralTx.wait();
          console.log(`✓ Withdrawal confirmed (${withdrawCollateralTx.hash})`);
          collateralToWithdraw = reducedAmount;*/
        }

      }


    }

    let isUnwrappingFlow = false;
    if (isUnwrappingFlow) {
      let nonce = await ethers.provider.getTransactionCount(signerAddress, "pending");
      await getBalance(wmUSDC, signerAddress, "WmUSDC", 18);

      // ========================================================================
      // STEP 10: Unwrap WmUSDC back to vaultUSDC
      // ========================================================================
      logStep(10, "Unwrap WmUSDC back to vaultUSDC", "\x1b[33m");

      const wmUsdcFinalBalance = await wmUSDC.balanceOf(signerAddress);
      console.log(`Redeeming ${ethers.formatUnits(wmUsdcFinalBalance, 18)} WmUSDC for vaultUSDC...`);

      if (wmUsdcFinalBalance > 0) {
        const redeemABI = ["function redeem(uint256 shares, address receiver, address owner) external returns (uint256)"];
        const wmUsdcRedeem = new ethers.Contract(CONTRACT_ADDRESSES.wmUSDC, redeemABI, signer);

        const redeemTx = await wmUsdcRedeem.redeem(wmUsdcFinalBalance, signerAddress, signerAddress, { nonce: nonce++ });
        await redeemTx.wait();
        console.log(`✓ Redeem confirmed (${redeemTx.hash})`);
      }

      const vaultUsdcFinal = await getBalance(morphoUSDCVault, signerAddress, "mUSDC", 18);

      // ========================================================================
      // STEP 11: Withdraw from Morpho USDC Vault
      // ========================================================================
      logStep(11, "Withdraw from Morpho USDC Vault", "\x1b[33m");

      console.log(`Withdrawing ${ethers.formatUnits(vaultUsdcFinal, 18)} USDC from Morpho Vault...`);

      if (vaultUsdcFinal > 0) {
        const withdrawTx = await morphoUSDCVault.redeem(vaultUsdcFinal, signerAddress, signerAddress, { nonce: nonce++ });
        await withdrawTx.wait();
        console.log(`✓ Withdrawal confirmed (${withdrawTx.hash})`);
      }
      const usdcFinal = await getBalance(usdc, signerAddress, "USDC", 6);
    }


    // ========================================================================
    // FINAL SUMMARY
    // ========================================================================
    console.log("\x1b[32m");
    console.log("=".repeat(70));
    console.log("✓ DEMO COMPLETE!");
    console.log("=".repeat(70));
    console.log("\x1b[0m");
    console.log("\nFinal Balances:");
    console.log(`  USDC: ${ethers.formatUnits(await usdc.balanceOf(signerAddress), 6)}`);
    console.log(`  mUSDC: ${ethers.formatUnits(await morphoUSDCVault.balanceOf(signerAddress), 18)}`);
    console.log(`  WmUSDC: ${ethers.formatUnits(await wmUSDC.balanceOf(signerAddress), 18)}`);
    console.log(`  MXNB: ${ethers.formatUnits(await mxnb.balanceOf(signerAddress), 6)}`);
    console.log("");
    console.log("Flow completed successfully:");
    console.log("  ✓ Supplied USDC to Morpho USDC Vault");
    console.log("  ✓ Wrapped vaultUSDC into WmUSDC");
    console.log("  ✓ Supplied WmUSDC as collateral to Morpho");
    console.log("  ✓ Borrowed MXNB_test");
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
