import {
  signAlert,
  type ThreatAlertPayload,
  resolveAgent,
  pickAgentEndpoint,
} from "@argus/shared";
import { env } from "./env.js";
import { logger } from "./logger.js";
import { ensClient, watcherAccount } from "./clients.js";
import { scrapePolymarket } from "./scrapers.js";
import { recordAlert } from "./db.js";
import { uploadEvidence } from "./swarm.js";

const COOLDOWN_MS = 2 * 60 * 1000;
let lastAlertAt = 0;

async function resolveManagerEndpoint(): Promise<{ address: `0x${string}`; endpoint: string }> {
  const records = await resolveAgent(ensClient, env.managerEns);
  if (!records.address) {
    throw new Error(`ENS resolution failed for ${env.managerEns}`);
  }
  const endpoint = pickAgentEndpoint(records, ["a2a", "web"]);
  if (!endpoint) {
    throw new Error(
      `${env.managerEns} has no agent-endpoint[a2a] or agent-endpoint[web] (ENSIP-26) text record`,
    );
  }
  return { address: records.address, endpoint };
}

/**
 * Hardcoded threat — fires a deterministic high-score alert each tick (subject
 * to cooldown). Demo path: Polymarket scrape proves x402 metering, this fires
 * the actual exit so the audience sees the full loop on every cycle.
 */
async function fireHardcodedAlert() {
  if (Date.now() - lastAlertAt < COOLDOWN_MS) {
    logger.info({}, "hardcoded threat in cooldown");
    return;
  }

  const evidence = {
    protocol: "aave-v3",
    score: 95,
    items: [
      {
        source: "hardcoded",
        id: `hardcoded-${Date.now()}`,
        url: "https://argus.divljo.eth/demo",
        text: "BREAKING: Aave v3 USDC pool drained — $40M exploit confirmed by multiple independent reports. Polymarket implied probability spiking.",
        receivedAt: Date.now(),
        cls: { relevance: 0.95, severity: 0.99, target: "aave-v3", summary: "hardcoded demo trigger" },
      },
    ],
  };
  const evidenceSwarmRef = await uploadEvidence(evidence);

  const issuedAt = Math.floor(Date.now() / 1000);
  const payload: ThreatAlertPayload = {
    alertId: `aave-v3-base-${issuedAt}`,
    protocol: "aave-v3",
    chain: "base",
    score: 95,
    evidenceSwarmRef,
    issuedAt,
    recommendedAction: "exit",
  };
  const signed = await signAlert(payload, env.watcherKey);

  let endpoint: string;
  try {
    ({ endpoint } = await resolveManagerEndpoint());
  } catch (err) {
    logger.error({ err }, "failed to resolve manager — skipping alert");
    return;
  }

  logger.info({ alertId: payload.alertId, endpoint, score: 95 }, "POSTing hardcoded alert to manager");
  try {
    const res = await fetch(`${endpoint.replace(/\/$/, "")}/alerts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(signed),
    });
    const body = await res.text();
    recordAlert(payload.alertId, 95, body);
    lastAlertAt = Date.now();
    logger.info({ alertId: payload.alertId, status: res.status, body }, "manager response");
  } catch (err) {
    logger.error({ err, alertId: payload.alertId }, "POST to manager failed");
  }
}

async function tick() {
  try {
    // 1. Polymarket via x402 — every successful scrape settles 1 USDC on Base
    //    (real on-chain proof for the Apify×x402 bounty).
    const polymarket = await scrapePolymarket();
    if (polymarket.length) {
      logger.info({ n: polymarket.length }, "polymarket scraped (x402 metered)");
    }

    // 2. Hardcoded threat → signed alert → manager exit. Deterministic for the demo.
    await fireHardcodedAlert();
  } catch (err) {
    logger.error({ err }, "tick error");
  }
}

async function main() {
  logger.info(
    { ens: env.watcherEns, address: watcherAccount.address, threshold: env.threshold, useX402: env.useX402 },
    "watcher booting",
  );
  await tick();
  setInterval(tick, env.pollIntervalMs);
}

main().catch((err) => {
  logger.fatal({ err }, "watcher crashed");
  process.exit(1);
});
