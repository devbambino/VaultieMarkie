// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @notice Interface for DebtLens to get accrued interest (returned in CCOP units with 6 decimals)
 */
interface IDebtLens {
    function getAccruedInterest(bytes32 marketId, address user) external view returns (uint256);
}

/**
 * @notice Interface for a simple oracle that returns CCOP per WaUSDC price scaled by 1e18
 * i.e. price = (CCOP amount for 1 WaUSDC) * 1e18
 */
interface IWaUSDCCCOPOracle {
    function price() external view returns (uint256);
}

/**
 * @title WaUSDC
 * @notice ERC4626 wrapper around Aave aUSDC with subsidy reservation for CCOP interest
 *
 * Key rules:
 * - totalAssets() is the aToken balance (rebasing aToken)
 * - standard ERC4626 share math is preserved for deposits/withdraws/preview logic
 * - per-user principal is tracked (userPrincipal) and reduced pro rata when shares are burned
 * - users call getInterestSubsidy(user) to request a subsidy reservation (reserves from available yield)
 * - users call redeemWithInterestSubsidy(...) to burn shares and receive principal + any reserved subsidy
 */
contract WaUSDC is ERC4626, Ownable {
    IERC20 public immutable aToken; // underlying aToken (aUSDC)
    uint8 private constant _decimals = 6;

    // Total principal tracked (sum of raw underlying assets considered principal)
    uint256 public totalPrincipal;

    // Per-user principal (in underlying aToken units)
    mapping(address => uint256) public userPrincipal;

    // Stored subsidy requested by user (in underlying aToken units)
    mapping(address => uint256) public userInterestSubsidyInWaUSDC;

    // track accrued interest in CCOP as recorded when getInterestSubsidy is called
    mapping(address => uint256) public userInterestInCCOP;

    // total allocated subsidy (sum of userInterestSubsidyInWaUSDC)
    uint256 public totalAllocatedSubsidy;

    // External integrations (configurable)
    address public debtLens;
    address public ccopUsdcOracle;
    bytes32 public marketId;

    // Events
    event SubsidyRequested(address indexed user, uint256 interestInCCOP, uint256 subsidyInWaUSDC);
    event SubsidyRevoked(address indexed user, uint256 amount);
    event SubsidyUsed(address indexed user, uint256 amount);
    event PrincipalReduced(address indexed user, uint256 amount);
    event DebtLensUpdated(address indexed oldDebtLens, address indexed newDebtLens);
    event CCOPUsdcOracleUpdated(address indexed oldOracle, address indexed newOracle);
    event MarketIdUpdated(bytes32 indexed oldMarketId, bytes32 indexed newMarketId);

    constructor(IERC20 _aToken, address initialOwner) ERC4626(_aToken) ERC20("Wrapped Aave USDC", "WaUSDC") Ownable(initialOwner) {
        require(address(_aToken) != address(0), "invalid aToken");
        aToken = _aToken;
    }

    /// decimals override to match aUSDC (6)
    function decimals() public pure override returns (uint8) {
        return _decimals;
    }

    /// totalAssets uses the aToken balance (rebasing aToken grows)
    function totalAssets() public view override returns (uint256) {
        return aToken.balanceOf(address(this));
    }

    // ----- deposit / mint overrides to track principal ----- //
    function deposit(uint256 assets, address receiver) public override returns (uint256 shares) {
        require(assets > 0, "zero assets");
        require(receiver != address(0), "zero receiver");

        // compute shares using ERC4626 logic (previewDeposit uses totalAssets)
        shares = previewDeposit(assets);

        // transfer aToken from user to this contract
        require(aToken.transferFrom(msg.sender, address(this), assets), "transfer failed");

        // mint shares to receiver
        _mint(receiver, shares);

        // record principal (raw assets)
        userPrincipal[receiver] += assets;
        totalPrincipal += assets;

        emit Deposit(msg.sender, receiver, assets, shares);
    }

    function mint(uint256 shares, address receiver) public override returns (uint256 assets) {
        require(shares > 0, "zero shares");
        require(receiver != address(0), "zero receiver");

        assets = previewMint(shares);
        require(aToken.transferFrom(msg.sender, address(this), assets), "transfer failed");
        _mint(receiver, shares);

        userPrincipal[receiver] += assets;
        totalPrincipal += assets;

        emit Deposit(msg.sender, receiver, assets, shares);
    }

    // ----- withdraw / redeem overrides to reduce principal pro rata ----- //
    function withdraw(uint256 assets, address receiver, address owner) public override returns (uint256 shares) {
        require(assets > 0, "zero assets");
        require(receiver != address(0), "zero receiver");

        shares = previewWithdraw(assets);

        if (msg.sender != owner) {
            uint256 allowed = allowance(owner, msg.sender);
            require(allowed >= shares, "insufficient allowance");
            _approve(owner, msg.sender, allowed - shares);
        }

        uint256 ownerSharesBefore = balanceOf(owner);
        require(ownerSharesBefore >= shares, "insufficient shares");

        // reduce principal proportional to shares being burned
        if (userPrincipal[owner] > 0) {
            uint256 principalReduction = (userPrincipal[owner] * shares) / ownerSharesBefore;
            userPrincipal[owner] -= principalReduction;
            totalPrincipal -= principalReduction;
            emit PrincipalReduced(owner, principalReduction);
        }

        _burn(owner, shares);
        require(aToken.transfer(receiver, assets), "transfer failed");

        emit Withdraw(msg.sender, receiver, owner, assets, shares);
    }

    function redeem(uint256 shares, address receiver, address owner) public override returns (uint256 assets) {
        require(shares > 0, "zero shares");
        require(receiver != address(0), "zero receiver");

        assets = previewRedeem(shares);

        if (msg.sender != owner) {
            uint256 allowed = allowance(owner, msg.sender);
            require(allowed >= shares, "insufficient allowance");
            _approve(owner, msg.sender, allowed - shares);
        }

        uint256 ownerSharesBefore = balanceOf(owner);
        require(ownerSharesBefore >= shares, "insufficient shares");

        if (userPrincipal[owner] > 0) {
            uint256 principalReduction = (userPrincipal[owner] * shares) / ownerSharesBefore;
            userPrincipal[owner] -= principalReduction;
            totalPrincipal -= principalReduction;
            emit PrincipalReduced(owner, principalReduction);
        }

        _burn(owner, shares);
        require(aToken.transfer(receiver, assets), "transfer failed");

        emit Withdraw(msg.sender, receiver, owner, assets, shares);
    }

    // ----- subsidy logic public API (user-invoked) ----- //

    /// availableYield = totalAssets - totalPrincipal - totalAllocatedSubsidy
    function availableYield() public view returns (uint256) {
        uint256 assets = totalAssets();
        if (assets <= totalPrincipal + totalAllocatedSubsidy) return 0;
        return assets - totalPrincipal - totalAllocatedSubsidy;
    }

    /**
     * @notice User calls this to compute & reserve (if possible) subsidy for their CCOP interest
     * @dev - Queries DebtLens for accrued interest (in CCOP units, 6 decimals)
     *      - Queries oracle (CCOP per WaUSDC scaled by 1e18)
     *      - Computes WaUSDC equivalent: waiver = interestCCOP * 1e18 / oraclePrice
     *      - Reserves waiver from availableYield (adds to userInterestSubsidyInWaUSDC & totalAllocatedSubsidy)
     */
    function getInterestSubsidy(address user) external returns (uint256 subsidy) {
        require(user != address(0), "zero user");
        require(debtLens != address(0) && ccopUsdcOracle != address(0), "integrations not set");

        uint256 interestInCCOP = IDebtLens(debtLens).getAccruedInterest(marketId, user);
        userInterestInCCOP[user] = interestInCCOP;

        if (interestInCCOP == 0) {
            userInterestSubsidyInWaUSDC[user] = 0;
            return 0;
        }

        uint256 oraclePrice = IWaUSDCCCOPOracle(ccopUsdcOracle).price();
        require(oraclePrice > 0, "oracle price 0");

        // Compute WaUSDC units: waiver = interestCCOP * 1e18 / oraclePrice
        // interestInCCOP has 6 decimals; waiver result will be in same 6 decimals (since oracle is scaled 1e18)
        // (interest * 1e18) / oraclePrice -> underlying units (6 decimals)
        uint256 waiver = (interestInCCOP * 1e36) / oraclePrice;

        uint256 avail = availableYield();
        require(waiver <= avail, "insufficient available yield");

        userInterestSubsidyInWaUSDC[user] = waiver;
        totalAllocatedSubsidy += waiver;

        emit SubsidyRequested(user, interestInCCOP, waiver);
        return waiver;
    }

    /**
     * @notice Redeem shares including the previously reserved interest subsidy
     * @dev User calls this to redeem their shares and, if they had reserved subsidy via getInterestSubsidy,
     *      they receive the subsidy in aToken units as part of the transfer.
     */
    function redeemWithInterestSubsidy(uint256 shares, address receiver, address owner)
        external
        returns (uint256 assets)
    {
        require(shares > 0, "zero shares");
        require(receiver != address(0), "zero receiver");

        if (msg.sender != owner) {
            uint256 allowed = allowance(owner, msg.sender);
            require(allowed >= shares, "insufficient allowance");
            _approve(owner, msg.sender, allowed - shares);
        }

        uint256 ownerSharesBefore = balanceOf(owner);
        require(ownerSharesBefore >= shares, "insufficient shares");

        // standard redeem amount (based on totalAssets -> fair)
        assets = previewRedeem(shares);

        // principal reduction proportional
        uint256 principalReduction = 0;
        if (userPrincipal[owner] > 0) {
            principalReduction = (userPrincipal[owner] * shares) / ownerSharesBefore;
            userPrincipal[owner] -= principalReduction;
            totalPrincipal -= principalReduction;
            emit PrincipalReduced(owner, principalReduction);
        }

        // subsidy stored for user
        uint256 storedSubsidy = userInterestSubsidyInWaUSDC[owner];
        uint256 subsidyToUse = 0;

        if (storedSubsidy > 0) {
            uint256 avail = availableYield();
            subsidyToUse = storedSubsidy <= avail ? storedSubsidy : avail;

            // consume subsidy
            if (subsidyToUse > 0) {
                userInterestSubsidyInWaUSDC[owner] -= subsidyToUse;
                totalAllocatedSubsidy -= subsidyToUse;
            }
        }

        // transfer amount: principal + subsidy (subsidy comes from yield, replacing default yield distribution)
        uint256 totalOut = principalReduction + subsidyToUse;

        // burn shares and transfer assets + subsidy
        _burn(owner, shares);
        require(aToken.transfer(receiver, totalOut), "transfer failed");

        if (subsidyToUse > 0) emit SubsidyUsed(owner, subsidyToUse);

        emit Withdraw(msg.sender, receiver, owner, assets, shares);
    }

    // ------- admin setters (onlyOwner) ------- //
    function setDebtLens(address _debtLens) external onlyOwner {
        require(_debtLens != address(0), "invalid");
        emit DebtLensUpdated(debtLens, _debtLens);
        debtLens = _debtLens;
    }

    function setCCOPUsdcOracle(address _oracle) external onlyOwner {
        require(_oracle != address(0), "invalid");
        emit CCOPUsdcOracleUpdated(ccopUsdcOracle, _oracle);
        ccopUsdcOracle = _oracle;
    }

    function setMarketId(bytes32 _marketId) external onlyOwner {
        emit MarketIdUpdated(marketId, _marketId);
        marketId = _marketId;
    }
}