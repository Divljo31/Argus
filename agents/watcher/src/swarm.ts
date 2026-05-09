import { Bee, NULL_STAMP } from "@ethersphere/bee-js";
import { env } from "./env.js";
import { logger } from "./logger.js";

const bee = new Bee(env.swarmGateway);

/**
 * Upload threat-evidence to Swarm. With the bzz.limo gateway, NULL_STAMP is
 * accepted — the gateway rewrites it to a real postage batch. Falls back to
 * a deterministic `stub:<ts>` reference on network failure so downstream
 * contracts and the UI stay valid.
 */
export async function uploadEvidence(payload: unknown): Promise<string> {
  const stamp = env.swarmPostageBatchId || NULL_STAMP;
  try {
    const result = await bee.uploadData(stamp, JSON.stringify(payload));
    return result.reference.toString();
  } catch (err) {
    const stub = `stub:${Date.now()}`;
    logger.warn({ err, stub }, "Swarm upload failed — using stub ref");
    return stub;
  }
}
