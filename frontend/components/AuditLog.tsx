"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchReceipts, type ReceiptRow } from "../lib/manager-api";

function explorerLink(txHash: string) {
  return `https://basescan.org/tx/${txHash}`;
}
function swarmLink(ref: string) {
  if (ref.startsWith("stub:")) return null;
  return `https://bzz.limo/bytes/${ref}`;
}

function ReceiptItem({ r }: { r: ReceiptRow }) {
  const p = r.payload as Record<string, unknown>;
  const tx = (p.txHash as string | undefined) ?? null;
  const swarm = r.swarm_ref;
  const time = new Date(r.created_at).toLocaleTimeString();
  const triggered = p.triggeredByAlertId as string | undefined;

  return (
    <li className="border-b border-neutral-800 py-3 last:border-0">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium">{r.kind}</span>
        <span className="text-xs text-neutral-500">{time}</span>
      </div>
      {p.amount ? (
        <div className="text-xs text-neutral-400">
          amount: <span className="font-mono">{(Number(p.amount) / 1e6).toFixed(6)} USDC</span>
        </div>
      ) : null}
      {p.score !== undefined ? (
        <div className="text-xs text-neutral-400">
          score: <span className="font-mono">{Number(p.score)}</span>
        </div>
      ) : null}
      {triggered && (
        <div className="text-xs text-amber-400">triggered by alert: {triggered}</div>
      )}
      <div className="mt-1 flex flex-wrap gap-3 text-xs">
        {tx && (
          <a href={explorerLink(tx)} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">
            basescan ↗
          </a>
        )}
        {swarm && swarmLink(swarm) && (
          <a href={swarmLink(swarm)!} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">
            evidence (swarm) ↗
          </a>
        )}
      </div>
    </li>
  );
}

export function AuditLog() {
  const { data, error } = useQuery({
    queryKey: ["receipts"],
    queryFn: fetchReceipts,
    refetchInterval: 4_000,
  });

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-5">
      <h3 className="mb-2 text-base font-semibold">Audit log</h3>
      {error && <div className="text-sm text-red-400">manager unreachable</div>}
      {data && data.length === 0 && (
        <div className="text-sm text-neutral-500">no receipts yet</div>
      )}
      <ul>
        {data?.map((r) => <ReceiptItem key={r.id} r={r} />)}
      </ul>
    </div>
  );
}
