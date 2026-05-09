// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Minimal slice of Aave v3 Pool we actually call.
interface IAavePool {
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;
    function withdraw(address asset, uint256 amount, address to) external returns (uint256);
}
