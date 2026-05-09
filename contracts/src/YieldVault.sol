// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IAavePool} from "./interfaces/IAavePool.sol";

/// @title  Argus YieldVault
/// @notice Per-user vault. The user owns the funds. The manager EOA can only
///         move funds between this vault and Aave on the same chain — never
///         to an arbitrary address. Hackathon-grade by design.
contract YieldVault {
    using SafeERC20 for IERC20;

    error NotOwner();
    error NotManager();
    error Paused();
    error CapExceeded();
    error ZeroAmount();

    event Deposit(address indexed from, uint256 amount);
    event WithdrawToOwner(address indexed to, uint256 amount);
    event ManagerSupplied(uint256 amount);
    event ManagerWithdrew(uint256 amount, bytes32 reason);
    event PauseChanged(bool paused);
    event ManagerChanged(address indexed manager);

    address public immutable owner;
    IERC20 public immutable usdc;
    IERC20 public immutable aUsdc;
    IAavePool public immutable aave;

    address public manager;
    uint256 public maxDeposit;
    bool public paused;

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyManager() {
        if (msg.sender != manager) revert NotManager();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    constructor(
        address _owner,
        address _manager,
        IERC20 _usdc,
        IERC20 _aUsdc,
        IAavePool _aave,
        uint256 _maxDeposit
    ) {
        owner = _owner;
        manager = _manager;
        usdc = _usdc;
        aUsdc = _aUsdc;
        aave = _aave;
        maxDeposit = _maxDeposit;
    }

    /// @notice User pulls USDC from their wallet into the vault.
    function deposit(uint256 amount) external onlyOwner whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        if (totalAssets() + amount > maxDeposit) revert CapExceeded();
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        emit Deposit(msg.sender, amount);
    }

    /// @notice Owner pulls funds back to themselves at any time. Always works,
    ///         even when paused, so the user is never trapped.
    function withdrawToOwner(uint256 amount) external onlyOwner {
        if (amount == 0) revert ZeroAmount();
        usdc.safeTransfer(owner, amount);
        emit WithdrawToOwner(owner, amount);
    }

    /// @notice Manager parks idle USDC in Aave. Funds never leave this vault.
    function managerSupplyAave(uint256 amount) external onlyManager whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        usdc.forceApprove(address(aave), amount);
        aave.supply(address(usdc), amount, address(this), 0);
        emit ManagerSupplied(amount);
    }

    /// @notice Manager pulls USDC back from Aave. `reason` is a free-form tag
    ///         like keccak256("threat-alert:<id>") for the audit log.
    function managerWithdrawAave(uint256 amount, bytes32 reason) external onlyManager {
        if (amount == 0) revert ZeroAmount();
        aave.withdraw(address(usdc), amount, address(this));
        emit ManagerWithdrew(amount, reason);
    }

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit PauseChanged(_paused);
    }

    function setManager(address _manager) external onlyOwner {
        manager = _manager;
        emit ManagerChanged(_manager);
    }

    /// @notice Idle USDC + supplied principal + accrued aUSDC interest.
    function totalAssets() public view returns (uint256) {
        return usdc.balanceOf(address(this)) + aUsdc.balanceOf(address(this));
    }
}
