import type { Address } from "viem";

/**
 * Canonical Base mainnet addresses for the MVP.
 * Confirmed before deploy — see contracts/script/Deploy.s.sol comments.
 */
export const BASE_ADDRESSES = {
  /** Native Circle USDC on Base (NOT bridged USDbC). */
  USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Address,
  /** Aave v3 Pool on Base. */
  AAVE_POOL: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5" as Address,
  /** aBasUSDC — Aave v3 receipt token for USDC on Base. */
  AUSDC: "0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB" as Address,
} as const;

export const CHAIN_IDS = {
  base: 8453,
} as const;
