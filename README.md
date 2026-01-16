# Aave V3 + Morpho Blue V1 Proof-of-Concept (PoC)

A complete end-to-end demonstration of **yield generation** via **Aave V3** and **collateralized lending** via **Morpho Blue V1** on **Base Sepolia testnet**.

## Overview

This PoC demonstrates the complete lifecycle of DeFi composability:

1. **Supply USDC to Aave** → Earn yield via aUSDC (interest-bearing token)
2. **Wrap aUSDC into WaUSDC** → ERC-4626 vault with non-rebasing shares
3. **Supply WaUSDC as collateral to Morpho** → Use wrapped yield as backing
4. **Borrow cCOP_test from Morpho** → Access liquidity
5. **Repay loan** → Settle borrowing position
6. **Withdraw & unwrap** → Convert back to USDC with accrued yield

### Key Features

- ✅ **Direct contract interaction** using ethers.js v6 and explicit ABIs
- ✅ **ERC-4626 compliant wrapper** around Aave aToken
- ✅ **Morpho Blue market creation** programmatically
- ✅ **No SDK abstractions** — pure smart contract calls
- ✅ **Frontend UI** for wallet integration and transaction tracking
- ✅ **Comprehensive Hardhat scripts** for deployment and demo

---

## Project Structure

```
VaultieMarkie/
├── contracts/
│   ├── MockCCOP.sol                 # Mock ERC20 for borrowing
│   ├── WaUSDC.sol                   # ERC-4626 wrapper around aUSDC
│   └── FixedPriceOracle.sol         # Simple oracle for Morpho Blue
├── scripts/
│   ├── deploy.ts                    # Deploy all contracts
│   ├── createMarket.ts              # Create Morpho market
│   └── demoFlow.ts                  # End-to-end demo flow
├── frontend/
│   ├── index.html                   # Main UI
│   └── app.js                       # ethers.js v6 interaction logic
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
  MockCCOP:         0x...
  WaUSDC:           0x...
  FixedPriceOracle: 0x...
```

**Action:** Copy these addresses to:
1. `src/config.ts` (update addresses)
2. `frontend/app.js` (update CONFIG object)

### Step 3: Create Morpho Market

```bash
npm run create-market
```

First, **update** `scripts/createMarket.ts` with deployed addresses:

```typescript
const CONTRACT_ADDRESSES = {
  mockCCOP: "0x...",        // From deploy output
  waUSDC: "0x...",          // From deploy output
  fixedPriceOracle: "0x...", // From deploy output
};
```

**Output:**

```
Market Creation Complete
Market ID: 0x...
```

**Action:** Copy Market ID to:
1. `scripts/demoFlow.ts`
2. `frontend/app.js`

### Step 4: Run Demo Flow

```bash
npm run demo
```

This executes the complete end-to-end flow:

1. ✓ Supplies USDC to Aave
2. ✓ Wraps aUSDC into WaUSDC
3. ✓ Supplies WaUSDC as collateral
4. ✓ Borrows cCOP_test
5. ✓ Repays loan
6. ✓ Withdraws collateral
7. ✓ Unwraps to aUSDC
8. ✓ Withdraws final USDC + yield

**Expected Output:**

```
Final Balances:
  USDC: 1000.00
  aUSDC: 0.00
  WaUSDC: 0.00
  cCOP: 0.00

✓ All flows completed successfully
```

---

## Frontend Usage

### Launch Frontend

```bash
npm run serve
```

Open: http://localhost:8000

### Features

- **Connect MetaMask** to Base Sepolia
- **Supply USDC** to Aave V3
- **Wrap/Unwrap** aUSDC ↔ WaUSDC
- **Supply Collateral** to Morpho Blue
- **Borrow/Repay** cCOP_test
- **Real-time Balance Updates**
- **Transaction Logs** with links to BaseScan

### Configuration

Update `frontend/app.js`:

```javascript
const CONFIG = {
    mockCCOP: "0x...",           // From deploy output
    waUSDC: "0x...",             // From deploy output
    fixedPriceOracle: "0x...",   // From deploy output
    // ... rest of config
};

const MARKET_ID = "0x...";       // From createMarket output
```

---

## Smart Contracts

### 1. MockCCOP.sol

**Purpose:** ERC20 mock token for borrowing in Morpho market.

**Key Functions:**
- `mint(address to, uint256 amount)` — Owner-only minting
- `burn(address from, uint256 amount)` — Owner-only burning
- Standard ERC20: `transfer()`, `approve()`, `balanceOf()`

**Decimals:** 6 (matches USDC)

### 2. WaUSDC.sol

**Purpose:** ERC-4626 vault wrapper around Aave aUSDC.

**Key Functions:**
- `deposit(uint256 assets, address receiver) → uint256 shares` — Supply aUSDC, receive shares
- `withdraw(uint256 assets, address receiver, address owner) → uint256 shares` — Withdraw aUSDC, burn shares
- `totalAssets() → uint256` — Return current aUSDC balance (includes accrued yield)
- `convertToShares(uint256 assets) → uint256` — Preview shares for assets
- `convertToAssets(uint256 shares) → uint256` — Preview assets for shares

**Key Properties:**
- Non-rebasing shares (unlike aUSDC)
- Price per share increases as Aave yields accrue
- Fully ERC-4626 compliant

### 3. FixedPriceOracle.sol

**Purpose:** Simple oracle for Morpho Blue market price feed.

**Key Function:**
- `price() → uint256` — Returns fixed price of 1e36

**Pricing Logic:**

For Morpho Blue, oracle price format is:
```
price = collateral_price_in_loan_token * 10^(loan_decimals - collateral_decimals + 36)
```

For equal decimals (both 6):
```
price = 1 * 10^(6 - 6 + 36) = 1e36
```

This means: **1 WaUSDC (collateral) = 1 cCOP (loan)**

---

## Morpho Blue Market Details

### Market Creation Parameters

```solidity
struct MarketParams {
    address loanToken;          // MockCCOP
    address collateralToken;    // WaUSDC
    address oracle;             // FixedPriceOracle
    address irm;                // Morpho DefaultIRM
    uint256 lltv;               // 770000000000000000 (77%)
}
```

### How It Works

1. **Supply Collateral:** User supplies WaUSDC to Morpho for this market
2. **Borrow:** User borrows up to 77% of collateral value in cCOP
3. **Interest:** IRM accrues interest on borrowed amount
4. **Liquidation:** If health factor < 1.0, position can be liquidated

### Health Factor

```
healthFactor = (collateralValue * 0.77) / borrowedValue
```

Must be > 1.0 to avoid liquidation.

---

## Debugging & Troubleshooting

### "Network not supported"

Ensure MetaMask is set to **Base Sepolia (Chain ID: 84532)**.

**Add manually:**
- RPC: `https://sepolia.base.org`
- Chain ID: `84532`
- Currency: ETH

### "Insufficient balance"

Get Base Sepolia ETH and USDC from faucets (see Prerequisites).

### "Insufficient collateral"

Ensure:
1. WaUSDC successfully deposited to Morpho
2. Borrow amount ≤ 77% of collateral value
3. Health factor > 1.0

### "Market not found"

Ensure:
1. `MARKET_ID` is correctly set from `createMarket.ts` output
2. Market was created on correct network (Base Sepolia)

---

## Canonical References

### Aave V3 (Base Sepolia)
- Pool: https://app.aave.com/reserve-overview/?marketName=proto_base_sepolia_v3
- USDC: https://sepolia.basescan.org/address/0xba50cd2a20f6da35d788639e581bca8d0b5d4d5f
- aUSDC: https://sepolia.basescan.org/address/0x10f1a9d11cdf50041f3f8cb7191cbe2f31750acc

### Morpho Blue (Base Sepolia)
- Core: https://sepolia.basescan.org/address/0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb
- Docs: https://docs.morpho.org/curate/tutorials-market-v1/creating-market/

### Base Sepolia
- Block Explorer: https://sepolia.basescan.org
- RPC: https://sepolia.base.org

---

## Security Considerations (PoC Only)

⚠️ **This is a PoC. Not audited. Not production-ready.**

- **FixedPriceOracle:** Fixed price only suitable for testing
- **WaUSDC:** No access controls or pause mechanisms
- **MockCCOP:** Owner-only minting. For testing only.
- **No slippage protection**
- **No revert guards**

---

## License

MIT

---

**Status:** ✅ Ready for Base Sepolia testnet

**Last Updated:** January 2026
