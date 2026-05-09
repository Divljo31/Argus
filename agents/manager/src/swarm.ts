import { Bee, NULL_STAMP } from "@ethersphere/bee-js";
import { env } from "./env.js";
import { logger } from "./logger.js";

const bee = new Bee(env.swarmGateway);

/**
 * Upload a receipt to Swarm. With the bzz.limo gateway, NULL_STAMP is accepted
 * — the gateway rewrites it to a real postage batch. SQLite is the canonical
 * audit log; Swarm is the immutable evidence side-channel.
 */
export async function uploadReceipt(payload: unknown): Promise<string | null> {
  const stamp = env.swarmPostageBatchId || NULL_STAMP;
  try {
    const result = await bee.uploadData(stamp, JSON.stringify(payload));
    return result.reference.toString();
  } catch (err) {
    logger.warn({ err }, "Swarm upload failed — local-only receipt");
    return null;
  }
}
