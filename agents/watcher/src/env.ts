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

/** Returns the key only if it looks real; otherwise empty (→ mock classifier). */
function validKey(v: string | undefined): string {
  if (!v) return "";
  if (v.includes("REPLACE_ME")) return "";
  return v;
}

export const env = {
  baseRpcUrl: required("BASE_RPC_URL"),
  mainnetRpcUrl: process.env.MAINNET_RPC_URL ?? "https://eth.llamarpc.com",
  watcherKey: required("WATCHER_PRIVATE_KEY") as Hex,
  watcherEns: required("WATCHER_ENS"),
  managerEns: required("MANAGER_ENS"),
  anthropicKey: validKey(process.env.ANTHROPIC_API_KEY),
  apifyToken: process.env.APIFY_TOKEN ?? "",
  /**
   * Comma-separated Telegram channel handles or URLs for tri_angle/telegram-scraper.
   * Leave empty to skip the Telegram scrape entirely (graceful no-op).
   */
  telegramChannels: (process.env.TELEGRAM_CHANNELS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  pollIntervalMs: Number(process.env.WATCHER_POLL_INTERVAL_MS ?? 30_000),
  threshold: Number(process.env.THREAT_SCORE_THRESHOLD ?? 60),
  demoMode: process.env.DEMO_MODE === "true",
  swarmGateway: process.env.SWARM_GATEWAY_URL ?? "https://bzz.limo",
  swarmPostageBatchId: process.env.SWARM_POSTAGE_BATCH_ID ?? "",
  /** Set to true to use x402-fetch against Apify's experimental endpoint. */
  useX402: process.env.USE_X402 === "true",
  /** Mock-classifier dials (used only when ANTHROPIC_API_KEY is empty). */
  mockThreatLevel: (process.env.MOCK_THREAT_LEVEL ?? "random") as
    | "low"
    | "medium"
    | "high"
    | "random",
  mockTargetAaveProb: Number(process.env.MOCK_TARGET_AAVE_PROB ?? 0.7),
};
