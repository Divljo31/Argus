"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useReceipts } from "../lib/hooks";
import type { ReceiptRow } from "../lib/manager-api";
import { WATCHERS, getSubscribedIds } from "../lib/watchers";

function ago(ms: number) {
  const sec = Math.max(1, Math.floor((Date.now() - ms) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  return `${Math.floor(min / 60)}h ago`;
}

function shortRef(s: string | null) {
  if (!s) return "—";
  if (s.startsWith("stub:")) return "stub";
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

function swarmHref(s: string | null): string | null {
  if (!s || s.startsWith("stub:")) return null;
  return `https://bzz.limo/bytes/${s}`;
}

interface MockEvidence {
  source: string;
  ageMs: number; // age in ms relative to now — used for sorting
  html: string; // body content with inline <span class="text-safe|text-warn"> highlights
  footer: string; // small grey text after "✓ signed"
}

const MOCK_EVIDENCE: MockEvidence[] = [
  {
    source: "polymarket",
    ageMs: 2 * 60_000,
    html:
      '"Will Aave v3 be exploited by Dec 31?" — <span class="text-safe">2% YES</span> · 412 traders · $48k volume',
    footer: "0x9a1e… · demo",
  },
  {
    source: "x.com",
    ageMs: 14 * 60_000,
    html:
      '@samczsun: "Reviewed the latest Aave gov proposal — risk params look <span class="text-safe">conservative and well-modeled</span>."',
    footer: "verified · 312k · demo",
  },
  {
    source: "telegram",
    ageMs: 38 * 60_000,
    html:
      'whale 0xf3a1… moved <span class="text-warn">$2.1M out of Aave</span> → no contagion on related vaults',
    footer: "weight 0.18 · demo",
  },
];

export function ThreatPanel() {
  const receipts = useReceipts();
  const [subbed, setSubbed] = useState<Set<string>>(new Set(WATCHERS.map((w) => w.id)));

  useEffect(() => {
    setSubbed(getSubscribedIds());
    const handler = () => setSubbed(getSubscribedIds());
    window.addEventListener("argus:watchers-changed", handler);
    return () => window.removeEventListener("argus:watchers-changed", handler);
  }, []);

  const rows = (receipts.data ?? []) as ReceiptRow[];
  // Cap real alerts to keep the Evidence section a fixed visual size.
  const alertRows = rows.filter((r) => r.kind === "threat-alert").slice(0, 2);
  const exitRows = rows.filter((r) => r.kind === "withdraw-aave").slice(0, 5).sort((a, b) => b.created_at - a.created_at);
  // Audit log: deposits, manager withdraws, x402 settlements, bounty payouts.
  // Excludes off-chain threat-alert receipts (those are in Evidence) and
  // user-initiated withdrawals (those are user actions, not agent actions).
  const AUDIT_KINDS = new Set(["deposit-aave", "withdraw-aave", "x402-payment", "bounty-paid"]);
  const auditRows = rows.filter((r) => AUDIT_KINDS.has(r.kind)).slice(0, 12).sort((a, b) => b.created_at - a.created_at);
  const totalSavedUsdc = exitRows.reduce((sum, r) => {
    const a = r.payload.amount;
    if (typeof a === "string" || typeof a === "number") return sum + Number(a) / 1e6;
    return sum;
  }, 0);

  // Merge real alerts + mocks, sorted by time (newest first).
  const now = Date.now();
  type Combined =
    | { kind: "real"; ts: number; r: ReceiptRow }
    | { kind: "mock"; ts: number; m: MockEvidence };
  const combinedEvidence: Combined[] = [
    ...alertRows.map((r): Combined => ({ kind: "real", ts: r.created_at, r })),
    ...MOCK_EVIDENCE.map((m): Combined => ({ kind: "mock", ts: now - m.ageMs, m })),
  ].sort((a, b) => b.ts - a.ts);

  const visible = WATCHERS.filter((w) => subbed.has(w.id));

  return (
    <div className="fade-col flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex flex-shrink-0 items-center justify-between border-b border-line bg-panel px-4 py-3">
        <div className="font-mono text-[10px] uppercase tracking-[2px] text-muted">
          // threat watchers
        </div>
        <div className="live-pulse font-mono text-[9px] text-safe">LIVE</div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Active swarm */}
        <Section
          title={`Active swarm · ${visible.filter((w) => w.status === "active").length}/${visible.length}`}
          meta={
            <Link href="/watchers" className="text-dim hover:text-accent">
              manage →
            </Link>
          }
        >
          {visible.length === 0 && (
            <div className="py-2 font-mono text-[10px] text-dim">
              no watchers subscribed —{" "}
              <Link href="/watchers" className="text-accent hover:underline">
                pick some
              </Link>
            </div>
          )}
          {visible.map((w) => (
            <div
              key={w.id}
              className="flex items-center justify-between py-1.5 font-mono text-[11px]"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className={`status-dot ${w.status === "active" ? "" : "idle"}`} />
                <span className="truncate">{w.id}</span>
                {w.deployed && (
                  <span className="flex-shrink-0 text-[9px] uppercase tracking-[1px] text-safe">●live</span>
                )}
              </div>
              <div className="flex-shrink-0 text-[10px] text-dim">{w.shortStatus}</div>
            </div>
          ))}
        </Section>

        {/* Evidence — real receipts merged with mocks, sorted newest first */}
        <Section title="Evidence · Aave v3 USDC">
          {combinedEvidence.length === 0 && (
            <div className="py-2 font-mono text-[10px] text-dim">no evidence yet</div>
          )}
          {combinedEvidence.map((c) =>
            c.kind === "real" ? (
              <EvidenceItem key={`real-${c.r.id}`} r={c.r} />
            ) : (
              <MockEvidenceItem key={`mock-${c.m.source}`} m={c.m} />
            ),
          )}
        </Section>

        {/* Exits triggered */}
        <Section
          title="Exits triggered"
          meta={
            exitRows.length > 0 ? (
              <span className="text-safe">${totalSavedUsdc.toFixed(2)} pulled</span>
            ) : null
          }
        >
          {exitRows.length === 0 && (
            <div className="py-2 font-mono text-[10px] text-dim">
              no exits yet — manager idle
            </div>
          )}
          {exitRows.map((r) => (
            <ExitItem key={r.id} r={r} />
          ))}
        </Section>

        {/* Audit log */}
        <Section title="Swarm audit log" meta={<span className="text-dim">on-chain</span>}>
          {auditRows.length === 0 && (
            <div className="py-2 font-mono text-[10px] text-dim">no receipts yet</div>
          )}
          {auditRows.map((r) => {
            const tx = (r.payload.txHash as string | undefined) ?? null;
            const swarmUrl = swarmHref(r.swarm_ref);
            const time = new Date(r.created_at).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            });
            const action = describeReceipt(r);
            return (
              <div
                key={r.id}
                className="grid grid-cols-[50px_1fr_auto] items-start gap-2.5 py-1.5 font-mono text-[10px]"
              >
                <div className="text-dim">{time}</div>
                <div>{action}</div>
                <div className="flex flex-col items-end gap-0.5">
                  {tx && (
                    <a
                      href={`https://basescan.org/tx/${tx}`}
                      target="_blank"
                      rel="noreferrer"
                      className="cursor-pointer text-accent hover:underline"
                      title="view on Basescan"
                    >
                      tx {tx.slice(0, 6)}…{tx.slice(-2)} ↗
                    </a>
                  )}
                  {swarmUrl ? (
                    <a
                      href={swarmUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="cursor-pointer text-safe hover:underline"
                      title="view receipt on Swarm via bzz.limo"
                    >
                      swarm {shortRef(r.swarm_ref)} ↗
                    </a>
                  ) : (
                    <span className="text-dim">swarm {shortRef(r.swarm_ref)}</span>
                  )}
                </div>
              </div>
            );
          })}
        </Section>
      </div>
    </div>
  );
}

function Section({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-line px-4 py-3.5">
      <div className="mb-2.5 flex items-center justify-between font-mono text-[10px] uppercase tracking-[1.5px] text-muted">
        <span>{title}</span>
        {meta}
      </div>
      {children}
    </div>
  );
}

function EvidenceItem({ r }: { r: ReceiptRow }) {
  const score = (r.payload.score as number | undefined) ?? null;
  const protocol = (r.payload.protocol as string | undefined) ?? "—";
  const swarm = r.swarm_ref;
  const swarmUrl = swarmHref(swarm);
  return (
    <div className="flex flex-col gap-1.5 border-t border-line py-2.5 first-of-type:border-t-0 first-of-type:pt-0">
      <div className="flex items-center justify-between font-mono text-[9px] uppercase tracking-[1.2px] text-muted">
        <div className="inline-flex items-center gap-1.5 text-text">◆ {protocol}</div>
        <div>{ago(r.created_at)}</div>
      </div>
      <div className="text-[12px] leading-[1.45]">
        Threat alert score <span className="text-warn">{score ?? "—"}</span> · alert{" "}
        {(r.payload.alertId as string)?.slice(-12) ?? ""}
      </div>
      <div className="flex gap-3 font-mono text-[9px] text-dim">
        <span className="text-safe">✓ signed</span>
        {swarmUrl ? (
          <a
            href={swarmUrl}
            target="_blank"
            rel="noreferrer"
            className="text-safe hover:underline"
            title="view evidence on Swarm via bzz.limo"
          >
            swarm {shortRef(swarm)} ↗
          </a>
        ) : (
          <span>swarm {shortRef(swarm)}</span>
        )}
      </div>
    </div>
  );
}

function ExitItem({ r }: { r: ReceiptRow }) {
  const tx = (r.payload.txHash as string | undefined) ?? null;
  const amount = formatAmount(r.payload.amount);
  const triggeredBy = (r.payload.triggeredByAlertId as string | undefined) ?? null;
  const swarm = r.swarm_ref;
  const swarmUrl = swarmHref(swarm);
  return (
    <div className="flex flex-col gap-1.5 border-t border-line py-2.5 first-of-type:border-t-0 first-of-type:pt-0">
      <div className="flex items-center justify-between font-mono text-[9px] uppercase tracking-[1.2px] text-muted">
        <div className="inline-flex items-center gap-1.5 text-text">◆ aave-v3 exit</div>
        <div>{ago(r.created_at)}</div>
      </div>
      <div className="text-[12px] leading-[1.45]">
        Pulled <span className="text-safe">{amount} USDC</span> back to vault
        {triggeredBy ? <> · alert <span className="text-warn">{triggeredBy.slice(-12)}</span></> : null}
      </div>
      <div className="flex flex-wrap gap-3 font-mono text-[9px] text-dim">
        {tx ? (
          <a
            href={`https://basescan.org/tx/${tx}`}
            target="_blank"
            rel="noreferrer"
            className="text-accent hover:underline"
          >
            tx {tx.slice(0, 6)}…{tx.slice(-2)} ↗
          </a>
        ) : (
          <span>tx —</span>
        )}
        {swarmUrl ? (
          <a
            href={swarmUrl}
            target="_blank"
            rel="noreferrer"
            className="text-safe hover:underline"
          >
            swarm {shortRef(swarm)} ↗
          </a>
        ) : (
          <span>swarm {shortRef(swarm)}</span>
        )}
      </div>
    </div>
  );
}

function MockEvidenceItem({ m }: { m: MockEvidence }) {
  const label = m.ageMs < 3_600_000 ? `${Math.round(m.ageMs / 60_000)}m` : `${Math.round(m.ageMs / 3_600_000)}h`;
  return (
    <div className="flex flex-col gap-1.5 border-t border-line py-2.5 first-of-type:border-t-0 first-of-type:pt-0">
      <div className="flex items-center justify-between font-mono text-[9px] uppercase tracking-[1.2px] text-muted">
        <div className="inline-flex items-center gap-1.5 text-text">◆ {m.source}</div>
        <div>{label}</div>
      </div>
      <div
        className="text-[12px] leading-[1.45]"
        dangerouslySetInnerHTML={{ __html: m.html }}
      />
      <div className="flex gap-3 font-mono text-[9px] text-dim">
        <span className="text-safe">✓ signed</span>
        <span>{m.footer}</span>
      </div>
    </div>
  );
}

function describeReceipt(r: ReceiptRow): string {
  switch (r.kind) {
    case "deposit-aave":
      return `Deposit → Aave · ${formatAmount(r.payload.amount)} USDC`;
    case "withdraw-aave":
      return `Withdraw ← Aave · ${formatAmount(r.payload.amount)} USDC`;
    case "x402-payment":
      return `x402 paid · ${r.payload.amount} USDC ${r.payload.actor} scrape`;
    case "bounty-paid":
      return `Bounty paid · ${formatAmount(r.payload.amount)} USDC → ${(r.payload.recipient as string)?.split(".")[0] ?? "watcher"}`;
    case "threat-alert":
      return `Threat alert · score ${r.payload.score}`;
    default:
      return r.kind;
  }
}

function formatAmount(a: unknown): string {
  if (typeof a !== "string" && typeof a !== "number") return "—";
  return (Number(a) / 1e6).toFixed(2);
}

