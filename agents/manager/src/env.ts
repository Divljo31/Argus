import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import dotenv from "dotenv";
import type { Hex } from "viem";

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env: ${name}`);
  return v;
}

export const env = {
  baseRpcUrl: required("BASE_RPC_URL"),
  managerKey: required("MANAGER_PRIVATE_KEY") as Hex,
  managerEns: required("MANAGER_ENS"),
  watcherEns: required("WATCHER_ENS"),
  vaultAddress: required("VAULT_ADDRESS_BASE") as Hex,
  port: Number(process.env.MANAGER_HTTP_PORT ?? 4001),
  swarmGateway: process.env.SWARM_GATEWAY_URL ?? "https://bzz.limo",
  swarmPostageBatchId: process.env.SWARM_POSTAGE_BATCH_ID ?? "",
  mainnetRpcUrl: process.env.MAINNET_RPC_URL ?? "https://eth.llamarpc.com",
};
