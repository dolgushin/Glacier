import type { DatabaseSync } from "node:sqlite";

/**
 * Schema evolution for databases created by an earlier version.
 *
 * schema.sql is written with CREATE TABLE IF NOT EXISTS, which creates new
 * tables but never reshapes existing ones. Anything that changes an existing
 * table goes here. Every step must be safe to run repeatedly.
 */

function tableExists(db: DatabaseSync, name: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name);
  return row !== undefined;
}

function columnExists(db: DatabaseSync, table: string, column: string): boolean {
  if (!tableExists(db, table)) return false;
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return columns.some((info) => info.name === column);
}

/**
 * v1 -> v2: a single `broker_accounts` row held both the API key and the
 * portfolio mapping, which made it impossible to attach one key to several
 * accounts. Split into broker_connections (the key) and broker_links (the
 * account-to-portfolio mapping).
 *
 * The old table is renamed rather than dropped: if anything here is wrong, the
 * original rows are still on disk.
 */
function migrateBrokerAccounts(db: DatabaseSync): void {
  if (!tableExists(db, "broker_accounts")) return;
  if (!columnExists(db, "broker_accounts", "token_enc")) return;

  const legacy = db
    .prepare(
      `SELECT id, user_id, portfolio_id, broker, token_enc, account_id, account_name,
              auto_sync, last_sync_at, last_sync_status, created_at
         FROM broker_accounts`,
    )
    .all() as {
    user_id: number;
    portfolio_id: number;
    broker: string;
    token_enc: string;
    account_id: string;
    account_name: string;
    auto_sync: number;
    last_sync_at: string | null;
    last_sync_status: string;
    created_at: string;
  }[];

  for (const row of legacy) {
    // The old format stored a bare token string; the new one stores a JSON
    // object of named fields. Both are AES-GCM ciphertext, so the payload has
    // to be re-shaped after decryption — done lazily in credentials.ts.
    const result = db
      .prepare(
        `INSERT INTO broker_connections
           (user_id, broker, label, credentials_enc, status, created_at)
         VALUES (?, ?, ?, ?, '', ?)`,
      )
      .run(
        row.user_id,
        row.broker,
        row.account_name || "Перенесённое подключение",
        row.token_enc,
        row.created_at,
      );

    db.prepare(
      `INSERT OR IGNORE INTO broker_links
         (connection_id, portfolio_id, remote_account_id, remote_account_name,
          auto_sync, last_sync_at, last_sync_status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      Number(result.lastInsertRowid),
      row.portfolio_id,
      row.account_id,
      row.account_name,
      row.auto_sync,
      row.last_sync_at,
      row.last_sync_status,
      row.created_at,
    );
  }

  db.exec("ALTER TABLE broker_accounts RENAME TO broker_accounts_v1_backup");
}

export function runMigrations(db: DatabaseSync): void {
  migrateBrokerAccounts(db);
}
