# @argus/swarm-kv

A developer-friendly key-value database on top of [Swarm](https://docs.ethswarm.org/docs/develop/introduction/). Strings, JSON, and binary values. End-to-end encrypted with keys derived from your Ethereum private key. No feeds, topics, SOCs, or manifests in your code.

```ts
import { Bee } from "@ethersphere/bee-js";
import { openKv } from "@argus/swarm-kv";

const kv = await openKv({
  bee: new Bee("http://localhost:1633"),
  privateKey: "0x" + "11".repeat(32),
  namespace: "myapp.v1",
  postage: { auto: true }, // or { batchId: "..." } if you have one
});

await kv.put("user.name", "Alice");
await kv.put("user.profile", { age: 30, theme: "dark" });
await kv.put("avatar", new Uint8Array([0xff, 0xd8, 0xff, 0xe0]));

await kv.get("user.name");                  // → "Alice"
await kv.getJson<{ age: number }>("user.profile"); // → { age: 30, theme: "dark" }
await kv.getBytes("avatar");                // → Uint8Array(4)

for await (const k of kv.keys()) console.log(k);
console.log(await kv.list());

await kv.delete("user.name");
```

That's the whole API.

---

## Install

```bash
pnpm add @argus/swarm-kv @ethersphere/bee-js
```

Requires Node 20+. Browser support is feasible (bee-js works in browsers) but the encryption uses `node:crypto`; a small polyfill or Web Crypto adapter would be needed for the browser.

---

## Why this exists

Swarm gives you a permissionless, content-addressed storage network with mutable pointers (Feeds) and per-user signed updates (Single Owner Chunks). All the right primitives for "user settings on a decentralized backend" — but you'd have to know:

- That a Feed is an `(address, topic)` pair, where the address is the signer's Ethereum address and the topic is a 32-byte identifier.
- That you must buy a postage stamp before uploading anything.
- That every "update" is a new chunk on the network with a sequence number.
- That listing keys means designing a manifest yourself.
- That signing happens with your raw secp256k1 private key.

Most app code shouldn't have to. `swarm-kv` wraps it into `get` / `put` / `list` / `delete` and gives you privacy by default — values are encrypted client-side with a key derived from your Ethereum private key.

---

## API

### `openKv(opts): Promise<SwarmKv>`

| Option | Type | Required | Notes |
| --- | --- | --- | --- |
| `bee` | `Bee` or URL string | yes | A `bee-js` instance, or a Bee node URL. |
| `privateKey` | `0x...` hex string or `Uint8Array(32)` | yes | Drives the feed signer **and** the encryption keys. Treat as you would any wallet key. |
| `namespace` | `string` | no, default `"default"` | App-level isolation. Two namespaces under the same key see disjoint data. |
| `postage` | see [Postage](#postage) | no | If omitted, uses any usable batch on the node; throws if there is none. |

Returns a `SwarmKv` with these methods:

| Method | Behavior |
| --- | --- |
| `put(key, value)` | Store a string, JSON-serializable value, or `Uint8Array`. Updates the index. |
| `get(key)` | Returns whatever was last `put`. `string`, parsed JSON, or `Uint8Array`. `null` if absent or deleted. |
| `getString(key)` / `getJson(key)` / `getBytes(key)` | Type-asserting variants. Throw if the stored value is a different kind. |
| `has(key)` | Cheap existence check via the index — no chunk fetch. |
| `delete(key)` | Writes a tombstone so subsequent `get` returns `null`, and removes the key from the index. |
| `list()` | All live keys as `string[]`. |
| `keys()` | `AsyncIterable<string>` — useful when scaling beyond `list`. |
| `entries()` | `AsyncIterable<[key, value]>` — fetches each value lazily. |

Read-only properties: `address`, `namespace`, `postageBatchId`.

### Value types

```ts
type StoredValue = string | Uint8Array | JsonValue;
type JsonValue =
  | string | number | boolean | null
  | JsonValue[]
  | { [k: string]: JsonValue };
```

`get` auto-detects the kind from a 1-byte tag prepended at write time:

| Tag | Kind | Decoded as |
| --- | --- | --- |
| `0x73` (`'s'`) | string | UTF-8 |
| `0x6a` (`'j'`) | JSON | `JSON.parse` |
| `0x62` (`'b'`) | bytes | `Uint8Array` |
| `0x00` | tombstone | returned as `null` |

---

## Postage

Swarm requires you to pre-pay for storage with a **postage batch**. `swarm-kv` handles this transparently:

```ts
// 1. You already have a batch id:
postage: { batchId: "0xabc...123" }

// 2. Use whichever usable batch is on the node, otherwise buy one with defaults:
postage: { auto: true }

// 3. Buy with explicit params (if no usable batch exists):
postage: { auto: { amount: 414720000n, depth: 22, label: "myapp" } }

// 4. Omit `postage`: uses an existing batch if any, throws otherwise.
```

Defaults are `amount = 414_720_000` (~1 day at the 24,000 storage price) and `depth = 22` (~16 GB capacity). `swarm-kv` polls until the batch is usable (up to two minutes), then continues. For long-lived storage, pass an `amount` that buys the duration you need — see Swarm's [postage docs](https://docs.ethswarm.org/docs/develop/access-the-swarm/keep-your-data-alive).

`getPostageBatches` is read once at `openKv` time. If the batch you chose runs out mid-session, `put` will start failing with a Bee error — open a new KV, or pass a fresh batch id.

---

## Privacy model

The library is private by default. Here is the precise claim:

| Field | Visible on Swarm | Decryptable without your private key |
| --- | --- | --- |
| Your Ethereum address | yes (it's the feed owner) | n/a |
| **Values** | yes, as ciphertext | **no** — AES-256-GCM, key derived from your private key via HKDF-SHA256 |
| **Key names** | no — the topic is `HMAC-SHA256(macKey, "kv:<namespace>:user:<key>")` | a guessing attacker who knew the namespace and a candidate key could compute a topic and check whether a feed exists; without the macKey they can't enumerate or recover the key string |
| The fact that a key exists | yes (an attacker can probe a guessed topic) | n/a |
| Number of keys you have | approximately yes (count of distinct topics seen on chain) | n/a |
| The index of all your key names | yes (encrypted) — single feed under the namespace | **no** |

Two derived keys under the hood:
- `encKey = HKDF(privateKey, salt = namespace, info = "swarm-kv-enc-v1", 32)` — for AES-GCM.
- `macKey = HKDF(privateKey, salt = namespace, info = "swarm-kv-mac-v1", 32)` — for topic HMACs.

Each value is encrypted with a fresh 12-byte nonce and the key string itself is bound into the AAD, so swapping ciphertexts between keys is detected.

What this is **not**: anonymity. Anyone watching Swarm can see that the address `0xabc...` writes feeds — they just can't read what's in them or list them.

---

## Use cases

- **User profiles and settings** for a dApp — replace `localStorage` with something that follows the user across devices, signed with their wallet.
- **dApp config / mutable state** — flags, theme, last-seen timestamps, draft messages.
- **Chat history, bookmarks, preferences** — anything an app would normally put in a per-user database, with no backend to operate.

The library is single-writer (one private key). For multi-user shared state you'd combine multiple KVs under different keypairs, or use Swarm's grantee features (out of scope).

---

## How it maps to Swarm primitives

If you want to read or extend the code:

```
key string ──HMAC(macKey)──► topic (32 bytes)
                              │
                              ▼
                         Feed at (your address, topic)
                              │  uploadReference
                              ▼
                       chunk reference (32 bytes)
                              │  uploadData
                              ▼
                  encrypted value bytes (AES-256-GCM)
```

`put` is two HTTP calls (chunk upload, then feed update) plus one index update (another two). `get` is two HTTP calls (feed read, then chunk fetch). `has` and `list` only read the index.

The index is itself a feed at `HMAC(macKey, "kv:<namespace>:index")` whose latest update points at an encrypted JSON `{ v: 1, keys: [...] }`. This is single-writer (only the keypair holder writes), so there's no race on read-modify-write.

---

## Layout

```
src/
  index.ts          # public exports
  kv.ts             # SwarmKv class — get/put/delete/has/list/keys/entries
  codec.ts          # value tag encoding (string / json / bytes / tombstone)
  crypto.ts         # HKDF, HMAC, AES-256-GCM via node:crypto
  postage.ts        # batch resolution + auto-create
  swarm.ts          # bee-js feed read/write helpers
  index-store.ts    # encrypted key index (single feed, single blob)
```

---

## Limits and known gaps

- **Single-writer.** Concurrent puts from two processes with the same key will race the index. The library is intended for one process at a time per `(privateKey, namespace)` pair.
- **Index is a single blob.** Fine for tens to a few thousand keys; beyond that, sharding the index is needed. Out of scope for v1.
- **No streaming uploads.** Values are buffered in memory before encryption.
- **Browser support requires a Web Crypto adapter** — current code targets `node:crypto`. The bee-js calls themselves are fetch-based and work in browsers.
- **Postage batch lifecycle** is not managed beyond initial resolution. If the batch expires, writes fail; rotate by reopening the KV with a fresh `batchId`.
