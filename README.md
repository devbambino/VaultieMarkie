# Morpho Blue V1 Proof-of-Concept (PoC)

A complete end-to-end demonstration of **yield generation** and **collateralized lending** using **Morpho Blue V1** and **Morpho Vaults** on **Base Sepolia testnet**.

## Overviews

This PoC demonstrates the complete lifecycle of DeFi composability across multiple markets:

### USDC Market Flow
1. **Supply USDC to Morpho Vault** → Earn yield via mUSDC (Morpho USDC Vault token)
2. **Wrap mUSDC into WmUSDC** → ERC-4626 vault with non-rebasing shares
3. **Supply WmUSDC as collateral to Morpho Blue** → Use wrapped yield as collateral
4. **Borrow from market** → Access liquidity
5. **Repay loan** → Settle borrowing position
6. **Withdraw & unwrap** → Convert back to USDC with accrued yield

### MXNB Market Flow
1. **Supply MXNB to Morpho Vault** → Earn yield via mMXNB (Morpho MXNB Vault token)
2. **Supply as collateral to Morpho Blue** → Use yield-bearing token as backing
3. **Borrow USDC from market** → Access liquidity against MXNB collateral
4. **Repay and withdraw** → Settle position and recover collateral

### Key Features

- ✅ **Multi-market support** — USDC and MXNB markets with separate configurations
- ✅ **Morpho Vaults** — Direct integration with Morpho's yield-bearing tokens (mUSDC, mMXNB)
- ✅ **ERC-4626 compliant wrapper** (WmUSDC) for additional composability
- ✅ **Direct contract interaction** using ethers.js v6 and explicit ABIs
- ✅ **Morpho Blue market creation** programmatically with custom oracles
- ✅ **Granular script operations** — Deploy, create markets, supply, borrow, repay individually
- ✅ **Interactive Frontend UI** for wallet integration, balance tracking, and transaction management
- ✅ **No SDK abstractions** — pure smart contract calls for maximum transparency

## IMPORTANT!!!!

The app is working on Base Sepolia. You will need Sepolia ETH, USDC(Aave's version of USDC) and MXNB(our version of MXNB) for testing. For getting the tokens you need to:

1. I've created a smart contract faucet for MXNB tokens, deployed to Base Sepolia. You only need to send Sepolia ETH from your wallet to the SC's address(`0xcC36c043eeDB630f001E3C892F4b5f37120fd003`) in Base Sepolia and the SC will automatically transfer back the corresponding amount of MXNB tokens(the FX rate is 1 ETH to 33548.87 MXNB). The Faucet smart contract is located at `/contracts/MXNBFaucet.sol`. For checking the real time liquidity of the faucet in Sepolia Basescan [click here](https://sepolia.basescan.org/address/0xcC36c043eeDB630f001E3C892F4b5f37120fd003), which is more than 1,000,000 MXNB.

2. For getting USDC enter Aave's faucet in Base Sepolia here(https://app.aave.com/faucet/), remember to enable the testnet mode.

---

## Project Structure

```
VaultieMarkie/
├── contracts/
│   ├── MockMXNB.sol                 # Mock MXNB token for testing
│   ├── MockWETH.sol                 # Mock WETH token (placeholder)
│   ├── WmUSDC.sol                   # ERC-4626 wrapper around Morpho mUSDC
│   ├── EthUsdcOracle.sol            # Price oracle for ETH/USDC pair
│   └── WmusdcMxnbOracle.sol         # Price oracle for WmUSDC/MXNB pair
├── scripts/
│   ├── deploy.ts                    # Deploy mock tokens and wrapper contract
│   ├── createUSDCMarket.ts          # Create Morpho Blue market for USDC
│   ├── createMXNBMarket.ts          # Create Morpho Blue market for MXNB
│   ├── supplyUSDC.ts                # Supply to USDC Morpho Vault
│   ├── supplyMXNB.ts                # Supply to MXNB Morpho Vault
│   ├── borrowUSDC.ts                # Borrow & repay from USDC market
│   ├── borrowMXNB.ts                # Borrow & repay from MXNB market
│   └── demoFlow.ts                  # End-to-end demo across multiple markets
├── frontend/
│   ├── index.html                   # Interactive UI with market operations
│   └── app.js                       # ethers.js v6 transaction logic
├── src/
│   └── config.ts                    # Centralized addresses & ABIs
├── hardhat.config.ts                # Hardhat configuration
├── tsconfig.json                    # TypeScript config
└── README.md                         # This file
```

---

## Tech Stack

| Component | Version | Purpose |
|-----------|---------|---------|
| **Hardhat** | Latest | Smart contract development & deployment |
| **TypeScript** | ^5.0 | Type-safe scripts |
| **Solidity** | ^0.8.19 | Smart contracts |
| **ethers.js** | 6.13.2 | Frontend & script blockchain interaction |
| **OpenZeppelin** | Latest | ERC20, ERC-4626 implementations |

---

## Prerequisites

1. **Node.js** v18+ and **npm**
2. **MetaMask** browser extension
3. **Base Sepolia testnet ETH** (from faucet)
4. **USDC on Base Sepolia** (from faucet or token contract)

---

## Setup Instructions

### 1. Install Dependencies

```bash
cd /workspaces/VaultieMarkie
npm install --legacy-peer-deps
```

### 2. Create Environment File

```bash
cp .env.example .env
```

Edit `.env` and add:

```env
# Required: Private key of deployment account (without 0x prefix)
PRIVATE_KEY=your_private_key_here

# Optional: Override Base Sepolia RPC (default: https://sepolia.base.org)
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org

# Optional: Enable gas reporting
REPORT_GAS=false

# Optional: Enable network forking
FORKING=false
```

⚠️ **NEVER commit `.env` to version control!**

### 3. Get Test Assets

**Base Sepolia ETH:**
- https://basefaucet.com/ (Alchemy)
- https://portal.cdp.coinbase.com/products/faucet (Coinbase)
- https://thirdweb.com/base-sepolia-testnet (thirdweb)

**USDC on Base Sepolia:**
- Aave Faucet: https://app.aave.com/faucet/
- Claim directly from pool using ethers script

---

## Deployment & Execution

### Step 1: Compile Contracts

```bash
npm run compile
```

This generates ABIs and bytecode from Solidity contracts.

### Step 2: Deploy Contracts

```bash
npm run deploy
```

**Output:**

```
Deployed Addresses:
  MockMXNB:         0x...
  MockWETH:         0x...
  WmUSDC:           0x...
  WmusdcMxnbOracle: 0x...
  EthUsdcOracle:    0x...
```

**Action:** Copy these addresses to:
1. `frontend/app.js` (update `CONTRACT_ADDRESSES` object)
2. Market creation scripts will reference these automatically

### Step 3: Create Markets

**Create USDC Market:**
```bash
npm run create-market-usd
```

**Output:** Saves market details to `market-details-usdc.json`:
```json
{
  "vaultAddress": "0x...",
  "marketId": "0x...",
  "loanToken": "0x...",
  "collateralToken": "0x...",
  "oracle": "0x...",
  "irm": "0x...",
  "lltv": "770000000000000000"
}
```

**Create MXNB Market:**
```bash
npm run create-market-mxn
```

**Output:** Saves market details to `market-details-mxnb.json`

### Step 4: Supply to Morpho Vaults

**Supply USDC:**
```bash
npm run supply-usd
```

**Supply MXNB:**
```bash
npm run supply-mxn
```

These scripts:
1. Deposit tokens to Morpho's yield-bearing vaults (mUSDC / mMXNB)
2. Approve vault token for collateral supply to Morpho Blue
3. Supply collateral to respective markets

### Step 5: Borrow & Repay

**Borrow from USDC Market:**
```bash
npm run borrow-usd
```

**Borrow from MXNB Market (if MXNB collateral):**
```bash
npm run supply-mxn
```

These scripts demonstrate:
1. ✓ Supplying collateral to Morpho Blue market
2. ✓ Borrowing against collateral
3. ✓ Repaying borrowed amount
4. ✓ Withdrawing collateral

### Step 6: Run Full Demo (Optional)

Execute all operations in sequence:
```bash
npm run demo
```

This runs the complete end-to-end flow across multiple markets.

---

## Frontend Usage

### Launch Frontend

```bash
npm run serve
```

Open: http://localhost:8000

### Features

The interactive frontend (`frontend/index.html` and `frontend/app.js`) provides:

**Multi-Market Dashboard:**
- Real-time wallet balance display (USDC, MXNB, mUSDC, mMXNB, WmUSDC)
- Separate panels for USDC and MXNB market operations
- Network status and account information

**USDC Market Operations:**
- Supply USDC → mUSDC (Morpho USDC Vault)
- Wrap mUSDC → WmUSDC (ERC-4626)
- Supply WmUSDC as collateral
- Borrow from USDC-based market
- Repay borrowed amount
- Withdraw collateral

**MXNB Market Operations:**
- Supply MXNB → mMXNB (Morpho MXNB Vault)
- Supply mMXNB as collateral
- Borrow USDC against MXNB collateral
- Repay and withdraw

**Advanced Features:**
- Transaction status tracking with BaseScan links
- Balance refreshing and approval status
- Health factor calculations
- Borrowing capacity indicators
- Error handling with clear messages

### Configuration

Update `frontend/app.js` with deployed addresses:

```javascript
const CONTRACT_ADDRESSES = {
  usdc: "0x...",                    // From Aave (Base Sepolia)
  mockMXNB: "0x...",                // From deploy output
  wmUSDC: "0x...",                  // From deploy output
  morphoUSDCVault: "0x...",         // Morpho USDC Vault
  morphoMXNBVault: "0x...",         // Morpho MXNB Vault
  morphoBlue: "0x...",              // Morpho Blue core
  wmusdcMxnbOracle: "0x...",        // From deploy output
  ethUsdcOracle: "0x...",           // From deploy output
};

const MARKET_IDS = {
  usdc: "0x...",                    // From createUSDCMarket output
  mxnb: "0x...",                    // From createMXNBMarket output
};
```

---

## Smart Contracts

### 1. MockMXNB.sol

**Purpose:** ERC20 mock token for testing MXNB market operations.

**Key Functions:**
- `mint(address to, uint256 amount)` — Owner-only minting
- `burn(address from, uint256 amount)` — Owner-only burning
- Standard ERC20: `transfer()`, `approve()`, `balanceOf()`

**Decimals:** 6 (matches USDC)

### 2. MockWETH.sol

**Purpose:** ERC20 mock token for WETH placeholder testing.

**Key Functions:**
- Standard ERC20 interface
- `deposit()` / `withdraw()` — Placeholder methods
- Decimals: 18

### 3. WmUSDC.sol

**Purpose:** ERC-4626 vault wrapper around Morpho's mUSDC token.

**Key Functions:**
- `deposit(uint256 assets, address receiver) → uint256 shares` — Supply mUSDC, receive shares
- `redeem(uint256 shares, address receiver, address owner) → uint256 assets` — Burn shares, receive mUSDC
- `withdraw(uint256 assets, address receiver, address owner) → uint256 shares` — Withdraw mUSDC, burn shares
- `totalAssets() → uint256` — Return current mUSDC balance (includes accrued yield)
- `convertToShares(uint256 assets) → uint256` — Preview shares for assets
- `convertToAssets(uint256 shares) → uint256` — Preview assets for shares

**Key Properties:**
- Non-rebasing shares (unlike mUSDC)
- Price per share increases as Morpho yields accrue
- Fully ERC-4626 compliant
- Enables composability for collateral in Morpho Blue

### 4. EthUsdcOracle.sol

**Purpose:** Price oracle providing ETH/USDC exchange rate for Morpho Blue markets.

**Key Function:**
- `latestAnswer() → uint256` — Returns current ETH/USDC price in 8 decimal format

**Pricing Logic:**

For Morpho Blue oracle requirements:
```
price = collateral_price * 10^(loan_decimals + 36 - collateral_decimals)
```

### 5. WmusdcMxnbOracle.sol

**Purpose:** Price oracle for WmUSDC/MXNB market pricing.

**Key Function:**
- `latestAnswer() → uint256` — Returns WmUSDC price relative to MXNB

**Used In:** USDC market where MXNB is borrowed against WmUSDC collateral

---

## Morpho Blue Markets

This PoC creates and manages two distinct Morpho Blue markets:

### Market 1: USDC Loan / WmUSDC Collateral

**Configuration:**
```solidity
struct MarketParams {
    address loanToken;          // USDC (Base Sepolia testnet)
    address collateralToken;    // WmUSDC (ERC-4626 wrapper)
    address oracle;             // EthUsdcOracle or WmusdcMxnbOracle
    address irm;                // Morpho DefaultIRM
    uint256 lltv;               // 770000000000000000 (77%)
}
```

**Operations:**
1. Supply USDC to Morpho Vault → receive mUSDC
2. Wrap mUSDC into WmUSDC
3. Supply WmUSDC as collateral to Morpho Blue
4. Borrow USDC up to 77% of collateral value
5. Repay and withdraw

### Market 2: USDC Loan / MXNB Collateral (Optional)

**Configuration:**
```solidity
struct MarketParams {
    address loanToken;          // USDC
    address collateralToken;    // MXNB (mock)
    address oracle;             // EthUsdcOracle
    address irm;                // Morpho DefaultIRM
    uint256 lltv;               // 770000000000000000 (77%)
}
```

**Note:** Can be enabled by modifying `scripts/createUSDCMarket.ts` to accept MXNB collateral instead of WmUSDC.

### Health Factor

```
healthFactor = (collateralValue * LLTV) / borrowedValue
```

**Must be > 1.0** to avoid liquidation risk.

**Example:**
- Supply 100 WmUSDC (= $100 value)
- 77% LTV → Can borrow up to $77
- If you borrow $60 → Health Factor = 77 / 60 = 1.28 ✓
- If you borrow $77 → Health Factor = 77 / 77 = 1.0 ⚠️ (liquidation risk)

---

## Development Workflow

### Quick Start (All Steps)

```bash
# 1. Install dependencies
npm install --legacy-peer-deps

# 2. Compile contracts
npm run compile

# 3. Deploy contracts
npm run deploy

# 4. Create USDC market
npm run create-market-usd

# 5. Create MXNB market  
npm run create-market-mxn

# 6. Supply to vaults
npm run supply-usd
npm run supply-mxn

# 7. Test borrowing
npm run borrow-usd

# 8. Launch frontend
npm run serve
# Open http://localhost:8000
```

### Script Reference

| Command | Purpose |
|---------|---------|
| `npm run compile` | Compile Solidity contracts |
| `npm run deploy` | Deploy mock tokens and wrapper contracts |
| `npm run create-market-usd` | Create USDC-denominated market |
| `npm run create-market-mxn` | Create MXNB-denominated market |
| `npm run supply-usd` | Supply USDC to Morpho Vault |
| `npm run supply-mxn` | Supply MXNB to Morpho Vault |
| `npm run borrow-usd` | Execute borrow/repay flow on USDC market |
| `npm run demo` | Run complete end-to-end demo |
| `npm run serve` | Launch frontend UI on localhost:8000 |
| `npm run test` | Run Hardhat tests |

---

## Troubleshooting

### "Network not supported"

Ensure MetaMask is set to **Base Sepolia (Chain ID: 84532)**.

**Add manually:**
- RPC: `https://sepolia.base.org`
- Chain ID: `84532`
- Currency: ETH

### "Insufficient balance"

Get Base Sepolia ETH and USDC from faucets (see Prerequisites).

### "Market creation failed"

Ensure:
1. You have recent deploy addresses from `npm run deploy`
2. USDC and WETH are correctly configured
3. RPC endpoint is responding

### "Borrow amount exceeds capacity"

Ensure:
1. Collateral successfully supplied to Morpho Blue
2. Borrow amount ≤ 77% of collateral value
3. Health factor would remain > 1.0

### "Market not found in frontend"

Ensure:
1. Market IDs are correctly set in `frontend/app.js`
2. Market was created on correct network (Base Sepolia)
3. Market details JSON file exists

---

## Canonical References

### Base Sepolia Tokens
- **USDC:** `0xba50cd2a20f6da35d788639e581bca8d0b5d4d5f` (Aave testnet USDC, 6 decimals)
- **WETH:** `0x1ddebA64A8B13060e13d15504500Dd962eECD35B` (Base Sepolia WETH, 18 decimals)

### Morpho Core (Base Sepolia)
- **Morpho Blue:** `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb`
- **Vault Factory:** `0x2c3FE6D71F8d54B063411Abb446B49f13725F784`
- **Default IRM:** `0x46415998764C29aB2a25CbeA6254146D50D22687`
- [Morpho Docs](https://docs.morpho.org/curate/tutorials-market-v1/creating-market/)

### Key Deployment Files
- `deploy-addresses-mor.json` — Deployed contract addresses
- `market-details-usdc.json` — USDC market parameters and IDs
- `market-details-mxnb.json` — MXNB market parameters and IDs
- `market-details.json` — Legacy market details (deprecated)

### Network Information
- **Network:** Base Sepolia
- **Chain ID:** 84532
- **RPC:** https://sepolia.base.org
- **Block Explorer:** https://sepolia.basescan.org

### Reference Links
- [Morpho Blue Documentation](https://docs.morpho.org/)
- [ERC-4626 Standard](https://eips.ethereum.org/EIPS/eip-4626)
- [Morpho Vault Market Curation](https://docs.morpho.org/curate/)
- [Base Sepolia Faucets](https://docs.base.org/guides/ecosystem-faucets/)

---

## Security Considerations (PoC Only)

⚠️ **This is a PoC. Not audited. Not production-ready.**

- **MockMXNB / MockWETH:** Test tokens only with owner-only minting. For testing only.
- **WmUSDC:** No access controls or pause mechanisms. Test wrapper only.
- **Oracles (EthUsdcOracle, WmusdcMxnbOracle):** Fixed/simple pricing suitable for testing only. Production would require reliable price feeds.
- **No slippage protection** on swap-like operations
- **No circuit breakers** or emergency pause mechanisms
- **Assumes 77% LLTV** — Not validated against various market conditions
- **Market parameters hardcoded** — Not adaptable to different risk profiles

---

**Status:** ✅ Ready for Base Sepolia testnet

**Last Updated:** February 2026
