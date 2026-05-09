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

export interface UserWithdrawReceipt extends ReceiptBase {
  kind: "user-withdraw";
  chainId: number;
  txHash: Hex;
  amount: string;
  vault: Address;
  to: Address;
}

export interface X402PaymentReceipt extends ReceiptBase {
  kind: "x402-payment";
  /** "polymarket" | "twitter" | etc. — actor whose call was metered. */
  actor: string;
  /** Decimal USDC paid (string for precision). */
  amount: string;
  /** L2 settlement tx hash on Base. Present only when USE_X402=true and the
   *  x402 wrapper attached settlement headers. Undefined for token-auth calls. */
  txHash?: Hex;
  chainId: number;
}

export interface BountyPaidReceipt extends ReceiptBase {
  kind: "bounty-paid";
  /** ENS name of the watcher receiving the bounty. */
  recipient: AgentName;
  recipientAddress: Address;
  /** Decimal USDC paid out as bounty. */
  amount: string;
  /** Basis points used to compute the payout. */
  rateBps: number;
  /** Saved-capital amount that triggered the bounty (decimal USDC). */
  savedAmount: string;
  /** Alert id that fired the manager-exit, for traceability. */
  triggeredByAlertId: string;
  txHash: Hex;
  chainId: number;
}

export type Receipt =
  | DepositReceipt
  | WithdrawReceipt
  | ThreatAlertReceipt
  | UserWithdrawReceipt
  | X402PaymentReceipt
  | BountyPaidReceipt;
