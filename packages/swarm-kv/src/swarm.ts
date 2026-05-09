import type { Bee, FeedReader, FeedWriter } from "@ethersphere/bee-js";
import { PrivateKey, Topic } from "@ethersphere/bee-js";

/**
 * Wrappers around bee-js feed/data primitives, scoped to the parts we use.
 * The KV store treats every value as an encrypted blob; we always store
 * the blob as a content-addressed chunk and put the chunk reference in
 * the feed update. Two round trips per put / per get, but uniform — no
 * inline-vs-reference branching at the call site.
 */

export interface SwarmIO {
  bee: Bee;
  signer: PrivateKey;
  ownerHex: string; // 0x-prefixed
  postageBatchId: string;
}

function makeWriter(io: SwarmIO, topic: Uint8Array): FeedWriter {
  return io.bee.makeFeedWriter(new Topic(topic), io.signer);
}

function makeReader(io: SwarmIO, topic: Uint8Array): FeedReader {
  return io.bee.makeFeedReader(new Topic(topic), io.ownerHex);
}

/**
 * Upload `payload` as a chunk and point `topic` at it via a feed update.
 * Returns the chunk reference (hex) so callers can log / pin it if needed.
 */
export async function writeFeedRef(
  io: SwarmIO,
  topic: Uint8Array,
  payload: Uint8Array,
): Promise<string> {
  const upload = await io.bee.uploadData(io.postageBatchId, payload);
  const ref = upload.reference.toString();
  const writer = makeWriter(io, topic);
  await writer.uploadReference(io.postageBatchId, ref);
  return ref;
}

/**
 * Read the latest feed update at `topic`, follow the reference, and return
 * the payload bytes. Returns `null` if the feed has never been written.
 */
export async function readFeedRef(io: SwarmIO, topic: Uint8Array): Promise<Buffer | null> {
  const reader = makeReader(io, topic);
  let refHex: string;
  try {
    const r = await reader.downloadReference();
    refHex = r.reference.toString();
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
  const data = await io.bee.downloadData(refHex);
  return Buffer.from(data.toUint8Array());
}

function isNotFound(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { status?: number; message?: string };
  if (e.status === 404) return true;
  if (typeof e.message === "string" && /not.found|no.update.found/i.test(e.message)) {
    return true;
  }
  return false;
}
