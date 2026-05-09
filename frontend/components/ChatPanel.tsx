"use client";

import { useEffect, useRef, useState } from "react";
import {
  useAccount,
  useChainId,
  useReadContract,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import { base } from "wagmi/chains";
import { formatUnits, parseUnits } from "viem";
import { BASE_ADDRESSES } from "@argus/shared";
import { erc20Abi, yieldVaultAbi } from "../lib/abi";
import { useManagerHealth } from "../lib/hooks";
import { PUBLIC_ENV } from "../lib/env";

type Msg = { who: "you" | "argus"; html: string; ts: string };

function timeNow() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const VAULT = PUBLIC_ENV.vaultAddress;
const USDC = BASE_ADDRESSES.USDC;
const TX_LINK = (h: string) =>
  `<a href="https://basescan.org/tx/${h}" target="_blank" rel="noreferrer" style="color:#d4a857;text-decoration:underline">${h.slice(0, 10)}…</a>`;

const SUGGESTIONS = [
  { label: "deposit 1 usdc", q: "deposit 1 usdc" },
  { label: "withdraw 0.5", q: "withdraw 0.5" },
  { label: "info", q: "info" },
];

const HELP =
  'Try: <strong>deposit 1 usdc</strong>, <strong>withdraw 0.5</strong>, <strong>info</strong>, or <strong>safest position</strong>. Amounts in USDC.';

export function ChatPanel() {
  const [messages, setMessages] = useState<Msg[]>([
    {
      who: "argus",
      html:
        "I can <strong>deposit</strong>, <strong>withdraw</strong>, or report <strong>info</strong> on your vault on Base. Each on-chain action prompts your wallet.",
      ts: timeNow(),
    },
  ]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const threadRef = useRef<HTMLDivElement | null>(null);

  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const health = useManagerHealth();

  const allowance = useReadContract({
    abi: erc20Abi,
    address: USDC,
    functionName: "allowance",
    args: address ? [address, VAULT] : undefined,
    chainId: base.id,
    query: { enabled: !!address, refetchInterval: 8_000 },
  });

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [messages, pending]);

  function pushAgent(html: string) {
    setMessages((m) => [...m, { who: "argus", html, ts: timeNow() }]);
  }

  async function handleDeposit(amountStr: string) {
    if (!isConnected || !address) return pushAgent("Connect a wallet first.");
    const amount = Number(amountStr);
    if (!isFinite(amount) || amount <= 0) return pushAgent(`Invalid amount: ${amountStr}`);
    if (chainId !== base.id) {
      pushAgent("Switching to Base…");
      try {
        await switchChainAsync({ chainId: base.id });
      } catch {
        return pushAgent("Switch to Base in your wallet, then re-run.");
      }
    }
    const amt = parseUnits(String(amount), 6);
    const current = (allowance.data ?? 0n) as bigint;
    try {
      if (current < amt) {
        pushAgent(`Approving ${amount} USDC for the vault…`);
        const approveTx = await writeContractAsync({
          abi: erc20Abi,
          address: USDC,
          functionName: "approve",
          args: [VAULT, amt],
        });
        pushAgent(`Approve tx: ${TX_LINK(approveTx)}`);
      }
      pushAgent(`Depositing ${amount} USDC…`);
      const depositTx = await writeContractAsync({
        abi: yieldVaultAbi,
        address: VAULT,
        functionName: "deposit",
        args: [amt],
      });
      pushAgent(
        `Deposit tx: ${TX_LINK(depositTx)} — manager will detect the event and supply to Aave shortly.`,
      );
    } catch (e) {
      pushAgent(`error: ${(e as Error).message.slice(0, 200)}`);
    }
  }

  async function handleWithdraw(amountStr: string) {
    if (!isConnected || !address) return pushAgent("Connect a wallet first.");
    const amount = Number(amountStr);
    if (!isFinite(amount) || amount <= 0) return pushAgent(`Invalid amount: ${amountStr}`);
    if (chainId !== base.id) {
      pushAgent("Switching to Base…");
      try {
        await switchChainAsync({ chainId: base.id });
      } catch {
        return pushAgent("Switch to Base in your wallet, then re-run.");
      }
    }
    const amt = parseUnits(String(amount), 6);
    try {
      pushAgent(`Withdrawing ${amount} USDC to your wallet…`);
      const tx = await writeContractAsync({
        abi: yieldVaultAbi,
        address: VAULT,
        functionName: "withdrawToOwner",
        args: [amt],
      });
      pushAgent(
        `Withdraw tx: ${TX_LINK(tx)}. Note: only idle USDC withdraws directly. If funds are in Aave, ask manager to exit first.`,
      );
    } catch (e) {
      pushAgent(`error: ${(e as Error).message.slice(0, 200)}`);
    }
  }

  function handleInfo() {
    const h = health.data;
    if (!h) {
      pushAgent("Manager unreachable on :4001. Is the agent running?");
      return;
    }
    const idle = Number(formatUnits(BigInt(h.balances.idleUsdc), 6)).toFixed(2);
    const supplied = Number(formatUnits(BigInt(h.balances.suppliedUsdc), 6)).toFixed(2);
    pushAgent(
      [
        `Vault <strong>${h.vault.slice(0, 8)}…${h.vault.slice(-4)}</strong> on Base`,
        `Idle: <strong>${idle} USDC</strong>`,
        `In Aave: <strong>${supplied} USDC</strong>`,
        `Manager: ${h.agent} (${h.address.slice(0, 8)}…)`,
        `Watcher: ${h.watcherEns} (${h.watcherAddress?.slice(0, 8) ?? "—"}…)`,
      ].join("<br/>"),
    );
  }

  async function dispatch(text: string) {
    const m = text.toLowerCase().trim();
    const dep = m.match(/(?:^|\b)deposit\s+([\d.]+)/);
    if (dep) return handleDeposit(dep[1]!);
    const wd = m.match(/(?:^|\b)withdraw\s+([\d.]+)/);
    if (wd) return handleWithdraw(wd[1]!);
    if (m === "info" || m.startsWith("info ") || m === "status" || m === "vault") {
      return handleInfo();
    }
    if (m.includes("safest")) {
      return pushAgent(
        "Aave v3 USDC on Base — Argus score <strong>92</strong>. Polymarket hack odds 2%, no whale exits flagged.",
      );
    }
    if (m.includes("rebalance")) {
      return pushAgent(
        "Only one active position right now (Aave v3 USDC). Rebalance unavailable until additional pools are wired.",
      );
    }
    if (m.includes("exit")) {
      return pushAgent(
        "To fully exit: I'll route your funds out of Aave (manager EOA) and back into the vault, then you can <strong>withdraw</strong>. Try <em>withdraw &lt;amount&gt;</em>.",
      );
    }
    pushAgent(HELP);
  }

  async function send(text: string) {
    if (!text.trim()) return;
    setMessages((m) => [...m, { who: "you", html: escapeHtml(text), ts: timeNow() }]);
    setInput("");
    setPending(true);
    try {
      await dispatch(text);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="fade-col flex flex-col overflow-hidden">
      <div className="flex flex-shrink-0 items-center justify-between border-b border-line bg-panel px-4 py-3">
        <div className="font-mono text-[10px] uppercase tracking-[2px] text-muted">
          // agent · {PUBLIC_ENV.managerEns}
        </div>
        <div className="font-mono text-[10px] text-dim">
          {isConnected ? "wallet connected" : "wallet not connected"}
        </div>
      </div>

      <div ref={threadRef} className="flex flex-1 flex-col gap-[18px] overflow-y-auto px-4 py-5">
        {messages.map((m, i) => (
          <div key={i} className="flex flex-col gap-1">
            <div className="font-mono text-[9px] uppercase tracking-[1.2px] text-dim">
              {m.who} · {m.ts}
            </div>
            {m.who === "you" ? (
              <div
                className="rounded-[2px] border border-line-2 px-3 py-2.5 text-[13px]"
                dangerouslySetInnerHTML={{ __html: m.html }}
              />
            ) : (
              <div
                className="px-0 py-0.5 text-[13px] [&_strong]:font-semibold [&_em]:italic"
                dangerouslySetInnerHTML={{ __html: m.html }}
              />
            )}
          </div>
        ))}
        {pending && (
          <div className="flex flex-col gap-1">
            <div className="font-mono text-[9px] uppercase tracking-[1.2px] text-dim">argus · now</div>
            <div className="px-0 py-0.5">
              <span className="typing">
                <span /> <span /> <span />
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="flex-shrink-0 border-t border-line bg-panel px-4 py-3.5">
        <div className="flex items-center gap-2 rounded-[2px] border border-line-2 bg-bg px-2.5 py-2 transition-colors focus-within:border-accent">
          <span className="select-none font-mono text-[12px] text-accent">›</span>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") send(input);
            }}
            placeholder="deposit 1 usdc · withdraw 0.5 · info"
            className="flex-1 bg-transparent text-[13px] text-text outline-none placeholder:text-dim"
          />
        </div>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button
              key={s.label}
              onClick={() => send(s.q)}
              className="cursor-pointer rounded-full border border-line-2 px-2.5 py-1 font-mono text-[10px] text-muted transition-all hover:border-accent hover:text-accent"
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
