import { PUBLIC_ENV } from "./env";

export interface ManagerHealth {
  agent: string;
  address: `0x${string}`;
  vault: `0x${string}`;
  watcherEns: string;
  watcherAddress: `0x${string}` | null;
  balances: { idleUsdc: string; suppliedUsdc: string };
}

export interface ReceiptRow {
  id: number;
  kind: string;
  payload: Record<string, unknown>;
  swarm_ref: string | null;
  created_at: number;
}

export async function fetchManagerHealth(): Promise<ManagerHealth> {
  const res = await fetch(`${PUBLIC_ENV.managerUrl}/health`, { cache: "no-store" });
  if (!res.ok) throw new Error(`manager /health: ${res.status}`);
  return res.json();
}

export async function fetchReceipts(): Promise<ReceiptRow[]> {
  const res = await fetch(`${PUBLIC_ENV.managerUrl}/receipts`, { cache: "no-store" });
  if (!res.ok) throw new Error(`manager /receipts: ${res.status}`);
  return res.json();
}
