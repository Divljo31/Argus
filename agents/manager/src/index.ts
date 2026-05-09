import express from "express";
import cors from "cors";
import {
  type SignedThreatAlert,
  recoverAlertSigner,
  type ThreatAlertReceipt,
  type WithdrawReceipt,
  type DepositReceipt,
} from "@argus/shared";
import { isAddressEqual } from "viem";
import { account, baseClient } from "./clients.js";
import { env } from "./env.js";
import { logger } from "./logger.js";
import { resolveAgentAddress } from "./ens.js";
import {
  exitAaveOnAlert,
  readVaultBalances,
  supplyIdleToAave,
} from "./vault.js";
import { yieldVaultAbi } from "./abi.js";
import { alreadyProcessed, listReceipts, markProcessed, saveReceipt } from "./db.js";
import { uploadReceipt } from "./swarm.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "256kb" }));

let watcherAddress: `0x${string}` | null = null;

async function refreshWatcherAddress() {
  try {
    watcherAddress = await resolveAgentAddress(env.watcherEns);
  } catch (err) {
    logger.error({ err }, "failed to resolve watcher ENS");
  }
}

app.get("/health", async (_req, res) => {
  const balances = await readVaultBalances();
  res.json({
    agent: env.managerEns,
    address: account.address,
    vault: env.vaultAddress,
    watcherEns: env.watcherEns,
    watcherAddress,
    balances: {
      idleUsdc: balances.idleUsdc.toString(),
      suppliedUsdc: balances.suppliedUsdc.toString(),
    },
  });
});

app.get("/receipts", (_req, res) => {
  res.json(listReceipts(200).map((r) => ({ ...r, payload: JSON.parse(r.payload_json) })));
});

/**
 * Watcher → Manager threat alert.
 *
 * 1. Verify EIP-712 signature comes from the live ENS-resolved watcher EOA.
 * 2. Idempotency check on alertId.
 * 3. If recommendedAction === "exit" and we have a supplied position, withdraw.
 * 4. Receipt → SQLite + best-effort Swarm.
 */
app.post("/alerts", async (req, res) => {
  const alert = req.body as SignedThreatAlert;
  if (!alert?.payload?.alertId || !alert?.signature) {
    return res.status(400).json({ error: "malformed alert" });
  }

  if (!watcherAddress) await refreshWatcherAddress();
  if (!watcherAddress) return res.status(503).json({ error: "watcher ENS not resolved" });

  const recovered = await recoverAlertSigner(alert);
  if (!isAddressEqual(recovered, watcherAddress)) {
    logger.warn({ recovered, expected: watcherAddress }, "alert signature mismatch");
    return res.status(401).json({ error: "signature does not match watcher ENS" });
  }

  if (alreadyProcessed(alert.payload.alertId)) {
    return res.json({ status: "duplicate", alertId: alert.payload.alertId });
  }

  logger.info({ alert: alert.payload }, "received signed threat alert");

  // Always log the alert as a receipt, regardless of whether we act.
  const alertReceipt: ThreatAlertReceipt = {
    kind: "threat-alert",
    agent: env.managerEns as `${string}.${string}`,
    agentAddress: account.address,
    alertId: alert.payload.alertId,
    protocol: alert.payload.protocol,
    chain: alert.payload.chain,
    score: alert.payload.score,
    evidenceSwarmRef: alert.payload.evidenceSwarmRef,
    timestamp: Date.now(),
  };
  saveReceipt("threat-alert", alertReceipt, await uploadReceipt(alertReceipt));

  if (alert.payload.recommendedAction !== "exit") {
    markProcessed(alert.payload.alertId, alert.payload.score, "monitor", null);
    return res.json({ status: "acknowledged", action: "monitor" });
  }

  const result = await exitAaveOnAlert(alert.payload.alertId);
  if (!result) {
    markProcessed(alert.payload.alertId, alert.payload.score, "no-position", null);
    return res.json({ status: "no-position" });
  }

  const withdrawReceipt: WithdrawReceipt = {
    kind: "withdraw-aave",
    agent: env.managerEns as `${string}.${string}`,
    agentAddress: account.address,
    chainId: 8453,
    txHash: result.txHash,
    amount: result.amount.toString(),
    vault: env.vaultAddress,
    triggeredByAlertId: alert.payload.alertId,
    timestamp: Date.now(),
  };
  saveReceipt("withdraw-aave", withdrawReceipt, await uploadReceipt(withdrawReceipt));
  markProcessed(alert.payload.alertId, alert.payload.score, "exit", result.txHash);

  return res.json({ status: "exited", txHash: result.txHash, amount: result.amount.toString() });
});

/**
 * Watch the vault for user Deposit events. Each deposit triggers a supply to
 * Aave on Base (the only chain in the MVP).
 */
async function watchDeposits() {
  baseClient.watchContractEvent({
    address: env.vaultAddress,
    abi: yieldVaultAbi,
    eventName: "Deposit",
    onLogs: async (logs) => {
      for (const log of logs) {
        logger.info({ log: log.args }, "Deposit event detected");
        const result = await supplyIdleToAave();
        if (!result) continue;
        const receipt: DepositReceipt = {
          kind: "deposit-aave",
          agent: env.managerEns as `${string}.${string}`,
          agentAddress: account.address,
          chainId: 8453,
          txHash: result.txHash,
          amount: result.amount.toString(),
          vault: env.vaultAddress,
          timestamp: Date.now(),
        };
        saveReceipt("deposit-aave", receipt, await uploadReceipt(receipt));
      }
    },
    onError: (err) => logger.error({ err }, "Deposit watch error"),
  });
}

async function main() {
  await refreshWatcherAddress();
  // Re-resolve watcher periodically so renames don't break us mid-demo.
  setInterval(refreshWatcherAddress, 60_000);

  await watchDeposits();

  app.listen(env.port, () => {
    logger.info(
      { ens: env.managerEns, address: account.address, port: env.port },
      "manager listening",
    );
  });
}

main().catch((err) => {
  logger.fatal({ err }, "manager crashed");
  process.exit(1);
});
