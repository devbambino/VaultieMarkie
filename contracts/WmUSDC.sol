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

    // Track per-user deposits in USDC-equivalent value
    mapping(address => uint256) public userDepositedAssets;

    // Accumulated yield (mUSDC shares) owned by the contract/owner
    uint256 public accumulatedShares;

    // Events
    event Deposited(address indexed user, uint256 assets, uint256 shares);
    event Withdrawn(address indexed user, uint256 assets, uint256 shares);
    event YieldAccumulated(uint256 yieldShares, uint256 timestamp);
    event YieldWithdrawn(address indexed recipient, uint256 amount, uint256 timestamp);

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
     * @return mUSDC shares required
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

        // Convert mUSDC shares to USDC-equivalent value
        uint256 usdcAssets = _convertMUSDCToUSDC(assets);
        
        // Calculate shares based on USDC equivalent value
        shares = previewDeposit(usdcAssets);
        
        // Transfer mUSDC from caller to this contract
        require(
            _vaultUSDC.transferFrom(msg.sender, address(this), assets),
            "Transfer failed"
        );
        
        // Track user's deposited USDC-equivalent amount
        userDepositedAssets[receiver] += usdcAssets;
        
        // Mint shares to receiver
        _mint(receiver, shares);
        
        emit Deposited(receiver, usdcAssets, shares);
        emit Deposit(msg.sender, receiver, usdcAssets, shares);
        
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
     * 2. Checking how many shares we actually hold
     * 3. Keeping any extra shares as accumulated yield for the owner
     */
    function withdraw(uint256 assets, address receiver, address owner)
        public
        override(ERC4626)
        returns (uint256 shares)
    {
        require(assets > 0, "Cannot withdraw zero");
        require(receiver != address(0), "Invalid receiver");

        // Calculate WmUSDC shares to burn based on USDC assets
        shares = previewWithdraw(assets);
        
        // Approve and burn shares from owner
        if (msg.sender != owner) {
            uint256 allowed = allowance(owner, msg.sender);
            require(allowed >= shares, "Insufficient allowance");
            _approve(owner, msg.sender, allowed - shares);
        }
        
        // Capture totalSupply before burning
        uint256 totalSupplyBefore = totalSupply();
        _burn(owner, shares);
        
        // Calculate mUSDC shares needed to cover the USDC assets
        uint256 mUSDCNeeded = _convertUSDCToMUSDC(assets);
        
        // Get current mUSDC balance
        uint256 mUSDCBalance = _vaultUSDC.balanceOf(address(this));
        
        // Capture yield: any excess mUSDC over what's needed
        if (mUSDCBalance > mUSDCNeeded) {
            uint256 yieldShares = mUSDCBalance - mUSDCNeeded;
            accumulatedShares += yieldShares;
            emit YieldAccumulated(yieldShares, block.timestamp);
        }
        
        // Transfer exact mUSDC to receiver
        require(_vaultUSDC.transfer(receiver, mUSDCNeeded), "Transfer failed");
        
        // Update user's deposited assets tracking using totalSupply from before burn
        if (totalSupplyBefore > 0) {
            uint256 userShare = (userDepositedAssets[owner] * shares) / totalSupplyBefore;
            userDepositedAssets[owner] -= userShare;
        }
        
        emit Withdrawn(owner, assets, shares);
        emit Withdraw(msg.sender, receiver, owner, assets, shares);
        
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

        // Calculate USDC value needed for the shares
        uint256 usdcAssets = previewMint(shares);
        
        // Convert USDC to mUSDC shares needed
        assets = _convertUSDCToMUSDC(usdcAssets);
        
        require(
            _vaultUSDC.transferFrom(msg.sender, address(this), assets),
            "Transfer failed"
        );
        
        // Track user's deposited USDC-equivalent amount
        userDepositedAssets[receiver] += usdcAssets;
        
        // Mint exact shares
        _mint(receiver, shares);
        
        emit Deposit(msg.sender, receiver, usdcAssets, shares);
        
        return assets;
    }

    /**
     * @notice Redeem WmUSDC shares for mUSDC while capturing yield
     * @param shares Amount of shares to redeem
     * @param receiver Address to receive mUSDC
     * @param owner Address whose shares are burned
     * @return assets Amount of mUSDC returned
     * @dev
     * The redemption captures yield by:
     * 1. Converting shares to USDC-equivalent assets
     * 2. Converting USDC assets to mUSDC shares needed
     * 3. Keeping any extra mUSDC shares as accumulated yield
     */
    function redeem(uint256 shares, address receiver, address owner)
        public
        override(ERC4626)
        returns (uint256 assets)
    {
        require(shares > 0, "Cannot redeem zero");
        require(receiver != address(0), "Invalid receiver");

        // Calculate USDC-equivalent assets user is entitled to
        uint256 usdcAssets = previewRedeem(shares);
        
        if (msg.sender != owner) {
            uint256 allowed = allowance(owner, msg.sender);
            require(allowed >= shares, "Insufficient allowance");
            _approve(owner, msg.sender, allowed - shares);
        }
        
        // Capture totalSupply before burning
        uint256 totalSupplyBefore = totalSupply();
        _burn(owner, shares);
        
        // Convert USDC assets to mUSDC shares needed
        assets = _convertUSDCToMUSDC(usdcAssets);
        
        // Get current mUSDC balance
        uint256 mUSDCBalance = _vaultUSDC.balanceOf(address(this));
        
        // Capture yield: any excess mUSDC over what's needed
        if (mUSDCBalance > assets) {
            uint256 yieldShares = mUSDCBalance - assets;
            accumulatedShares += yieldShares;
            emit YieldAccumulated(yieldShares, block.timestamp);
        }
        
        // Transfer calculated mUSDC to receiver
        require(_vaultUSDC.transfer(receiver, assets), "Transfer failed");
        
        // Update user's deposited assets tracking using totalSupply from before burn
        if (totalSupplyBefore > 0) {
            uint256 userShare = (userDepositedAssets[owner] * shares) / totalSupplyBefore;
            userDepositedAssets[owner] -= userShare;
        }
        
        emit Withdraw(msg.sender, receiver, owner, usdcAssets, shares);
        
        return assets;
    }

    /**
     * @notice Preview how many shares would be minted for a given amount of USDC assets
     * @param assets Amount of USDC assets to deposit
     * @return Shares that would be minted
     * @dev These are USDC-equivalent assets (not mUSDC shares)
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
     * @notice Preview how many USDC assets would be withdrawn for a given number of shares
     * @param assets Amount of USDC assets to withdraw
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
     * @notice Preview how many USDC assets would be needed to mint given shares
     * @param shares Amount of shares to mint
     * @return Assets required (in USDC equivalent)
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
     * @notice Preview how many USDC assets would be returned for redeeming shares
     * @param shares Amount of shares to redeem
     * @return Assets that would be returned (in USDC equivalent)
     */
    function previewRedeem(uint256 shares)
        public
        view
        override(ERC4626)
        returns (uint256)
    {
        // assets = shares * (totalAssets / totalSupply)
        uint256 supply = totalSupply();
        return supply == 0 ? shares : (shares * totalAssets()) / supply;
    }

    /**
     * @notice Withdraw accumulated yield (mUSDC shares) owned by the contract
     * @param amount Amount of mUSDC shares to withdraw
     * @param recipient Address to receive the mUSDC
     * @dev Only owner can call this. Yield is captured during user withdrawals/redeems
     */
    function withdrawAccumulatedYield(uint256 amount, address recipient)
        external
        onlyOwner
    {
        require(amount > 0, "Cannot withdraw zero");
        require(recipient != address(0), "Invalid recipient");
        require(amount <= accumulatedShares, "Insufficient accumulated yield");

        // Reduce accumulated shares counter
        accumulatedShares -= amount;

        // Transfer mUSDC to recipient
        require(_vaultUSDC.transfer(recipient, amount), "Transfer failed");

        emit YieldWithdrawn(recipient, amount, block.timestamp);
    }
}
