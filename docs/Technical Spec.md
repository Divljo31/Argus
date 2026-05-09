# Argus — Technical Spec

> **Implementation note (2026-05-09):** this spec describes the design. The actual built system diverges in three concrete ways:
> - **ENS namespace** is `argus.divljo.eth` (not `argus.eth`) — issued onchain via NameWrapper, not Namestone.
> - **ENS text records** follow ENSIP-26 standard keys (`agent-endpoint[a2a]`, `agent-context`, `description`) instead of the `com.argus.*` custom keys mentioned below.
> - **Apify actors**: shipped with `fatihtahta/polymarket-scraper-ppe` (PPE, x402-eligible) plus `apidojo/tweet-scraper`, `trudax/reddit-scraper-lite`, `tri_angle/telegram-scraper` (PPR, token auth).
>
> See [README.md](../README.md) for the canonical current state. This spec remains the design rationale.

Hackathon MVP. Trust infrastructure for agent-managed capital. A user deposits USDC into a per-user `YieldVault`. A `manager.argus.divljo.eth` agent parks idle balance in Aave v3 on Base. A separate `watcher.argus.divljo.eth` agent scrapes social, news, and prediction-market signals via Apify, classifies them, and — when a `ThreatScore` crosses threshold — sends a signed `ThreatAlert` to the manager via ENS lookup. The manager verifies the signature against the live ENS-resolved watcher address and exits Aave.

This document defines the interfaces, data formats, state, and runtime contracts between the components actually in this repo. It is the single source of truth for "what does X look like on the wire."

---

## 1. Goals and non-goals

### In scope (MVP)
- One Solidity vault per user on **Base mainnet**, no proxy.
- Two long-running Node agents with distinct EOAs, distinct ENS names, plain HTTP between them.
- ENS resolution is the agent-discovery primitive — no hard-coded peer addresses in agent code.
- EIP-712 signed alerts; manager rejects forgeries by recovering the signer and comparing against the ENS-resolved watcher address.
- Apify-paid scrape pipeline with optional `x402-fetch` payment path, default off.
- Audit log: SQLite for hot state on each agent, best-effort Swarm uploads as evidence side-channel, on-chain tx hashes as canonical truth.
- Next.js dashboard: deposit/withdraw, agent cards rendered live from ENS text records, audit stream from manager `/receipts`.

### Out of scope (deferred)
- Arbitrum + cross-chain manager. Single chain only.
- Per-user vault subnames (`<handle>.argus.divljo.eth`).
- Two-sided x402 (watcher charging consumers).
- Account abstraction, session keys, multi-sig.
- On-chain TVL anomaly detector as a third signal source.
- Bridging during exit (explicit non-goal — too risky for a 48-hour build).

---

## 2. System architecture

```
                    ┌─────────────────────────────────────┐
                    │  Frontend (Next.js 15, port :3000) │
                    │  • wagmi 2.19 + viem 2.48          │
                    │  • ENS via @ensdomains/ensjs 4.2   │
                    │  • Polls manager /health, /receipts│
                    └──────────────┬──────────────────────┘
                                   │ HTTPS
                                   ▼
       ┌─────────────────────────────────────────────────┐
       │  Manager agent  manager.argus.divljo.eth  (port :4001)│
       │  • Express HTTP — POST /alerts, GET /health,    │
       │      GET /receipts                              │
       │  • viem on Base: watch Deposit → supplyAave     │
       │  • EIP-712 verify ↔ ENS-resolved watcher addr  │
       │  • better-sqlite3: processed_alerts, receipts   │
       │  • Best-effort Swarm uploads via bee-js         │
       └────────▲───────────────────────────────┬────────┘
                │                               │
   ENS resolve  │ HTTP POST /alerts             │  RPC writes
   (mainnet)    │ (signed ThreatAlert)          │  (Base)
                │                               ▼
       ┌────────┴─────────────────────┐  ┌─────────────────────────┐
       │ Watcher agent                │  │ YieldVault (Base)       │
       │   watcher.argus.divljo.eth          │  │ • deposit(amount)       │
       │ • 30s tick: scrape→classify  │  │ • withdrawToOwner       │
       │ • Apify (token or x402-fetch)│  │ • managerSupplyAave     │
       │ • Claude haiku classifier    │  │ • managerWithdrawAave   │
       │ • Aggregator + cooldown      │  │ • setPaused / setManager│
       │ • Signs EIP-712 alert        │  └─────────────────────────┘
       │ • SQLite: seen, sent_alerts  │
       └──────────────────────────────┘
```

ENS resolution targets mainnet on both agents and the frontend; vault calls and Aave interactions target Base (chainId 8453).

---

## 3. Repository layout

```
contracts/         Foundry — YieldVault.sol, IAavePool.sol, Deploy.s.sol, tests
packages/shared/   TS types + EIP-712 alert signing/verification, addresses
agents/manager/    Express + viem; deposits → Aave, alerts → exit
agents/watcher/    Polls scrapers, classifies, scores, signs, POSTs alert
frontend/          Next.js dashboard
```

Workspace is pnpm with three globs: `packages/*`, `agents/*`, `frontend`. Node 20.10+, TypeScript 5.6.3, viem pinned to `2.48.8`, wagmi pinned to `2.19.x` (wagmi 3 has unresolved peerDeps).

---

## 4. Smart contracts

### 4.1 YieldVault.sol

Solidity 0.8.28, OpenZeppelin SafeERC20, no upgradeability.

**Constructor**

| Param | Type | Notes |
| --- | --- | --- |
| `_owner` | `address` | The user — only address allowed to `deposit` and `withdrawToOwner`. |
| `_manager` | `address` | The manager EOA. Mutable via `setManager(address)`. |
| `_usdc` | `IERC20` | Native USDC on Base. |
| `_aUsdc` | `IERC20` | aBasUSDC receipt token. |
| `_aave` | `IAavePool` | Aave v3 Pool on Base. |
| `_maxDeposit` | `uint256` | Cap, 6-dec USDC. Default 50_000_000 (50 USDC). |

**State**

- `address public immutable owner`
- `IERC20 public immutable usdc`, `aUsdc`
- `IAavePool public immutable aave`
- `address public manager` (mutable by owner)
- `uint256 public maxDeposit` (immutable post-deploy in MVP)
- `bool public paused`

**Functions**

| Function | Access | Behavior |
| --- | --- | --- |
| `deposit(uint256 amount)` | onlyOwner, whenNotPaused | `safeTransferFrom(owner, vault, amount)`. Reverts `CapExceeded` if `totalAssets() + amount > maxDeposit`. Reverts `ZeroAmount` if 0. Emits `Deposit(owner, amount)`. |
| `withdrawToOwner(uint256 amount)` | onlyOwner | Always works, even when paused. `safeTransfer(owner, amount)`. Emits `WithdrawToOwner(owner, amount)`. |
| `managerSupplyAave(uint256 amount)` | onlyManager, whenNotPaused | `forceApprove(aave, amount)` then `aave.supply(usdc, amount, vault, 0)`. Emits `ManagerSupplied(amount)`. |
| `managerWithdrawAave(uint256 amount, bytes32 reason)` | onlyManager | Pulls from Aave back to vault. `reason` is a free-form tag, e.g. `keccak256("threat-alert:<alertId>")`. Works when paused (so exits aren't blockable). Emits `ManagerWithdrew(amount, reason)`. |
| `setPaused(bool)` | onlyOwner | Emits `PauseChanged`. |
| `setManager(address)` | onlyOwner | Emits `ManagerChanged`. |
| `totalAssets() view` | — | `usdc.balanceOf(this) + aUsdc.balanceOf(this)`. aUSDC rebases — this is principal + accrued interest. |

**Errors**: `NotOwner`, `NotManager`, `Paused`, `CapExceeded`, `ZeroAmount`.

**Events**: `Deposit`, `WithdrawToOwner`, `ManagerSupplied`, `ManagerWithdrew(amount, reason)`, `PauseChanged`, `ManagerChanged`.

### 4.2 Safety model

- The manager EOA can only move funds **vault ↔ Aave on Base**. There is no path for the manager to transfer funds out of the vault.
- The owner (user) can `withdrawToOwner` at any time, paused or not. The user is never trapped.
- `maxDeposit` cap enforced in the contract — defense in depth on top of the per-user $50 cap from the demo plan.
- No proxy. Misbehaving manager → owner pulls funds and rotates.

### 4.3 Deploy

`contracts/script/Deploy.s.sol` hardcodes Base addresses (verified May 2026):

| Symbol | Address |
| --- | --- |
| `USDC_BASE` | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| `AAVE_POOL_BASE` | `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5` |
| `AUSDC_BASE` | `0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB` |

Reads from env: `VAULT_OWNER`, `MANAGER_ADDRESS`, `MAX_DEPOSIT_USDC_6DEC` (default `50_000_000`).

```bash
forge script script/Deploy.s.sol \
  --rpc-url $BASE_RPC_URL --private-key $PRIVATE_KEY --broadcast --verify
```

### 4.4 Tests

`contracts/test/YieldVault.t.sol` — local unit tests with `MockUSDC` and `MockAavePool`. Cases:

- `test_deposit_supply_withdraw_roundtrip` — deposit → supply → withdrawAave → withdrawToOwner.
- `test_deposit_cap` — `CapExceeded` over `maxDeposit`.
- `test_attacker_cannot_supply` — `NotManager`.
- `test_attacker_cannot_withdraw_to_self` — `NotOwner`.
- `test_owner_can_pull_even_when_paused` — pause does not trap user.

Mocks are minimal (no per-second interest), so aUSDC tests check 1:1 only.

---

## 5. Shared package (`@argus/shared`)

ESM-only TypeScript package consumed by manager, watcher, and frontend. Exposes three modules under `./alerts`, `./receipts`, `./addresses` and a barrel re-export.

### 5.1 Threat alert protocol — EIP-712

**Domain**

```ts
{ name: "Argus", version: "1" }
```

No `chainId` and no `verifyingContract` — alerts are off-chain messages between agents, not bound to a specific chain or contract. Recovery uses the signer's mainnet-derived EOA.

**Types**

```ts
ThreatAlert: [
  { name: "alertId",           type: "string"  },
  { name: "protocol",          type: "string"  },
  { name: "chain",             type: "string"  },
  { name: "score",             type: "uint8"   },
  { name: "evidenceSwarmRef",  type: "string"  },
  { name: "issuedAt",          type: "uint64"  },
  { name: "recommendedAction", type: "string"  },
]
```

**`ThreatAlertPayload`**

| Field | Type | Notes |
| --- | --- | --- |
| `alertId` | `string` | Stable monotonic id, format `${protocol}-${chain}-${unixSeconds}`. |
| `protocol` | `"aave-v3"` | Constrained literal in the MVP. |
| `chain` | `"base"` | Constrained literal in the MVP. |
| `score` | `number` (0..100) | Aggregated ThreatScore. |
| `evidenceSwarmRef` | `string` | Swarm content hash, or `stub:<unixMs>` if upload failed. |
| `issuedAt` | `number` | Unix seconds. |
| `recommendedAction` | `"exit" \| "monitor"` | Manager decides whether to act. |

**`SignedThreatAlert = { payload, signature }`** where `signature: Hex`.

**API**

- `hashAlert(payload): Hex` — EIP-712 hash.
- `signAlert(payload, privateKey): Promise<SignedThreatAlert>` — uses `viem` `privateKeyToAccount(...).signTypedData`.
- `recoverAlertSigner(alert): Promise<Address>` — recovers signer from `hashAlert + signature`.
- `verifyAlert(alert, expectedSigner): Promise<boolean>` — `isAddressEqual` of recovered vs expected.

Manager calls `recoverAlertSigner` and compares to its **live ENS-resolved** watcher address (refreshed every 60s and on demand). This is the forgery defense and the ENS bounty's headline behavior.

### 5.2 Receipts

Discriminated union `Receipt = DepositReceipt | WithdrawReceipt | ThreatAlertReceipt`.

Common base:
```ts
{ agent: AgentName, agentAddress: Address, timestamp: number }
```
where `AgentName = ${string}.${string}` (an ENS name).

| Kind | Extra fields |
| --- | --- |
| `deposit-aave` | `chainId`, `txHash`, `amount` (decimal-string USDC, raw 6-dec), `vault` |
| `withdraw-aave` | `chainId`, `txHash`, `amount`, `vault`, `triggeredByAlertId: string \| null` |
| `threat-alert` | `alertId`, `protocol`, `chain`, `score`, `evidenceSwarmRef` |

The manager writes all three kinds. The watcher does not write receipts (it records sent alerts in its own SQLite).

### 5.3 Addresses

```ts
export const BASE_ADDRESSES = { USDC, AAVE_POOL, AUSDC } // Base mainnet
export const CHAIN_IDS = { base: 8453 }
```

Single source of truth for token addresses imported by the manager (`vault.ts`) and the frontend (`DepositForm.tsx`). Keep in sync with `contracts/script/Deploy.s.sol`.

---

## 6. Manager agent (`@argus/manager`)

Long-running Node 20 process. Express HTTP server on `MANAGER_HTTP_PORT` (default `4001`). One viem `WalletClient` on Base, one read-only `PublicClient` on mainnet for ENS resolution.

### 6.1 HTTP surface

| Method | Path | Behavior |
| --- | --- | --- |
| `GET` | `/health` | Snapshot: `agent`, `address`, `vault`, `watcherEns`, `watcherAddress`, and `balances: { idleUsdc, suppliedUsdc }` (6-dec strings). Polled by the frontend's `VaultStatus` every 5s. |
| `GET` | `/receipts` | Last 200 receipts. Each row: `{ id, kind, payload, swarm_ref, created_at }` with `payload` already JSON-parsed. Polled every 4s by `AuditLog`. |
| `POST` | `/alerts` | Accepts `SignedThreatAlert` JSON, max 256kb body. See 6.2. |

Express has no CORS middleware; the frontend reads it from the same host (or via `NEXT_PUBLIC_MANAGER_HTTP_URL`). For a browser on `localhost:3000` calling `localhost:4001` you will need to add `cors()` or run the frontend's `next dev` proxy. **TODO if not present at demo time.**

### 6.2 Alert handler — `POST /alerts`

Pipeline:

1. **Shape check** — reject `400` if `alert.payload.alertId` or `alert.signature` missing.
2. **ENS resolve** — if `watcherAddress` is null (cold start race), refresh via `resolveAgentAddress(WATCHER_ENS)` (which goes through the shared `resolveAgent` helper on the mainnet client). If still null, `503`.
3. **Signature recovery** — `recoverAlertSigner(alert)` → compare via `isAddressEqual` to `watcherAddress`. Mismatch → `401`.
4. **Idempotency** — `alreadyProcessed(alertId)` short-circuits with `{ status: "duplicate" }`. No receipt is written on the duplicate path; the original first-sight receipt is the canonical record.
5. **Log the alert** as a `threat-alert` receipt on first sight (after the idempotency check, before any action decision).
6. **If `recommendedAction !== "exit"`** — mark processed with action `monitor`, return `{ status: "acknowledged" }`.
7. **Otherwise** — call `exitAaveOnAlert(alertId)`:
   - Read `suppliedUsdc` (aUSDC balance of vault). If `0n`, mark processed with action `no-position`, return `{ status: "no-position" }`.
   - Compute `reason = keccak256(toBytes("threat-alert:" + alertId))`.
   - `writeContract` `managerWithdrawAave(suppliedUsdc, reason)`.
   - `waitForTransactionReceipt`.
   - Save `withdraw-aave` receipt with `triggeredByAlertId`.
   - Mark processed with action `exit` and the tx hash.
   - Return `{ status: "exited", txHash, amount }`.

Concurrency: alerts process sequentially through Express. Race between two distinct alertIds is not an issue (idempotency keyed on `alertId`).

### 6.3 Deposit watcher

`watchContractEvent({ vault, abi, eventName: "Deposit" })`. On each log:

1. Call `supplyIdleToAave()`:
   - Read idle USDC balance of vault.
   - If `> 0`, `writeContract` `managerSupplyAave(idleUsdc)` and `waitForTransactionReceipt`.
2. Save `deposit-aave` receipt and best-effort upload to Swarm.

Note: if two `Deposit` events arrive in quick succession, both handlers will read the post-first-supply balance. The second sees `0n` and bails with no-op — no double-supply, no revert path required.

### 6.4 ENS

`ens.ts:resolveAgent(name)` — `mainnet.getEnsAddress({ name })`. Throws on null. The endpoint to POST alerts to is **not** read by the manager — the watcher reads it. Manager only resolves the watcher's address (for signature checks).

`refreshWatcherAddress()` runs at startup and every 60s. Failure logs and leaves `watcherAddress` unchanged so transient resolver hiccups don't disable the agent.

### 6.5 Persistence — SQLite (`./data/manager.sqlite`, WAL)

```sql
CREATE TABLE processed_alerts (
  alert_id    TEXT PRIMARY KEY,
  received_at INTEGER NOT NULL,
  score       INTEGER NOT NULL,
  action      TEXT    NOT NULL, -- 'monitor' | 'no-position' | 'exit'
  tx_hash     TEXT
);

CREATE TABLE receipts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  kind         TEXT NOT NULL,    -- 'deposit-aave' | 'withdraw-aave' | 'threat-alert'
  payload_json TEXT NOT NULL,
  swarm_ref    TEXT,
  created_at   INTEGER NOT NULL
);
```

### 6.6 Swarm

`@ethersphere/bee-js` 12. `uploadReceipt(payload)` returns the Swarm reference, or `null` if no postage batch is set or the upload fails. Receipts are still written to SQLite either way. Public gateway is documented as flaky for writes; running a local Bee is the demo polish path.

### 6.7 ABI used by manager

Subset of vault — only the functions and events the manager actually invokes/observes:

- Functions: `managerSupplyAave(uint256)`, `managerWithdrawAave(uint256, bytes32)`, `totalAssets()`, `usdc()`, `aUsdc()`.
- Event: `Deposit(address indexed from, uint256 amount)`.

`erc20Abi` here is `balanceOf` only — used to read `usdc` and `aUsdc` balances of the vault.

### 6.8 Required env

| Var | Purpose |
| --- | --- |
| `BASE_RPC_URL` | viem Base transport. |
| `MANAGER_PRIVATE_KEY` | Manager EOA. Hackathon-grade. |
| `MANAGER_ENS` | e.g. `manager.argus.divljo.eth`. |
| `WATCHER_ENS` | Resolved on mainnet for the signature check. |
| `VAULT_ADDRESS_BASE` | Filled in after deploy. |
| `MANAGER_HTTP_PORT` | Default 4001. |
| `MAINNET_RPC_URL` | ENS resolution. Defaults to `https://eth.llamarpc.com`. |
| `SWARM_GATEWAY_URL`, `SWARM_POSTAGE_BATCH_ID` | Optional. |

---

## 7. Watcher agent (`@argus/watcher`)

Long-running Node 20 process. No HTTP server. Tick interval `WATCHER_POLL_INTERVAL_MS` (default 30s).

### 7.1 Tick

```
tick():
  items = pollDemoTrigger() ++ scrapeReddit() ++ scrapeTwitter()
  ingest(items)            # dedupe via SQLite, classify, push to buffer
  score = scoreFor("aave-v3", buffer.recent())
  maybeAlert(score, buffer.topEvidence("aave-v3", 5))
```

### 7.2 Scrapers — Apify Store actors

We do not write or host scrapers. The watcher rents pre-built Actors from the **Apify Store** (`https://apify.com/store`) and calls them through Apify's standard REST surface. This is deliberate: the Apify-x402 narrative requires that the watcher buy compute from a third-party marketplace per call, not run its own crawlers.

`scrapers.ts` calls Apify's REST endpoint `run-sync-get-dataset-items`:

```
POST https://api.apify.com/v2/acts/<actor-id>/run-sync-get-dataset-items
```

`run-sync-get-dataset-items` is the synchronous "run + return dataset" endpoint — one HTTP call in, parsed JSON array out, no polling. We pass actor input as the JSON body.

#### Actors — current code vs. recommended for x402

The watcher currently codes against two Reddit/Twitter actors. Both are **Pay-Per-Result**, which Apify's x402 path does **not** support — x402 requires Pay-Per-Event. To make the Apify×x402 bounty path real, the spec calls for switching to two Pay-Per-Event actors that surface comparable signal.

##### Currently in code (NOT x402-eligible)

| Role | Actor id | Pricing | Status |
| --- | --- | --- | --- |
| Reddit signal | `trudax/reddit-scraper` ([store](https://apify.com/trudax/reddit-scraper)) | Pay-Per-Result | Token-auth only. Cannot route through x402. |
| Twitter signal | `apidojo/twitter-scraper-lite` ([store](https://apify.com/apidojo/twitter-scraper-lite)) | Pay-Per-Result | Token-auth only. Cannot route through x402. |

##### Recommended (Pay-Per-Event, x402-eligible)

| Role | Actor id | Pricing | Why |
| --- | --- | --- | --- |
| Broad threat search | `apify/google-search-scraper` ([store](https://apify.com/apify/google-search-scraper)) | Pay-Per-Event | Google SERPs cover Reddit, X, news outlets, and aggregator sites in a single query. Higher recall than scraping each source individually. |
| Targeted source reads | `apify/website-content-crawler` ([store](https://apify.com/apify/website-content-crawler)) | Pay-Per-Event | Curated URLs (rekt.news, governance.aave.com, defillama outage feeds). Markdown-extracted content slots straight into the classifier prompt. |

##### Suggested input shapes

`apify/google-search-scraper`:

```ts
{
  queries: "aave exploit\naave drained\naave hack\naave depeg\naave paused",
  resultsPerPage: 25,
  maxPagesPerQuery: 1,
  countryCode: "us",
  languageCode: "en",
  saveHtml: false,
}
```

`apify/website-content-crawler` (curated seed list):

```ts
{
  startUrls: [
    { url: "https://rekt.news/" },
    { url: "https://governance.aave.com/latest" },
    { url: "https://defillama.com/protocol/aave" },
  ],
  maxCrawlDepth: 1,
  maxCrawlPages: 30,
  saveMarkdown: true,
  proxyConfiguration: { useApifyProxy: true },
}
```

Both should be called via:

```
POST https://api.apify.com/v2/acts/apify~google-search-scraper/run-sync-get-dataset-items
POST https://api.apify.com/v2/acts/apify~website-content-crawler/run-sync-get-dataset-items
```

Note the `apify~<actor>` form (tilde-separated) on the URL — this is Apify's path-safe escaping of the `apify/` prefix. The slash form is also accepted by the REST API for the synchronous endpoints we use, but the tilde form is the documented one.

##### Why we don't write our own crawlers

- Each Store actor is maintained by the actor author — schema changes, anti-bot adaptations, proxy rotation, residential IPs are not our problem.
- Per-call cost is metered and visible in the Apify console; the watcher pays only for ticks that ran the actor.
- Switching providers means changing `actorId` and `input`, nothing else.
- The Apify×x402 narrative requires the watcher to **buy** compute from a third-party marketplace per call. Self-hosted crawlers would defeat the demo.

##### x402 eligibility check before each release

Apify's pricing model can change per actor. Before flipping `USE_X402=true`:

1. Open each actor's Store page.
2. Confirm the pricing badge says **Pay-Per-Event**.
3. If any actor is Pay-Per-Result, Rental, or subscription-based, route that one through token auth (`?token=APIFY_TOKEN`) and only route Pay-Per-Event actors through the x402 fetcher.

The watcher's `getFetcher()` selects fetcher globally today — if we keep mixing pricing models, this needs to become per-actor (a small refactor: pass the fetcher into `scrapeApify`).

#### Normalization to `ScrapedItem`

```ts
{ source: "reddit" | "twitter" | "telegram" | "stub",
  id: string, text: string, url: string, author?: string, postedAt: number }
```

The `source` field is currently hardcoded `"reddit"` in the mapper regardless of which actor produced the row — see §16 TODOs.

#### Failure handling

`scrapeApify` returns `[]` on any non-2xx response or thrown error. The watcher tolerates empty cycles — a tick with no scraped items just produces a zero contribution to the score.

#### x402-fetch path (opt-in) — Apify protocol

`USE_X402=true` swaps the global `fetch` for `wrapFetchWithPaymentFromConfig(fetch, { schemes: [{ network: "eip155:8453", client: new ExactEvmScheme(account) }] })` from `@x402/fetch` and `@x402/evm` v2.11. The watcher's EOA pays per scrape from its USDC balance on Base.

Off by default and with caveats below. Token-auth fallback (`?token=...`) is the safe path for stage demos.

**Apify's x402 wire format** (per `apify.com/.well-known/agents.md` and `docs.apify.com/platform/integrations/x402`):

- Endpoint: any normal Actor URL, e.g. `https://api.apify.com/v2/acts/<actor>/run-sync-get-dataset-items`. There is no `/x402` suffix.
- **Three-step flow** when paying directly:
  1. `GET/POST` with header `X-APIFY-PAYMENT-PROTOCOL: X402` and **no signature**. Server returns `HTTP 402` with a `PAYMENT-REQUIRED` response header — the value is base64-encoded JSON listing accepted payment formats.
  2. Sign the value: `mcpc x402 sign <PAYMENT-REQUIRED header value>` → produces a base64 `PAYMENT-SIGNATURE`.
  3. Resend the request with both headers:
     ```
     X-APIFY-PAYMENT-PROTOCOL: X402
     PAYMENT-SIGNATURE: <base64-signed-payload>
     ```
- **Network**: USDC on Base. The agents.md doc also lists OAuth and Apify API tokens as alternative auth paths; the x402 path is for "autonomous agents with wallet access and no human to complete account signup."
- **Prepaid balance**: minimum transaction is **$1 USDC**. First successful payment creates a prepaid balance on Apify and subsequent calls draw from it without new on-chain transactions until the balance is exhausted.
- **Constraints**:
  - Only **Pay-Per-Event Actors** are supported.
  - **Standby Actors are not supported.**
  - Apify's docs flag the integration as Experimental.

**Wire-compatibility gap with the current code.** `@x402/fetch` produces the canonical x402 `X-PAYMENT` / `X-PAYMENT-RESPONSE` headers from coinbase's reference protocol. Apify wraps the same idea in its own `X-APIFY-PAYMENT-PROTOCOL: X402` + `PAYMENT-SIGNATURE` header pair and recommends signing with the `mcpc` CLI. Whether `wrapFetchWithPaymentFromConfig` in v2.11 emits headers Apify accepts as-is, or whether we need a thin adapter that:

1. detects `402 + PAYMENT-REQUIRED`,
2. base64-decodes it,
3. signs the payload with the watcher EOA, and
4. resends with `X-APIFY-PAYMENT-PROTOCOL` + `PAYMENT-SIGNATURE`

…must be confirmed in a dry-run **before** flipping `USE_X402=true` for the demo. This is the riskiest unverified assumption in the watcher path. Falling back to plain token auth keeps the demo deterministic.

**Reference URLs**:
- `https://apify.com/.well-known/agents.md` — agent integration overview, mentions `mcpc x402 init` for wallet setup.
- `https://docs.apify.com/platform/integrations/x402` — full protocol, three-step curl examples, prepaid-balance behavior, Pay-Per-Event constraint.

#### Demo trigger

`pollDemoTrigger()` reads `./data/demo-trigger.json`, deletes it, returns it as a single `ScrapedItem` with `source: "stub"`. Created by `pnpm --filter @argus/watcher demo:trigger "<text>"`. Useful when the live signal is empty.

### 7.3 Classifier

`classifier.ts` calls Anthropic `claude-haiku-4-5-20251001`. System prompt asks for strict JSON:

```json
{
  "relevance": <0..1>,
  "severity": <0..1>,
  "target":   "aave-v3" | null,
  "summary":  "<= 20 words"
}
```

`extractJson` slices first `{` to last `}` to tolerate stray prose. Failure path returns `{ relevance: 0, severity: 0, target: null, summary: "" }` so a failed call never produces a false positive.

### 7.4 Aggregator (`scoreFor`)

```
raw = sum_over_signals( relevance * severity * sourceWeight * decay )
decay = 0.5 ^ (ageMs / HALF_LIFE_MS)        # 5-minute half-life
sourceWeight = { twitter: 1.2, reddit: 1.0, telegram: 0.9, stub: 1.5 }
burst = (live.length >= 3) ? 1.4 : 1.0
score = min(100, round(raw * 50 * burst))
```

Only signals with `cls.target === protocol` are counted. `topEvidence(protocol, n)` returns the top N by `relevance * severity` for the evidence bundle.

### 7.5 Alert flow

`maybeAlert(score, signals)`:

1. Gate on `score >= THREAT_SCORE_THRESHOLD` (env, default 60). Drop to 30 for demos.
2. Gate on **cooldown** — `Date.now() - lastAlertAt >= 2 * 60_000`.
3. Build evidence object, upload to Swarm via `uploadEvidence`. On failure or no postage batch, returns `stub:<unixMs>` so downstream contracts/UI stay valid.
4. Construct `ThreatAlertPayload` with `recommendedAction: "exit"`, `alertId = aave-v3-base-${unixSeconds}`.
5. `signAlert(payload, WATCHER_PRIVATE_KEY)`.
6. **Resolve manager endpoint live**:
   ```ts
   address  = mainnet.getEnsAddress({ name: MANAGER_ENS })
   endpoint = mainnet.getEnsText({ name: MANAGER_ENS, key: "agent-endpoint[a2a]" })
   ```
   Strip trailing slash, POST signed alert to `${endpoint}/alerts`. **No hard-coded address. This is the ENS bounty's primary moment.**
7. Record response body in SQLite `sent_alerts` and update `lastAlertAt`.

### 7.6 Persistence — SQLite (`./data/watcher.sqlite`, WAL)

```sql
CREATE TABLE seen (
  item_id TEXT PRIMARY KEY,
  seen_at INTEGER NOT NULL
);
CREATE TABLE sent_alerts (
  alert_id TEXT PRIMARY KEY,
  sent_at  INTEGER NOT NULL,
  score    INTEGER NOT NULL,
  response TEXT
);
```

`isNew(itemId)` / `markSeen(itemId)` are the dedupe primitives. `recordAlert(alertId, score, response)` writes whatever the manager returned (string or error body).

### 7.7 Required env

| Var | Purpose |
| --- | --- |
| `BASE_RPC_URL`, `MAINNET_RPC_URL` | Base reads (currently unused by watcher beyond x402 wallet client), mainnet for ENS. |
| `WATCHER_PRIVATE_KEY` | Watcher EOA. Signs alerts; pays for x402 scrapes when enabled. |
| `WATCHER_ENS`, `MANAGER_ENS` | Identity + peer discovery. |
| `ANTHROPIC_API_KEY` | Classifier. |
| `APIFY_TOKEN` | Token-auth fallback for scrape. Optional but heavily recommended. |
| `THREAT_SCORE_THRESHOLD` | Default 60. |
| `WATCHER_POLL_INTERVAL_MS` | Default 30000. |
| `USE_X402` | `"true"` to flip on x402-fetch. Default off. |
| `SWARM_GATEWAY_URL`, `SWARM_POSTAGE_BATCH_ID` | Optional; without postage batch, Swarm refs become `stub:<ts>`. |

---

## 8. Frontend (`@argus/frontend`)

Next.js 15.5 App Router, React 19, wagmi 2.19.x (pinned), `@ensdomains/ensjs` 4.2, Tailwind 3.4.

### 8.1 Pages and components

- `app/page.tsx` — single dashboard:
  - `<WalletConnect/>` — injected + Coinbase Wallet connectors.
  - Two `<AgentCard ensName=… />`: manager and watcher.
  - `<DepositForm/>` and `<VaultStatus/>` side-by-side.
  - `<AuditLog/>` full-width below.
- `app/providers.tsx` — `WagmiProvider` + `QueryClientProvider`. `staleTime: 5_000`.
- `app/layout.tsx` — minimal RSC root, dark Tailwind shell.

### 8.2 wagmi config

```ts
chains: [base, mainnet]
connectors: [injected(), coinbaseWallet({ appName: "Argus" })]
transports: { [base.id]: http(BASE_RPC), [mainnet.id]: http(MAINNET_RPC) }
ssr: true
```

`declare module "wagmi" { interface Register { config: typeof wagmiConfig } }` for typed hooks.

### 8.3 ENS reads (`lib/ens.ts`)

`@ensdomains/ensjs` `getRecords` — single batched read per agent on mount, cached for 30s by react-query:

| Field | Source |
| --- | --- |
| `address` | `coins: ["ETH"]` |
| `description` | `texts.description` |
| `avatar` | `texts.avatar` |
| `role` | `texts."agent-context (role field)"` |
| `endpoint` | `texts."agent-endpoint[a2a]"` |
| `capabilities` | `texts."agent-context (sources field)"` (JSON or comma-sep) |

The frontend doesn't act on `endpoint` — it's there for cards to display "this is how watchers reach me" — but reading the same key the watcher uses on stage is the proof point.

### 8.4 Manager API client (`lib/manager-api.ts`)

`fetchManagerHealth()` and `fetchReceipts()` against `NEXT_PUBLIC_MANAGER_HTTP_URL`. `cache: "no-store"` so React Query alone controls staleness. Polled by `VaultStatus` (5s) and `AuditLog` (4s).

### 8.5 DepositForm

- Reads `usdcBalance` and `allowance(owner=user, spender=vault)` on Base.
- On `Deposit`: enforces `chainId === base.id`, requests `switchChain` if not. Approves USDC if allowance < amount, then calls `vault.deposit(amount)`.
- On `Withdraw`: calls `vault.withdrawToOwner(amount)`. Always works, even when paused.
- All amounts are 6-dec USDC.

### 8.6 ABI surface used in frontend

User-facing only:
- Vault: `deposit`, `withdrawToOwner`, `totalAssets`, `owner`, `manager`, `maxDeposit`.
- ERC20: `approve`, `allowance`, `balanceOf`.

The manager-only entrypoints (`managerSupplyAave`, `managerWithdrawAave`) are intentionally absent here — the frontend never calls them.

### 8.7 next.config.ts notes

- `transpilePackages: ["@argus/shared"]` — webpack must compile the shared TS package.
- `webpack.resolve.extensionAlias` maps `.js → [.ts, .tsx, .js]` so the shared package's NodeNext-style `.js` re-exports resolve under webpack too.
- `env: { NEXT_PUBLIC_* }` — promotes the root `.env` to the public-namespaced vars the frontend reads.

### 8.8 Frontend env (browser-exposed)

| `NEXT_PUBLIC_*` | Backed by | Default |
| --- | --- | --- |
| `VAULT_ADDRESS` | `VAULT_ADDRESS_BASE` | `0x0` |
| `MANAGER_ENS` | `MANAGER_ENS` | `manager.argus.divljo.eth` |
| `WATCHER_ENS` | `WATCHER_ENS` | `watcher.argus.divljo.eth` |
| `MANAGER_HTTP_URL` | `MANAGER_HTTP_URL` | `http://localhost:4001` |
| `BASE_RPC_URL` | `BASE_RPC_URL` | `https://mainnet.base.org` |
| `MAINNET_RPC_URL` | `MAINNET_RPC_URL` | `https://eth.llamarpc.com` |

---

## 9. ENS layer

### 9.1 Subname plan

Root: `argus.eth`. Subnames issued via Namestone (tentative — alt is a CCIP-Read offchain resolver):

- `manager.argus.divljo.eth` — points at the manager EOA.
- `watcher.argus.divljo.eth` — points at the watcher EOA.
- `<userhandle>.argus.eth` — deferred; per-user vault subnames are post-MVP.

### 9.2 Text records — ENSIP-26 conformant

The agent integration follows **[ENSIP-26](https://docs.ens.domains/ensip/26)** (Agent Text Records). This buys us interop with any other ENS-aware tooling that learns the same convention. Two record families are standardized:

- `agent-context` — agent-readable description. ENSIP-26 permits any format suitable for agentic systems (JSON, Markdown, plain text). We use **JSON**.
- `agent-endpoint[<protocol>]` — URL for the named protocol. Defined protocols: `a2a` (agent-to-agent), `mcp` (Model Context Protocol), `web` (web interface). We publish `agent-endpoint[a2a]` on the manager.

| Key | Standard | Owner publishes | Purpose |
| --- | --- | :---: | --- |
| ETH address (`coins: ETH`) | ENSIP-9 | both | The agent EOA. |
| `description` | ENSIP-5 | both | Human-readable role line. Rendered on agent cards. |
| `avatar` | ENSIP-12 | optional | Image URL. Rendered on agent cards. |
| `agent-context` | ENSIP-26 | both | JSON: `{ "role": "yield-manager" \| "threat-watcher", "capabilities": [...], "version": "1" }`. |
| `agent-endpoint[a2a]` | ENSIP-26 | **manager** | HTTPS URL the watcher POSTs signed alerts to. Watcher prefers this over `[web]`. |
| `agent-endpoint[web]` | ENSIP-26 | optional | Fallback if `[a2a]` is unset (rarely used in the MVP, but supported by `pickAgentEndpoint`). |

#### Example record values (manager)

```
description           → "Argus yield manager. Parks user USDC in Aave v3 on Base."
avatar                → "https://argus.example/manager.png"
agent-context         → {"role":"yield-manager","capabilities":["aave-v3","base"],"version":"1"}
agent-endpoint[a2a]   → "https://manager.argus.example"
```

#### Example record values (watcher)

```
description           → "Argus threat watcher. Apify-paid scraping, signed alerts."
agent-context         → {"role":"threat-watcher","capabilities":["aave-v3","apify-x402"],"version":"1"}
```

The watcher does not publish an endpoint — peers don't call it.

### 9.3 Resolution code path

All three components (manager, watcher, frontend) go through one helper: `resolveAgent(client, name)` from `@argus/shared/ens`. It runs a viem `Promise.all` over `getEnsAddress` + each text key, both of which use the **Universal Resolver** (`0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe` on mainnet) under the hood. That gives us:

- One logical "load this agent" call from the dev's perspective.
- **CCIP-Read aware** — Namestone's offchain resolver works without any extra setup; viem follows EIP-3668 redirects automatically.
- Tolerant of missing records — a key with no value resolves to `null` rather than throwing; the helper returns `address: null` if the name doesn't resolve.

`pickAgentEndpoint(records, ["a2a", "web"])` returns the URL for the first protocol the agent has published, or `null`.

The frontend uses the same record set via `@ensdomains/ensjs` `getRecords` for a single batched read (one HTTP call, also Universal-Resolver-backed).

### 9.4 Three places ENS does real work

1. **Watcher → Manager routing** — every alert tick calls `resolveAgent(MANAGER_ENS)` and uses `endpoints.a2a` as the POST target. Rotating the manager's URL or EOA = update the ENS records, no code change.
2. **Manager forgery defense** — the recovered EIP-712 signer is compared via `isAddressEqual` to `resolveAgent(WATCHER_ENS).address` (refreshed every 60s). A signature from any wallet other than the live ENS-resolved watcher → 401.
3. **Frontend agent cards** — render description, avatar, role (from `agent-context.role`), capabilities (from `agent-context.capabilities`), and the published endpoints. Live from text records. Stage demo: edit a text record on Namestone and watch the card update in 30s without redeploying.

### 9.5 Future: ENSIP-25 verification

ENSIP-25 (Agent Registration) defines `agent-registration[<registry>][<agentId>]` text records that prove an ENS name controls an entry in an external agent registry (e.g. ERC-8004 on Ethereum). For Argus this is post-MVP — once an agent registry contract is in scope, publish the record with value `"1"` and downstream consumers can verify the binding without any extra signed message. The shared helper is structured so adding it is one more text-key in `resolveAgent`.

---

## 10. End-to-end demo flow

1. **Setup**: vault deployed on Base, ENS records populated for both agents (manager has `agent-endpoint[a2a]` set to its public URL), `.env` filled in.
2. **Boot**: `pnpm dev:manager`, `pnpm dev:watcher`, `pnpm dev:web`.
3. **Deposit**: user connects wallet → `DepositForm` → `approve(USDC, vault, amount)` then `vault.deposit(amount)`.
4. **Auto-supply**: manager's `watchContractEvent` fires → `managerSupplyAave(idleUsdc)` → aUSDC appears in vault. Receipt logged. Frontend `VaultStatus` shows `Idle USDC: 0`, `In Aave: 10` within ~5s.
5. **Trigger threat**: `pnpm --filter @argus/watcher demo:trigger "BREAKING: Aave v3 USDC drained, $40M exploit confirmed."`
6. **Tick**: watcher picks up the sock-puppet, classifies, scores >= threshold, signs, resolves manager via ENS, POSTs alert.
7. **Exit**: manager verifies signature against ENS-resolved watcher address → idempotency check → `managerWithdrawAave(suppliedUsdc, keccak256("threat-alert:<id>"))` → aUSDC drains back to USDC in vault. `withdraw-aave` receipt with `triggeredByAlertId`.
8. **Audit**: `AuditLog` polls every 4s; the new receipts (alert, then withdraw) appear with Basescan and Swarm links.

---

## 11. State machines / sequence diagrams

### 11.1 Alert lifecycle (watcher → manager)

```
WATCHER                                         MANAGER

tick()                                         Express :4001
  scrape                                          .
  classify                                        .
  score >= threshold && !cooldown                 .
  uploadEvidence → swarmRef                       .
  signAlert(payload, WATCHER_KEY)                 .
  resolve manager via ENS:                        .
    addr = getEnsAddress(MANAGER_ENS)             .
    url  = getEnsText(MANAGER_ENS,                .
                      "agent-endpoint[a2a]")       .
  POST {url}/alerts (signed)  ───────────────►   POST /alerts
                                                   shape check (400 if bad)
                                                   refresh watcherAddress if null
                                                   recover signer
                                                     ≠ watcherAddress → 401
                                                   alreadyProcessed(alertId)?
                                                     yes → 200 duplicate
                                                   save threat-alert receipt
                                                   action == "exit"?
                                                     no → mark monitor, 200
                                                   suppliedUsdc == 0?
                                                     yes → mark no-position, 200
                                                   managerWithdrawAave(...)
                                                   waitForTransactionReceipt
                                                   save withdraw-aave receipt
                                                   mark exit + txHash
                                                 ◄─ 200 { exited, txHash, amount }
  recordAlert(alertId, score, response)
  lastAlertAt = now
```

### 11.2 Deposit lifecycle (user → manager → Aave)

```
USER (browser)            VAULT                  MANAGER          AAVE

approve(USDC, vault, amt)
deposit(amt)            ──► Deposit event ─────► onLogs()
                                                   readBalances
                                                   managerSupplyAave(idle)
                                                                  ──► supply()
                                                   waitForReceipt
                                                   save deposit-aave receipt
```

---

## 12. Environment variables — complete table

Single root `.env` consumed by all four packages.

| Var | Manager | Watcher | Frontend | Default |
| --- | :---: | :---: | :---: | --- |
| `BASE_RPC_URL` | required | required | promoted | — |
| `MAINNET_RPC_URL` | optional | optional | promoted | `eth.llamarpc.com` |
| `MANAGER_PRIVATE_KEY` | required | — | — | — |
| `MANAGER_ENS` | required | required | promoted | `manager.argus.divljo.eth` |
| `MANAGER_HTTP_PORT` | optional | — | — | `4001` |
| `MANAGER_HTTP_URL` | — | — | promoted | `http://localhost:4001` |
| `WATCHER_PRIVATE_KEY` | — | required | — | — |
| `WATCHER_ENS` | required | required | promoted | `watcher.argus.divljo.eth` |
| `VAULT_ADDRESS_BASE` | required | — | promoted | — |
| `ANTHROPIC_API_KEY` | — | required | — | — |
| `APIFY_TOKEN` | — | optional | — | empty |
| `NAMESTONE_API_KEY`, `NAMESTONE_DOMAIN` | (issuance only) | — | — | — |
| `SWARM_GATEWAY_URL` | optional | optional | — | `api.gateway.ethswarm.org` |
| `SWARM_POSTAGE_BATCH_ID` | optional | optional | — | empty |
| `THREAT_SCORE_THRESHOLD` | — | optional | — | `60` |
| `WATCHER_POLL_INTERVAL_MS` | — | optional | — | `30000` |
| `USE_X402` | — | optional | — | `false` |
| `DEMO_MODE` | — | optional | — | `false` |

---

## 13. Out-of-band setup checklist

- Foundry tools installed; `forge install foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts` run inside `contracts/`.
- Vault deployed on Base; address pasted into `VAULT_ADDRESS_BASE`.
- Two EOAs funded:
  - Manager EOA — ~$5 ETH on Base for gas.
  - Watcher EOA — ~$5 ETH on Base for gas, plus ≥ $5 USDC on Base if `USE_X402=true`.
- ENS subnames issued (Namestone), text records populated. `agent-endpoint[a2a]` on the manager points at the running Express URL.
- Optional: local Bee node for reliable Swarm uploads; `SWARM_POSTAGE_BATCH_ID` set.

---

## 14. Failure modes and degradations

| Failure | Behavior |
| --- | --- |
| ENS resolution fails on alert | Manager 503s the alert; watcher logs and skips this tick. Both retry on next interval. |
| Apify down or token missing | Scrapers return `[]`; watcher tick is a no-op. |
| Anthropic call fails | Classifier returns zeroed result; signal contributes nothing. |
| Swarm upload fails | Receipt still saved locally (manager) or `stub:<ts>` ref returned (watcher); UI hides the "evidence" link when ref is a stub. |
| Manager process crashed when alert fires | Watcher's POST fails; alertId is stored in `sent_alerts` with the error body. Manual re-trigger possible. |
| Two `Deposit` events in quick succession | Second handler reads idle == 0, returns null. No double-supply. |
| Replay of alert | Manager's `processed_alerts` PK on `alertId` short-circuits with `{ status: "duplicate" }`. |
| Forged signature | Signer recovery mismatches ENS-resolved watcher → 401. |
| Vault paused mid-incident | `managerWithdrawAave` is `onlyManager` (no `whenNotPaused`) and still works. `withdrawToOwner` always works. |

---

## 15. Hard caps for live mainnet demo

- `maxDeposit` per vault = 50 USDC (constructor arg, default in `Deploy.s.sol`).
- Manager EOA holds ~$5 ETH on Base.
- Watcher EOA holds ~$5 ETH on Base, plus ≥ $5 USDC on Base if `USE_X402=true`.
- Threshold can be lowered to 30 for stage demos.
- Cooldown: 2 minutes between alerts.

---

## 16. Open items / TODOs called out by the code

- **`@x402/fetch` ↔ Apify wire compatibility unverified.** Apify expects `X-APIFY-PAYMENT-PROTOCOL: X402` + `PAYMENT-SIGNATURE` (base64), produced by `mcpc x402 sign` against a base64 `PAYMENT-REQUIRED` challenge. The standard `@x402/fetch` library emits `X-PAYMENT`. If those don't line up, the watcher needs a small adapter that intercepts `402 + PAYMENT-REQUIRED`, base64-decodes the challenge, signs with the watcher EOA, and resends with Apify's header names. Run a dry-run before flipping `USE_X402=true`.
- `scrapers.ts` always tags items as `source: "reddit"` regardless of actor. Aggregator weights are fine for mixed input today, but provenance is wrong in receipts. Fix before any post-demo claim about source breakdown.
- **Highest priority for the Apify×x402 bounty:** the two actors currently in the code (`trudax/reddit-scraper`, `apidojo/twitter-scraper-lite`) are **Pay-Per-Result**, which the x402 path does not support. Switch to `apify/google-search-scraper` and `apify/website-content-crawler` (both Pay-Per-Event) per §7.2. Without this swap, `USE_X402=true` cannot succeed against any actor we currently call.
- Manager Express has no CORS; cross-origin browsers hitting `/health` and `/receipts` will need a `cors()` middleware or a same-origin proxy.
- Manager's `agent: env.managerEns as ${string}.${string}` casts assume the env contains a dot. Validate at boot if you want to fail fast.
- Watcher's classifier model id is hardcoded to `claude-haiku-4-5-20251001`. Lift to env if the haiku family rolls forward during the hackathon.
- No retry/backoff on the watcher → manager POST. A single transient failure means `lastAlertAt` is **not** set; the next tick (if signal persists) tries again immediately, which is the desired behavior.
- Swarm reads are gateway-direct from the frontend. `stub:` refs are filtered out client-side; non-stub refs link to `api.gateway.ethswarm.org` regardless of which gateway the agent uploaded through.

---

## 17. Bounty mapping (why this exists)

| Bounty | Where to look |
| --- | --- |
| **ENS** (primary) | `agents/watcher/src/index.ts:resolveManagerEndpoint`, `agents/manager/src/ens.ts`, `frontend/lib/ens.ts:readAgentRecords`, signature recovery in `manager/src/index.ts`. |
| **Apify × x402** (primary) | `agents/watcher/src/scrapers.ts:getFetcher` and the `scrapeApify` fall-through. Wire format: §7.2 — `X-APIFY-PAYMENT-PROTOCOL: X402` + `PAYMENT-SIGNATURE`, three-step flow per `docs.apify.com/platform/integrations/x402`. |
| **Best Agentic Venture / Umia** | Whole repo: two named, ENS-discoverable agents with distinct roles and signed messages. Receipts in `manager/src/index.ts` are the trust artifact. |
| **Swarm** (secondary) | `agents/manager/src/swarm.ts`, `agents/watcher/src/swarm.ts`, `bee-js` uploads of receipts and evidence bundles. |
