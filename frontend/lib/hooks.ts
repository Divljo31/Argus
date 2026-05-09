"use client";

import { useQuery } from "@tanstack/react-query";
import { useReadContract, useAccount } from "wagmi";
import { base } from "wagmi/chains";
import { erc20Abi, yieldVaultAbi } from "./abi";
import { aavePoolMinimalAbi } from "./aave-abi";
import { fetchManagerHealth, fetchReceipts } from "./manager-api";
import { PUBLIC_ENV } from "./env";
import { BASE_ADDRESSES } from "@argus/shared";

export function useManagerHealth() {
  return useQuery({
    queryKey: ["manager", "health"],
    queryFn: fetchManagerHealth,
    refetchInterval: 4_000,
  });
}

export function useReceipts() {
  return useQuery({
    queryKey: ["manager", "receipts"],
    queryFn: fetchReceipts,
    refetchInterval: 4_000,
  });
}

export function useVaultTotalAssets() {
  return useReadContract({
    abi: yieldVaultAbi,
    address: PUBLIC_ENV.vaultAddress,
    functionName: "totalAssets",
    chainId: base.id,
    query: { refetchInterval: 6_000 },
  });
}

export function useVaultMaxDeposit() {
  return useReadContract({
    abi: yieldVaultAbi,
    address: PUBLIC_ENV.vaultAddress,
    functionName: "maxDeposit",
    chainId: base.id,
  });
}

/**
 * Reads Aave v3 USDC supply rate (ray, 1e27) from Base mainnet and converts
 * to APY %. Refetches every 30s so stale rates don't sit forever.
 */
export function useAaveSupplyApy() {
  const r = useReadContract({
    abi: aavePoolMinimalAbi,
    address: BASE_ADDRESSES.AAVE_POOL,
    functionName: "getReserveData",
    args: [BASE_ADDRESSES.USDC],
    chainId: base.id,
    query: { refetchInterval: 30_000 },
  });
  if (!r.data) return { apy: null as number | null, isLoading: r.isLoading };
  const liquidityRate = (r.data as { currentLiquidityRate: bigint }).currentLiquidityRate;
  // ray = 1e27, rate is per-second linear APR. APY = (1 + APR/SEC)^SEC - 1.
  const SECONDS_PER_YEAR = 31_536_000;
  const apr = Number(liquidityRate) / 1e27;
  const apy = Math.pow(1 + apr / SECONDS_PER_YEAR, SECONDS_PER_YEAR) - 1;
  return { apy: apy * 100, isLoading: false };
}

export function useUsdcBalance() {
  const { address } = useAccount();
  return useReadContract({
    abi: erc20Abi,
    address: BASE_ADDRESSES.USDC,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: base.id,
    query: { enabled: !!address, refetchInterval: 8_000 },
  });
}
