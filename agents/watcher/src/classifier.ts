import Anthropic from "@anthropic-ai/sdk";
import { env } from "./env.js";
import { logger } from "./logger.js";
import type { ScrapedItem } from "./scrapers.js";

const client = env.anthropicKey ? new Anthropic({ apiKey: env.anthropicKey }) : null;

export interface Classification {
  itemId: string;
  relevance: number; // 0..1
  severity: number; // 0..1
  target: "aave-v3" | null;
  summary: string;
}

const SYSTEM = `You are a security signal classifier for a DeFi yield agent.
Given a social-media post, decide:
- relevance: how likely this is about a real, current threat to a DeFi protocol (0..1)
- severity: if real, how severe (0..1) — exploit/drain/paused = high, FUD/rumor = low
- target: which protocol it concerns, only "aave-v3" or null
- summary: <=20 words, factual, no editorializing

Respond ONLY with one JSON object: {"relevance": number, "severity": number, "target": string|null, "summary": string}.`;

export async function classify(item: ScrapedItem): Promise<Classification> {
  // Polymarket items carry an implied probability — the market's real-money
  // belief that the event happens. Skip the LLM and use it directly.
  if (item.source === "polymarket" && typeof item.impliedProb === "number") {
    const isAave = /aave/i.test(item.text);
    return {
      itemId: item.id,
      relevance: item.impliedProb,
      severity: 1.0, // markets only exist for outcomes that matter
      target: isAave ? "aave-v3" : null,
      summary: `[polymarket] ${(item.impliedProb * 100).toFixed(1)}% implied prob`,
    };
  }

  // No API key → mock mode. Two env dials:
  //   MOCK_THREAT_LEVEL = low | medium | high | random
  //   MOCK_TARGET_AAVE_PROB = 0..1 (probability target = "aave-v3")
  if (!client) {
    const [rMin, rMax, sMin, sMax] = rangeFor(env.mockThreatLevel);
    const relevance = rMin + Math.random() * (rMax - rMin);
    const severity = sMin + Math.random() * (sMax - sMin);
    const target = Math.random() < env.mockTargetAaveProb ? "aave-v3" : null;
    return {
      itemId: item.id,
      relevance,
      severity,
      target,
      summary: `[mock:${env.mockThreatLevel}] r=${relevance.toFixed(2)} s=${severity.toFixed(2)} target=${target ?? "null"}`,
    };
  }
  try {
    const resp = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 200,
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `Source: ${item.source}\nAuthor: ${item.author ?? "unknown"}\nText: ${item.text}`,
        },
      ],
    });
    const text = resp.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text)
      .join("");
    const json = JSON.parse(extractJson(text)) as Omit<Classification, "itemId">;
    return { itemId: item.id, ...json };
  } catch (err) {
    logger.warn({ err, itemId: item.id }, "classifier failed — treating as low signal");
    return { itemId: item.id, relevance: 0, severity: 0, target: null, summary: "" };
  }
}

function rangeFor(level: "low" | "medium" | "high" | "random"): [number, number, number, number] {
  switch (level) {
    case "low":    return [0.0, 0.3, 0.0, 0.3]; // rMin, rMax, sMin, sMax
    case "medium": return [0.3, 0.7, 0.3, 0.7];
    case "high":   return [0.7, 1.0, 0.7, 1.0];
    case "random": return [0.0, 1.0, 0.0, 1.0];
  }
}

function extractJson(s: string): string {
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("no JSON object in response");
  return s.slice(start, end + 1);
}
