import { createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet } from "viem/chains";
import { env } from "./env.js";

export const watcherAccount = privateKeyToAccount(env.watcherKey);

export const ensClient = createPublicClient({
  chain: mainnet,
  transport: http(env.mainnetRpcUrl),
});
