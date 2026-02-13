// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MXNBFaucet
 * @notice Faucet for MockMXNB token. Allows users to swap ETH for MXNB at a fixed rate.
 * @dev Fixed exchange rate: 1 ETH = 33548.87 MXNB (accounting for 18 decimal ETH and 6 decimal MXNB)
 */
contract MXNBFaucet is Ownable {
    // ============================================================================
    // STATE VARIABLES
    // ============================================================================

    IERC20 public mxnbToken;

    /// @notice Fixed exchange rate: 1 ETH (10^18 wei) = 33548.87 MXNB (33548870000 wei in 6 decimals)
    /// This represents: 33548.87 * 10^6 = 33548870000
    uint256 public constant EXCHANGE_RATE = 33548870000; // MXNB per 1 ETH (accounting for 6 decimals)

    /// @notice Maximum amount of MXNB a single wallet can receive: 20000 MXNB (in wei, 6 decimals)
    uint256 public constant MAX_PER_WALLET = 20000 * 10**6; // 20000 MXNB

    /// @notice Tracks cumulative MXNB claimed by each address
    mapping(address => uint256) public claimedAmount;

    /// @notice Total ETH received by the faucet
    uint256 public totalEthReceived;

    /// @notice Total MXNB distributed by the faucet
    uint256 public totalMxnbDistributed;

    // ============================================================================
    // EVENTS
    // ============================================================================

    /// @notice Emitted when a user swaps ETH for MXNB
    event Swapped(address indexed user, uint256 ethAmount, uint256 mxnbAmount);

    /// @notice Emitted when owner withdraws ETH
    event EthWithdrawn(address indexed to, uint256 amount);

    /// @notice Emitted when owner withdraws remaining MXNB
    event MxnbWithdrawn(address indexed to, uint256 amount);

    // ============================================================================
    // CONSTRUCTOR
    // ============================================================================

    /**
     * @notice Initialize the faucet with MXNB token address
     * @param _mxnbToken Address of the MockMXNB token
     */
    constructor(address _mxnbToken) Ownable(msg.sender) {
        require(_mxnbToken != address(0), "Invalid MXNB token address");
        mxnbToken = IERC20(_mxnbToken);
    }

    // ============================================================================
    // FALLBACK FUNCTIONS
    // ============================================================================

    /**
     * @notice Fallback: Receive ETH directly (calls swapEthForMxnb)
     */
    receive() external payable {
        _swapEthForMxnb();
    }

    // ============================================================================
    // INTERNAL FUNCTIONS
    // ============================================================================

    /**
     * @notice Internal function to swap ETH for MXNB
     */
    function _swapEthForMxnb() internal {
        require(msg.value > 0, "Must send ETH");

        // Calculate MXNB amount: (ethAmount / 10^18) * 33548.87 * 10^6
        // Which is: (ethAmount * 33548870000) / 10^18
        uint256 mxnbAmount = (msg.value * EXCHANGE_RATE) / 10**18;

        // Check if this would exceed the per-wallet limit
        uint256 newClaimedAmount = claimedAmount[msg.sender] + mxnbAmount;
        require(
            newClaimedAmount <= MAX_PER_WALLET,
            "Would exceed max MXNB per wallet limit"
        );

        // Check if faucet has enough MXNB
        uint256 faucetBalance = mxnbToken.balanceOf(address(this));
        require(faucetBalance >= mxnbAmount, "Faucet has insufficient MXNB");

        // Update tracking
        claimedAmount[msg.sender] = newClaimedAmount;
        totalEthReceived += msg.value;
        totalMxnbDistributed += mxnbAmount;

        // Transfer MXNB to user
        require(
            mxnbToken.transfer(msg.sender, mxnbAmount),
            "MXNB transfer failed"
        );

        emit Swapped(msg.sender, msg.value, mxnbAmount);
    }

    // ============================================================================
    // USER FUNCTIONS
    // ============================================================================

    /**
     * @notice Swap ETH for MXNB at fixed rate: 1 ETH = 33548.87 MXNB
     * @dev User sends ETH via payable function, receives MXNB
     */
    function swapEthForMxnb() external payable {
        _swapEthForMxnb();
    }

    /**
     * @notice Get remaining MXNB available for a specific address
     * @param user Address to check
     * @return Remaining MXNB amount (in wei) that this user can claim
     */
    function getRemainingClaim(address user) external view returns (uint256) {
        uint256 claimed = claimedAmount[user];
        if (claimed >= MAX_PER_WALLET) {
            return 0;
        }
        return MAX_PER_WALLET - claimed;
    }

    // ============================================================================
    // OWNER FUNCTIONS
    // ============================================================================

    /**
     * @notice Owner withdraws ETH from faucet
     * @param to Recipient address
     * @param amount Amount of ETH to withdraw
     */
    function withdrawEth(address payable to, uint256 amount) external onlyOwner {
        require(to != address(0), "Invalid recipient");
        require(amount <= address(this).balance, "Insufficient ETH balance");

        (bool success, ) = to.call{value: amount}("");
        require(success, "ETH transfer failed");

        emit EthWithdrawn(to, amount);
    }

    /**
     * @notice Owner withdraws remaining MXNB from faucet
     * @param to Recipient address
     * @param amount Amount of MXNB to withdraw
     */
    function withdrawMxnb(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "Invalid recipient");

        uint256 faucetBalance = mxnbToken.balanceOf(address(this));
        require(amount <= faucetBalance, "Insufficient MXNB balance");

        require(mxnbToken.transfer(to, amount), "MXNB transfer failed");

        emit MxnbWithdrawn(to, amount);
    }

    /**
     * @notice Owner can withdraw ETH to this address (for ease)
     */
    function withdrawEthToSelf() external payable onlyOwner {
        // No-op, just receives ETH
    }
}
