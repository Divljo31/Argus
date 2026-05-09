import type { Address, PublicClient } from "viem";

/**
 * ENSIP-26 standardizes two text-record families for AI agents:
 *   - `agent-context`            — agent-readable description (JSON / Markdown / etc.)
 *   - `agent-endpoint[<proto>]`  — URL where this agent speaks `<proto>`
 *
 * Defined protocols: `a2a` (agent-to-agent), `mcp`, `web`.
 * See https://docs.ens.domains/ensip/26
 */
export type AgentEndpointProtocol = "a2a" | "mcp" | "web" | (string & {});

/**
 * Argus's expected `agent-context` shape. ENSIP-26 only requires the value
 * be agent-readable; we choose JSON. Unknown fields are preserved on the
 * `raw`/passthrough so this survives schema growth.
 */
export interface AgentContext {
  role?: string;
  capabilities?: string[];
  version?: string;
  [key: string]: unknown;
}

export interface AgentRecords {
  name: string;
  address: Address | null;
  /** ENSIP-5 standard text record. */
  description: string | null;
  /** ENSIP-12 standard text record. */
  avatar: string | null;
  /** Parsed JSON from `agent-context`, or `{ raw: <string> }` if it wasn't JSON. */
  context: AgentContext | null;
  /** Map from protocol → URL, populated only for protocols that have a record set. */
  endpoints: Partial<Record<AgentEndpointProtocol, string>>;
}

const KNOWN_PROTOCOLS: AgentEndpointProtocol[] = ["a2a", "mcp", "web"];

/**
 * Resolve an agent's ENS records in one logical operation. Wraps viem's
 * `getEnsAddress` + `getEnsText` (each of which goes through the Universal
 * Resolver and is CCIP-Read aware, so offchain resolvers like Namestone work
 * out of the box).
 *
 * @param client    A viem PublicClient connected to mainnet (where ENS lives).
 * @param name      The ENS name to resolve, e.g. `manager.argus.eth`.
 * @param protocols Which `agent-endpoint[<proto>]` keys to ask for. Defaults
 *                  to ENSIP-26's three known protocols.
 *
 * Throws only on viem-internal errors (network, malformed name). A name with
 * no records resolves to all-`null` fields rather than throwing.
 */
export async function resolveAgent(
  client: PublicClient,
  name: string,
  protocols: AgentEndpointProtocol[] = KNOWN_PROTOCOLS,
): Promise<AgentRecords> {
  const endpointKeys = protocols.map((p) => `agent-endpoint[${p}]`);
  const textKeys = ["description", "avatar", "agent-context", ...endpointKeys];

  const safeText = (key: string) =>
    client.getEnsText({ name, key }).catch(() => null);

  const [address, ...textValues] = await Promise.all([
    client.getEnsAddress({ name }).catch(() => null),
    ...textKeys.map(safeText),
  ]);

  const [description, avatar, contextRaw, ...endpointValues] = textValues;

  let context: AgentContext | null = null;
  if (contextRaw) {
    try {
      context = JSON.parse(contextRaw) as AgentContext;
    } catch {
      // ENSIP-26 permits non-JSON (Markdown, plain text). Surface raw text
      // so callers don't lose data, but stay typed as AgentContext.
      context = { raw: contextRaw };
    }
  }

  const endpoints: AgentRecords["endpoints"] = {};
  protocols.forEach((p, i) => {
    const v = endpointValues[i];
    if (v) endpoints[p] = v;
  });

  return {
    name,
    address: address ?? null,
    description: description ?? null,
    avatar: avatar ?? null,
    context,
    endpoints,
  };
}

/**
 * The watcher and any other peer agent uses this to find where to POST.
 * Falls back from `a2a` → `web` so a name that only publishes a public
 * web endpoint still works.
 */
export function pickAgentEndpoint(
  records: AgentRecords,
  preference: AgentEndpointProtocol[] = ["a2a", "web"],
): string | null {
  for (const p of preference) {
    const url = records.endpoints[p];
    if (url) return url;
  }
  return null;
}
