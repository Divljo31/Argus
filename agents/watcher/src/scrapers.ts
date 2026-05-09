import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { resolveAgent, pickAgentEndpoint } from "@argus/shared";
import { env } from "./env.js";
import { logger } from "./logger.js";
import { ensClient } from "./clients.js";

/**
 * Tells the manager that a metered scrape just settled. When USE_X402=true
 * and the x402-fetch wrapper returns settlement headers, txHash should be
 * passed through; otherwise it's omitted (token-auth calls don't produce an
 * on-chain settlement tx). Endpoint is resolved live via ENS.
 */
async function notifyScrapePaid(actor: string, amount: string, txHash?: `0x${string}`) {
  try {
    const records = await resolveAgent(ensClient, env.managerEns);
    if (!records.address) return;
    const endpoint = pickAgentEndpoint(records, ["a2a"]);
    if (!endpoint) return;
    await fetch(`${endpoint.replace(/\/$/, "")}/scrape-paid`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actor, amount, txHash }),
    });
  } catch (err) {
    logger.debug({ err, actor }, "scrape-paid notify failed (best-effort)");
  }
}

export interface ScrapedItem {
  source: "reddit" | "twitter" | "telegram" | "news" | "polymarket" | "stub";
  id: string;
  text: string;
  url: string;
  author?: string;
  postedAt: number;
  /** Polymarket implied probability (0..1). */
  impliedProb?: number;
}

/**
 * x402 v2 wrapped fetch, used only for the Polymarket actor (the one PPE
 * actor in our set). Apify's x402 path requires Pay-Per-Event pricing —
 * the social actors below are PPR and stay on plain token auth.
 */
function getX402Fetcher(): typeof fetch {
  if (!env.useX402) return fetch;
  const account = privateKeyToAccount(env.watcherKey);
  return wrapFetchWithPaymentFromConfig(fetch, {
    schemes: [
      {
        network: "eip155:8453",
        client: new ExactEvmScheme(account),
      },
    ],
  }) as typeof fetch;
}

const x402Fetcher = getX402Fetcher();

/**
 * Generic Apify call — accepts a fetcher override for x402-eligible actors.
 *
 * Token-auth path (default): URL carries `?token=...` so Apify authenticates
 * the call directly and never issues a 402.
 *
 * x402 path (when `opts.fetcher` is provided, i.e. Polymarket): URL omits
 * the token entirely. We add `X-APIFY-PAYMENT-PROTOCOL: X402` so Apify
 * knows to respond with a 402 + `payment-required` quote header, which the
 * wrapped fetcher signs (with the watcher EOA's USDC) and resends.
 */
async function callActor(
  actorId: string,
  input: object,
  opts: { fetcher?: typeof fetch } = {},
): Promise<unknown[]> {
  if (!env.apifyToken && !opts.fetcher) return [];
  const f = opts.fetcher ?? fetch;
  const useX402 = !!opts.fetcher;
  const url = useX402
    ? `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items`
    : `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${env.apifyToken}`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (useX402) headers["X-APIFY-PAYMENT-PROTOCOL"] = "X402";
  try {
    const res = await f(url, { method: "POST", headers, body: JSON.stringify(input) });
    if (!res.ok) {
      logger.warn({ status: res.status, actorId }, "apify call failed");
      return [];
    }
    return (await res.json()) as unknown[];
  } catch (err) {
    logger.warn({ err, actorId }, "apify scrape error");
    return [];
  }
}

const SEARCH_TERMS = [
  "aave exploit",
  "aave hack",
  "aave drained",
  "aave depeg",
  "aave paused",
];

/**
 * `apidojo/tweet-scraper` — PPR. Searches X/Twitter for the threat terms.
 * Token auth (USE_X402 has no effect here — this is not a PPE actor).
 *
 * The actor pads results with `{ noResults: true }` placeholders when a
 * search has zero matches; those are filtered out.
 */
export async function scrapeTwitter(): Promise<ScrapedItem[]> {
  type Tweet = {
    noResults?: boolean;
    id?: string;
    url?: string;
    text?: string;
    fullText?: string;
    author?: { userName?: string };
    createdAt?: string;
  };
  const items = (await callActor("apidojo~tweet-scraper", {
    searchTerms: SEARCH_TERMS,
    maxItems: 25,
    sort: "Latest",
    tweetLanguage: "en",
  })) as Tweet[];
  return items
    .filter((t) => !t.noResults && (t.text || t.fullText))
    .map((t, i) => ({
      source: "twitter",
      id: `tw-${t.id ?? i}`,
      text: String(t.fullText ?? t.text ?? ""),
      url: String(t.url ?? ""),
      author: t.author?.userName,
      postedAt: t.createdAt ? new Date(t.createdAt).getTime() : Date.now(),
    }));
}

/**
 * `trudax/reddit-scraper-lite` — PPR. Search threads for threat terms across
 * all of Reddit. Apify proxy required by the actor's input schema.
 */
export async function scrapeReddit(): Promise<ScrapedItem[]> {
  type Post = {
    id?: string;
    url?: string;
    title?: string;
    body?: string;
    username?: string;
    author?: string;
    createdAt?: string;
    parsedCommunityName?: string;
  };
  const items = (await callActor("trudax~reddit-scraper-lite", {
    searches: SEARCH_TERMS,
    searchPosts: true,
    sort: "New",
    time: "week",
    maxItems: 25,
    proxy: { useApifyProxy: true },
  })) as Post[];
  return items.map((p, i) => ({
    source: "reddit",
    id: `rd-${p.id ?? i}`,
    text: [p.title, (p.body ?? "").slice(0, 500)].filter(Boolean).join(" — "),
    url: String(p.url ?? ""),
    author: p.username ?? p.author,
    postedAt: p.createdAt ? new Date(p.createdAt).getTime() : Date.now(),
  }));
}

/**
 * `tri_angle/telegram-scraper` — PPR. Reads recent messages from configured
 * Telegram channels (set via TELEGRAM_CHANNELS env, comma-separated). When
 * no channels are configured, returns [] without calling the actor.
 *
 * Output shape: each item is a profile + nested `message`. We pull text from
 * `message.description` and the per-message URL from `message.link`.
 */
export async function scrapeTelegram(): Promise<ScrapedItem[]> {
  if (env.telegramChannels.length === 0) return [];
  type TgItem = {
    username?: string;
    fullName?: string;
    url?: string;
    message?: {
      description?: string;
      fulldate?: string;
      link?: string;
      views?: number;
    };
  };
  const items = (await callActor("tri_angle~telegram-scraper", {
    profiles: env.telegramChannels,
    collectMessages: true,
    scrapeLastNDays: 1,
  })) as TgItem[];
  return items
    .filter((m) => !!m.message?.description)
    .map((m, i) => ({
      source: "telegram",
      id: `tg-${m.message?.link?.split("/").pop() ?? i}`,
      text: String(m.message?.description ?? ""),
      url: String(m.message?.link ?? m.url ?? ""),
      author: m.username ?? m.fullName,
      postedAt: m.message?.fulldate
        ? new Date(m.message.fulldate).getTime()
        : Date.now(),
    }));
}

const POLYMARKET_KEYWORDS = [
  "aave",
  "defi",
  "exploit",
  "hack",
  "drained",
  "depeg",
  "stablecoin",
  "usdc",
];

/**
 * `fatihtahta/polymarket-scraper-ppe` — **PPE**. The only x402-eligible
 * actor in our set. Returns prediction-market data; we filter to DeFi /
 * Aave-relevant markets and pass implied probability through to the
 * classifier as a direct threat probability (skips the LLM).
 */
export async function scrapePolymarket(): Promise<ScrapedItem[]> {
  type PItem = {
    parentMarket?: {
      title?: string;
      eventUrl?: string;
      volume?: number;
    };
    market?: {
      title?: string;
      outcomes?: Array<{ name?: string; price?: number }>;
    };
  };
  const items = (await callActor(
    "fatihtahta~polymarket-scraper-ppe",
    { queries: ["aave", "defi", "usdc", "crypto"], limit: 10, status: "active" },
    { fetcher: x402Fetcher },
  )) as PItem[];

  // Real x402 settlement happened if items came back. Notify the manager so
  // the audit log shows the metered scrape.
  if (items.length > 0) {
    void notifyScrapePaid("polymarket", "1.00").catch(() => {});
  }

  return items
    .map((it) => {
      const title = String(it.parentMarket?.title ?? it.market?.title ?? "");
      const url = String(it.parentMarket?.eventUrl ?? "");
      const vol = Number(it.parentMarket?.volume ?? 0);
      // outcomes may arrive as an array, JSON string, or object — be defensive.
      let outcomesArr: Array<{ name?: string; price?: number }> = [];
      const raw = it.market?.outcomes as unknown;
      if (Array.isArray(raw)) {
        outcomesArr = raw as Array<{ name?: string; price?: number }>;
      } else if (typeof raw === "string") {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) outcomesArr = parsed;
        } catch {
          /* ignore */
        }
      }
      const yesOutcome = outcomesArr.find((o) => o.name?.toLowerCase?.() === "yes");
      const prob = Number(yesOutcome?.price ?? 0);
      return { title, prob, vol, url };
    })
    .filter((m) => !!m.title)
    .map((m, i) => ({
      source: "polymarket" as const,
      id: `pm-${(m.url || m.title).slice(-48)}-${i}`,
      text: `${m.title} — yes: ${(m.prob * 100).toFixed(1)}%, vol: $${m.vol.toLocaleString()}`,
      url: m.url,
      postedAt: Date.now(),
      impliedProb: m.prob,
    }));
}

const DEMO_TRIGGER_FILE = "./data/demo-trigger.json";

export function pollDemoTrigger(): ScrapedItem[] {
  if (!existsSync(DEMO_TRIGGER_FILE)) return [];
  try {
    const raw = readFileSync(DEMO_TRIGGER_FILE, "utf8");
    unlinkSync(DEMO_TRIGGER_FILE);
    const item = JSON.parse(raw) as Partial<ScrapedItem>;
    return [
      {
        source: "stub",
        id: item.id ?? `demo-${Date.now()}`,
        text: item.text ?? "BREAKING: Aave v3 USDC pool drained, exploit confirmed",
        url: item.url ?? "https://example.invalid/demo",
        author: item.author ?? "demo-trigger",
        postedAt: Date.now(),
      },
    ];
  } catch (err) {
    logger.warn({ err }, "demo-trigger parse failed");
    return [];
  }
}
