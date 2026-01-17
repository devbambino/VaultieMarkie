/**
 * End-to-End Demo Flow Script
 * 
 * This script demonstrates the complete lifecycle:
 * 1. Supply USDC to Aave → receive aUSDC
 * 2. Wrap aUSDC into WaUSDC
 * 3. Supply WaUSDC as collateral to Morpho
 * 4. Borrow cCOP_test from Morpho
 * 5. Repay cCOP_test
 * 6. Withdraw WaUSDC collateral from Morpho
 * 7. Unwrap WaUSDC back into aUSDC
 * 8. Withdraw from Aave → receive USDC
 * 
 * Prerequisites:
 * 1. npx hardhat run scripts/deploy.ts --network baseSepolia
 * 2. npx hardhat run scripts/createMarket.ts --network baseSepolia
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
};

// Base Sepolia addresses (do not change)
const BASE_SEPOLIA = {
  usdc: "0xba50cd2a20f6da35d788639e581bca8d0b5d4d5f", // Aave's Testnet USDC
  aUSDC: "0x10f1a9d11cdf50041f3f8cb7191cbe2f31750acc",
  aavePool: "0x7B4eb56E7CD4eFc5c4D044DBC3917eB21f3d5dAE",
  morphoBlue: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb",
};

// UPDATE THIS from market-details.json after createMarket.ts
const MARKET_ID = "0x9e745eaf869d3f5112802a512d07f3ccab77233e8cb245a7d762bb6e8fdc9f69"; // Will be set after createMarket.ts

// Amount to supply (1,000 USDC = 1,000 * 10^6 wei)
const SUPPLY_AMOUNT = ethers.parseUnits("1000", 6);

// Amount to borrow (500 cCOP = 500 * 10^6 wei)
const BORROW_AMOUNT = ethers.parseUnits("500", 6);

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
async function getBalance(token: ethersLib.Contract, account: string, symbol: string): Promise<bigint> {
  const balance = await token.balanceOf(account);
  const decimals = await token.decimals();
  const formatted = ethers.formatUnits(balance, decimals);
  console.log(`${symbol} Balance: ${formatted}`);
  return balance;
}

async function main() {
  console.log("\x1b[32m");
  console.log("╔" + "═".repeat(68) + "╗");
  console.log("║" + " ".repeat(68) + "║");
  console.log("║" + "  AAVE V3 + MORPHO BLUE V1 END-TO-END PoC DEMO".padStart(68) + "║");
  console.log("║" + "  Base Sepolia Testnet".padStart(68) + "║");
  console.log("║" + " ".repeat(68) + "║");
  console.log("╚" + "═".repeat(68) + "╝");
  console.log("\x1b[0m");

  // Verify addresses are configured
  if (!CONTRACT_ADDRESSES.mockCCOP.startsWith("0x") || CONTRACT_ADDRESSES.mockCCOP === "0x") {
    throw new Error("ERROR: Update CONTRACT_ADDRESSES in this script with values from deploy.ts");
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
    // STEP 1: Mint USDC (for testing)
    // ========================================================================
    logStep(1, "Mint Test USDC", "\x1b[33m");
    
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
    // For this demo, we assume USDC is already available
    if (usdcBalance < SUPPLY_AMOUNT) {
      console.log(`\n⚠️  USDC balance (${ethers.formatUnits(usdcBalance, 6)}) is less than needed (${ethers.formatUnits(SUPPLY_AMOUNT, 6)})`);
      console.log(`Please get USDC from: https://app.aave.com/faucet/`);
      return;
    }

    // ========================================================================
    // STEP 2: Approve USDC to Aave Pool
    // ========================================================================
    logStep(2, "Approve USDC for Aave Supply", "\x1b[33m");
    
    console.log(`Approving ${ethers.formatUnits(SUPPLY_AMOUNT, 6)} USDC to Aave Pool...`);
    let approveTx = await usdc.approve(BASE_SEPOLIA.aavePool, SUPPLY_AMOUNT);
    await approveTx.wait();
    console.log(`✓ Approval confirmed (${approveTx.hash})`);

    // ========================================================================
    // STEP 3: Supply USDC to Aave
    // ========================================================================
    logStep(3, "Supply USDC to Aave V3 Pool", "\x1b[33m");
    
    const aavePoolABI = [
      "function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external",
      "function withdraw(address asset, uint256 amount, address to) external returns (uint256)",
    ];
    
    const aavePool = new ethers.Contract(BASE_SEPOLIA.aavePool, aavePoolABI, signer);
    
    console.log(`Supplying ${ethers.formatUnits(SUPPLY_AMOUNT, 6)} USDC to Aave...`);
    let supplyTx = await aavePool.supply(BASE_SEPOLIA.usdc, SUPPLY_AMOUNT, signerAddress, 0);
    await supplyTx.wait();
    console.log(`✓ Supply confirmed (${supplyTx.hash})`);

    // Verify aUSDC received
    const aUsdcABI = ["function balanceOf(address) external view returns (uint256)"];
    const aUsdc = new ethers.Contract(BASE_SEPOLIA.aUSDC, aUsdcABI, signer);
    await getBalance(aUsdc, signerAddress, "aUSDC");

    // ========================================================================
    // STEP 4: Wrap aUSDC into WaUSDC
    // ========================================================================
    logStep(4, "Wrap aUSDC into WaUSDC", "\x1b[33m");
    
    const waUSDCABI = [
      "function deposit(uint256 assets, address receiver) external returns (uint256)",
      "function balanceOf(address) external view returns (uint256)",
    ];
    
    const waUSDC = new ethers.Contract(CONTRACT_ADDRESSES.waUSDC, waUSDCABI, signer);
    
    // Get aUSDC balance
    const aUsdcBalance = await aUsdc.balanceOf(signerAddress);
    console.log(`Approving aUSDC to WaUSDC wrapper...`);
    approveTx = await aUsdc.approve(CONTRACT_ADDRESSES.waUSDC, aUsdcBalance);
    await approveTx.wait();
    console.log(`✓ Approval confirmed (${approveTx.hash})`);
    
    console.log(`Wrapping ${ethers.formatUnits(aUsdcBalance, 6)} aUSDC into WaUSDC...`);
    const depositTx = await waUSDC.deposit(aUsdcBalance, signerAddress);
    await depositTx.wait();
    console.log(`✓ Deposit confirmed (${depositTx.hash})`);

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
      "function withdrawCollateral(tuple(address,address,address,address,uint256) marketParams, uint256 amount, address receiver) external",
    ];
    
    const morpho = new ethers.Contract(BASE_SEPOLIA.morphoBlue, morphoABI, signer);
    
    // Create market params
    const marketParams = [
      CONTRACT_ADDRESSES.mockCCOP,     // loanToken
      CONTRACT_ADDRESSES.waUSDC,       // collateralToken
      CONTRACT_ADDRESSES.fixedPriceOracle, // oracle
      "0x46cAcB97d52D1C1c0c3189d879fD3dAF265b2eee", // irm (default)
      ethers.parseEther("0.77"),       // lltv (77%)
    ];
    
    console.log(`Supplying ${ethers.formatUnits(waUsdcBalance, 6)} WaUSDC as collateral...`);
    const supplyCollateralTx = await morpho.supplyCollateral(marketParams, waUsdcBalance, signerAddress, "0x");
    await supplyCollateralTx.wait();
    console.log(`✓ Collateral supply confirmed (${supplyCollateralTx.hash})`);

    // Verify collateral position
    const position = await morpho.position(MARKET_ID, signerAddress);
    console.log(`Morpho Position - Collateral: ${ethers.formatUnits(position[2], 6)} WaUSDC`);

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
    
    const ccopBalance = await ccop.balanceOf(signerAddress);
    console.log(`Approving cCOP to Morpho for repayment...`);
    const approveCcopTx = await ccop.approve(BASE_SEPOLIA.morphoBlue, ccopBalance);
    await approveCcopTx.wait();
    console.log(`✓ Approval confirmed (${approveCcopTx.hash})`);
    
    console.log(`Repaying ${ethers.formatUnits(ccopBalance, 6)} cCOP...`);
    const repayTx = await morpho.repay(
      marketParams,
      ccopBalance,  // assets
      0,            // shares
      signerAddress,
      "0x"
    );
    await repayTx.wait();
    console.log(`✓ Repayment confirmed (${repayTx.hash})`);

    // ========================================================================
    // STEP 9: Withdraw WaUSDC Collateral from Morpho
    // ========================================================================
    logStep(9, "Withdraw WaUSDC Collateral from Morpho", "\x1b[33m");
    
    const updatedPosition = await morpho.position(MARKET_ID, signerAddress);
    const collateralToWithdraw = updatedPosition[2];
    
    console.log(`Withdrawing ${ethers.formatUnits(collateralToWithdraw, 6)} WaUSDC from Morpho...`);
    const withdrawCollateralTx = await morpho.withdrawCollateral(
      marketParams,
      collateralToWithdraw,
      signerAddress
    );
    await withdrawCollateralTx.wait();
    console.log(`✓ Withdrawal confirmed (${withdrawCollateralTx.hash})`);

    await getBalance(waUSDC, signerAddress, "WaUSDC");

    // ========================================================================
    // STEP 10: Unwrap WaUSDC back to aUSDC
    // ========================================================================
    logStep(10, "Unwrap WaUSDC back to aUSDC", "\x1b[33m");
    
    const waUsdcFinalBalance = await waUSDC.balanceOf(signerAddress);
    console.log(`Redeeming ${ethers.formatUnits(waUsdcFinalBalance, 6)} WaUSDC for aUSDC...`);
    
    const redeemABI = ["function redeem(uint256 shares, address receiver, address owner) external returns (uint256)"];
    const waUsdcRedeem = new ethers.Contract(CONTRACT_ADDRESSES.waUSDC, redeemABI, signer);
    
    const redeemTx = await waUsdcRedeem.redeem(waUsdcFinalBalance, signerAddress, signerAddress);
    await redeemTx.wait();
    console.log(`✓ Redeem confirmed (${redeemTx.hash})`);

    const aUsdcFinal = await getBalance(aUsdc, signerAddress, "aUSDC");

    // ========================================================================
    // STEP 11: Withdraw from Aave
    // ========================================================================
    logStep(11, "Withdraw from Aave Pool", "\x1b[33m");
    
    console.log(`Withdrawing ${ethers.formatUnits(aUsdcFinal, 6)} aUSDC from Aave...`);
    const withdrawTx = await aavePool.withdraw(BASE_SEPOLIA.usdc, aUsdcFinal, signerAddress);
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
    console.log(`  aUSDC: ${ethers.formatUnits(aUsdcFinal, 6)}`);
    console.log(`  WaUSDC: ${ethers.formatUnits(await waUSDC.balanceOf(signerAddress), 6)}`);
    console.log(`  cCOP: ${ethers.formatUnits(await ccop.balanceOf(signerAddress), 6)}`);
    console.log("");
    console.log("Flow completed successfully:");
    console.log("  ✓ Supplied USDC to Aave");
    console.log("  ✓ Wrapped aUSDC into WaUSDC");
    console.log("  ✓ Supplied WaUSDC as collateral to Morpho");
    console.log("  ✓ Borrowed cCOP_test");
    console.log("  ✓ Repaid loan");
    console.log("  ✓ Withdrew collateral");
    console.log("  ✓ Unwrapped back to aUSDC");
    console.log("  ✓ Withdrew from Aave");
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
