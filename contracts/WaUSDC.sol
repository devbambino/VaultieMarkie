// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @notice Interface for DebtLens contract to calculate accrued interest
 */
interface IDebtLens {
    function getAccruedInterest(bytes32 marketId, address user) external view returns (uint256);
}

/**
 * @notice Interface for WaUSDCCCOPOracle to get price conversion
 */
interface IWaUSDCCCOPOracle {
    function price() external view returns (uint256);
}

/**
 * @title WaUSDC
 * @notice ERC-4626 wrapper around Aave aUSDC token
 * @dev
 * - Underlying asset: aUSDC (Aave's interest-bearing USDC)
 * - Wrapper shares are non-rebasing
 * - Price per share increases as Aave accrues yield
 * - totalAssets() returns the wrapper's aUSDC balance
 *
 * Flow:
 * 1. User deposits aUSDC into this vault
 * 2. User receives WaUSDC shares (non-rebasing)
 * 3. As Aave accrues interest, totalAssets() increases
 * 4. User can redeem shares for more aUSDC than originally deposited
 */
contract WaUSDC is ERC20, ERC4626, Ownable {
    // Reference to the underlying Aave aToken
    IERC20 private immutable _aUSDC;
    
    // Track total original deposits to keep yield on redemptions
    uint256 private _totalDeposited;

    // Deployed contract addresses for interest subsidy
    address public debtLens = 0x14751F624968372878cDE4238e84Fb3D980C4F05;
    address public ccopUsdcOracle = 0x9f4b138BF3513866153Af9f0A2794096DFebFaD4;
    bytes32 public marketId = 0xf912f62db71d01c572b28b6953c525851f9e0660df4e422cec986e620da726df;

    // Track per-user deposits in USDC-equivalent value
    mapping(address => uint256) public userDepositedAssets;
    mapping(address => uint256) public userGeneratedYieldInUSDC;
    mapping(address => uint256) public userInterestSubsidyInWaUSDC;
    mapping(address => uint256) public userInterestInCCOP;
    mapping(address => uint256) public userPaidSubsidyInUSDC;

    // Events
    event Deposited(address indexed user, uint256 assets, uint256 shares);
    event Withdrawn(address indexed user, uint256 assets, uint256 shares, uint256 yieldInUSDC);
    event WithdrawnWithSubsidy(address indexed owner, address receiver, uint256 sharesInWausdc, uint256 assetsInAusdc, uint256 yieldInUSDC, uint256 subsidyInUSDC);
    event YieldWithdrawn(address indexed recipient, uint256 amount, uint256 timestamp);
    event DebtLensUpdated(address indexed oldDebtLens, address indexed newDebtLens);
    event CCOPUsdcOracleUpdated(address indexed oldOracle, address indexed newOracle);
    event MarketIdUpdated(bytes32 indexed oldMarketId, bytes32 indexed newMarketId);
    event GetSubsidy(address indexed user, uint256 interestInCCOP, uint256 oraclePrice, uint256 userInterestSubsidyInWaUSDC);

    /**
     * @notice Initialize the WaUSDC wrapper
     * @param aUSDC_ Address of Aave's aUSDC token
     */
    constructor(address aUSDC_) 
        ERC20("Wrapped Aave USDC", "WaUSDC")
        ERC4626(IERC20(aUSDC_))
        Ownable(msg.sender)
    {
        require(aUSDC_ != address(0), "Invalid aUSDC address");
        _aUSDC = IERC20(aUSDC_);
    }

    /**
     * @notice Get the total number of assets managed by this vault
     * @return Total aUSDC balance held by this contract
     * @dev This is critical: as Aave accrues yield, this balance grows
     */
    function totalAssets() public view override returns (uint256) {
        // Return the current balance of aUSDC held by this contract
        // This includes both principal and accrued Aave interest
        return _aUSDC.balanceOf(address(this));
    }

    /**
     * @notice Get total original deposits (excludes accrued yield)
     * @return Total amount of aUSDC originally deposited
     * @dev Used to calculate redemptions and keep yield in the vault
     */
    function getTotalDeposited() public view returns (uint256) {
        return _totalDeposited;
    }

    /**
     * @notice Get decimals (matches aUSDC: 6)
     * @return Decimal places
     */
    function decimals() public pure override(ERC20, ERC4626) returns (uint8) {
        return 6;
    }

    /**
     * @notice Deposit aUSDC and receive non-rebasing WaUSDC shares
     * @param assets Amount of aUSDC to deposit
     * @param receiver Address to receive shares
     * @return shares Shares minted
     */
    function deposit(uint256 assets, address receiver)
        public
        override(ERC4626)
        returns (uint256 shares)
    {
        require(assets > 0, "Cannot deposit zero");
        require(receiver != address(0), "Invalid receiver");

        // Calculate shares: assets / price per share
        shares = previewDeposit(assets);
        
        // Transfer aUSDC from caller to this contract
        require(
            _aUSDC.transferFrom(msg.sender, address(this), assets),
            "Transfer failed"
        );
        
        // Track original deposit amount
        _totalDeposited += assets;
        userDepositedAssets[receiver] += assets;
        
        // Mint shares to receiver
        _mint(receiver, shares);
        
        emit Deposited(receiver, assets, shares);
        emit Deposit(msg.sender, receiver, assets, shares);
        
        return shares;
    }

    /**
     * @notice Withdraw aUSDC by burning WaUSDC shares
     * @param assets Amount of aUSDC to withdraw
     * @param receiver Address to receive aUSDC
     * @param owner Address whose shares are burned
     * @return shares Shares burned
     */
    function withdraw(uint256 assets, address receiver, address owner)
        public
        override(ERC4626)
        returns (uint256 shares)
    {
        require(assets > 0, "Cannot withdraw zero");
        require(receiver != address(0), "Invalid receiver");

        // Calculate shares needed to cover assets
        shares = previewWithdraw(assets);
        
        // Approve and burn shares from owner
        if (msg.sender != owner) {
            uint256 allowed = allowance(owner, msg.sender);
            require(allowed >= shares, "Insufficient allowance");
            _approve(owner, msg.sender, allowed - shares);
        }
        
        _burn(owner, shares);
        
        // Transfer aUSDC to receiver
        require(_aUSDC.transfer(receiver, assets), "Transfer failed");
        
        emit Withdrawn(owner, assets, shares, 0);
        emit Withdraw(msg.sender, receiver, owner, assets, shares);
        
        return shares;
    }

    /**
     * @notice Mint WaUSDC shares by providing aUSDC
     * @param shares Amount of shares to mint
     * @param receiver Address to receive shares
     * @return assets Amount of aUSDC required
     */
    function mint(uint256 shares, address receiver)
        public
        override(ERC4626)
        returns (uint256 assets)
    {
        require(shares > 0, "Cannot mint zero");
        require(receiver != address(0), "Invalid receiver");

        assets = previewMint(shares);
        
        require(
            _aUSDC.transferFrom(msg.sender, address(this), assets),
            "Transfer failed"
        );
        
        // Track original deposit amount
        _totalDeposited += assets;
        userDepositedAssets[receiver] += assets;
        
        _mint(receiver, shares);
        
        emit Deposit(msg.sender, receiver, assets, shares);
        
        return assets;
    }

    /**
     * @notice Redeem WaUSDC shares for aUSDC
     * @dev Returns aUSDC based on original deposit amount, keeping accrued yield
     * @param shares Amount of shares to redeem
     * @param receiver Address to receive aUSDC
     * @param owner Address whose shares are burned
     * @return assets Amount of aUSDC returned
     */
    function redeem(uint256 shares, address receiver, address owner)
        public
        override(ERC4626)
        returns (uint256 assets)
    {
        require(shares > 0, "Cannot redeem zero");
        require(receiver != address(0), "Invalid receiver");

        assets = previewRedeem(shares);
        
        if (msg.sender != owner) {
            uint256 allowed = allowance(owner, msg.sender);
            require(allowed >= shares, "Insufficient allowance");
            _approve(owner, msg.sender, allowed - shares);
        }
        
        _burn(owner, shares);
        
        // Reduce total deposited to reflect redemption
        _totalDeposited -= assets;
        
        // Calculate yield in USDC for this user
        uint256 assetsRedeemed = assets;
        uint256 deposited = userDepositedAssets[owner];
        uint256 yield = deposited >= assetsRedeemed ? 0 : assetsRedeemed - deposited;
        
        // Update user's deposited assets and yield tracking
        if (userDepositedAssets[owner] >= assetsRedeemed) {
            userDepositedAssets[owner] -= assetsRedeemed;
        } else {
            userDepositedAssets[owner] = 0;
        }
        userGeneratedYieldInUSDC[owner] = yield;
        
        require(_aUSDC.transfer(receiver, assets), "Transfer failed");
        
        emit Withdrawn(owner, assets, shares, yield);
        emit Withdraw(msg.sender, receiver, owner, assets, shares);
        
        return assets;
    }

    /**
     * @notice Calculate the interest subsidy amount in WaUSDC for a user's CCOP market debt
     * @param user The user address
     * @return subsidy Amount of WaUSDC equivalent to the accrued interest
     * @dev
     * - Gets accrued interest from DebtLens (in CCOP with 6 decimals)
     * - Converts CCOP amount to WaUSDC equivalent using the oracle price
     * - Stores the result in userInterestSubsidyInWaUSDC[user] for later use in redeemWithInterestSubsidy
     * - User should call this during the repay process to record their interest subsidy
     */
    function getInterestSubsidy(address user) external returns (uint256 subsidy) {
        // Get accrued interest in CCOP (6 decimals)
        uint256 interestInCCOP = IDebtLens(debtLens).getAccruedInterest(marketId, user);
        userInterestInCCOP[user] = interestInCCOP;
        
        if (interestInCCOP == 0) return 0;
        
        // Get oracle price: how many CCOP per WaUSDC (scaled by 1e48)
        // Formula: WaUSDCAmount = CCOPAmount * OraclePrice / 1e48
        // Since CCOP has 6 decimals and USDC has 6 decimals:
        // We need to scale appropriately
        uint256 oraclePrice = IWaUSDCCCOPOracle(ccopUsdcOracle).price();
        
        // Price is in format: CCOP (6 decimals) per WaUSDC (6 decimals) scaled by 1e36
        // Result: interestInCCOP (6 decimals) * oraclePrice / 1e36 = WaUSDC equivalent (6 decimals)
        uint256 waUSDCWith6Decimals = (interestInCCOP * 1e36) / oraclePrice;
        
        // Store the subsidy for later use in redeemWithInterestSubsidy
        userInterestSubsidyInWaUSDC[user] = waUSDCWith6Decimals;

        emit GetSubsidy(user, interestInCCOP, oraclePrice, waUSDCWith6Decimals);

        return waUSDCWith6Decimals;
    }

    /**
     * @notice Redeem shares for aUSDC with interest subsidy included
     * @param shares Amount of WaUSDC shares to redeem
     * @param receiver Address to receive aUSDC
     * @param owner Address whose shares are burned
     * @return assets Total aUSDC returned (original + interest subsidy)
     * @dev
     * Combines the standard redeem with an interest subsidy:
     * - Burns user's WaUSDC shares
     * - Returns aUSDC for original shares
     * - Plus additional aUSDC equal to interest paid in CCOP market (if available and yield > interest)
     */
    function redeemWithInterestSubsidy(
        uint256 shares,
        address receiver,
        address owner
    ) external returns (uint256 assets) {
        require(shares > 0, "Cannot redeem zero");
        require(receiver != address(0), "Invalid receiver");

        if (msg.sender != owner) {
            uint256 allowed = allowance(owner, msg.sender);
            require(allowed >= shares, "Insufficient allowance");
            _approve(owner, msg.sender, allowed - shares);
        }
        
        // Calculate standard aUSDC return
        uint256 standardReturn = previewRedeem(shares);
        
        // Get stored interest subsidy in WaUSDC (6 decimals)
        uint256 storedInterestSubsidyWaUSDC = userInterestSubsidyInWaUSDC[owner];

        // Calculate generated yield (difference between what contract has and what was deposited)
        uint256 deposited = userDepositedAssets[owner];
        uint256 generatedYield = deposited > standardReturn ? 0 : (standardReturn - deposited);

        // Total aUSDC to return
        uint256 totalAUSDC = standardReturn;
        uint256 subsidyUSDC = 0;
        
        // Only give subsidy if generated yield >= interest subsidy amount
        if (generatedYield >= storedInterestSubsidyWaUSDC && storedInterestSubsidyWaUSDC > 0) {
            totalAUSDC = standardReturn + storedInterestSubsidyWaUSDC;
            subsidyUSDC = storedInterestSubsidyWaUSDC;
            userPaidSubsidyInUSDC[owner] = subsidyUSDC;
        }

        _burn(owner, shares);
        
        // Update user's deposited assets tracking
        if (userDepositedAssets[owner] >= standardReturn) {
            userDepositedAssets[owner] -= standardReturn;
        } else {
            userDepositedAssets[owner] = 0;
        }
        userGeneratedYieldInUSDC[owner] = generatedYield;
        
        // Transfer all aUSDC in one transaction
        require(_aUSDC.transfer(receiver, totalAUSDC), "Transfer failed");
        
        // Reduce total deposited to reflect redemption
        _totalDeposited -= standardReturn;
        
        // Reset interest subsidy after redemption
        userInterestSubsidyInWaUSDC[owner] = 0;
        
        emit WithdrawnWithSubsidy(owner, receiver, shares, standardReturn, generatedYield, subsidyUSDC);
        
        return totalAUSDC;
    }

    /**
     * @notice Preview how many shares would be minted for a given amount of aUSDC
     * @param assets Amount of aUSDC to deposit
     * @return Shares that would be minted
     */
    function previewDeposit(uint256 assets)
        public
        view
        override(ERC4626)
        returns (uint256)
    {
        // shares = assets / (totalAssets / totalSupply)
        // If totalAssets = 0, 1 asset = 1 share
        uint256 supply = totalSupply();
        return supply == 0 ? assets : (assets * supply) / totalAssets();
    }

    /**
     * @notice Preview how many aUSDC would be withdrawn for a given number of shares
     * @param assets Amount of aUSDC to withdraw
     * @return Shares that would be burned
     */
    function previewWithdraw(uint256 assets)
        public
        view
        override(ERC4626)
        returns (uint256)
    {
        // shares = assets / (totalAssets / totalSupply)
        uint256 total = totalAssets();
        uint256 supply = totalSupply();
        return supply == 0 ? assets : (assets * supply + total - 1) / total; // Round up
    }

    /**
     * @notice Preview how many aUSDC would be needed to mint given shares
     * @param shares Amount of shares to mint
     * @return Assets required
     */
    function previewMint(uint256 shares)
        public
        view
        override(ERC4626)
        returns (uint256)
    {
        // assets = shares * (totalAssets / totalSupply)
        uint256 supply = totalSupply();
        return supply == 0 ? shares : (shares * totalAssets() + supply - 1) / supply; // Round up
    }

    /**
     * @notice Preview how many aUSDC would be returned for redeeming shares
     * @dev Based on original deposits, not current assets (keeps yield)
     * @param shares Amount of shares to redeem
     * @return Assets that would be returned
     */
    function previewRedeem(uint256 shares)
        public
        view
        override(ERC4626)
        returns (uint256)
    {
        // assets = shares * (totalDeposited / totalSupply)
        // This returns the proportional share of original deposits, keeping accrued yield
        uint256 supply = totalSupply();
        return supply == 0 ? shares : (shares * _totalDeposited) / supply;
    }

    /**
     * @notice Set the DebtLens contract address
     * @param _debtLens The new DebtLens address
     */
    function setDebtLens(address _debtLens) external onlyOwner {
        require(_debtLens != address(0), "Invalid address");
        emit DebtLensUpdated(debtLens, _debtLens);
        debtLens = _debtLens;
    }

    /**
     * @notice Set the CCOP/USDC Oracle address
     * @param _ccopUsdcOracle The new Oracle address
     */
    function setCCOPUsdcOracle(address _ccopUsdcOracle) external onlyOwner {
        require(_ccopUsdcOracle != address(0), "Invalid address");
        emit CCOPUsdcOracleUpdated(ccopUsdcOracle, _ccopUsdcOracle);
        ccopUsdcOracle = _ccopUsdcOracle;
    }

    /**
     * @notice Set the Market ID
     * @param _marketId The new Market ID
     */
    function setMarketId(bytes32 _marketId) external onlyOwner {
        require(_marketId != bytes32(0), "Invalid marketId");
        emit MarketIdUpdated(marketId, _marketId);
        marketId = _marketId;
    }
}
