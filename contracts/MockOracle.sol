// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * Mock Oracle returning CCOP per WaUSDC price scaled by 1e18.
 * Example: if 1 WaUSDC == 0.5 CCOP -> price = 0.5 * 1e18 = 5e17
 * For simplicity in tests you will set price such that subsidy math is clear.
 */
contract MockOracle {
    uint256 public price; // CCOP per WaUSDC scaled by 1e18

    constructor(uint256 initialPrice) {
        price = initialPrice;
    }

    function setPrice(uint256 p) external {
        price = p;
    }
}