import { Bee, PrivateKey } from "@ethersphere/bee-js";
import {
  aesDecrypt,
  aesEncrypt,
  deriveKeys,
  topicForIndex,
  topicForKey,
} from "./crypto.js";
import { decodeValue, encodeValue, TOMBSTONE, type JsonValue, type StoredValue } from "./codec.js";
import { resolvePostage, type PostageOptions } from "./postage.js";
import { readFeedRef, writeFeedRef, type SwarmIO } from "./swarm.js";
import { makeIndexStore } from "./index-store.js";

export interface KvOptions {
  /** Bee instance, or a Bee node URL. */
  bee: Bee | string;
  /** Hex (`0x...`) or 32-byte private key. Drives the feed signer AND the encryption keys. */
  privateKey: string | Uint8Array;
  /**
   * Logical app namespace. Two KVs with different namespaces under the same
   * keypair are isolated — different topics, different encryption salt.
   * Defaults to `"default"`.
   */
  namespace?: string;
  /**
   * How to obtain a postage batch:
   *   - `{ batchId: '...' }` — use this batch (passed-through; we don't validate).
   *   - `{ auto: true }` — pick a usable existing batch, or buy one with sane defaults.
   *   - `{ auto: { amount, depth } }` — pick or buy with these params.
   *   - omitted — pick a usable existing batch, or throw if none.
   */
  postage?: PostageOptions;
}

export interface SwarmKv {
  /** The Ethereum address derived from the keypair. Hex with `0x` prefix. */
  readonly address: string;
  /** The namespace this instance was opened with. */
  readonly namespace: string;
  /** The postage batch id (hex) being used for writes. */
  readonly postageBatchId: string;

  /**
   * Auto-typed value: returns whatever was put. `string`, parsed JSON, or `Uint8Array`.
   * Returns `null` if the key does not exist or has been deleted.
   */
  get<T extends StoredValue = StoredValue>(key: string): Promise<T | null>;
  getString(key: string): Promise<string | null>;
  getJson<T extends JsonValue = JsonValue>(key: string): Promise<T | null>;
  getBytes(key: string): Promise<Uint8Array | null>;

  put(key: string, value: StoredValue): Promise<void>;
  delete(key: string): Promise<void>;
  has(key: string): Promise<boolean>;

  list(): Promise<string[]>;
  keys(): AsyncIterable<string>;
  entries(): AsyncIterable<[string, StoredValue]>;
}

function normalizePrivateKey(input: string | Uint8Array): PrivateKey {
  if (typeof input === "string") {
    const hex = input.startsWith("0x") ? input.slice(2) : input;
    if (hex.length !== 64) {
      throw new Error("swarm-kv: privateKey must be 32 bytes (64 hex chars)");
    }
    return new PrivateKey(hex);
  }
  if (input.length !== 32) {
    throw new Error("swarm-kv: privateKey must be 32 bytes");
  }
  return new PrivateKey(input);
}

export async function openKv(opts: KvOptions): Promise<SwarmKv> {
  const bee = typeof opts.bee === "string" ? new Bee(opts.bee) : opts.bee;
  const namespace = opts.namespace ?? "default";
  const signer = normalizePrivateKey(opts.privateKey);
  const ownerHex = `0x${signer.publicKey().address().toString().replace(/^0x/, "")}`;

  const postageBatchId = await resolvePostage(bee, opts.postage);

  const { encKey, macKey } = deriveKeys(signer.toUint8Array(), namespace);

  const io: SwarmIO = { bee, signer, ownerHex, postageBatchId };
  const indexTopic = topicForIndex(macKey, namespace);
  const index = makeIndexStore(io, indexTopic, encKey);

  function topic(key: string): Buffer {
    return topicForKey(macKey, namespace, key);
  }

  function aad(key: string): Buffer {
    return Buffer.from(`kv:${namespace}:${key}`, "utf8");
  }

  async function readDecrypted(key: string): Promise<Uint8Array | null> {
    const blob = await readFeedRef(io, topic(key));
    if (!blob) return null;
    return aesDecrypt(encKey, blob, aad(key));
  }

  async function get<T extends StoredValue = StoredValue>(key: string): Promise<T | null> {
    const plain = await readDecrypted(key);
    if (!plain) return null;
    const decoded = decodeValue(plain);
    if (decoded.kind === "tombstone") return null;
    return decoded.value as T;
  }

  async function put(key: string, value: StoredValue): Promise<void> {
    const plain = encodeValue(value);
    const enc = aesEncrypt(encKey, plain, aad(key));
    await writeFeedRef(io, topic(key), enc);
    await index.add(key);
  }

  async function del(key: string): Promise<void> {
    const enc = aesEncrypt(encKey, TOMBSTONE, aad(key));
    await writeFeedRef(io, topic(key), enc);
    await index.remove(key);
  }

  async function has(key: string): Promise<boolean> {
    const set = await index.load();
    return set.has(key);
  }

  async function list(): Promise<string[]> {
    return [...(await index.load())];
  }

  async function* keys(): AsyncGenerator<string> {
    for (const k of await list()) yield k;
  }

  async function* entries(): AsyncGenerator<[string, StoredValue]> {
    for (const k of await list()) {
      const v = await get(k);
      if (v !== null) yield [k, v];
    }
  }

  return {
    address: ownerHex,
    namespace,
    postageBatchId,
    get,
    async getString(key: string) {
      const plain = await readDecrypted(key);
      if (!plain) return null;
      const decoded = decodeValue(plain);
      if (decoded.kind === "tombstone") return null;
      if (decoded.kind !== "string") {
        throw new Error(`swarm-kv: key '${key}' is not a string (kind=${decoded.kind})`);
      }
      return decoded.value as string;
    },
    async getJson<T extends JsonValue = JsonValue>(key: string) {
      const plain = await readDecrypted(key);
      if (!plain) return null;
      const decoded = decodeValue(plain);
      if (decoded.kind === "tombstone") return null;
      if (decoded.kind !== "json") {
        throw new Error(`swarm-kv: key '${key}' is not JSON (kind=${decoded.kind})`);
      }
      return decoded.value as T;
    },
    async getBytes(key: string) {
      const plain = await readDecrypted(key);
      if (!plain) return null;
      const decoded = decodeValue(plain);
      if (decoded.kind === "tombstone") return null;
      if (decoded.kind !== "bytes") {
        throw new Error(`swarm-kv: key '${key}' is not bytes (kind=${decoded.kind})`);
      }
      return decoded.value as Uint8Array;
    },
    put,
    delete: del,
    has,
    list,
    keys,
    entries,
  };
}
