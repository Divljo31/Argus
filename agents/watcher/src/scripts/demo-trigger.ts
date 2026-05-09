/**
 * Drop a sock-puppet item into the watcher's pickup directory. The watcher
 * will read it on the next tick, classify it, and (if score crosses) alert.
 *
 * Use:
 *   pnpm --filter @argus/watcher demo:trigger
 */
import { mkdirSync, writeFileSync } from "node:fs";

const text = process.argv.slice(2).join(" ") ||
  "BREAKING: Aave v3 USDC pool exploited, $40M drained, withdrawals paused. Confirmed by multiple sources.";

const item = {
  id: `demo-${Date.now()}`,
  source: "stub",
  text,
  url: "https://example.invalid/demo-post",
  author: "demo",
};

mkdirSync("./data", { recursive: true });
writeFileSync("./data/demo-trigger.json", JSON.stringify(item));
console.log("demo trigger queued:", item);
