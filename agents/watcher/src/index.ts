import {
  signAlert,
  type ThreatAlertPayload,
  resolveAgent,
  pickAgentEndpoint,
} from "@argus/shared";
import { env } from "./env.js";
import { logger } from "./logger.js";
import { ensClient, watcherAccount } from "./clients.js";
import {
  scrapeTwitter,
  scrapeReddit,
  scrapeTelegram,
  scrapePolymarket,
  pollDemoTrigger,
  type ScrapedItem,
} from "./scrapers.js";
import { classify } from "./classifier.js";
import { SignalBuffer, scoreFor, type Signal } from "./aggregator.js";
import { isNew, markSeen, recordAlert } from "./db.js";
import { uploadEvidence } from "./swarm.js";

const buffer = new SignalBuffer();
const COOLDOWN_MS = 2 * 60 * 1000;
let lastAlertAt = 0;

async function ingest(items: ScrapedItem[]) {
  for (const item of items) {
    if (!isNew(item.id)) continue;
    markSeen(item.id);
    const cls = await classify(item);
    buffer.add({ item, cls, receivedAt: Date.now() });
    if (cls.target) {
      logger.info(
        { id: item.id, source: item.source, rel: cls.relevance, sev: cls.severity, target: cls.target },
        "classified",
      );
    }
  }
}

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

async function maybeAlert(score: number, signals: Signal[]) {
  if (score < env.threshold) return;
  if (Date.now() - lastAlertAt < COOLDOWN_MS) {
    logger.info({ score }, "score above threshold but in cooldown");
    return;
  }

  const evidence = {
    protocol: "aave-v3",
    score,
    items: signals.map((s) => ({
      source: s.item.source,
      id: s.item.id,
      url: s.item.url,
      text: s.item.text.slice(0, 500),
      cls: s.cls,
      receivedAt: s.receivedAt,
    })),
  };
  const evidenceSwarmRef = await uploadEvidence(evidence);

  const alertId = `aave-v3-base-${Math.floor(Date.now() / 1000)}`;
  const payload: ThreatAlertPayload = {
    alertId,
    protocol: "aave-v3",
    chain: "base",
    score,
    evidenceSwarmRef,
    issuedAt: Math.floor(Date.now() / 1000),
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

  logger.info({ alertId, endpoint, score }, "POSTing signed alert to manager");
  try {
    const res = await fetch(`${endpoint.replace(/\/$/, "")}/alerts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(signed),
    });
    const body = await res.text();
    recordAlert(alertId, score, body);
    lastAlertAt = Date.now();
    logger.info({ alertId, status: res.status, body }, "manager response");
  } catch (err) {
    logger.error({ err, alertId }, "POST to manager failed");
  }
}

async function tick() {
  try {
    const [twitter, reddit, telegram, polymarket] = await Promise.all([
      scrapeTwitter(),
      scrapeReddit(),
      scrapeTelegram(),
      scrapePolymarket(),
    ]);
    const items = [
      ...pollDemoTrigger(),
      ...twitter,
      ...reddit,
      ...telegram,
      ...polymarket,
    ];
    if (items.length) {
      logger.info({ n: items.length }, "scraped items");
      await ingest(items);
    }
    const score = scoreFor("aave-v3", buffer.recent());
    logger.info({ score }, "current ThreatScore");
    await maybeAlert(score, buffer.topEvidence("aave-v3", 5));
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
