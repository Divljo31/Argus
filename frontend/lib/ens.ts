import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";
import { addEnsContracts } from "@ensdomains/ensjs";
import { getRecords } from "@ensdomains/ensjs/public";
import { PUBLIC_ENV } from "./env";

const client = createPublicClient({
  chain: addEnsContracts(mainnet),
  transport: http(PUBLIC_ENV.mainnetRpc),
});

/**
 * ENSIP-26 agent text records. The endpoint key is parameterized by protocol
 * (`a2a`, `mcp`, `web`); we read the three known protocols. `agent-context`
 * is JSON for our agents but ENSIP-26 permits Markdown / plain text — so we
 * accept either.
 */
export interface AgentContext {
  role?: string;
  capabilities?: string[];
  version?: string;
  raw?: string;
  [key: string]: unknown;
}

export interface AgentRecords {
  name: string;
  address: `0x${string}` | null;
  description: string | null;
  avatar: string | null;
  context: AgentContext | null;
  endpoints: Partial<Record<"a2a" | "mcp" | "web", string>>;
}

const TEXT_KEYS = [
  "description",
  "avatar",
  "agent-context",
  "agent-endpoint[a2a]",
  "agent-endpoint[mcp]",
  "agent-endpoint[web]",
] as const;

/**
 * Single batched read via @ensdomains/ensjs (which goes through the Universal
 * Resolver under the hood — one round trip, CCIP-Read aware so Namestone
 * offchain resolvers work).
 */
export async function readAgentRecords(name: string): Promise<AgentRecords> {
  const result = await getRecords(client, {
    name,
    texts: TEXT_KEYS as unknown as string[],
    coins: ["ETH"],
  });

  const ethCoin = result.coins?.find((c) => c.id === 60 || c.name === "eth");
  const text = (k: string) => result.texts?.find((t) => t.key === k)?.value ?? null;

  const contextRaw = text("agent-context");
  let context: AgentContext | null = null;
  if (contextRaw) {
    try {
      context = JSON.parse(contextRaw);
    } catch {
      context = { raw: contextRaw };
    }
  }

  const endpoints: AgentRecords["endpoints"] = {};
  const a2a = text("agent-endpoint[a2a]");
  const mcp = text("agent-endpoint[mcp]");
  const web = text("agent-endpoint[web]");
  if (a2a) endpoints.a2a = a2a;
  if (mcp) endpoints.mcp = mcp;
  if (web) endpoints.web = web;

  return {
    name,
    address: (ethCoin?.value as `0x${string}` | undefined) ?? null,
    description: text("description"),
    avatar: text("avatar"),
    context,
    endpoints,
  };
}
