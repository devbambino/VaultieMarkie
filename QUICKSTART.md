# Quick Start Guide - Aave + Morpho Blue PoC

## 🚀 5-Minute Setup

### 1. **Get Test ETH & USDC**

```bash
# Base Sepolia ETH (pick one faucet):
- https://basefaucet.com/
- https://portal.cdp.coinbase.com/products/faucet
- https://thirdweb.com/base-sepolia-testnet

# USDC on Base Sepolia:
- https://app.aave.com/faucet/
```

### 2. **Set Up Environment**

```bash
cd /workspaces/VaultieMarkie

# Copy environment template
cp .env.example .env

# Edit .env and add your private key:
# PRIVATE_KEY=your_private_key_here (without 0x)
# BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
```

### 3. **Compile Contracts**

```bash
npm run compile
```

✅ **Output:** `Compiled 19 Solidity files successfully`

### 4. **Deploy Contracts**

```bash
npm run deploy
```

✅ **Output:** Three contract addresses (copy them!)

```
MockCCOP:         0x...
WaUSDC:           0x...
FixedPriceOracle: 0x...
```

**⚠️ ACTION:** Update these addresses in:
- `scripts/createMarket.ts` (line ~20)
- `frontend/app.js` (line ~20 in CONFIG object)

### 5. **Create Morpho Market**

```bash
npm run create-market
```

✅ **Output:** Market ID

```
Market ID: 0x...
```

**⚠️ ACTION:** Update in:
- `scripts/demoFlow.ts` (line ~20)
- `frontend/app.js` (line ~30)

### 6. **Run Demo**

```bash
npm run demo
```

✅ **Expected output:**

```
✓ Supplies USDC to Aave
✓ Wraps aUSDC into WaUSDC
✓ Supplies WaUSDC as collateral
✓ Borrows cCOP_test
✓ Repays loan
✓ Withdraws collateral
✓ Unwraps back to aUSDC
✓ Withdraws final USDC + yield

Final Balances:
  USDC: 1000.00
  aUSDC: 0.00
  WaUSDC: 0.00
  cCOP: 0.00

All flows completed successfully
```

### 7. **Launch Frontend (Optional)**

```bash
npm run serve
```

Open: http://localhost:8000

Connect MetaMask to Base Sepolia and interact with the PoC UI.

---

## 📁 Project Files

| File | Purpose |
|------|---------|
| `contracts/MockCCOP.sol` | ERC20 mock token for borrowing |
| `contracts/WaUSDC.sol` | ERC-4626 vault wrapper around Aave aToken |
| `contracts/FixedPriceOracle.sol` | Morpho oracle (fixed 1:1 price) |
| `scripts/deploy.ts` | Deploy contracts |
| `scripts/createMarket.ts` | Create Morpho Blue market |
| `scripts/demoFlow.ts` | Full end-to-end demo |
| `frontend/index.html` + `app.js` | Web UI |
| `src/config.ts` | Centralized contract addresses & ABIs |

---

## 🔍 Understanding the Flow

### User Journey

```
1. Supply 1000 USDC to Aave Pool
   → Receive ~1000 aUSDC (rebasing)

2. Wrap aUSDC into WaUSDC
   → Receive ~1000 WaUSDC shares (non-rebasing)
   → As Aave yields, shares become worth more

3. Supply WaUSDC as collateral to Morpho
   → Locked in Morpho as backing

4. Borrow up to 77% of collateral value in cCOP
   → Max: 770 cCOP (77% of 1000 WaUSDC)

5. Repay loan
   → Pay back borrowed cCOP + interest

6. Withdraw collateral
   → Reclaim WaUSDC from Morpho

7. Unwrap to aUSDC
   → Convert shares back to aToken

8. Withdraw from Aave
   → Get original USDC + accrued yield!
```

---

## 🐛 Troubleshooting

### "Market not found"

Ensure Market ID is set correctly:

```bash
# Check market-details.json
cat market-details.json | grep -i "marketId"

# Copy the market ID to:
# - scripts/demoFlow.ts (line ~20)
# - frontend/app.js (line ~30)
```

### "Insufficient collateral"

You tried to borrow more than 77% of collateral value.

Formula:
```
max_borrow = collateral_amount * 0.77
```

### "Revert: Insufficient balance"

You need more Base Sepolia ETH or USDC. Get from faucets listed above.

### "Contract validation failed"

Ensure addresses are correct in the config files. Check `deploy-addresses.json`.

---

## 📊 Contract Addresses (Base Sepolia)

| Contract | Address |
|----------|---------|
| Aave Pool | `0x7B4eb56E7CD4eFc5c4D044DBC3917eB21f3d5dAE` |
| USDC | `0xba50cd2a20f6da35d788639e581bca8d0b5d4d5f` |
| aUSDC | `0x10f1a9d11cdf50041f3f8cb7191cbe2f31750acc` |
| Morpho Blue | `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb` |

---

## 💡 Key Concepts

### ERC-4626 (WaUSDC)

- **Wrapper pattern:** Holds aUSDC, issues non-rebasing shares
- **Price increases:** As Aave yields accrue, `totalAssets() / totalSupply()` increases
- **Non-rebasing:** Unlike aUSDC, WaUSDC shares don't rebase (increase daily)
- **Composability:** Can use WaUSDC in other DeFi protocols

### Morpho Blue

- **Market:** Defined by loan token, collateral, oracle, IRM, LLTV
- **LLTV (77%):** Max borrow = 77% of collateral value
- **Oracle:** Returns price = `1e36` (1 WaUSDC = 1 cCOP)
- **Interest:** Simple model, no compounding (PoC)

---

## 🔗 Canonical References

- **Aave V3:** https://app.aave.com/reserve-overview/?marketName=proto_base_sepolia_v3
- **Morpho Docs:** https://docs.morpho.org/
- **Base Sepolia:** https://sepolia.base.org
- **BaseScan:** https://sepolia.basescan.org

---

## 📝 Notes

- This is a **PoC**, not production code
- **Do NOT** use real assets on testnet
- Contracts are **not audited**
- Oracle is **fixed price** (testing only)
- Smart contracts have **no pause mechanism**

---

**Questions?** Check full [README.md](README.md)
