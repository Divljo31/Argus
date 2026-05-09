import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";

mkdirSync("./data", { recursive: true });
export const db = new Database("./data/watcher.sqlite");
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS seen (
    item_id TEXT PRIMARY KEY,
    seen_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sent_alerts (
    alert_id TEXT PRIMARY KEY,
    sent_at INTEGER NOT NULL,
    score INTEGER NOT NULL,
    response TEXT
  );
`);

export function isNew(itemId: string): boolean {
  return !db.prepare("SELECT 1 FROM seen WHERE item_id = ?").get(itemId);
}

export function markSeen(itemId: string) {
  db.prepare("INSERT OR IGNORE INTO seen (item_id, seen_at) VALUES (?, ?)").run(itemId, Date.now());
}

export function recordAlert(alertId: string, score: number, response: string) {
  db.prepare("INSERT OR REPLACE INTO sent_alerts VALUES (?, ?, ?, ?)").run(
    alertId,
    Date.now(),
    score,
    response,
  );
}
