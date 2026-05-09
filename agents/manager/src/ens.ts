import type { Address } from "viem";
import { resolveAgent, type AgentRecords } from "@argus/shared";
import { ensClient } from "./clients.js";
import { logger } from "./logger.js";

/**
 * Full ENSIP-26 agent record read for a peer (the watcher, in our case).
 * Used both for the signature check (we compare recovered alert signers
 * against `records.address`) and for any future role / capability gating.
 */
export async function resolveAgentRecords(name: string): Promise<AgentRecords> {
  const records = await resolveAgent(ensClient, name);
  if (!records.address) {
    throw new Error(`ENS resolution returned null address for ${name}`);
  }
  logger.info(
    {
      name,
      address: records.address,
      role: records.context?.role ?? null,
      hasA2a: !!records.endpoints.a2a,
    },
    "resolved ENS",
  );
  return records;
}

/** Convenience for the common case — only the address is needed. */
export async function resolveAgentAddress(name: string): Promise<Address> {
  const records = await resolveAgentRecords(name);
  return records.address as Address;
}
