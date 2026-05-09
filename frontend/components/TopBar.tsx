"use client";

import Link from "next/link";
import { SauronEye } from "./SauronEye";
import { PUBLIC_ENV } from "../lib/env";
import { WalletConnect } from "./WalletConnect";

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function TopBar() {
  return (
    <div className="argus-top-shadow relative flex flex-shrink-0 items-center justify-between border-b border-line bg-panel px-5 py-3.5">
      <div className="flex items-center gap-3">
        <SauronEye className="h-8 w-8 flex-shrink-0" />
        <div className="font-serif text-[22px] tracking-[0.5px]">argus</div>
        <div className="ml-1 border-l border-line-2 pl-3 font-mono text-[10px] uppercase tracking-[1.5px] text-muted">
          all-seeing yield agent
        </div>
      </div>

      <div className="flex items-center gap-5">
        <Link
          href="/build"
          className="font-mono text-[10px] uppercase tracking-[1.5px] text-muted hover:text-accent"
        >
          build a watcher ↗
        </Link>
        <Link
          href="/watchers"
          className="font-mono text-[10px] uppercase tracking-[1.5px] text-muted hover:text-accent"
        >
          watcher swarm ↗
        </Link>
        <div className="flex items-center gap-2 rounded-full border border-line-2 px-3 py-1.5 font-mono text-[11px]">
          <span className="chain-dot" />
          Base · {shortAddr(PUBLIC_ENV.vaultAddress)}
        </div>
        <WalletConnect />
      </div>
    </div>
  );
}
