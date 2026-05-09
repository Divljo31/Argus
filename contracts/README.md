# Argus contracts

Foundry project. One contract: `YieldVault.sol`.

## Setup

```bash
cd contracts
forge install foundry-rs/forge-std --no-commit
forge install OpenZeppelin/openzeppelin-contracts --no-commit
forge build
forge test -vv
```

## Deploy (Base mainnet)

```bash
export BASE_RPC_URL=https://base-mainnet.g.alchemy.com/v2/...
export VAULT_OWNER=0xYourDemoUserEOA
export MANAGER_ADDRESS=0xManagerAgentEOA
export PRIVATE_KEY=0xDeployerKey       # any funded EOA, doesn't have to be owner

forge script script/Deploy.s.sol --rpc-url $BASE_RPC_URL --private-key $PRIVATE_KEY --broadcast --verify
```

## Safety rails (re-confirmed before stage)

- `manager` EOA can only move funds **vault ↔ Aave**. It cannot transfer out.
- `owner` (the user) can always `withdrawToOwner`, even when paused.
- `maxDeposit` cap enforced in the contract — defense in depth.
- No proxy / upgradeability. Hackathon-grade.
