// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @notice Interface for Morpho Vault interaction
 * @dev Used to convert between mUSDC shares and USDC asset values
 */
interface IMorphoVault is IERC20 {
    function convertToAssets(uint256 shares) external view returns (uint256);
    function convertToShares(uint256 assets) external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
}

/**
 * @notice Interface for DebtLens contract to calculate accrued interest
 */
interface IDebtLens {
    function getAccruedInterest(bytes32 marketId, address user) external view returns (uint256);
}

/**
 * @notice Interface for WmusdcMxnbOracle to get price conversion
 */
interface IWmusdcMxnbOracle {
    function price() external view returns (uint256);
}

/**
 * @title WmUSDC
 * @notice ERC-4626 wrapper around Morpho Vault token (vaultUSDC)
 * @dev
 * - Underlying asset: vaultUSDC (Morpho's interest-bearing USDC Vault)
 * - Wrapper shares are non-rebasing
 * - Price per share increases as Morpho Vault accrues yield
 * - totalAssets() returns the wrapper's vaultUSDC balance
 *
 * Flow:
 * 1. User deposits Morpho's mUSDC into this vault
 * 2. User receives WmUSDC shares (non-rebasing)
 * 3. As Morpho Vault accrues interest, totalAssets() increases
 * 4. User can redeem shares for more mUSDC than originally deposited
 */
contract WmUSDC is ERC20, ERC4626, Ownable {
    // Reference to the underlying Morpho Vault token
    IMorphoVault private immutable _vaultUSDC;

    // Deployed contract addresses for interest subsidy
    address public debtLens = 0x14751F624968372878cDE4238e84Fb3D980C4F05;
    address public mxnbUsdcOracle = 0x9f4b138BF3513866153Af9f0A2794096DFebFaD4;
    bytes32 public marketId = 0xf912f62db71d01c572b28b6953c525851f9e0660df4e422cec986e620da726df;

    // Track per-user deposits in USDC-equivalent value
    mapping(address => uint256) public userDepositedAssets;
    mapping(address => uint256) public userDepositedShares;
    mapping(address => uint256) public userGeneratedYieldInShares;
    mapping(address => uint256) public userGeneratedYieldInUSDC;
    mapping(address => uint256) public userInterestSubsidyInWmUSDC;
    mapping(address => uint256) public userInterestInMxnb;
    mapping(address => uint256) public userPaidSubsidyInUSDC;
    
    
    // Events
    event Deposited(address indexed user, uint256 assetsInMusdc, uint256 sharesInWmusdc);
    event Withdrawn(address indexed owner, address receiver, uint256 sharesInWmusdc, uint256 assetsInMusdc, uint256 yieldInMusdc,uint256 yieldInUsdc );
    event WithdrawnWithSubsidy(address indexed owner, address receiver, uint256 sharesInWmusdc, uint256 assetsInMusdc, uint256 yieldInMusdc,uint256 yieldInUsdc, uint256 subsidyInMusdc, uint256 subsidyInUsdc );
    event YieldWithdrawn(address indexed recipient, uint256 amount, uint256 timestamp);
    event DebtLensUpdated(address indexed oldDebtLens, address indexed newDebtLens);
    event MxnbUsdcOracleUpdated(address indexed oldOracle, address indexed newOracle);
    event MarketIdUpdated(bytes32 indexed oldMarketId, bytes32 indexed newMarketId);
    event GetSubsidy(address indexed user, uint256 interestInMxnb, uint256 oraclePrice, uint256 userInterestSubsidyInWmUSDC);

    /**
     * @notice Initialize the WmUSDC wrapper
     * @param vaultUSDC_ Address of Morpho's USDC Vault token
     */
    constructor(address vaultUSDC_) 
        ERC20("Wrapped Morpho Vault USDC", "WmUSDC")
        ERC4626(IERC20(vaultUSDC_))
        Ownable(msg.sender)
    {
        require(vaultUSDC_ != address(0), "Invalid vaultUSDC address");
        _vaultUSDC = IMorphoVault(vaultUSDC_);
    }

    /**
     * @notice Get the total number of assets managed by this vault
     * @return Total USDC value represented by mUSDC held by this contract (in 18 decimals)
     * @dev Converts current mUSDC balance to USDC-equivalent using Morpho's exchange rate
     * and scales from 6 decimals to 18 decimals
     */
    function totalAssets() public view override returns (uint256) {
        // Return the USDC-equivalent value of mUSDC held by this contract
        // Morpho vault returns USDC with 6 decimals, scale to 18 decimals for WmUSDC
        uint256 mUSDCBalance = _vaultUSDC.balanceOf(address(this));
        uint256 usdcWith6Decimals = _vaultUSDC.convertToAssets(mUSDCBalance);
        return usdcWith6Decimals * 1e12; // Scale from 6 decimals to 18 decimals
    }

    /**
     * @notice Get decimals (matches mUSDC: 18)
     * @return Decimal places
     */
    function decimals() public pure override(ERC20, ERC4626) returns (uint8) {
        return 18;
    }

    function _convertMUSDCToRealUSDC(uint256 mUSDCShares) internal view returns (uint256) {
        // convertToAssets returns USDC value with 6 decimals
        uint256 usdcWith6Decimals = _vaultUSDC.convertToAssets(mUSDCShares);
        return usdcWith6Decimals;
    }

    /**
     * @notice Convert mUSDC shares to USDC-equivalent assets
     * @param mUSDCShares Amount of mUSDC shares (18 decimals)
     * @return USDC-equivalent value in 18 decimals
     * @dev Morpho vault returns USDC with 6 decimals, we scale to 18 decimals for WmUSDC
     */
    function _convertMUSDCToUSDC(uint256 mUSDCShares) internal view returns (uint256) {
        // convertToAssets returns USDC value with 6 decimals
        uint256 usdcWith6Decimals = _vaultUSDC.convertToAssets(mUSDCShares);
        // Scale from 6 decimals to 18 decimals (multiply by 10^12)
        return usdcWith6Decimals * 1e12;
    }

    /**
     * @notice Convert USDC assets to mUSDC shares
     * @param usdcAssets Amount of USDC assets in 18 decimals
     * @return mUSDC shares required with 18 decimals
     * @dev WmUSDC uses 18 decimals, but Morpho vault expects USDC with 6 decimals
     */
    function _convertUSDCToMUSDC(uint256 usdcAssets) internal view returns (uint256) {
        // Scale from 18 decimals to 6 decimals (divide by 10^12)
        uint256 usdcWith6Decimals = usdcAssets / 1e12;
        // convertToShares expects USDC with 6 decimals
        return _vaultUSDC.convertToShares(usdcWith6Decimals);
    }

    /**
     * @notice Deposit mUSDC and receive non-rebasing WmUSDC shares
     * @param assets Amount of mUSDC to deposit
     * @param receiver Address to receive shares
     * @return shares Shares minted
     * @dev The user receives WmUSDC shares equal to the USDC-equivalent value of their mUSDC deposit
     */
    function deposit(uint256 assets, address receiver)
        public
        override(ERC4626)
        returns (uint256 shares)
    {
        require(assets > 0, "Cannot deposit zero");
        require(receiver != address(0), "Invalid receiver");

        // Calculate shares based on USDC equivalent value
        // Note: previewDeposit takes mUSDC assets as input
        shares = previewDeposit(assets);
        
        // Transfer mUSDC from caller to this contract
        require(
            _vaultUSDC.transferFrom(msg.sender, address(this), assets),
            "Transfer failed"
        );
        
        // Track user's deposited USDC-equivalent amount
        userDepositedAssets[receiver] += shares;

        userDepositedShares[receiver] += assets;
        
        // Mint shares to receiver
        _mint(receiver, shares);

        emit Deposited(receiver, assets, shares);
        
        return shares;
    }

    /**
     * @notice Withdraw mUSDC by burning WmUSDC shares while capturing yield
     * @param assets Amount of USDC-equivalent assets to withdraw
     * @param receiver Address to receive mUSDC
     * @param owner Address whose shares are burned
     * @return shares Shares burned
     * @dev
     * The withdrawal captures yield by:
     * 1. Converting requested USDC assets to mUSDC shares needed
     * 2. Burning equivalent shares (1:1 with USDC assets)
     * 3. Any excess mUSDC held by contract remains as yield
     */
    function withdraw(uint256 assets, address receiver, address owner)
        public
        override(ERC4626)
        returns (uint256 shares)
    {
        require(assets > 0, "Cannot withdraw zero");
        require(receiver != address(0), "Invalid receiver");

        // Calculate WmUSDC shares to burn based on USDC assets (1:1)
        shares = previewWithdraw(assets);
        
        // Approve and burn shares from owner
        if (msg.sender != owner) {
            uint256 allowed = allowance(owner, msg.sender);
            require(allowed >= shares, "Insufficient allowance");
            _approve(owner, msg.sender, allowed - shares);
        }
        
        _burn(owner, shares);
        
        // Calculate mUSDC shares needed to cover the USDC assets
        uint256 mUSDCNeeded = _convertUSDCToMUSDC(assets);
        
        // Transfer exact mUSDC to receiver
        require(_vaultUSDC.transfer(receiver, mUSDCNeeded), "Transfer failed");
        
        // Update user's deposited assets tracking
        if (userDepositedAssets[owner] >= shares) {
            userDepositedAssets[owner] -= shares;
        } else {
            userDepositedAssets[owner] = 0;
        }
        
        return shares;
    }

    /**
     * @notice Mint WmUSDC shares by providing mUSDC
     * @param shares Amount of shares to mint
     * @param receiver Address to receive shares
     * @return assets Amount of mUSDC required
     * @dev The contract will transfer mUSDC shares from caller equal to the USDC-equivalent cost
     */
    function mint(uint256 shares, address receiver)
        public
        override(ERC4626)
        returns (uint256 assets)
    {
        require(shares > 0, "Cannot mint zero");
        require(receiver != address(0), "Invalid receiver");

        // Calculate mUSDC needed for the shares
        assets = previewMint(shares);
        
        require(
            _vaultUSDC.transferFrom(msg.sender, address(this), assets),
            "Transfer failed"
        );
        
        // Track user's deposited USDC-equivalent amount
        userDepositedAssets[receiver] += shares;
        
        // Mint exact shares
        _mint(receiver, shares);
        
        emit Deposit(msg.sender, receiver, shares, shares);
        
        return assets;
    }

    /**
     * @notice Redeem WmUSDC shares for mUSDC while capturing yield
     * @param shares Amount of shares to redeem
     * @param receiver Address to receive mUSDC
     * @param owner Address whose shares are burned
     * @return assets Amount of mUSDC returned
     */
    function redeem(uint256 shares, address receiver, address owner)
        public
        override(ERC4626)
        returns (uint256 assets)
    {
        require(shares > 0, "Cannot redeem zero");
        require(receiver != address(0), "Invalid receiver");

        if (msg.sender != owner) {
            uint256 allowed = allowance(owner, msg.sender);
            require(allowed >= shares, "Insufficient allowance");
            _approve(owner, msg.sender, allowed - shares);
        }
        
        // Calculate mUSDC shares to return
        assets = previewRedeem(shares);
        
        _burn(owner, shares);
        
        // Transfer calculated mUSDC to receiver
        require(_vaultUSDC.transfer(receiver, assets), "Transfer failed");
        
        // Update user's deposited assets tracking
        uint256 yield = 0;
        if (userDepositedAssets[owner] >= shares) {
            userDepositedAssets[owner] -= shares;
            userDepositedShares[owner] -= assets;
            userGeneratedYieldInShares[owner] = userDepositedShares[owner];
            yield = _convertMUSDCToRealUSDC(userGeneratedYieldInShares[owner]);
            userGeneratedYieldInUSDC[owner] = yield;
            userDepositedShares[owner] = 0;
        } else {
            userDepositedAssets[owner] = 0;
        }
        
        emit Withdrawn(owner,receiver, shares, assets, userGeneratedYieldInShares[owner], yield);
        
        return assets;
    }

    /**
     * @notice Calculate the interest subsidy amount in WmUSDC for a user's MXNB market debt
     * @param user The user address
     * @return subsidy Amount of WmUSDC equivalent to the accrued interest
     * @dev
     * - Gets accrued interest from DebtLens (in MXNB with 6 decimals)
     * - Converts MXNB amount to WmUSDC equivalent using the oracle price
     * - Stores the result in interestSubsidyInWmUSDC[user] for later use in redeemWithInterestSubsidy
     * - User should call this during the repay process to record their interest subsidy
     */
    function getInterestSubsidy(address user) external returns (uint256 subsidy) {
        // Get accrued interest in MXNB (6 decimals)
        uint256 interestInMxnb = IDebtLens(debtLens).getAccruedInterest(marketId, user);
        userInterestInMxnb[user] = interestInMxnb;
        
        if (interestInMxnb == 0) return 0;
        
        // Get oracle price: how many MXNB per WmUSDC (scaled by 1e48)
        // Formula: WmusdcAmount = MxnbAmount * OraclePrice / 1e48
        // Since MXNB has 6 decimals and mUSDC has 18 decimals:
        // We need to scale appropriately
        uint256 oraclePrice = IWmusdcMxnbOracle(mxnbUsdcOracle).price();
        
        // Price is in format: MXNB (6 decimals) per WmUSDC (18 decimals) scaled by 1e36
        // Result: interestInMxnb (6 decimals) * oraclePrice / 1e36 = wmUSDC equivalent (18 decimals)
        uint256 wmUSDCWith18Decimals = (interestInMxnb * 1e36) / oraclePrice;
        
        // Store the subsidy for later use in redeemWithInterestSubsidy
        userInterestSubsidyInWmUSDC[user] = wmUSDCWith18Decimals;

        emit GetSubsidy(user,interestInMxnb,oraclePrice,wmUSDCWith18Decimals);

        return wmUSDCWith18Decimals;
    }

    /**
     * @notice Redeem shares for mUSDC with interest subsidy included
     * @param shares Amount of WmUSDC shares to redeem
     * @param receiver Address to receive mUSDC
     * @param owner Address whose shares are burned
     * @return assets Total mUSDC returned (original + interest subsidy)
     * @dev
     * Combines the standard redeem with an interest subsidy:
     * - Burns user's WmUSDC shares
     * - Returns mUSDC for original shares
     * - Plus additional mUSDC equal to interest paid in MXNB market (if available)
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
        
        // Calculate standard mUSDC return (6 decimals)
        uint256 standardReturn = previewRedeem(shares);
        
        // Get stored interest subsidy in WmUSDC shares (18 decimals)
        uint256 storedInterestSubsidyWmUSDC = userInterestSubsidyInWmUSDC[owner];

        // Convert stored interest subsidy from WmUSDC shares to mUSDC (6 decimals)
        uint256 interestSubsidyMUSDC = storedInterestSubsidyWmUSDC > 0 ? previewRedeem(storedInterestSubsidyWmUSDC) : 0;
        uint256 generatedYield = userDepositedShares[owner] - standardReturn;

        // Total mUSDC to return
        uint256 totalMUSDC = standardReturn;
        uint256 subsidyUSDC = 0;
        if (generatedYield  > interestSubsidyMUSDC ) {
            totalMUSDC = standardReturn + interestSubsidyMUSDC;
            subsidyUSDC = _convertMUSDCToRealUSDC(interestSubsidyMUSDC);
            userPaidSubsidyInUSDC[owner] = subsidyUSDC;
        }

        _burn(owner, shares);
        
        // Transfer all mUSDC in one transaction
        require(_vaultUSDC.transfer(receiver, totalMUSDC), "Transfer failed");
        
        // Update user's deposited assets tracking
        uint256 yield = 0;
        if (userDepositedAssets[owner] >= shares) {
            userDepositedAssets[owner] -= shares;
            userDepositedShares[owner] -= standardReturn;
            userGeneratedYieldInShares[owner] = userDepositedShares[owner];
            yield = _convertMUSDCToRealUSDC(userGeneratedYieldInShares[owner]);
            userGeneratedYieldInUSDC[owner] = yield;
            userDepositedShares[owner] = 0;
        } else {
            userDepositedAssets[owner] = 0;
        }
        
        // Reset interest subsidy after redemption
        userInterestSubsidyInWmUSDC[owner] = 0;
        
        emit WithdrawnWithSubsidy(owner,receiver, shares, assets, userGeneratedYieldInShares[owner], yield, interestSubsidyMUSDC, subsidyUSDC);
        
        return totalMUSDC;
    }

    /**
     * @notice Convert USDC assets to shares (1:1)
     * @param assets Amount of USDC assets
     * @return Shares
     */
    function convertToShares(uint256 assets) public pure override returns (uint256) {
        return assets;
    }

    /**
     * @notice Convert shares to USDC assets (1:1)
     * @param shares Amount of shares
     * @return USDC Assets
     */
    function convertToAssets(uint256 shares) public pure override returns (uint256) {
        return shares;
    }

    /**
     * @notice Preview how many shares would be minted for a given amount of mUSDC
     * @param assets Amount of mUSDC to deposit
     * @return Shares that would be minted (USDC Value)
     */
    function previewDeposit(uint256 assets)
        public
        view
        override(ERC4626)
        returns (uint256)
    {
        return _convertMUSDCToUSDC(assets);
    }

    /**
     * @notice Preview how many Shares would be burned for a given amount of USDC
     * @param assets Amount of USDC assets to withdraw
     * @return Shares that would be burned
     */
    function previewWithdraw(uint256 assets)
        public
        pure
        override(ERC4626)
        returns (uint256)
    {
        return assets;
    }

    /**
     * @notice Preview how many mUSDC assets would be needed to mint given shares
     * @param shares Amount of shares to mint
     * @return Assets required (mUSDC)
     */
    function previewMint(uint256 shares)
        public
        view
        override(ERC4626)
        returns (uint256)
    {
        return _convertUSDCToMUSDC(shares);
    }

    /**
     * @notice Preview how many mUSDC assets would be returned for redeeming shares
     * @param shares Amount of shares to redeem
     * @return Assets that would be returned (mUSDC)
     */
    function previewRedeem(uint256 shares)
        public
        view
        override(ERC4626)
        returns (uint256)
    {
        return _convertUSDCToMUSDC(shares);
    }

    /**
     * @notice Get the currently accumulated yield in mUSDC
     * @return Amount of mUSDC held in excess of user deposits
     */
    function getAccumulatedYield() public view returns (uint256) {
        uint256 mUSDCBalance = _vaultUSDC.balanceOf(address(this));
        uint256 mUSDCRequired = _convertUSDCToMUSDC(totalSupply());
        
        if (mUSDCBalance > mUSDCRequired) {
            return mUSDCBalance - mUSDCRequired;
        }
        return 0;
    }

    /**
     * @notice Withdraw accumulated yield (mUSDC shares) owned by the contract
     * @param amount Amount of mUSDC shares to withdraw
     * @param recipient Address to receive the mUSDC
     * @dev Only owner can call this. Yield is calculated dynamically.
     */
    function withdrawAccumulatedYield(uint256 amount, address recipient)
        external
        onlyOwner
    {
        require(amount > 0, "Cannot withdraw zero");
        require(recipient != address(0), "Invalid recipient");
        
        uint256 available = getAccumulatedYield();
        require(amount <= available, "Insufficient accumulated yield");

        // Transfer mUSDC to recipient
        require(_vaultUSDC.transfer(recipient, amount), "Transfer failed");

        emit YieldWithdrawn(recipient, amount, block.timestamp);
    }

    function withdrawAllAccumulatedYield(address recipient)
        external
        onlyOwner
    {
        require(recipient != address(0), "Invalid recipient");
        
        uint256 available = getAccumulatedYield();

        // Transfer mUSDC to recipient
        require(_vaultUSDC.transfer(recipient, available), "Transfer failed");

        emit YieldWithdrawn(recipient, available, block.timestamp);
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
     * @notice Set the MXNB/USDC Oracle address
     * @param _mxnbUsdcOracle The new Oracle address
     */
    function setMxnbUsdcOracle(address _mxnbUsdcOracle) external onlyOwner {
        require(_mxnbUsdcOracle != address(0), "Invalid address");
        emit MxnbUsdcOracleUpdated(mxnbUsdcOracle, _mxnbUsdcOracle);
        mxnbUsdcOracle = _mxnbUsdcOracle;
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