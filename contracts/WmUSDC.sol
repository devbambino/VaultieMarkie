// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

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
    IERC20 private immutable _vaultUSDC;

    // Events
    event Deposited(address indexed user, uint256 assets, uint256 shares);
    event Withdrawn(address indexed user, uint256 assets, uint256 shares);

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
        _vaultUSDC = IERC20(vaultUSDC_);
    }

    /**
     * @notice Get the total number of assets managed by this vault
     * @return Total vaultUSDC balance held by this contract
     * @dev This is critical: as Morpho Vault accrues yield, this balance grows
     */
    function totalAssets() public view override returns (uint256) {
        // Return the current balance of vaultUSDC held by this contract
        // This includes both principal and accrued Morpho Vault interest
        return _vaultUSDC.balanceOf(address(this));
    }

    /**
     * @notice Get decimals (matches mUSDC: 18)
     * @return Decimal places
     */
    function decimals() public pure override(ERC20, ERC4626) returns (uint8) {
        return 18;
    }

    /**
     * @notice Deposit vaultUSDC and receive non-rebasing WaUSDC shares
     * @param assets Amount of vaultUSDC to deposit
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
        
        // Transfer vaultUSDC from caller to this contract
        require(
            _vaultUSDC.transferFrom(msg.sender, address(this), assets),
            "Transfer failed"
        );
        
        // Mint shares to receiver
        _mint(receiver, shares);
        
        emit Deposited(receiver, assets, shares);
        emit Deposit(msg.sender, receiver, assets, shares);
        
        return shares;
    }

    /**
     * @notice Withdraw vaultUSDC by burning WaUSDC shares
     * @param assets Amount of vaultUSDC to withdraw
     * @param receiver Address to receive vaultUSDC
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
        
        // Transfer vaultUSDC to receiver
        require(_vaultUSDC.transfer(receiver, assets), "Transfer failed");
        
        emit Withdrawn(owner, assets, shares);
        emit Withdraw(msg.sender, receiver, owner, assets, shares);
        
        return shares;
    }

    /**
     * @notice Mint WmUSDC shares by providing vaultUSDC
     * @param shares Amount of shares to mint
     * @param receiver Address to receive shares
     * @return assets Amount of vaultUSDC required
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
            _vaultUSDC.transferFrom(msg.sender, address(this), assets),
            "Transfer failed"
        );
        
        _mint(receiver, shares);
        
        emit Deposit(msg.sender, receiver, assets, shares);
        
        return assets;
    }

    /**
     * @notice Redeem WmUSDC shares for vaultUSDC
     * @param shares Amount of shares to redeem
     * @param receiver Address to receive vaultUSDC
     * @param owner Address whose shares are burned
     * @return assets Amount of vaultUSDC returned
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
        
        require(_vaultUSDC.transfer(receiver, assets), "Transfer failed");
        
        emit Withdraw(msg.sender, receiver, owner, assets, shares);
        
        return assets;
    }

    /**
     * @notice Preview how many shares would be minted for a given amount of vaultUSDC
     * @param assets Amount of vaultUSDC to deposit
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
     * @notice Preview how many vaultUSDC would be withdrawn for a given number of shares
     * @param assets Amount of vaultUSDC to withdraw
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
     * @notice Preview how many vaultUSDC would be needed to mint given shares
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
     * @notice Preview how many vaultUSDC would be returned for redeeming shares
     * @param shares Amount of shares to redeem
     * @return Assets that would be returned
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
}
