"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchManagerHealth } from "../lib/manager-api";

const fmt = (raw: string) => (Number(raw) / 1e6).toFixed(4);

export function VaultStatus() {
  const { data, error } = useQuery({
    queryKey: ["manager-health"],
    queryFn: fetchManagerHealth,
    refetchInterval: 5_000,
  });

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-5">
      <h3 className="mb-3 text-base font-semibold">Vault status</h3>
      {error && <div className="text-sm text-red-400">manager unreachable</div>}
      {data && (
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-neutral-500">Idle USDC</dt>
            <dd className="font-mono">{fmt(data.balances.idleUsdc)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-neutral-500">In Aave (aUSDC)</dt>
            <dd className="font-mono">{fmt(data.balances.suppliedUsdc)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-neutral-500">Vault</dt>
            <dd className="font-mono text-xs">
              {data.vault.slice(0, 8)}…{data.vault.slice(-6)}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-neutral-500">Watcher resolved</dt>
            <dd className="font-mono text-xs">
              {data.watcherAddress
                ? `${data.watcherAddress.slice(0, 8)}…${data.watcherAddress.slice(-6)}`
                : "—"}
            </dd>
          </div>
        </dl>
      )}
    </div>
  );
}
