import type { Bee, PostageBatch } from "@ethersphere/bee-js";

export type PostageOptions =
  | { batchId: string | Uint8Array }
  | { auto: true | { amount: bigint | string; depth: number; label?: string } }
  | undefined;

const DEFAULT_AMOUNT = "414720000"; // ~1 day at the 24,000 storage price
const DEFAULT_DEPTH = 22; // ~16 GB capacity — generous for a KV demo
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 120_000;

function toHex(value: string | Uint8Array): string {
  if (typeof value === "string") {
    return value.startsWith("0x") ? value.slice(2) : value;
  }
  return Buffer.from(value).toString("hex");
}

/**
 * Resolve a usable postage batch id, auto-creating one when asked.
 *
 * Order of preference:
 *   1. caller passes `{ batchId }` — we trust them and return it.
 *   2. else, use the first usable batch already on the Bee node.
 *   3. else, if `{ auto: ... }` was passed, create one and wait until usable.
 *   4. else, throw with a clear message — the caller has to decide.
 */
export async function resolvePostage(bee: Bee, opts: PostageOptions): Promise<string> {
  if (opts && "batchId" in opts) {
    return toHex(opts.batchId);
  }

  const existing = await bee.getPostageBatches();
  const usable = pickUsable(existing);
  if (usable) return usable.batchID.toString();

  if (!opts || !("auto" in opts)) {
    throw new Error(
      "swarm-kv: no usable postage batch on this Bee node. " +
        "Pass `postage: { batchId: '...' }` to use a specific batch, " +
        "or `postage: { auto: true }` to let the library buy one.",
    );
  }

  const params =
    opts.auto === true
      ? { amount: DEFAULT_AMOUNT, depth: DEFAULT_DEPTH }
      : {
          amount:
            typeof opts.auto.amount === "bigint"
              ? opts.auto.amount.toString()
              : opts.auto.amount,
          depth: opts.auto.depth,
          label: opts.auto.label,
        };

  const batchId = await bee.createPostageBatch(params.amount, params.depth, {
    label: "label" in params && params.label ? params.label : "swarm-kv",
  });
  return waitForUsable(bee, batchId.toString());
}

function pickUsable(batches: PostageBatch[]): PostageBatch | undefined {
  return batches.find((b) => b.usable && b.usage < 0.95);
}

async function waitForUsable(bee: Bee, batchIdHex: string): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < POLL_TIMEOUT_MS) {
    const list = await bee.getPostageBatches();
    const found = list.find((b) => b.batchID.toString() === batchIdHex);
    if (found?.usable) return batchIdHex;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(
    `swarm-kv: postage batch ${batchIdHex} did not become usable within ${
      POLL_TIMEOUT_MS / 1000
    }s. Check the Bee node's BZZ balance.`,
  );
}
