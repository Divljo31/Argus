// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {YieldVault} from "../src/YieldVault.sol";
import {IAavePool} from "../src/interfaces/IAavePool.sol";

contract Deploy is Script {
    // Base mainnet — verify against the latest Aave address book before deploy.
    // Aave v3 Pool (Base):  0xA238Dd80C259a72e81d7e4664a9801593F98d1c5
    // USDC (native, Base):  0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
    // aBasUSDC (Base):      0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB
    address internal constant USDC_BASE = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address internal constant AAVE_POOL_BASE = 0xA238Dd80C259a72e81d7e4664a9801593F98d1c5;
    address internal constant AUSDC_BASE = 0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB;

    function run() external {
        address owner = vm.envAddress("VAULT_OWNER");
        address manager = vm.envAddress("MANAGER_ADDRESS");
        uint256 cap = vm.envOr("MAX_DEPOSIT_USDC_6DEC", uint256(50_000_000)); // 50 USDC default

        vm.startBroadcast();
        YieldVault vault = new YieldVault(
            owner,
            manager,
            IERC20(USDC_BASE),
            IERC20(AUSDC_BASE),
            IAavePool(AAVE_POOL_BASE),
            cap
        );
        vm.stopBroadcast();

        console.log("YieldVault deployed:", address(vault));
        console.log("  owner:   ", owner);
        console.log("  manager: ", manager);
        console.log("  cap:     ", cap);
    }
}
