"use client";

import { useAccount, useConnect, useDisconnect } from "wagmi";

export function WalletConnect() {
  const { address, isConnected } = useAccount();
  const { connectors, connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();

  if (isConnected && address) {
    return (
      <button
        onClick={() => disconnect()}
        className="cursor-pointer rounded-full border border-line-2 px-3 py-1.5 font-mono text-[11px] hover:border-accent hover:text-accent"
        title="disconnect"
      >
        {address.slice(0, 6)}…{address.slice(-4)}
      </button>
    );
  }

  const c = connectors[0];
  if (!c) return null;
  return (
    <button
      onClick={() => connect({ connector: c })}
      disabled={isPending}
      className="cursor-pointer rounded-full border border-accent bg-accent px-3 py-1.5 font-mono text-[11px] font-semibold text-bg hover:bg-[#e0b865] disabled:opacity-50"
    >
      {isPending ? "…" : "Connect"}
    </button>
  );
}
