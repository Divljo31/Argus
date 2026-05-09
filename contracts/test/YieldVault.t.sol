// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {YieldVault} from "../src/YieldVault.sol";
import {IAavePool} from "../src/interfaces/IAavePool.sol";

contract MockUSDC {
    string public constant name = "USD Coin";
    string public constant symbol = "USDC";
    uint8 public constant decimals = 6;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract MockAavePool is IAavePool {
    MockUSDC public immutable usdc;
    MockUSDC public immutable aUsdc;

    constructor(MockUSDC _usdc, MockUSDC _aUsdc) {
        usdc = _usdc;
        aUsdc = _aUsdc;
    }

    function supply(address, uint256 amount, address onBehalfOf, uint16) external override {
        usdc.transferFrom(msg.sender, address(this), amount);
        aUsdc.mint(onBehalfOf, amount);
    }

    function withdraw(address, uint256 amount, address to) external override returns (uint256) {
        usdc.transfer(to, amount);
        return amount;
    }
}

contract YieldVaultTest is Test {
    MockUSDC usdc;
    MockUSDC aUsdc;
    MockAavePool pool;
    YieldVault vault;

    address user = address(0xA11CE);
    address manager = address(0xB0B);
    address attacker = address(0xBAD);

    function setUp() public {
        usdc = new MockUSDC();
        aUsdc = new MockUSDC();
        pool = new MockAavePool(usdc, aUsdc);
        vm.prank(user);
        vault = new YieldVault(user, manager, IERC20(address(usdc)), IERC20(address(aUsdc)), pool, 50_000_000);
        usdc.mint(user, 100_000_000);
    }

    function test_deposit_supply_withdraw_roundtrip() public {
        vm.startPrank(user);
        usdc.approve(address(vault), 20_000_000);
        vault.deposit(20_000_000);
        vm.stopPrank();

        assertEq(usdc.balanceOf(address(vault)), 20_000_000);

        vm.prank(manager);
        vault.managerSupplyAave(20_000_000);
        assertEq(aUsdc.balanceOf(address(vault)), 20_000_000);
        assertEq(usdc.balanceOf(address(vault)), 0);

        vm.prank(manager);
        vault.managerWithdrawAave(20_000_000, bytes32("threat-alert:demo"));
        assertEq(usdc.balanceOf(address(vault)), 20_000_000);

        vm.prank(user);
        vault.withdrawToOwner(20_000_000);
        assertEq(usdc.balanceOf(user), 100_000_000);
    }

    function test_deposit_cap() public {
        vm.startPrank(user);
        usdc.approve(address(vault), 60_000_000);
        vm.expectRevert(YieldVault.CapExceeded.selector);
        vault.deposit(60_000_000);
        vm.stopPrank();
    }

    function test_attacker_cannot_supply() public {
        vm.prank(attacker);
        vm.expectRevert(YieldVault.NotManager.selector);
        vault.managerSupplyAave(1);
    }

    function test_attacker_cannot_withdraw_to_self() public {
        vm.prank(attacker);
        vm.expectRevert(YieldVault.NotOwner.selector);
        vault.withdrawToOwner(1);
    }

    function test_owner_can_pull_even_when_paused() public {
        vm.startPrank(user);
        usdc.approve(address(vault), 10_000_000);
        vault.deposit(10_000_000);
        vault.setPaused(true);
        vault.withdrawToOwner(10_000_000);
        vm.stopPrank();
        assertEq(usdc.balanceOf(user), 100_000_000);
    }
}
