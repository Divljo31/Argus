"use client";

import { useState } from "react";
import { formatUnits } from "viem";
import { useManagerHealth, useVaultTotalAssets, useAaveSupplyApy } from "../lib/hooks";
import { PUBLIC_ENV } from "../lib/env";
import { DepositForm } from "./DepositForm";

function fmtUsdc(s: string | bigint | undefined) {
  if (s === undefined) return "—";
  const v = typeof s === "string" ? BigInt(s) : s;
  return Number(formatUnits(v, 6)).toFixed(2);
}

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

interface VaultRow {
  id: string;
  name: string;
  chain: string;
  addr: string;
  apy: string;
  position: string;
  yield: string;
  threat: number;
  threatLabel: "low" | "med" | "high";
  active: boolean;
}

export function PortfolioPanel() {
  const health = useManagerHealth();
  const total = useVaultTotalAssets();
  const { apy: liveApy } = useAaveSupplyApy();
  const [showDeposit, setShowDeposit] = useState(false);

  const totalUsdc = total.data !== undefined ? Number(formatUnits(total.data as bigint, 6)) : null;
  const liveApyStr = liveApy !== null ? `${liveApy.toFixed(2)}%` : "—";
  const hasPosition = totalUsdc !== null && totalUsdc > 0;

  const liveRow: VaultRow = {
    id: "aave-base",
    name: "Aave v3 USDC",
    chain: "Base",
    addr: PUBLIC_ENV.vaultAddress,
    apy: liveApyStr,
    position: totalUsdc !== null ? `$${totalUsdc.toFixed(2)}` : "—",
    yield: "+$0.00",
    threat: 92,
    threatLabel: "low",
    active: true,
  };

  const rows: VaultRow[] = hasPosition ? [liveRow] : [];

  return (
    <div className="fade-col flex flex-col overflow-hidden">
      <div className="flex flex-shrink-0 items-center justify-between border-b border-line bg-panel px-4 py-3">
        <div className="font-mono text-[10px] uppercase tracking-[2px] text-muted">// portfolio</div>
        <div className="font-mono text-[10px] text-dim">
          {health.isFetching ? "syncing…" : "last sync just now"}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-5 pt-4">
        {/* Hero */}
        <div className="mb-4 flex items-end justify-between gap-6">
          <div>
            <div className="font-mono text-[9px] uppercase tracking-[2px] text-muted">Total Value</div>
            <div className="font-serif text-[36px] leading-none tracking-[-0.5px]">
              ${totalUsdc !== null ? totalUsdc.toFixed(0) : "0"}
              <span className="text-muted text-[20px]">
                .{totalUsdc !== null ? totalUsdc.toFixed(2).split(".")[1] : "00"}
              </span>
            </div>
            <div className="mt-1 font-mono text-[10px] text-safe">
              {hasPosition ? "▲ $0.00 · 0% · live" : "no open positions"}
            </div>
          </div>
          <Sparkline />
        </div>

        {/* Open positions */}
        {hasPosition ? (
          <>
            <div className="mb-4 flex flex-col overflow-hidden rounded-[3px] border border-line">
              <div className="grid grid-cols-[1.4fr_0.7fr_0.7fr_0.7fr_0.9fr_24px] gap-3 border-b border-line bg-panel px-3.5 py-1.5 font-mono text-[9px] uppercase tracking-[1.5px] text-muted">
                <div>Pool</div>
                <div>APY</div>
                <div>Position</div>
                <div>Yield</div>
                <div>Threat</div>
                <div />
              </div>
              {rows.map((r) => (
                <div
                  key={r.id}
                  className="grid grid-cols-[1.4fr_0.7fr_0.7fr_0.7fr_0.9fr_24px] items-center gap-3 border-l-2 border-accent bg-panel-2 px-3.5 py-2 pl-3 text-left"
                >
                  <div className="flex items-center gap-2">
                    <div className="flex h-5 w-5 items-center justify-center rounded-[3px] border border-line-2 bg-bg font-mono text-[9px] font-semibold text-muted">
                      {r.name[0]}
                    </div>
                    <div>
                      <div className="text-[12px]">{r.name}</div>
                      <div className="font-mono text-[9px] uppercase tracking-[1px] text-dim">
                        {r.chain} · {shortAddr(r.addr)}
                      </div>
                    </div>
                  </div>
                  <div className="font-mono text-[11px] text-safe">{r.apy}</div>
                  <div className="font-mono text-[11px]">{r.position}</div>
                  <div className="font-mono text-[11px]">{r.yield}</div>
                  <div className="font-mono text-[11px]">
                    <ThreatMeter score={r.threat} band={r.threatLabel} />
                  </div>
                  <div className="font-mono text-[12px] text-muted">›</div>
                </div>
              ))}
            </div>

            {/* Vault detail */}
            <div className="overflow-hidden rounded-[3px] border border-line">
              <div className="flex items-start justify-between border-b border-line bg-panel px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="font-serif text-[18px]">{liveRow.name}</div>
                  <div className="mt-0.5 truncate font-mono text-[10px] text-muted">
                    {shortAddr(liveRow.addr)} · {liveRow.chain}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-[9px] uppercase tracking-[1.5px] text-muted">
                    Argus Score
                  </div>
                  <div className="mt-0.5 font-mono text-[22px] font-medium leading-none text-safe">
                    {liveRow.threat}
                    <span className="text-[12px] text-muted">/100</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2">
                <DetailCell label="Net APY" value={liveRow.apy} cls="text-safe" />
                <DetailCell
                  label="Vault Idle"
                  value={
                    health.data ? `${fmtUsdc(health.data.balances.idleUsdc)} USDC` : "—"
                  }
                />
                <DetailCell
                  label="In Aave"
                  value={
                    health.data ? `${fmtUsdc(health.data.balances.suppliedUsdc)} USDC` : "—"
                  }
                />
                <DetailCell label="Time Live" value="0d" />
              </div>

              <div className="px-4 py-3">
                <div className="mb-2 font-mono text-[9px] uppercase tracking-[1.5px] text-muted">
                  Score breakdown · live signals from watchers
                </div>
                <div className="flex flex-col gap-1.5">
                  <ScoreRow label="Polymarket hack odds" pct={4} valLabel="2%" />
                  <ScoreRow label="Social sentiment X/Reddit" pct={62} valLabel="+62" delay={0.1} />
                  <ScoreRow label="On-chain anomalies" pct={6} valLabel="none" delay={0.2} />
                  <ScoreRow
                    label="Telegram whale exits"
                    pct={24}
                    valLabel="low"
                    cls="warn"
                    delay={0.3}
                  />
                  <ScoreRow label="Audit / code freshness" pct={95} valLabel="+95" delay={0.4} />
                </div>
              </div>

              <div className="border-t border-line p-3">
                <button
                  onClick={() => setShowDeposit((s) => !s)}
                  className="w-full cursor-pointer border border-accent bg-accent px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-[1.5px] text-bg transition-colors hover:bg-[#e0b865]"
                >
                  {showDeposit ? "Hide deposit" : "Deposit / Withdraw"}
                </button>
                {showDeposit && (
                  <div className="mt-2">
                    <DepositForm />
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          <EmptyPositions
            apyStr={liveApyStr}
            showDeposit={showDeposit}
            onToggle={() => setShowDeposit((s) => !s)}
          />
        )}
      </div>
    </div>
  );
}

function EmptyPositions({
  apyStr,
  showDeposit,
  onToggle,
}: {
  apyStr: string;
  showDeposit: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="overflow-hidden rounded-[3px] border border-dashed border-line-2 bg-panel-2/40">
      <div className="px-5 py-7 text-center">
        <div className="font-serif text-[20px] text-text">No open positions</div>
        <div className="mt-1.5 font-mono text-[10px] text-muted">
          deposit USDC and the manager parks it in Aave v3 on Base
        </div>
        <div className="mt-4 inline-flex items-center gap-3 rounded-[3px] border border-line bg-panel px-3.5 py-2 font-mono text-[11px]">
          <span className="text-muted">Aave v3 USDC · Base</span>
          <span className="h-3 w-px bg-line-2" />
          <span className="text-safe">{apyStr} APY</span>
          <span className="h-3 w-px bg-line-2" />
          <span className="text-safe">score 92</span>
        </div>
      </div>
      <div className="border-t border-line p-3">
        <button
          onClick={onToggle}
          className="w-full cursor-pointer border border-accent bg-accent px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-[1.5px] text-bg transition-colors hover:bg-[#e0b865]"
        >
          {showDeposit ? "Hide deposit" : "Open a position"}
        </button>
        {showDeposit && (
          <div className="mt-2">
            <DepositForm />
          </div>
        )}
      </div>
    </div>
  );
}

function DetailCell({ label, value, cls = "" }: { label: string; value: string; cls?: string }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-line px-4 py-2.5 [&:nth-child(odd)]:border-r [&:nth-child(odd)]:border-line">
      <div className="font-mono text-[9px] uppercase tracking-[1.5px] text-muted">{label}</div>
      <div className={`font-mono text-[12px] ${cls}`}>{value}</div>
    </div>
  );
}

function ScoreRow({
  label,
  pct,
  valLabel,
  cls,
  delay = 0,
}: {
  label: string;
  pct: number;
  valLabel: string;
  cls?: "warn" | "danger";
  delay?: number;
}) {
  const valColor = cls === "warn" ? "text-warn" : cls === "danger" ? "text-threat" : "text-safe";
  return (
    <div className="grid grid-cols-[160px_1fr_60px] items-center gap-3 font-mono text-[11px]">
      <div className="text-muted">{label}</div>
      <div className="h-1 overflow-hidden rounded-sm bg-line">
        <div
          className={`vb-fill ${cls ?? ""}`}
          style={{ width: `${pct}%`, animationDelay: `${delay}s` }}
        />
      </div>
      <div className={`text-right ${valColor}`}>{valLabel}</div>
    </div>
  );
}

function ThreatMeter({ score, band }: { score: number; band: "low" | "med" | "high" }) {
  const filled = band === "low" ? 1 : band === "med" ? 2 : 4;
  const color = band === "low" ? "bg-safe" : band === "med" ? "bg-warn" : "bg-threat";
  const numColor = band === "low" ? "text-safe" : band === "med" ? "text-warn" : "text-threat";
  return (
    <div className="flex items-center gap-2">
      <div className="flex gap-0.5">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={`block h-3 w-1 rounded-[1px] ${i < filled ? color : "bg-line-2"}`}
          />
        ))}
      </div>
      <div className={`font-mono text-[11px] ${numColor}`}>{score}</div>
    </div>
  );
}

function Sparkline() {
  return (
    <svg className="h-[70px] max-w-[280px] flex-1" viewBox="0 0 280 70" preserveAspectRatio="none">
      <defs>
        <linearGradient id="spark-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#8fb88a" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#8fb88a" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d="M0,55 L20,52 L40,48 L60,50 L80,42 L100,44 L120,38 L140,32 L160,34 L180,28 L200,24 L220,22 L240,18 L260,14 L280,10 L280,70 L0,70 Z"
        fill="url(#spark-grad)"
      />
      <path
        d="M0,55 L20,52 L40,48 L60,50 L80,42 L100,44 L120,38 L140,32 L160,34 L180,28 L200,24 L220,22 L240,18 L260,14 L280,10"
        fill="none"
        stroke="#8fb88a"
        strokeWidth="1.2"
      />
    </svg>
  );
}
