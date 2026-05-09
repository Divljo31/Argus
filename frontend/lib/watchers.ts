/**
 * Watcher registry. Each entry is a logical "swarm member" with its own ENS
 * subname under argus.divljo.eth. The single watcher process today runs all
 * four; their addresses are placeholders until each is issued on-chain.
 *
 * Bounty model (post-MVP):
 *   - When a watcher's signal triggers an exit that saves capital from a hack,
 *     reward = 0.5% of the saved amount, sent to the watcher's EOA.
 *   - Numbers below are demo placeholders.
 */
export interface WatcherDef {
  id: string;
  ens: string;
  source: "polymarket" | "x.com" | "reddit" | "news" | "telegram" | "all";
  description: string;
  rewardRateBps: number; // basis points of saved capital
  lifetimeEarnedUsdc: number;
  triggers: number;
  status: "active" | "idle" | "unissued";
  shortStatus: string;
  /** True when this watcher is actually running on-chain / signing alerts. */
  deployed?: boolean;
}

export const WATCHERS: WatcherDef[] = [
  {
    id: "watcher",
    ens: "watcher.argus.divljo.eth",
    source: "all",
    description:
      "Live deployed watcher. Runs all four source feeds in parallel, classifies, signs alerts to the manager. Earns the umbrella bounty until logical sub-watchers are issued onchain.",
    rewardRateBps: 50,
    lifetimeEarnedUsdc: 0,
    triggers: 1,
    status: "active",
    shortStatus: "live",
    deployed: true,
  },
  {
    id: "polymarket-watcher",
    ens: "polymarket-watcher.argus.divljo.eth",
    source: "polymarket",
    description:
      "Reads Polymarket prediction-market odds for DeFi-exploit events. Implied probability = real-money belief.",
    rewardRateBps: 50,
    lifetimeEarnedUsdc: 12.4,
    triggers: 3,
    status: "active",
    shortStatus: "3s ago",
  },
  {
    id: "x-watcher",
    ens: "x-watcher.argus.divljo.eth",
    source: "x.com",
    description:
      "Scans X/Twitter for credible accounts flagging exploits, paused protocols, or governance attacks.",
    rewardRateBps: 30,
    lifetimeEarnedUsdc: 4.1,
    triggers: 2,
    status: "active",
    shortStatus: "11s ago",
  },
  {
    id: "reddit-watcher",
    ens: "reddit-watcher.argus.divljo.eth",
    source: "reddit",
    description:
      "Crawls r/ethfinance, r/defi, r/cryptocurrency for exploit threads and depeg discussions.",
    rewardRateBps: 25,
    lifetimeEarnedUsdc: 1.8,
    triggers: 1,
    status: "active",
    shortStatus: "42s ago",
  },
  {
    id: "tg-whale-watcher",
    ens: "tg-whale-watcher.argus.divljo.eth",
    source: "telegram",
    description:
      "Tracks whale Telegram channels for early exit signals — watches when smart money quietly leaves.",
    rewardRateBps: 40,
    lifetimeEarnedUsdc: 0,
    triggers: 0,
    status: "idle",
    shortStatus: "1m ago",
  },
];

const KEY = "argus.subscribedWatchers";

export function getSubscribedIds(): Set<string> {
  if (typeof window === "undefined") return new Set(WATCHERS.map((w) => w.id));
  const raw = window.localStorage.getItem(KEY);
  if (!raw) return new Set(WATCHERS.map((w) => w.id));
  try {
    const parsed = JSON.parse(raw) as string[];
    return new Set(parsed);
  } catch {
    return new Set(WATCHERS.map((w) => w.id));
  }
}

export function setSubscribedIds(ids: Set<string>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(Array.from(ids)));
  window.dispatchEvent(new Event("argus:watchers-changed"));
}
