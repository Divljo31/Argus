"use client";

import { useQuery } from "@tanstack/react-query";
import { useBalance } from "wagmi";
import { base } from "wagmi/chains";
import { readAgentRecords } from "../lib/ens";

interface Props {
  ensName: string;
}

export function AgentCard({ ensName }: Props) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["ens", ensName],
    queryFn: () => readAgentRecords(ensName),
    staleTime: 30_000,
  });

  const balance = useBalance({
    address: data?.address ?? undefined,
    chainId: base.id,
    query: { enabled: !!data?.address, refetchInterval: 15_000 },
  });

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-5">
      <div className="flex items-center gap-3">
        {data?.avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={data.avatar} alt="" className="h-10 w-10 rounded-full" />
        ) : (
          <div className="h-10 w-10 rounded-full bg-neutral-700" />
        )}
        <div>
          <div className="font-mono text-sm text-neutral-300">{ensName}</div>
          <div className="text-xs uppercase tracking-wide text-neutral-500">
            {data?.context?.role ?? "agent"}
          </div>
        </div>
      </div>

      {isLoading && <div className="mt-4 text-sm text-neutral-500">resolving…</div>}
      {error && (
        <div className="mt-4 text-sm text-red-400">ENS resolution failed: {String(error)}</div>
      )}

      {data && (
        <>
          <p className="mt-3 text-sm text-neutral-300">
            {data.description ?? "(no description set)"}
          </p>
          {data.address && (
            <div className="mt-3 font-mono text-xs text-neutral-500">
              {data.address.slice(0, 8)}…{data.address.slice(-6)}
            </div>
          )}
          {data.context?.capabilities && data.context.capabilities.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {data.context.capabilities.map((c) => (
                <span
                  key={c}
                  className="rounded-full border border-neutral-700 px-2 py-0.5 text-xs text-neutral-300"
                >
                  {c}
                </span>
              ))}
            </div>
          )}
          {Object.keys(data.endpoints).length > 0 && (
            <div className="mt-3 space-y-1 text-xs text-neutral-500">
              {Object.entries(data.endpoints).map(([proto, url]) => (
                <div key={proto} className="flex items-baseline gap-2">
                  <span className="rounded bg-neutral-800 px-1.5 py-0.5 font-mono uppercase">
                    {proto}
                  </span>
                  <span className="truncate font-mono text-neutral-400">{url}</span>
                </div>
              ))}
            </div>
          )}
          {balance.data && (
            <div className="mt-4 flex items-baseline justify-between border-t border-neutral-800 pt-3">
              <span className="text-xs text-neutral-500">Base ETH</span>
              <span className="font-mono text-sm">
                {Number(balance.data.formatted).toFixed(4)} {balance.data.symbol}
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
