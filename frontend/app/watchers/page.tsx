"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { WATCHERS, getSubscribedIds, setSubscribedIds, type WatcherDef } from "../../lib/watchers";

export default function WatchersPage() {
  const [subbed, setSubbed] = useState<Set<string>>(new Set());
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setSubbed(getSubscribedIds());
    setMounted(true);
  }, []);

  function toggle(id: string) {
    const next = new Set(subbed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSubbed(next);
    setSubscribedIds(next);
  }

  const totalEarned = WATCHERS.reduce((s, w) => s + w.lifetimeEarnedUsdc, 0);
  const totalTriggers = WATCHERS.reduce((s, w) => s + w.triggers, 0);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-bg text-text">
      <header className="argus-top-shadow relative flex flex-shrink-0 items-center justify-between border-b border-line bg-panel px-5 py-3.5">
        <div className="flex items-center gap-4">
          <Link href="/" className="font-mono text-[11px] text-muted hover:text-accent">
            ‹ back to dashboard
          </Link>
          <div className="border-l border-line-2 pl-4 font-serif text-[22px]">
            Watcher Swarm
          </div>
          <div className="font-mono text-[10px] uppercase tracking-[1.5px] text-muted">
            argus.divljo.eth
          </div>
        </div>
        <div className="flex items-center gap-7">
          <Stat label="Active" value={`${WATCHERS.filter((w) => w.status === "active").length}/${WATCHERS.length}`} />
          <Stat label="Triggers" value={String(totalTriggers)} />
          <Stat label="Bounties paid" value={`$${totalEarned.toFixed(2)}`} kind="up" />
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-8 py-8">
        <div className="mx-auto max-w-5xl">
          <div className="mb-6 flex items-end justify-between">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[2px] text-muted">
                // available watchers
              </div>
              <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-muted">
                Each watcher is an autonomous agent with its own ENS identity and EOA. Subscribed
                watchers contribute to your <span className="text-text">ThreatScore</span>. When
                their signal triggers an exit that saves capital, they earn a bounty in basis
                points of the saved amount.
              </p>
            </div>
            {mounted && (
              <div className="font-mono text-[11px] text-muted">
                {subbed.size}/{WATCHERS.length} subscribed
              </div>
            )}
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {WATCHERS.map((w) => (
              <WatcherCard
                key={w.id}
                w={w}
                subscribed={mounted && subbed.has(w.id)}
                onToggle={() => toggle(w.id)}
              />
            ))}
          </div>

          <div className="mt-8 rounded-[3px] border border-line bg-panel-2 px-5 py-4 font-mono text-[11px] text-muted">
            <div className="mb-2 text-[10px] uppercase tracking-[1.5px] text-text">
              How bounties work
            </div>
            <ul className="space-y-1 leading-relaxed">
              <li>
                ◆ Each watcher signs evidence with its ENS-bound EOA. Manager verifies via live ENS lookup.
              </li>
              <li>
                ◆ When a signal triggers an exit, the manager records the saved capital in the receipt.
              </li>
              <li>
                ◆ At settlement, bounty = <span className="text-warn">rewardRateBps / 10000</span> × saved amount.
              </li>
              <li>
                ◆ Paid in USDC to the watcher EOA. Reflected in &quot;Bounties paid&quot; above.
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, kind }: { label: string; value: string; kind?: "up" }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="font-mono text-[9px] uppercase tracking-[1.5px] text-muted">{label}</div>
      <div className={`font-mono text-[14px] font-medium ${kind === "up" ? "text-safe" : ""}`}>
        {value}
      </div>
    </div>
  );
}

function WatcherCard({
  w,
  subscribed,
  onToggle,
}: {
  w: WatcherDef;
  subscribed: boolean;
  onToggle: () => void;
}) {
  const ensProfile = `https://app.ens.domains/${w.ens}`;
  const statusColor =
    w.status === "active" ? "text-safe" : w.status === "idle" ? "text-muted" : "text-threat";
  const dotClass = w.status === "active" ? "status-dot" : "status-dot idle";
  return (
    <div className="rounded-[3px] border border-line bg-panel-2 p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={dotClass} />
            <div className="truncate font-mono text-[12px]">{w.ens}</div>
            {w.deployed && (
              <span className="flex-shrink-0 rounded-full border border-safe/40 bg-safe/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[1px] text-safe">
                deployed
              </span>
            )}
          </div>
          <div className="mt-2 text-[12px] leading-relaxed text-muted">{w.description}</div>
        </div>
        <button
          onClick={onToggle}
          className={[
            "flex-shrink-0 cursor-pointer border px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[1px] transition-all",
            subscribed
              ? "border-accent bg-accent text-bg hover:bg-[#e0b865]"
              : "border-line-2 text-muted hover:border-accent hover:text-accent",
          ].join(" ")}
        >
          {subscribed ? "Subscribed" : "Subscribe"}
        </button>
      </div>

      <div className="grid grid-cols-3 border-t border-line pt-3 font-mono text-[11px]">
        <Cell label="Source" value={w.source} />
        <Cell label="Status" value={w.shortStatus} cls={statusColor} />
        <Cell label="Triggers" value={String(w.triggers)} />
        <Cell label="Reward rate" value={`${w.rewardRateBps} bps`} />
        <Cell label="Earned" value={`$${w.lifetimeEarnedUsdc.toFixed(2)}`} cls="text-safe" />
        <Cell
          label="ENS"
          value={
            <a
              href={ensProfile}
              target="_blank"
              rel="noreferrer"
              className="text-accent hover:underline"
            >
              view ↗
            </a>
          }
        />
      </div>
    </div>
  );
}

function Cell({
  label,
  value,
  cls = "",
}: {
  label: string;
  value: React.ReactNode;
  cls?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 py-1.5 [&:not(:nth-child(3n))]:border-r [&:not(:nth-child(3n))]:border-line [&:not(:nth-child(3n))]:pr-3 [&:nth-child(n+4)]:pt-3 [&:nth-child(n+2)]:pl-3 [&:nth-child(3n+1)]:pl-0">
      <div className="text-[9px] uppercase tracking-[1.2px] text-dim">{label}</div>
      <div className={`text-[12px] ${cls}`}>{value}</div>
    </div>
  );
}
