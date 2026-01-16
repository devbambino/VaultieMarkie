/**
 * Aave + Morpho Blue PoC Frontend
 * 
 * This is the main application logic for interacting with the Web3 PoC.
 * All interactions use ethers.js v6 directly with ABIs.
 * 
 * TODO: Update CONTRACT_ADDRESSES with your deployed addresses
 */

// ============================================================================
// CONFIGURATION - UPDATE WITH YOUR DEPLOYED ADDRESSES
// ============================================================================

const CONFIG = {
    mockCCOP: "0x", // From deploy.ts
    waUSDC: "0x",   // From deploy.ts
    fixedPriceOracle: "0x", // From deploy.ts
    
    // Base Sepolia (do not change)
    usdc: "0xba50cd2a20f6da35d788639e581bca8d0b5d4d5f",
    aUSDC: "0x10f1a9d11cdf50041f3f8cb7191cbe2f31750acc",
    aavePool: "0x7B4eb56E7CD4eFc5c4D044DBC3917eB21f3d5dAE",
    morphoBlue: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb",
    
    chainId: 84532,
    chainName: "Base Sepolia",
};

const MARKET_ID = "0x"; // Update from market-details.json

// ============================================================================
// CONTRACT ABIs
// ============================================================================

const ERC20_ABI = [
    "function approve(address spender, uint256 amount) external returns (bool)",
    "function allowance(address owner, address spender) external view returns (uint256)",
    "function transfer(address to, uint256 amount) external returns (bool)",
    "function transferFrom(address from, address to, uint256 amount) external returns (bool)",
    "function balanceOf(address account) external view returns (uint256)",
    "function totalSupply() external view returns (uint256)",
    "function decimals() external view returns (uint8)",
    "function symbol() external view returns (string)",
    "function name() external view returns (string)",
];

const ERC4626_ABI = [
    ...ERC20_ABI,
    "function deposit(uint256 assets, address receiver) external returns (uint256)",
    "function withdraw(uint256 assets, address receiver, address owner) external returns (uint256)",
    "function mint(uint256 shares, address receiver) external returns (uint256)",
    "function redeem(uint256 shares, address receiver, address owner) external returns (uint256)",
    "function totalAssets() external view returns (uint256)",
    "function convertToShares(uint256 assets) external view returns (uint256)",
    "function convertToAssets(uint256 shares) external view returns (uint256)",
    "function asset() external view returns (address)",
];

const AAVE_POOL_ABI = [
    "function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external",
    "function withdraw(address asset, uint256 amount, address to) external returns (uint256)",
];

const MORPHO_BLUE_ABI = [
    "function supplyCollateral(tuple(address,address,address,address,uint256) marketParams, uint256 amount, address onBehalf, bytes data) external",
    "function withdrawCollateral(tuple(address,address,address,address,uint256) marketParams, uint256 amount, address receiver) external",
    "function borrow(tuple(address,address,address,address,uint256) marketParams, uint256 assets, uint256 shares, address onBehalf, address receiver) external returns (uint256, uint256)",
    "function repay(tuple(address,address,address,address,uint256) marketParams, uint256 assets, uint256 shares, address onBehalf, bytes data) external returns (uint256, uint256)",
    "function position(bytes32 id, address user) external view returns (tuple(uint256,uint256,uint256))",
];

// ============================================================================
// GLOBAL STATE
// ============================================================================

let signer = null;
let provider = null;
let userAddress = null;

// ============================================================================
// LOGGING UTILITIES
// ============================================================================

function addLog(message, type = "info") {
    const logContainer = document.getElementById("logContainer");
    const logLine = document.createElement("div");
    logLine.className = `log-line log-${type}`;
    
    const timestamp = new Date().toLocaleTimeString();
    logLine.textContent = `[${timestamp}] ${message}`;
    
    logContainer.appendChild(logLine);
    logContainer.scrollTop = logContainer.scrollHeight;
}

function clearLogs() {
    document.getElementById("logContainer").innerHTML = "";
}

function setStatus(elementId, message, type = "info") {
    const statusEl = document.getElementById(elementId);
    statusEl.textContent = message;
    statusEl.className = `status status-${type}`;
}

function updateWorkflowStep(stepNum, status) {
    const stepEl = document.getElementById(`step-${stepNum}`);
    if (status === "active") {
        stepEl.className = "step active";
    } else if (status === "completed") {
        stepEl.className = "step completed";
    } else {
        stepEl.className = "step";
    }
}

// ============================================================================
// WALLET CONNECTION
// ============================================================================

async function connectWallet() {
    try {
        if (!window.ethereum) {
            alert("MetaMask is not installed. Please install MetaMask to continue.");
            return;
        }

        // Request account access
        const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
        userAddress = accounts[0];

        // Create provider and signer
        provider = new ethers.BrowserProvider(window.ethereum);
        signer = await provider.getSigner();

        // Check network
        const network = await provider.getNetwork();
        if (network.chainId !== BigInt(CONFIG.chainId)) {
            try {
                await window.ethereum.request({
                    method: "wallet_switchEthereumChain",
                    params: [{ chainId: "0x14a34" }], // 84532 in hex
                });
            } catch (switchError) {
                if (switchError.code === 4902) {
                    // Chain not added to MetaMask
                    await window.ethereum.request({
                        method: "wallet_addEthereumChain",
                        params: [{
                            chainId: "0x14a34",
                            chainName: "Base Sepolia",
                            rpcUrls: ["https://sepolia.base.org"],
                            nativeCurrency: {
                                name: "ETH",
                                symbol: "ETH",
                                decimals: 18,
                            },
                            blockExplorerUrls: ["https://sepolia.basescan.org"],
                        }],
                    });
                }
            }
        }

        // Update UI
        document.getElementById("connectBtn").textContent = "✓ Connected";
        document.getElementById("connectBtn").disabled = true;
        document.getElementById("network").textContent = CONFIG.chainName;
        document.getElementById("account").textContent = truncateAddress(userAddress);
        document.getElementById("status").textContent = "Connected";

        // Enable buttons
        enableAllButtons();

        // Load balances
        await refreshAllBalances();

        addLog(`✓ Wallet connected: ${userAddress}`, "success");
        setStatus("aaveStatus", "Connected to wallet", "success");

    } catch (error) {
        addLog(`❌ Connection failed: ${error.message}`, "error");
        setStatus("aaveStatus", `Error: ${error.message}`, "error");
    }
}

function truncateAddress(address) {
    return `${address.substring(0, 6)}...${address.substring(38)}`;
}

// ============================================================================
// BALANCE UPDATES
// ============================================================================

async function refreshAllBalances() {
    if (!signer || !userAddress) return;

    try {
        // USDC Balance
        const usdc = new ethers.Contract(CONFIG.usdc, ERC20_ABI, provider);
        const usdcBalance = await usdc.balanceOf(userAddress);
        document.getElementById("usdcBalance").textContent = 
            ethers.formatUnits(usdcBalance, 6).substring(0, 10);

        // aUSDC Balance
        const aUsdc = new ethers.Contract(CONFIG.aUSDC, ERC20_ABI, provider);
        const ausdcBalance = await aUsdc.balanceOf(userAddress);
        document.getElementById("ausdcBalance").textContent = 
            ethers.formatUnits(ausdcBalance, 6).substring(0, 10);

        // WaUSDC Balance
        const waUSDC = new ethers.Contract(CONFIG.waUSDC, ERC4626_ABI, provider);
        const wausdcBalance = await waUSDC.balanceOf(userAddress);
        document.getElementById("wausdcBalance").textContent = 
            ethers.formatUnits(wausdcBalance, 6).substring(0, 10);

        // WaUSDC Price per Share
        const totalAssets = await waUSDC.totalAssets();
        const totalSupply = await waUSDC.totalSupply();
        const pricePerShare = totalSupply > 0n ? 
            ethers.formatUnits((totalAssets * 10n**6n) / totalSupply, 6) : "1.00";
        document.getElementById("sharePrice").textContent = 
            pricePerShare.substring(0, 10);

        // cCOP Balance
        const ccop = new ethers.Contract(CONFIG.mockCCOP, ERC20_ABI, provider);
        const ccopBalance = await ccop.balanceOf(userAddress);
        document.getElementById("ccopBalance").textContent = 
            ethers.formatUnits(ccopBalance, 6).substring(0, 10);

        // Morpho Position
        if (MARKET_ID !== "0x") {
            const morpho = new ethers.Contract(CONFIG.morphoBlue, MORPHO_BLUE_ABI, provider);
            try {
                const position = await morpho.position(MARKET_ID, userAddress);
                document.getElementById("morphoCollateral").textContent = 
                    ethers.formatUnits(position[2], 6).substring(0, 10);
                // Note: position[1] is borrow shares, would need to query market data for assets
                document.getElementById("morphoBorrow").textContent = "0.00"; // Placeholder
            } catch (e) {
                // Market may not exist yet
            }
        }

    } catch (error) {
        addLog(`Error refreshing balances: ${error.message}`, "warning");
    }
}

// ============================================================================
// AAVE FUNCTIONS
// ============================================================================

async function approveAndSupplyUsdc() {
    if (!signer || !userAddress) {
        alert("Please connect wallet first");
        return;
    }

    try {
        updateWorkflowStep(1, "active");
        const amount = ethers.parseUnits(document.getElementById("supplyAmount").value || "1000", 6);
        
        addLog(`Starting: Supply ${ethers.formatUnits(amount, 6)} USDC to Aave`, "info");
        setStatus("aaveStatus", "⏳ Approving USDC...", "warning");

        const usdc = new ethers.Contract(CONFIG.usdc, ERC20_ABI, signer);
        const approveTx = await usdc.approve(CONFIG.aavePool, amount);
        await approveTx.wait();
        addLog(`✓ Approval confirmed: ${approveTx.hash}`, "success");

        setStatus("aaveStatus", "⏳ Supplying to Aave...", "warning");
        const aavePool = new ethers.Contract(CONFIG.aavePool, AAVE_POOL_ABI, signer);
        const supplyTx = await aavePool.supply(CONFIG.usdc, amount, userAddress, 0);
        await supplyTx.wait();
        addLog(`✓ Supply confirmed: ${supplyTx.hash}`, "success");

        setStatus("aaveStatus", "✓ USDC supplied to Aave", "success");
        updateWorkflowStep(1, "completed");
        
        await refreshAllBalances();
    } catch (error) {
        addLog(`❌ Supply failed: ${error.message}`, "error");
        setStatus("aaveStatus", `Error: ${error.message}`, "error");
    }
}

async function withdrawFromAave() {
    if (!signer || !userAddress) {
        alert("Please connect wallet first");
        return;
    }

    try {
        updateWorkflowStep(8, "active");
        
        const aUsdc = new ethers.Contract(CONFIG.aUSDC, ERC20_ABI, provider);
        const balance = await aUsdc.balanceOf(userAddress);
        
        addLog(`Starting: Withdraw ${ethers.formatUnits(balance, 6)} aUSDC from Aave`, "info");
        setStatus("aaveStatus", "⏳ Withdrawing...", "warning");

        const aavePool = new ethers.Contract(CONFIG.aavePool, AAVE_POOL_ABI, signer);
        const withdrawTx = await aavePool.withdraw(CONFIG.usdc, balance, userAddress);
        await withdrawTx.wait();
        addLog(`✓ Withdrawal confirmed: ${withdrawTx.hash}`, "success");

        setStatus("aaveStatus", "✓ Withdrawn from Aave", "success");
        updateWorkflowStep(8, "completed");
        
        await refreshAllBalances();
    } catch (error) {
        addLog(`❌ Withdrawal failed: ${error.message}`, "error");
        setStatus("aaveStatus", `Error: ${error.message}`, "error");
    }
}

// ============================================================================
// WaUSDC WRAPPER FUNCTIONS
// ============================================================================

async function wrapAusdcToWausdc() {
    if (!signer || !userAddress) {
        alert("Please connect wallet first");
        return;
    }

    try {
        updateWorkflowStep(2, "active");
        
        const aUsdc = new ethers.Contract(CONFIG.aUSDC, ERC20_ABI, provider);
        const balance = await aUsdc.balanceOf(userAddress);
        
        if (balance === 0n) {
            alert("No aUSDC balance to wrap");
            return;
        }

        addLog(`Starting: Wrap ${ethers.formatUnits(balance, 6)} aUSDC to WaUSDC`, "info");
        setStatus("wausdcStatus", "⏳ Approving aUSDC...", "warning");

        const aUsdcSigner = new ethers.Contract(CONFIG.aUSDC, ERC20_ABI, signer);
        const approveTx = await aUsdcSigner.approve(CONFIG.waUSDC, balance);
        await approveTx.wait();
        addLog(`✓ Approval confirmed: ${approveTx.hash}`, "success");

        setStatus("wausdcStatus", "⏳ Depositing to WaUSDC...", "warning");
        const waUSDC = new ethers.Contract(CONFIG.waUSDC, ERC4626_ABI, signer);
        const depositTx = await waUSDC.deposit(balance, userAddress);
        await depositTx.wait();
        addLog(`✓ Wrap confirmed: ${depositTx.hash}`, "success");

        setStatus("wausdcStatus", "✓ aUSDC wrapped to WaUSDC", "success");
        updateWorkflowStep(2, "completed");
        
        await refreshAllBalances();
    } catch (error) {
        addLog(`❌ Wrap failed: ${error.message}`, "error");
        setStatus("wausdcStatus", `Error: ${error.message}`, "error");
    }
}

async function unwrapWausdcToAusdc() {
    if (!signer || !userAddress) {
        alert("Please connect wallet first");
        return;
    }

    try {
        updateWorkflowStep(7, "active");
        
        const waUSDC = new ethers.Contract(CONFIG.waUSDC, ERC4626_ABI, provider);
        const balance = await waUSDC.balanceOf(userAddress);
        
        if (balance === 0n) {
            alert("No WaUSDC balance to unwrap");
            return;
        }

        addLog(`Starting: Unwrap ${ethers.formatUnits(balance, 6)} WaUSDC to aUSDC`, "info");
        setStatus("wausdcStatus", "⏳ Redeeming from WaUSDC...", "warning");

        const waUsdcSigner = new ethers.Contract(CONFIG.waUSDC, ERC4626_ABI, signer);
        const redeemTx = await waUsdcSigner.redeem(balance, userAddress, userAddress);
        await redeemTx.wait();
        addLog(`✓ Unwrap confirmed: ${redeemTx.hash}`, "success");

        setStatus("wausdcStatus", "✓ WaUSDC unwrapped to aUSDC", "success");
        updateWorkflowStep(7, "completed");
        
        await refreshAllBalances();
    } catch (error) {
        addLog(`❌ Unwrap failed: ${error.message}`, "error");
        setStatus("wausdcStatus", `Error: ${error.message}`, "error");
    }
}

// ============================================================================
// MORPHO BLUE FUNCTIONS
// ============================================================================

function getMarketParams() {
    return [
        CONFIG.mockCCOP,        // loanToken
        CONFIG.waUSDC,          // collateralToken
        CONFIG.fixedPriceOracle, // oracle
        "0x46cAcB97d52D1C1c0c3189d879fD3dAF265b2eee", // irm
        ethers.parseEther("0.77"), // lltv
    ];
}

async function supplyCollateralToMorpho() {
    if (!signer || !userAddress) {
        alert("Please connect wallet first");
        return;
    }

    try {
        updateWorkflowStep(3, "active");
        
        const waUSDC = new ethers.Contract(CONFIG.waUSDC, ERC20_ABI, provider);
        const balance = await waUSDC.balanceOf(userAddress);
        
        if (balance === 0n) {
            alert("No WaUSDC balance");
            return;
        }

        addLog(`Starting: Supply ${ethers.formatUnits(balance, 6)} WaUSDC as collateral`, "info");
        setStatus("morphoStatus", "⏳ Approving WaUSDC...", "warning");

        const waUsdcSigner = new ethers.Contract(CONFIG.waUSDC, ERC20_ABI, signer);
        const approveTx = await waUsdcSigner.approve(CONFIG.morphoBlue, balance);
        await approveTx.wait();
        addLog(`✓ Approval confirmed: ${approveTx.hash}`, "success");

        setStatus("morphoStatus", "⏳ Supplying collateral...", "warning");
        const morpho = new ethers.Contract(CONFIG.morphoBlue, MORPHO_BLUE_ABI, signer);
        const supplyTx = await morpho.supplyCollateral(getMarketParams(), balance, userAddress, "0x");
        await supplyTx.wait();
        addLog(`✓ Collateral supply confirmed: ${supplyTx.hash}`, "success");

        setStatus("morphoStatus", "✓ Collateral supplied to Morpho", "success");
        updateWorkflowStep(3, "completed");
        
        await refreshAllBalances();
    } catch (error) {
        addLog(`❌ Collateral supply failed: ${error.message}`, "error");
        setStatus("morphoStatus", `Error: ${error.message}`, "error");
    }
}

async function borrowFromMorpho() {
    if (!signer || !userAddress) {
        alert("Please connect wallet first");
        return;
    }

    try {
        updateWorkflowStep(4, "active");
        const amount = ethers.parseUnits(document.getElementById("borrowAmount").value || "500", 6);
        
        addLog(`Starting: Borrow ${ethers.formatUnits(amount, 6)} cCOP`, "info");
        setStatus("morphoStatus", "⏳ Borrowing...", "warning");

        const morpho = new ethers.Contract(CONFIG.morphoBlue, MORPHO_BLUE_ABI, signer);
        const borrowTx = await morpho.borrow(
            getMarketParams(),
            amount,
            0,
            userAddress,
            userAddress
        );
        await borrowTx.wait();
        addLog(`✓ Borrow confirmed: ${borrowTx.hash}`, "success");

        setStatus("morphoStatus", "✓ Borrowed cCOP from Morpho", "success");
        updateWorkflowStep(4, "completed");
        
        await refreshAllBalances();
    } catch (error) {
        addLog(`❌ Borrow failed: ${error.message}`, "error");
        setStatus("morphoStatus", `Error: ${error.message}`, "error");
    }
}

async function repayMorphoLoan() {
    if (!signer || !userAddress) {
        alert("Please connect wallet first");
        return;
    }

    try {
        updateWorkflowStep(5, "active");
        
        const ccop = new ethers.Contract(CONFIG.mockCCOP, ERC20_ABI, provider);
        const balance = await ccop.balanceOf(userAddress);
        
        if (balance === 0n) {
            alert("No cCOP balance to repay");
            return;
        }

        addLog(`Starting: Repay ${ethers.formatUnits(balance, 6)} cCOP`, "info");
        setStatus("morphoStatus", "⏳ Approving cCOP...", "warning");

        const ccopSigner = new ethers.Contract(CONFIG.mockCCOP, ERC20_ABI, signer);
        const approveTx = await ccopSigner.approve(CONFIG.morphoBlue, balance);
        await approveTx.wait();
        addLog(`✓ Approval confirmed: ${approveTx.hash}`, "success");

        setStatus("morphoStatus", "⏳ Repaying...", "warning");
        const morpho = new ethers.Contract(CONFIG.morphoBlue, MORPHO_BLUE_ABI, signer);
        const repayTx = await morpho.repay(
            getMarketParams(),
            balance,
            0,
            userAddress,
            "0x"
        );
        await repayTx.wait();
        addLog(`✓ Repayment confirmed: ${repayTx.hash}`, "success");

        setStatus("morphoStatus", "✓ Loan repaid", "success");
        updateWorkflowStep(5, "completed");
        
        await refreshAllBalances();
    } catch (error) {
        addLog(`❌ Repay failed: ${error.message}`, "error");
        setStatus("morphoStatus", `Error: ${error.message}`, "error");
    }
}

async function withdrawCollateralFromMorpho() {
    if (!signer || !userAddress) {
        alert("Please connect wallet first");
        return;
    }

    try {
        updateWorkflowStep(6, "active");
        
        const morpho = new ethers.Contract(CONFIG.morphoBlue, MORPHO_BLUE_ABI, provider);
        const position = await morpho.position(MARKET_ID, userAddress);
        const collateral = position[2];
        
        if (collateral === 0n) {
            alert("No collateral to withdraw");
            return;
        }

        addLog(`Starting: Withdraw ${ethers.formatUnits(collateral, 6)} WaUSDC collateral`, "info");
        setStatus("morphoStatus", "⏳ Withdrawing collateral...", "warning");

        const morphoSigner = new ethers.Contract(CONFIG.morphoBlue, MORPHO_BLUE_ABI, signer);
        const withdrawTx = await morphoSigner.withdrawCollateral(
            getMarketParams(),
            collateral,
            userAddress
        );
        await withdrawTx.wait();
        addLog(`✓ Withdrawal confirmed: ${withdrawTx.hash}`, "success");

        setStatus("morphoStatus", "✓ Collateral withdrawn", "success");
        updateWorkflowStep(6, "completed");
        
        await refreshAllBalances();
    } catch (error) {
        addLog(`❌ Withdrawal failed: ${error.message}`, "error");
        setStatus("morphoStatus", `Error: ${error.message}`, "error");
    }
}

// ============================================================================
// INITIALIZATION
// ============================================================================

function enableAllButtons() {
    document.querySelectorAll("button[disabled]").forEach(btn => {
        if (btn.id !== "connectBtn") {
            btn.disabled = false;
        }
    });
}

function disableAllButtons() {
    document.querySelectorAll("button").forEach(btn => {
        if (btn.id !== "connectBtn") {
            btn.disabled = true;
        }
    });
}

// Auto-connect if already connected
window.addEventListener("load", async () => {
    if (window.ethereum && window.ethereum.selectedAddress) {
        await connectWallet();
    } else {
        disableAllButtons();
    }
});

// Listen for account changes
if (window.ethereum) {
    window.ethereum.on("accountsChanged", async (accounts) => {
        if (accounts.length === 0) {
            userAddress = null;
            signer = null;
            document.getElementById("connectBtn").textContent = "🔌 Connect MetaMask";
            document.getElementById("connectBtn").disabled = false;
            disableAllButtons();
            addLog("Wallet disconnected", "warning");
        } else {
            await connectWallet();
        }
    });

    window.ethereum.on("chainChanged", () => {
        window.location.reload();
    });
}

addLog("Frontend loaded. Click 'Connect MetaMask' to start.", "info");
