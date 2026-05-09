import { aesDecrypt, aesEncrypt } from "./crypto.js";
import { readFeedRef, writeFeedRef, type SwarmIO } from "./swarm.js";

interface IndexBlob {
  v: 1;
  keys: string[];
}

const INDEX_AAD = Buffer.from("swarm-kv-index-v1");

export interface IndexStore {
  load(): Promise<Set<string>>;
  add(key: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/**
 * The index is a single encrypted JSON blob holding the set of live keys.
 * One feed update per change. Single-writer (the KV signer) so no race.
 *
 * For tens to low-thousands of keys this is fine; beyond that we'd want
 * to shard. Out of scope for v1.
 */
export function makeIndexStore(io: SwarmIO, topic: Uint8Array, encKey: Uint8Array): IndexStore {
  let cache: Set<string> | null = null;

  async function load(): Promise<Set<string>> {
    if (cache) return cache;
    const blob = await readFeedRef(io, topic);
    if (!blob) {
      cache = new Set<string>();
      return cache;
    }
    const plain = aesDecrypt(encKey, blob, INDEX_AAD);
    const parsed = JSON.parse(plain.toString("utf8")) as IndexBlob;
    cache = new Set(parsed.keys ?? []);
    return cache;
  }

  async function persist(set: Set<string>) {
    const body: IndexBlob = { v: 1, keys: [...set].sort() };
    const enc = aesEncrypt(encKey, Buffer.from(JSON.stringify(body), "utf8"), INDEX_AAD);
    await writeFeedRef(io, topic, enc);
    cache = set;
  }

  return {
    load,
    async add(key: string) {
      const set = await load();
      if (set.has(key)) return;
      set.add(key);
      await persist(set);
    },
    async remove(key: string) {
      const set = await load();
      if (!set.has(key)) return;
      set.delete(key);
      await persist(set);
    },
  };
}
