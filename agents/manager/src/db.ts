import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const DB_PATH = "./data/manager.sqlite";
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS processed_alerts (
    alert_id TEXT PRIMARY KEY,
    received_at INTEGER NOT NULL,
    score INTEGER NOT NULL,
    action TEXT NOT NULL,
    tx_hash TEXT
  );

  CREATE TABLE IF NOT EXISTS receipts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    swarm_ref TEXT,
    created_at INTEGER NOT NULL
  );
`);

export function alreadyProcessed(alertId: string): boolean {
  const row = db.prepare("SELECT 1 FROM processed_alerts WHERE alert_id = ?").get(alertId);
  return !!row;
}

export function markProcessed(alertId: string, score: number, action: string, txHash: string | null) {
  db.prepare(
    "INSERT INTO processed_alerts (alert_id, received_at, score, action, tx_hash) VALUES (?, ?, ?, ?, ?)",
  ).run(alertId, Date.now(), score, action, txHash);
}

export function saveReceipt(kind: string, payload: unknown, swarmRef: string | null) {
  db.prepare(
    "INSERT INTO receipts (kind, payload_json, swarm_ref, created_at) VALUES (?, ?, ?, ?)",
  ).run(kind, JSON.stringify(payload), swarmRef, Date.now());
}

export function listReceipts(limit = 100) {
  return db
    .prepare("SELECT * FROM receipts ORDER BY id DESC LIMIT ?")
    .all(limit) as Array<{ id: number; kind: string; payload_json: string; swarm_ref: string | null; created_at: number }>;
}
