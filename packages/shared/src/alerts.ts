import {
  type Address,
  type Hex,
  hashTypedData,
  recoverAddress,
  isAddressEqual,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

export type Protocol = "aave-v3";
export type SupportedChain = "base";

export interface ThreatAlertPayload {
  /** Stable monotonic id, e.g. `${protocol}-${chain}-${unixSeconds}`. */
  alertId: string;
  protocol: Protocol;
  chain: SupportedChain;
  /** 0–100 aggregated threat score from the watcher. */
  score: number;
  /** Swarm content hash pointing to the evidence bundle. */
  evidenceSwarmRef: string;
  /** Unix seconds, watcher-local time. */
  issuedAt: number;
  /** Recommended action — manager decides whether to act. */
  recommendedAction: "exit" | "monitor";
}

export interface SignedThreatAlert {
  payload: ThreatAlertPayload;
  /** EIP-712 signature from the watcher's EOA. */
  signature: Hex;
}

const ALERT_DOMAIN = {
  name: "Argus",
  version: "1",
} as const;

const ALERT_TYPES = {
  ThreatAlert: [
    { name: "alertId", type: "string" },
    { name: "protocol", type: "string" },
    { name: "chain", type: "string" },
    { name: "score", type: "uint8" },
    { name: "evidenceSwarmRef", type: "string" },
    { name: "issuedAt", type: "uint64" },
    { name: "recommendedAction", type: "string" },
  ],
} as const;

function toMessage(payload: ThreatAlertPayload) {
  return {
    alertId: payload.alertId,
    protocol: payload.protocol,
    chain: payload.chain,
    score: payload.score,
    evidenceSwarmRef: payload.evidenceSwarmRef,
    issuedAt: BigInt(payload.issuedAt),
    recommendedAction: payload.recommendedAction,
  };
}

export function hashAlert(payload: ThreatAlertPayload): Hex {
  return hashTypedData({
    domain: ALERT_DOMAIN,
    types: ALERT_TYPES,
    primaryType: "ThreatAlert",
    message: toMessage(payload),
  });
}

export async function signAlert(
  payload: ThreatAlertPayload,
  privateKey: Hex,
): Promise<SignedThreatAlert> {
  const account = privateKeyToAccount(privateKey);
  const signature = await account.signTypedData({
    domain: ALERT_DOMAIN,
    types: ALERT_TYPES,
    primaryType: "ThreatAlert",
    message: toMessage(payload),
  });
  return { payload, signature };
}

export async function recoverAlertSigner(
  alert: SignedThreatAlert,
): Promise<Address> {
  return recoverAddress({
    hash: hashAlert(alert.payload),
    signature: alert.signature,
  });
}

export async function verifyAlert(
  alert: SignedThreatAlert,
  expectedSigner: Address,
): Promise<boolean> {
  const recovered = await recoverAlertSigner(alert);
  return isAddressEqual(recovered, expectedSigner);
}
