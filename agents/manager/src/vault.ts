import { keccak256, toBytes } from "viem";
import { BASE_ADDRESSES } from "@argus/shared";
import { baseClient, baseWallet } from "./clients.js";
import { env } from "./env.js";
import { erc20Abi, yieldVaultAbi } from "./abi.js";
import { logger } from "./logger.js";

export interface VaultBalances {
  idleUsdc: bigint;
  suppliedUsdc: bigint;
}

export async function readVaultBalances(): Promise<VaultBalances> {
  const [idle, supplied] = await Promise.all([
    baseClient.readContract({
      address: BASE_ADDRESSES.USDC,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [env.vaultAddress],
    }),
    baseClient.readContract({
      address: BASE_ADDRESSES.AUSDC,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [env.vaultAddress],
    }),
  ]);
  return { idleUsdc: idle, suppliedUsdc: supplied };
}

export async function supplyIdleToAave(): Promise<{ txHash: `0x${string}`; amount: bigint } | null> {
  const { idleUsdc } = await readVaultBalances();
  if (idleUsdc === 0n) {
    logger.info("no idle USDC — nothing to supply");
    return null;
  }
  logger.info({ amount: idleUsdc.toString() }, "supplying to Aave");
  const txHash = await baseWallet.writeContract({
    address: env.vaultAddress,
    abi: yieldVaultAbi,
    functionName: "managerSupplyAave",
    args: [idleUsdc],
  });
  await baseClient.waitForTransactionReceipt({ hash: txHash });
  return { txHash, amount: idleUsdc };
}

export async function exitAaveOnAlert(alertId: string): Promise<{ txHash: `0x${string}`; amount: bigint } | null> {
  const { suppliedUsdc } = await readVaultBalances();
  if (suppliedUsdc === 0n) {
    logger.warn({ alertId }, "alert received but vault has no supplied position");
    return null;
  }
  const reason = keccak256(toBytes(`threat-alert:${alertId}`));
  logger.info({ amount: suppliedUsdc.toString(), alertId }, "exiting Aave on alert");
  const txHash = await baseWallet.writeContract({
    address: env.vaultAddress,
    abi: yieldVaultAbi,
    functionName: "managerWithdrawAave",
    args: [suppliedUsdc, reason],
  });
  await baseClient.waitForTransactionReceipt({ hash: txHash });
  return { txHash, amount: suppliedUsdc };
}
