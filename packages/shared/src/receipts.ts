import type { Address, Hex } from "viem";

export type AgentName = `${string}.${string}`;

interface ReceiptBase {
  agent: AgentName;
  agentAddress: Address;
  timestamp: number;
}

export interface DepositReceipt extends ReceiptBase {
  kind: "deposit-aave";
  chainId: number;
  txHash: Hex;
  amount: string; // decimal USDC string
  vault: Address;
}

export interface WithdrawReceipt extends ReceiptBase {
  kind: "withdraw-aave";
  chainId: number;
  txHash: Hex;
  amount: string;
  vault: Address;
  triggeredByAlertId: string | null;
}

export interface ThreatAlertReceipt extends ReceiptBase {
  kind: "threat-alert";
  alertId: string;
  protocol: string;
  chain: string;
  score: number;
  evidenceSwarmRef: string;
}

export type Receipt = DepositReceipt | WithdrawReceipt | ThreatAlertReceipt;
