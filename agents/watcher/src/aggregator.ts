import type { Classification } from "./classifier.js";
import type { ScrapedItem } from "./scrapers.js";

export interface Signal {
  item: ScrapedItem;
  cls: Classification;
  receivedAt: number;
}

const HALF_LIFE_MS = 5 * 60 * 1000; // 5 min — old signals fade fast
const SOURCE_WEIGHT: Record<ScrapedItem["source"], number> = {
  polymarket: 1.4, // real-money implied probability — strongest signal type
  twitter: 1.2,
  news: 1.1, // rekt.news, Aave governance, DefiLlama — higher signal than social
  reddit: 1.0,
  telegram: 0.9,
  stub: 1.5, // demo-trigger items count more
};

/**
 * Returns a 0..100 score for the protocol given a sliding window of signals.
 * Burst boost: 3+ relevant signals within the window → multiplier.
 */
export function scoreFor(protocol: "aave-v3", signals: Signal[]): number {
  const now = Date.now();
  const live = signals.filter((s) => s.cls.target === protocol);
  let raw = 0;
  for (const s of live) {
    const ageMs = now - s.receivedAt;
    const decay = Math.pow(0.5, ageMs / HALF_LIFE_MS);
    const w = SOURCE_WEIGHT[s.item.source];
    raw += s.cls.relevance * s.cls.severity * w * decay;
  }
  const burst = live.length >= 3 ? 1.4 : 1.0;
  const score = Math.min(100, Math.round(raw * 50 * burst));
  return score;
}

/**
 * Rolling buffer of signals capped to last 200 entries (memory-bound).
 */
export class SignalBuffer {
  private buf: Signal[] = [];
  private cap = 200;

  add(s: Signal) {
    this.buf.push(s);
    if (this.buf.length > this.cap) this.buf.splice(0, this.buf.length - this.cap);
  }

  recent(): Signal[] {
    return this.buf;
  }

  topEvidence(protocol: "aave-v3", n = 5): Signal[] {
    return this.buf
      .filter((s) => s.cls.target === protocol)
      .sort((a, b) => b.cls.relevance * b.cls.severity - a.cls.relevance * a.cls.severity)
      .slice(0, n);
  }
}
