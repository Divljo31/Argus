import { env } from "./env.js";
import { logger } from "./logger.js";
import { watcherAccount } from "./clients.js";
import { scrapePolymarket } from "./scrapers.js";

async function tick() {
  try {
    // Polymarket scrape via x402 — settles 1 USDC to Apify on Base each call.
    // Real on-chain proof for the Apify×x402 bounty.
    const polymarket = await scrapePolymarket();
    if (polymarket.length) {
      logger.info({ n: polymarket.length }, "polymarket scraped (x402 metered)");
    } else {
      logger.info({}, "polymarket returned no items this tick");
    }
  } catch (err) {
    logger.error({ err }, "tick error");
  }
}

async function main() {
  logger.info(
    { ens: env.watcherEns, address: watcherAccount.address, useX402: env.useX402 },
    "watcher booting",
  );
  // Single Polymarket scrape on boot — no automatic interval. Restart the
  // watcher to trigger another x402-metered scrape. Keeps demo costs predictable.
  await tick();
  logger.info({}, "watcher idle — restart to trigger another scrape");
}

main().catch((err) => {
  logger.fatal({ err }, "watcher crashed");
  process.exit(1);
});
