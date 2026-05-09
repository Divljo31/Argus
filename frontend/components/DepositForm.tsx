"use client";

import { useState } from "react";
import { useAccount, useChainId, useReadContract, useSwitchChain, useWriteContract } from "wagmi";
import { base } from "wagmi/chains";
import { parseUnits, formatUnits } from "viem";
import { BASE_ADDRESSES } from "@argus/shared";
import { erc20Abi, yieldVaultAbi } from "../lib/abi";
import { PUBLIC_ENV } from "../lib/env";

const VAULT = PUBLIC_ENV.vaultAddress;
const USDC = BASE_ADDRESSES.USDC;

export function DepositForm() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const { writeContractAsync, isPending } = useWriteContract();
  const [amount, setAmount] = useState("10");
  const [status, setStatus] = useState<string | null>(null);

  const usdcBalance = useReadContract({
    abi: erc20Abi,
    address: USDC,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: base.id,
    query: { enabled: !!address, refetchInterval: 10_000 },
  });

  const allowance = useReadContract({
    abi: erc20Abi,
    address: USDC,
    functionName: "allowance",
    args: address ? [address, VAULT] : undefined,
    chainId: base.id,
    query: { enabled: !!address, refetchInterval: 10_000 },
  });

  async function deposit() {
    if (!address) return;
    if (chainId !== base.id) {
      await switchChain({ chainId: base.id });
      return;
    }
    setStatus(null);
    const amt = parseUnits(amount || "0", 6);
    const currentAllowance = (allowance.data ?? 0n) as bigint;
    try {
      if (currentAllowance < amt) {
        setStatus("Approving USDC…");
        await writeContractAsync({
          abi: erc20Abi,
          address: USDC,
          functionName: "approve",
          args: [VAULT, amt],
        });
      }
      setStatus("Depositing to vault…");
      const tx = await writeContractAsync({
        abi: yieldVaultAbi,
        address: VAULT,
        functionName: "deposit",
        args: [amt],
      });
      setStatus(`tx: ${tx.slice(0, 10)}… — manager will supply to Aave shortly`);
    } catch (e) {
      setStatus(`error: ${(e as Error).message}`);
    }
  }

  async function withdraw() {
    if (!address) return;
    if (chainId !== base.id) {
      await switchChain({ chainId: base.id });
      return;
    }
    const amt = parseUnits(amount || "0", 6);
    setStatus("Withdrawing to owner…");
    try {
      const tx = await writeContractAsync({
        abi: yieldVaultAbi,
        address: VAULT,
        functionName: "withdrawToOwner",
        args: [amt],
      });
      setStatus(`tx: ${tx.slice(0, 10)}…`);
    } catch (e) {
      setStatus(`error: ${(e as Error).message}`);
    }
  }

  if (!isConnected) {
    return (
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-5 text-sm text-neutral-400">
        Connect a wallet to deposit USDC.
      </div>
    );
  }

  const usdc =
    usdcBalance.data !== undefined ? formatUnits(usdcBalance.data as bigint, 6) : "—";

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-base font-semibold">Deposit USDC</h3>
        <span className="text-xs text-neutral-500">balance: {usdc}</span>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          step="0.000001"
          min="0"
          className="flex-1 rounded border border-neutral-700 bg-black/40 px-3 py-2 font-mono text-sm"
        />
        <span className="text-sm text-neutral-500">USDC</span>
      </div>
      <div className="mt-3 flex gap-2">
        <button
          onClick={deposit}
          disabled={isPending}
          className="flex-1 rounded bg-white px-3 py-2 text-sm font-medium text-black hover:bg-neutral-200 disabled:opacity-50"
        >
          {isPending ? "…" : "Deposit"}
        </button>
        <button
          onClick={withdraw}
          disabled={isPending}
          className="flex-1 rounded border border-neutral-700 px-3 py-2 text-sm hover:bg-neutral-800 disabled:opacity-50"
        >
          Withdraw
        </button>
      </div>
      {status && <div className="mt-3 text-xs text-neutral-400">{status}</div>}
    </div>
  );
}
