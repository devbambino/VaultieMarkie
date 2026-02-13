/**
 * Morpho Blue V1 PoC Frontend
 * Yield Generation & Collateralized Lending on Base Sepolia
 * 
 * Flow:
 * 1. Supply USDC → get mUSDC (Morpho USDC Vault)
 * 2. Wrap mUSDC → get WmUSDC
 * 3. Supply WmUSDC as collateral → Morpho Blue
 * 4. Borrow MXNB → receive MXNB_test
 * 5. Repay MXNB
 * 6. Withdraw WmUSDC collateral
 * 7. Unwrap WmUSDC → get mUSDC
 * 8. Withdraw USDC from Morpho Vault
 */

// ============================================================================
// CONFIGURATION
// ============================================================================

const BASE_SEPOLIA_CONFIG = {
  chainId: 84532,
  rpcUrl: "https://sepolia.base.org",
  blockExplorer: "https://sepolia.basescan.org",
};

const CONTRACT_ADDRESSES = {
  // Base Sepolia Token Addresses
  usdc: "0xba50cd2a20f6da35d788639e581bca8d0b5d4d5f",
  mockMXNB: "0xF19D2F986DC0fb7E2A82cb9b55f7676967F7bC3E",
  
  // Wrapper & Vault Addresses
  wmUSDC: "0xCa4625EA7F3363d7E9e3090f9a293b64229FE55B",
  morphoUSDCVault: "0xA694354Ab641DFB8C6fC47Ceb9223D12cCC373f9",
  morphoMXNBVault: "0xd6a83595b11CCC94bCcde4c9654bcaa6D423896e",
  
  // Morpho Addresses
  morphoBlue: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb",
  
  // Oracle Addresses
  wmusdcMxnbOracle: "0x9f4b138BF3513866153Af9f0A2794096DFebFaD4",
  ethUsdcOracle: "0x97EBCdb0F784CDc9F91490bEBC9C8756491814a3",
};

const MARKET_IDS = {
  usdc: "0x6af42641dd1ddc4fd0c3648e45497a29b78eb50d21fd0f6eac7b8eae2192dd47",
  mxnb: "0xf912f62db71d01c572b28b6953c525851f9e0660df4e422cec986e620da726df",
};


// ============================================================================
// ABI DEFINITIONS
// ============================================================================

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function transfer(address to, uint256 amount) external returns (bool)",
  "function transferFrom(address from, address to, uint256 amount) external returns (bool)",
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
  "function symbol() external view returns (string)",
  "function name() external view returns (string)",
];

const VAULT_ABI = [
  "function deposit(uint256 assets, address receiver) external returns (uint256)",
  "function withdraw(uint256 assets, address receiver, address owner) external returns (uint256)",
  "function redeem(uint256 shares, address receiver, address owner) external returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function asset() external view returns (address)",
];

const WMEMORY_ABI = [
  "function deposit(uint256 assets, address receiver) external returns (uint256)",
  "function redeem(uint256 shares, address receiver, address owner) external returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)",
  "function approve(address spender, uint256 amount) external returns (bool)",
];

const MORPHO_ABI = [
  "function supplyCollateral(tuple(address,address,address,address,uint256) marketParams, uint256 amount, address onBehalf, bytes data) external",
  "function withdrawCollateral(tuple(address,address,address,address,uint256) marketParams, uint256 amount, address onBehalf, address receiver) external",
  "function borrow(tuple(address,address,address,address,uint256) marketParams, uint256 assets, uint256 shares, address onBehalf, address receiver) external returns (uint256, uint256)",
  "function repay(tuple(address,address,address,address,uint256) marketParams, uint256 assets, uint256 shares, address onBehalf, bytes data) external returns (uint256, uint256)",
  "function position(bytes32 id, address user) external view returns (tuple(uint256,uint256,uint256))",
];

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

let currentUser = null;
let provider = null;
let signer = null;
let chainId = null;
let isConnecting = false;

const contracts = {
  usdc: null,
  mxnb: null,
  wmUSDC: null,
  morphoUSDCVault: null,
  morphoMXNBVault: null,
  morpho: null,
};

const displayPrecision = {
  usdc: 6,
  mxnb: 6,
  wmUSDC: 18,
  mUSDC: 18,
  mxnbBorrowed: 12,
};



// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function formatAmount(amount, decimals = 18) {
  if (!amount) return "0.00";
  const formatted = ethers.formatUnits(amount, decimals);
  return parseFloat(formatted).toFixed(4);
}

function parseAmount(amount, decimals = 18) {
  try {
    return ethers.parseUnits(amount.toString(), decimals);
  } catch (e) {
    console.error("Error parsing amount:", e);
    return 0n;
  }
}

function log(message, type = "info") {
  const logContainer = document.getElementById("logContainer");
  const timestamp = new Date().toLocaleTimeString();
  const logLine = document.createElement("div");
  logLine.className = `log-line log-${type}`;
  logLine.textContent = `[${timestamp}] ${message}`;
  logContainer.appendChild(logLine);
  logContainer.scrollTop = logContainer.scrollHeight;
}

function setStatus(elementId, message, type = "info") {
  const statusElement = document.getElementById(elementId);
  if (statusElement) {
    statusElement.className = `status status-${type}`;
    statusElement.textContent = message;
  }
}

function updateWorkflowStep(step, status = "active") {
  const stepElement = document.getElementById(`step-${step}`);
  if (stepElement) {
    stepElement.className = `step ${status}`;
  }
}



// ============================================================================
// CONNECTION & INITIALIZATION
// ============================================================================

async function connectWallet() {
  if (isConnecting) return;
  isConnecting = true;
  
  try {
    // Check if MetaMask is available
    if (!window.ethereum) {
      alert("MetaMask is not installed!");
      return;
    }

    // Request accounts from MetaMask
    const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
    if (!accounts || accounts.length === 0) {
      log("❌ No accounts selected", "error");
      return;
    }

    provider = new ethers.BrowserProvider(window.ethereum);
    signer = await provider.getSigner();
    currentUser = await signer.getAddress();
    chainId = (await provider.getNetwork()).chainId;

    // Verify network
    if (chainId !== BigInt(BASE_SEPOLIA_CONFIG.chainId)) {
      setStatus("aaveStatus", `❌ Wrong network. Please switch to Base Sepolia`, "error");
      setStatus("wausdcStatus", `❌ Wrong network. Please switch to Base Sepolia`, "error");
      setStatus("morphoStatus", `❌ Wrong network. Please switch to Base Sepolia`, "error");
      setStatus("ccopStatus", `❌ Wrong network. Please switch to Base Sepolia`, "error");
      return;
    }

    // Initialize contracts
    initializeContracts();

    // Update UI
    document.getElementById("network").textContent = "Base Sepolia ✓";
    document.getElementById("account").textContent = `${currentUser.slice(0, 6)}...${currentUser.slice(-4)}`;
    document.getElementById("status").textContent = "Connected ✓";
    document.getElementById("connectBtn").disabled = true;
    document.getElementById("connectBtn").textContent = "✓ Connected";

    // Enable all interaction buttons
    enableInteractions(true);

    log("✓ Wallet connected successfully", "success");
    log(`Account: ${currentUser}`, "info");

    // Load initial balances
    await updateBalances();
  } catch (error) {
    console.error("Connection error:", error);
    log(`❌ Connection failed: ${error.message}`, "error");
  } finally {
    isConnecting = false;
  }
}

function initializeContracts() {
  contracts.usdc = new ethers.Contract(CONTRACT_ADDRESSES.usdc, ERC20_ABI, signer);
  contracts.mxnb = new ethers.Contract(CONTRACT_ADDRESSES.mockMXNB, ERC20_ABI, signer);
  contracts.wmUSDC = new ethers.Contract(CONTRACT_ADDRESSES.wmUSDC, WMEMORY_ABI, signer);
  contracts.morphoUSDCVault = new ethers.Contract(CONTRACT_ADDRESSES.morphoUSDCVault, VAULT_ABI, signer);
  contracts.morphoMXNBVault = new ethers.Contract(CONTRACT_ADDRESSES.morphoMXNBVault, VAULT_ABI, signer);
  contracts.morpho = new ethers.Contract(CONTRACT_ADDRESSES.morphoBlue, MORPHO_ABI, signer);

  log("✓ Contracts initialized", "info");
}

function enableInteractions(enabled) {
  document.getElementById("supplyBtn").disabled = !enabled;
  document.getElementById("withdrawAaveBtn").disabled = !enabled;
  document.getElementById("wrapBtn").disabled = !enabled;
  document.getElementById("unwrapBtn").disabled = !enabled;
  document.getElementById("collateralBtn").disabled = !enabled;
  document.getElementById("withdrawCollateralBtn").disabled = !enabled;
  document.getElementById("borrowBtn").disabled = !enabled;
  document.getElementById("repayBtn").disabled = !enabled;
  
  document.getElementById("supplyAmount").disabled = !enabled;
  document.getElementById("borrowAmount").disabled = !enabled;
}



// ============================================================================
// BALANCE UPDATES
// ============================================================================

async function updateBalances() {
  if (!currentUser || !contracts.usdc) return;

  try {
    // Get Morpho USDC Vault balance
    const musdcBalance = await contracts.morphoUSDCVault.balanceOf(currentUser);
    document.getElementById("ausdcBalance").textContent = formatAmount(musdcBalance, displayPrecision.mUSDC);

    // Get USDC balance
    const usdcBalance = await contracts.usdc.balanceOf(currentUser);
    document.getElementById("usdcBalance").textContent = formatAmount(usdcBalance, displayPrecision.usdc);

    // Get WmUSDC balance
    const wmUsdcBalance = await contracts.wmUSDC.balanceOf(currentUser);
    document.getElementById("wausdcBalance").textContent = formatAmount(wmUsdcBalance, displayPrecision.wmUSDC);

    // Get MXNB balance
    const mxnbBalance = await contracts.mxnb.balanceOf(currentUser);
    document.getElementById("ccopBalance").textContent = formatAmount(mxnbBalance, displayPrecision.mxnb);

    // Get Morpho position (collateral and borrow)
    const position = await contracts.morpho.position(MARKET_IDS.mxnb, currentUser);
    const collateral = position[2]; // collateral is 3rd element
    const borrowShares = position[1]; // borrowShares is 2nd element
    
    document.getElementById("morphoCollateral").textContent = formatAmount(collateral, displayPrecision.wmUSDC);
    
    // Estimate borrow amount from borrow shares
    if (borrowShares > 0n) {
      // For now, just show the shares as a rough estimate
      document.getElementById("morphoBorrow").textContent = formatAmount(borrowShares, displayPrecision.mxnbBorrowed);
    } else {
      document.getElementById("morphoBorrow").textContent = "0.00";
    }

  } catch (error) {
    console.error("Error updating balances:", error);
  }
}



// ============================================================================
// TRANSACTION HANDLERS
// ============================================================================

async function executeTransaction(fn, description) {
  try {
    log(`⏳ ${description}...`, "info");
    const tx = await fn();
    log(`📝 Transaction hash: ${tx.hash}`, "info");
    
    const receipt = await tx.wait();
    log(`✓ ${description} confirmed!`, "success");
    
    // Update balances after transaction
    setTimeout(updateBalances, 1000);
    
    return receipt;
  } catch (error) {
    const errorMsg = error.reason || error.message || "Unknown error";
    log(`❌ ${description} failed: ${errorMsg}`, "error");
    throw error;
  }
}

// ============================================================================
// SUPPLY USDC TO MORPHO VAULT
// ============================================================================

async function approveAndSupplyUsdc() {
  if (!currentUser) {
    alert("Please connect wallet first");
    return;
  }

  const amount = document.getElementById("supplyAmount").value;
  const parsedAmount = parseAmount(amount, displayPrecision.usdc);

  if (parsedAmount <= 0) {
    alert("Please enter a valid amount");
    return;
  }

  try {
    updateWorkflowStep(1, "active");
    
    // Check USDC balance
    const balance = await contracts.usdc.balanceOf(currentUser);
    if (balance < parsedAmount) {
      alert(`Insufficient USDC balance. You have ${formatAmount(balance, displayPrecision.usdc)}`);
      return;
    }

    // Approve USDC
    await executeTransaction(
      () => contracts.usdc.approve(CONTRACT_ADDRESSES.morphoUSDCVault, parsedAmount),
      "Approving USDC"
    );

    // Supply to Morpho USDC Vault
    await executeTransaction(
      () => contracts.morphoUSDCVault.deposit(parsedAmount, currentUser),
      "Supplying USDC to Morpho Vault"
    );

    setStatus("aaveStatus", "✓ USDC supplied successfully", "success");
    updateWorkflowStep(1, "completed");
    updateWorkflowStep(2, "active");
  } catch (error) {
    setStatus("aaveStatus", "❌ Supply failed", "error");
  }
}

async function withdrawFromAave() {
  if (!currentUser) {
    alert("Please connect wallet first");
    return;
  }

  try {
    const balance = await contracts.morphoUSDCVault.balanceOf(currentUser);
    if (balance <= 0) {
      alert("No mUSDC balance to withdraw");
      return;
    }

    await executeTransaction(
      () => contracts.morphoUSDCVault.redeem(balance, currentUser, currentUser),
      "Withdrawing from Morpho USDC Vault"
    );

    setStatus("aaveStatus", "✓ Withdrawal successful", "success");
    updateWorkflowStep(8, "completed");
  } catch (error) {
    setStatus("aaveStatus", "❌ Withdrawal failed", "error");
  }
}

// ============================================================================
// WRAP/UNWRAP mUSDC <-> WmUSDC
// ============================================================================

async function wrapAusdcToWausdc() {
  if (!currentUser) {
    alert("Please connect wallet first");
    return;
  }

  try {
    const balance = await contracts.morphoUSDCVault.balanceOf(currentUser);
    if (balance <= 0) {
      alert("No mUSDC balance to wrap");
      return;
    }

    // Approve mUSDC for wmUSDC
    await executeTransaction(
      () => contracts.morphoUSDCVault.approve(CONTRACT_ADDRESSES.wmUSDC, balance),
      "Approving mUSDC for wrapping"
    );

    // Wrap mUSDC -> WmUSDC
    await executeTransaction(
      () => contracts.wmUSDC.deposit(balance, currentUser),
      "Wrapping mUSDC to WmUSDC"
    );

    setStatus("wausdcStatus", "✓ Wrapped successfully", "success");
    updateWorkflowStep(2, "completed");
    updateWorkflowStep(3, "active");
  } catch (error) {
    setStatus("wausdcStatus", "❌ Wrapping failed", "error");
  }
}

async function unwrapWausdcToAusdc() {
  if (!currentUser) {
    alert("Please connect wallet first");
    return;
  }

  try {
    const balance = await contracts.wmUSDC.balanceOf(currentUser);
    if (balance <= 0) {
      alert("No WmUSDC balance to unwrap");
      return;
    }

    await executeTransaction(
      () => contracts.wmUSDC.redeem(balance, currentUser, currentUser),
      "Unwrapping WmUSDC to mUSDC"
    );

    setStatus("wausdcStatus", "✓ Unwrapped successfully", "success");
    updateWorkflowStep(7, "completed");
  } catch (error) {
    setStatus("wausdcStatus", "❌ Unwrapping failed", "error");
  }
}



// ============================================================================
// MORPHO BLUE COLLATERAL & BORROWING
// ============================================================================

const MXNB_MARKET_PARAMS = [
  CONTRACT_ADDRESSES.mockMXNB,        // loanToken
  CONTRACT_ADDRESSES.wmUSDC,          // collateralToken
  CONTRACT_ADDRESSES.wmusdcMxnbOracle, // oracle
  "0x46415998764C29aB2a25CbeA6254146D50D22687", // irm
  ethers.parseEther("0.77"),          // lltv (77%)
];

async function supplyCollateralToMorpho() {
  if (!currentUser) {
    alert("Please connect wallet first");
    return;
  }

  try {
    const balance = await contracts.wmUSDC.balanceOf(currentUser);
    if (balance <= 0) {
      alert("No WmUSDC balance to supply as collateral");
      return;
    }

    // Approve WmUSDC for Morpho
    await executeTransaction(
      () => contracts.wmUSDC.approve(CONTRACT_ADDRESSES.morphoBlue, balance),
      "Approving WmUSDC for Morpho"
    );

    // Supply collateral
    await executeTransaction(
      () => contracts.morpho.supplyCollateral(MXNB_MARKET_PARAMS, balance, currentUser, "0x"),
      "Supplying WmUSDC as collateral"
    );

    setStatus("morphoStatus", "✓ Collateral supplied", "success");
    updateWorkflowStep(3, "completed");
    updateWorkflowStep(4, "active");
  } catch (error) {
    setStatus("morphoStatus", "❌ Collateral supply failed", "error");
  }
}

async function withdrawCollateralFromMorpho() {
  if (!currentUser) {
    alert("Please connect wallet first");
    return;
  }

  try {
    const position = await contracts.morpho.position(MARKET_IDS.mxnb, currentUser);
    const collateral = position[2];

    if (collateral <= 0) {
      alert("No collateral to withdraw");
      return;
    }

    await executeTransaction(
      () => contracts.morpho.withdrawCollateral(MXNB_MARKET_PARAMS, collateral, currentUser, currentUser),
      "Withdrawing WmUSDC collateral"
    );

    setStatus("morphoStatus", "✓ Collateral withdrawn", "success");
    updateWorkflowStep(6, "completed");
  } catch (error) {
    setStatus("morphoStatus", "❌ Collateral withdrawal failed", "error");
  }
}

async function borrowFromMorpho() {
  if (!currentUser) {
    alert("Please connect wallet first");
    return;
  }

  const amount = document.getElementById("borrowAmount").value;
  const parsedAmount = parseAmount(amount, displayPrecision.mxnb);

  if (parsedAmount <= 0) {
    alert("Please enter a valid amount");
    return;
  }

  try {
    // Check collateral first
    const position = await contracts.morpho.position(MARKET_IDS.mxnb, currentUser);
    const collateral = position[2];

    if (collateral <= 0) {
      alert("You must supply collateral first");
      return;
    }

    await executeTransaction(
      () => contracts.morpho.borrow(MXNB_MARKET_PARAMS, parsedAmount, 0, currentUser, currentUser),
      "Borrowing MXNB"
    );

    setStatus("morphoStatus", "✓ MXNB borrowed successfully", "success");
    updateWorkflowStep(4, "completed");
    updateWorkflowStep(5, "active");
  } catch (error) {
    setStatus("morphoStatus", "❌ Borrow failed", "error");
  }
}

async function repayMorphoLoan() {
  if (!currentUser) {
    alert("Please connect wallet first");
    return;
  }

  try {
    // Get current position
    const position = await contracts.morpho.position(MARKET_IDS.mxnb, currentUser);
    const borrowShares = position[1];

    if (borrowShares <= 0) {
      alert("No outstanding debt");
      return;
    }

    // Get MXNB balance
    const mxnbBalance = await contracts.mxnb.balanceOf(currentUser);
    if (mxnbBalance <= 0) {
      alert("No MXNB balance to repay loan");
      return;
    }

    // Approve MXNB for Morpho
    await executeTransaction(
      () => contracts.mxnb.approve(CONTRACT_ADDRESSES.morphoBlue, mxnbBalance),
      "Approving MXNB for repayment"
    );

    // Repay loan - use borrowShares to close position
    await executeTransaction(
      () => contracts.morpho.repay(MXNB_MARKET_PARAMS, 0, borrowShares, currentUser, "0x"),
      "Repaying MXNB loan"
    );

    setStatus("morphoStatus", "✓ Loan repaid successfully", "success");
    updateWorkflowStep(5, "completed");
    updateWorkflowStep(6, "active");
  } catch (error) {
    setStatus("morphoStatus", "❌ Repayment failed", "error");
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function clearLogs() {
  document.getElementById("logContainer").innerHTML = "";
}

// ============================================================================
// MANUAL TESTING & DEVELOPMENT
// ============================================================================

// Auto-connect on page load (for development)
let eventListenersSetup = false;

window.addEventListener("load", () => {
  // Setup MetaMask event listeners once
  if (!eventListenersSetup && window.ethereum) {
    setupEthereumListeners();
  }
});

function setupEthereumListeners() {
  if (eventListenersSetup) return;
  eventListenersSetup = true;

  window.ethereum.on("accountsChanged", async (accounts) => {
    // Only handle if user disconnected (accounts array is empty)
    if (accounts.length === 0) {
      currentUser = null;
      signer = null;
      document.getElementById("connectBtn").textContent = "🔌 Connect MetaMask";
      document.getElementById("connectBtn").disabled = false;
      document.getElementById("network").textContent = "Not connected";
      document.getElementById("account").textContent = "Not connected";
      document.getElementById("status").textContent = "Disconnected";
      enableInteractions(false);
      log("Wallet disconnected", "warning");
    }
  });

  window.ethereum.on("chainChanged", async (newChainIdHex) => {
    if (isConnecting) return;

    // If we are already connected, check if the chain ID actually changed
    if (chainId) {
      const newChainId = BigInt(newChainIdHex);
      if (newChainId === chainId) {
        return; // Chain ID is the same, no need to reload
      }
    }
    
    location.reload();
  });
}

