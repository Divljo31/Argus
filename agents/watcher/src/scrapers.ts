import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { env } from "./env.js";
import { logger } from "./logger.js";

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

/** Generic Apify call — accepts a fetcher override for x402-eligible actors. */
async function callActor(
  actorId: string,
  input: object,
  opts: { fetcher?: typeof fetch } = {},
): Promise<unknown[]> {
  if (!env.apifyToken) return [];
  const f = opts.fetcher ?? fetch;
  try {
    const url = `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${env.apifyToken}`;
    const res = await f(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
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
  type PMarket = {
    ticker?: string;
    title?: string;
    question?: string;
    yesPrice?: number | string;
    impliedProbability?: number | string;
    volume?: number | string;
    url?: string;
    slug?: string;
  };
  const markets = (await callActor(
    "fatihtahta~polymarket-scraper-ppe",
    {},
    { fetcher: x402Fetcher },
  )) as PMarket[];

  return markets
    .map((m) => {
      const title = String(m.title ?? m.question ?? m.ticker ?? "");
      const yes = Number(m.yesPrice ?? m.impliedProbability ?? 0);
      const prob = yes > 1 ? yes / 100 : yes;
      const vol = Number(m.volume ?? 0);
      const url = String(m.url ?? (m.slug ? `https://polymarket.com/event/${m.slug}` : ""));
      return { title, prob, vol, url };
    })
    .filter(
      (m) => m.title && POLYMARKET_KEYWORDS.some((kw) => m.title.toLowerCase().includes(kw)),
    )
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
