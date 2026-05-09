import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, mainnet } from "viem/chains";
import { env } from "./env.js";

export const account = privateKeyToAccount(env.managerKey);

export const baseClient = createPublicClient({
  chain: base,
  transport: http(env.baseRpcUrl),
});

export const baseWallet = createWalletClient({
  account,
  chain: base,
  transport: http(env.baseRpcUrl),
});

/** ENS lives on mainnet — name resolution always goes here. */
export const ensClient = createPublicClient({
  chain: mainnet,
  transport: http(env.mainnetRpcUrl),
});
