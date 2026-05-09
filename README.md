# Argus

> Trust infrastructure for agent-managed capital.

Two ENS-named agents managing a USDC position on Base. The **manager** parks funds in Aave v3 and exits on signed alerts. The **watcher** scrapes social, news, and prediction markets via Apify, scores threats, and signs alerts that the manager verifies via live ENS lookup. Every action is on-chain or signed-and-stored on Swarm.

## Live demo

| Asset | Where |
|---|---|
| **Vault contract** (Base) | [`0x4486738ec027F0776B25aC2F5E2744FCe6F96e1e`](https://basescan.org/address/0x4486738ec027F0776B25aC2F5E2744FCe6F96e1e) |
| **Manager agent** | [`manager.argus.divljo.eth`](https://app.ens.domains/manager.argus.divljo.eth) → `0x6da3471242039591A7A1C012caBeDEfaB466bE16` |
| **Watcher agent** | [`watcher.argus.divljo.eth`](https://app.ens.domains/watcher.argus.divljo.eth) → `0x11952796edC9eC91090e459fDE87BdcfC11e13aD` |
| **Namespace** | [`argus.divljo.eth`](https://app.ens.domains/argus.divljo.eth) |

Quick verification anyone can run:

```bash
# manager exposes its endpoint via ENSIP-26 text records
cast text manager.argus.divljo.eth "agent-endpoint[a2a]"
cast text manager.argus.divljo.eth "agent-context"

# watcher publishes its bounty terms
cast text watcher.argus.divljo.eth "bounty"

# vault state on-chain
cast call 0x4486738ec027F0776B25aC2F5E2744FCe6F96e1e "totalAssets()(uint256)" --rpc-url https://mainnet.base.org
```

---

## Bounties targeted

### 1. ENS — agent identity + agent-to-agent discovery (primary)

**What we built:**
- Three ENS subnames under user-owned `divljo.eth`, issued onchain via NameWrapper:
  - `argus.divljo.eth` — namespace root
  - `manager.argus.divljo.eth` — manager EOA + ENSIP-26 records
  - `watcher.argus.divljo.eth` — watcher EOA + ENSIP-26 records
- ENSIP-26 text records on each agent: `agent-endpoint[a2a]`, `agent-context`, `description`, plus a custom `bounty` record on the watcher publishing its reward terms.
- Live A2A discovery — the watcher resolves the manager's HTTP endpoint on **every** alert via `getEnsAddress` + `getEnsText("agent-endpoint[a2a]")`. No hardcoded URLs anywhere.
- Manager verifies watcher signatures by recovering the EIP-712 signer and comparing it to the **live ENS-resolved address** of `watcher.argus.divljo.eth`, refreshed every 60s. Renaming or rotating an agent updates the trust path with zero code changes.

**Where in the code:**
- [`packages/shared/src/ens.ts`](packages/shared/src/ens.ts) — CCIP-Read aware `resolveAgent()` helper used by all three runtimes
- [`agents/watcher/src/index.ts:35-47`](agents/watcher/src/index.ts#L35-L47) — `resolveManagerEndpoint()` runs before every POST
- [`agents/manager/src/index.ts:28-34, 72-76`](agents/manager/src/index.ts#L28-L34) — periodic ENS refresh + signature verification against ENS-resolved address
- [`frontend/components/AgentCard.tsx`](frontend/components/AgentCard.tsx) and [`/watchers` page](frontend/app/watchers/page.tsx) — read text records live via `@ensdomains/ensjs`

### 2. Apify × x402 — metered scraping (primary)

**What we built:**
- Four Apify actors integrated, three signal types in parallel:
  - **`fatihtahta/polymarket-scraper-ppe`** (PPE) — prediction-market implied probabilities, **the x402-eligible actor**
  - `apidojo/tweet-scraper` (PPR) — Twitter/X
  - `trudax/reddit-scraper-lite` (PPR) — Reddit
  - `tri_angle/telegram-scraper` (PPR) — channel messages (configured to read [`whale_alert_io`](https://t.me/s/whale_alert_io) by default)
- Polymarket calls flow through `wrapFetchWithPaymentFromConfig` from `@x402/fetch` v2.11 + `@x402/evm` v2.11, signing with the watcher EOA on Base. The Twitter/Reddit/Telegram actors stay on token auth because Apify's x402 path is **PPE-only by design**.
- Polymarket items are special-cased in the classifier — implied probability is the threat probability directly, no LLM in the loop.

**Why the split matters:** Apify's experimental x402 endpoint only settles against Pay-Per-Event actors. We ship one PPE actor wired through x402 and three PPR actors on token auth — clearly documented in code and in the env (`USE_X402` flag), so the bounty path is real, not decorative.

**Where in the code:**
- [`agents/watcher/src/scrapers.ts`](agents/watcher/src/scrapers.ts) — four scrape functions, the `x402Fetcher` wrapping only the Polymarket call
- [`agents/watcher/src/classifier.ts:24-34`](agents/watcher/src/classifier.ts#L24-L34) — Polymarket short-circuit using `impliedProb`

### 3. Swarm — verifiable evidence trail (secondary)

**What we built:**
- All receipts (deposits, withdraws, threat alerts, evidence bundles) are uploaded to Swarm via `@ethersphere/bee-js` v12.
- Uses the **bzz.limo** hosted gateway with `NULL_STAMP` — no postage batch setup required, the gateway rewrites it. Verified live: upload returns a 64-char ref, retrieval at `bzz.limo/bytes/<ref>` returns the exact JSON.
- Receipts are linked from the frontend audit log — every row has a `swarm ↗` link the audience can click to see the actual signed payload.
- Graceful fallback: on network failure, refs become `stub:<unixMs>` so the SQLite audit log stays canonical and downstream UI doesn't break.

**Where in the code:**
- [`agents/manager/src/swarm.ts`](agents/manager/src/swarm.ts), [`agents/watcher/src/swarm.ts`](agents/watcher/src/swarm.ts) — `Bee('https://bzz.limo')` + `NULL_STAMP`
- [`frontend/components/ThreatPanel.tsx`](frontend/components/ThreatPanel.tsx) — Evidence and Exits sections render `bzz.limo/bytes/<ref>` deep-links

### 4. Best Agentic Venture / Umia — narrative

**The thesis:** capital management agents are coming. The hard part isn't running the strategy — it's giving humans verifiable trust that an autonomous agent can't drain you, won't hide its actions, and earns its keep only when it actually saves you money. Argus is a small, end-to-end demonstration of that trust stack.

**Three concrete trust primitives we ship:**

1. **Identity = ENS.** Both agents are ENS-named with on-chain address records and ENSIP-26 metadata. The manager's HTTP endpoint, role, and supported protocols are public. The watcher's bounty terms (`50 bps of saved capital, paid in USDC on Base`) are published as a signed-by-mainnet ENS text record — a public economic commitment, not a whitepaper handwave.
2. **A2A trust = signature + live ENS.** No allowlist. The manager accepts any alert signed by *whatever address `watcher.argus.divljo.eth` currently resolves to*. ENS becomes the access-control list — managed by the user, not the protocol.
3. **Evidence = Swarm + on-chain.** Every action produces a receipt: vault tx (Basescan) + signed JSON (Swarm). A user reviewing what the agents did doesn't need to trust our database — they read the chain and the content-addressed evidence.

**Watcher swarm + bounty model.** The frontend `/watchers` page lists four logical sub-watchers (`polymarket-watcher`, `x-watcher`, `reddit-watcher`, `tg-whale-watcher`) each with its own ENS subname and reward rate (25-50 bps of saved capital). Users subscribe per-watcher; the bounty story is wired into the UI and the on-chain ENS commitment.

**Where in the code:**
- [`frontend/lib/watchers.ts`](frontend/lib/watchers.ts) — the registry
- [`frontend/app/watchers/page.tsx`](frontend/app/watchers/page.tsx) — the subscribe page
- [`contracts/src/YieldVault.sol`](contracts/src/YieldVault.sol) — manager EOA can ONLY move funds vault↔Aave; owner can always exit; no upgradeability

---

## Architecture

```
                                     ┌─────────────────────────────────┐
                                     │ user wallet (vault owner)       │
                                     │  0x23812ff0…a7D3c               │
                                     └────────────┬────────────────────┘
                                                  │ deposit USDC
                                                  ▼
                                     ┌─────────────────────────────────┐
                                     │ YieldVault on Base              │
                                     │  0x4486738e…6e1e                │
                                     │  cap: 5 USDC (demo)             │
                                     └────────────┬────────────────────┘
                                                  │ Deposit event
                                                  ▼
        ┌────────────┐     POST signed     ┌──────────────────────┐    Aave supply/withdraw
        │ Watcher    │◄────────────────────│ Manager              │◄──────────────►  Aave v3 Pool
        │ ENS:       │ /alerts             │ ENS:                 │
        │ watcher.   │                     │ manager.             │
        │ argus.     │                     │ argus.               │
        │ divljo.eth │                     │ divljo.eth           │
        └─────┬──────┘                     └────────┬─────────────┘
              │                                     │
              │ scrape via Apify                    │ upload receipts
              │ (Polymarket via x402,               │ via bee-js
              │  Twitter/Reddit/Telegram via token) │ → bzz.limo
              ▼                                     ▼
        ┌────────────┐                     ┌──────────────────────┐
        │ Apify      │                     │ Swarm                │
        │ (4 actors) │                     │ (NULL_STAMP)         │
        └────────────┘                     └──────────────────────┘
```

Both agents resolve each other via mainnet ENS (CCIP-Read aware). The manager's HTTP endpoint is published in `agent-endpoint[a2a]`; the watcher's ENS address is the source of truth for signature verification.

## Repo layout

```
contracts/         Foundry — YieldVault.sol + tests
packages/shared/   TS — EIP-712 alert types, ENS resolver helpers, address constants
agents/manager/    Express on :4001 — watches vault, supplies/exits Aave, persists receipts
agents/watcher/    30s tick — scrapes 4 Apify actors, classifies, scores, signs alerts
frontend/          Next.js 15 + wagmi 2.19 + ensjs 4.2 — three-pane dashboard + /watchers page
docs/              Technical Spec (high-level) + diagrams
```

## Run locally

```bash
pnpm install
cp .env.example .env       # then fill in private keys, Apify token
```

Three terminals:

```bash
# Terminal 1 — manager (Express :4001)
pnpm --filter @argus/manager dev

# Terminal 2 — watcher (30s tick loop)
pnpm --filter @argus/watcher dev

# Terminal 3 — frontend (:3000)
pnpm --filter @argus/frontend dev
```

Optional 4th terminal to expose manager publicly for the demo:

```bash
ngrok http --url=argus-manager.ngrok-free.app 4001
# then update agent-endpoint[a2a] on manager.argus.divljo.eth to the ngrok URL
```

## Demo flow

1. Open http://localhost:3000, connect MetaMask (vault owner wallet, Base network)
2. In the chat panel: **`info`** — manager `/health` echoes vault state + ENS-resolved watcher address
3. **`deposit 1 usdc`** — wallet approves + deposits → manager detects the on-chain `Deposit` event → calls `managerSupplyAave` automatically
4. Wait ~30s — watcher next tick scrapes 4 Apify actors, mock classifier (no Anthropic key) marks items high-threat, ThreatScore ≥ 60 fires a signed alert
5. Manager verifies signature via ENS, calls `managerWithdrawAave`, vault back to idle
6. Right column shows: real **Evidence** receipt + **Exits triggered** ($N pulled) with clickable `swarm ↗` links to `bzz.limo/bytes/<ref>`
7. **`withdraw 1`** in chat — pulls idle USDC back to your wallet

## Stack pinning

- `viem` 2.48.8, `wagmi` 2.19.x (do **not** bump to 3.x — broken peerDeps)
- `@ensdomains/ensjs` 4.2.2
- Next.js 15.5
- Solidity 0.8.28 + Foundry
- bee-js 12.0.0
- @x402/fetch + @x402/evm 2.11
- Anthropic SDK 0.32.1 (mock classifier on by default — set `ANTHROPIC_API_KEY` to switch to real Claude)

## Safety rails

| Rail | Where |
|---|---|
| Manager EOA cannot transfer funds out — only vault↔Aave | [`YieldVault.sol`](contracts/src/YieldVault.sol) `managerSupplyAave` / `managerWithdrawAave` |
| Owner can `withdrawToOwner` even when paused | [`YieldVault.sol:78-82`](contracts/src/YieldVault.sol#L78-L82) |
| `maxDeposit` cap (5 USDC for demo) | constructor-bound, not settable |
| Alert idempotency on `alertId` | manager SQLite PK |
| Watcher cooldown 2 min between alerts | [`agents/watcher/src/index.ts:17`](agents/watcher/src/index.ts#L17) |
| EIP-712 alert verification against live ENS | [`agents/manager/src/index.ts:72-76`](agents/manager/src/index.ts#L72-L76) |

## What's mocked / deferred (honest list)

- **Argus Score** + **Score breakdown bars** in the dashboard — hardcoded; the watcher's real aggregator score isn't surfaced via an HTTP endpoint yet.
- **Chat panel routing** — regex matcher with three real commands (`deposit`, `withdraw`, `info`) wired to wagmi; other queries get canned responses. No real LLM tool-use yet.
- **ANTHROPIC_API_KEY** intentionally unset → **mock classifier** with `MOCK_THREAT_LEVEL` dial. Set the key to switch to real Claude Haiku.
- **Four watcher subnames** (`polymarket-watcher.argus.divljo.eth` etc.) are **defined in the registry** and surfaced on the `/watchers` page, but their ENS subnames + EOAs are not yet issued onchain. Single-process watcher today; logical sub-agents on the page.
- **Per-user vault subnames** (`<handle>.argus.divljo.eth`) — deferred (Namestone path abandoned in favor of onchain NameWrapper, where per-user issuance costs gas).
- **Multi-chain selection** ("manager picks higher APY") — Base-only for the demo.

## Hackathon-grade

This is a 48-hour build. Hot keys live in `.env` and are deliberately scoped — manager and watcher EOAs hold ≤ ~$5 ETH each on Base, vault is capped at 5 USDC. Nothing here is production. The point is to demonstrate the **trust primitives end-to-end on real mainnet infrastructure**: ENS, Aave, Swarm, Apify x402.

## License

MIT — see [LICENSE](LICENSE).
