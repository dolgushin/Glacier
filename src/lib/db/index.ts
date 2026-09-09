import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { runMigrations } from "@/lib/db/migrate";
import { SCHEMA } from "@/lib/db/schema";

/**
 * Single connection per process, opened lazily.
 *
 * "Lazily" is the important word. Opening it at module scope meant that merely
 * importing this file created the file and ran the DDL — and Next collects page
 * data in three parallel workers, so three processes raced on the same SQLite
 * file and one of them lost with "database is locked". The same race would hit
 * any multi-process deployment, pm2 cluster included.
 *
 * Now nothing touches disk until a query actually runs.
 */
type Row = Record<string, unknown>;

/*
 * The database location is deliberately configurable — a VPS deployment puts it
 * on a mounted volume, not inside the bundle. Turbopack cannot trace a path it
 * cannot see and warns that it will include the whole project in the output;
 * the annotation says this one is intended.
 */
const DB_PATH = resolve(/* turbopackIgnore: true */ process.env.GLACIER_DB_PATH || "./data/glacier.db");

declare global {
  // eslint-disable-next-line no-var
  var __glacierDb: DatabaseSync | undefined;
}

function open(): DatabaseSync {
  mkdirSync(/* turbopackIgnore: true */ dirname(DB_PATH), { recursive: true });
  const database = new DatabaseSync(DB_PATH);

  // Wait for a competing writer instead of failing outright. WAL lets readers
  // work during a write, but two processes applying the schema still collide,
  // and five seconds is far longer than that ever takes.
  database.exec("PRAGMA busy_timeout = 5000;");

  database.exec(SCHEMA);
  runMigrations(database);
  return database;
}

/** The connection, created on first use and reused for the process lifetime. */
function connection(): DatabaseSync {
  return (globalThis.__glacierDb ??= open());
}

/** All rows for a query. */
export function all<T = Row>(sql: string, ...params: unknown[]): T[] {
  return (connection().prepare(sql).all(...(params as never[])) as unknown[]).map((row) =>
    plain<T>(row),
  );
}

/** First row, or undefined. */
export function get<T = Row>(sql: string, ...params: unknown[]): T | undefined {
  const row = connection().prepare(sql).get(...(params as never[]));
  return row === undefined ? undefined : plain<T>(row);
}

/** Execute a write; returns lastInsertRowid and changes. */
export function run(sql: string, ...params: unknown[]) {
  return connection().prepare(sql).run(...(params as never[]));
}

/** Wrap a function in a transaction. node:sqlite has no helper, so do it by hand. */
export function tx<T>(fn: () => T): T {
  const database = connection();
  database.exec("BEGIN");
  try {
    const result = fn();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

/**
 * node:sqlite returns rows with a null prototype. React Server Components
 * refuse to serialise those to Client Components ("Classes or null prototypes
 * are not supported"), so every row is normalised into a plain object here —
 * once, at the boundary, rather than at each call site.
 */
function plain<T>(row: unknown): T {
  return { ...(row as object) } as T;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function getSetting(key: string): string | undefined {
  return get<{ value: string }>("SELECT value FROM settings WHERE key = ?", key)?.value;
}

export function setSetting(key: string, value: string): void {
  run(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    key,
    value,
  );
}
