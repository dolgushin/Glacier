import { all, get, nowIso, run } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import {
  addTransactionsBulk,
  createPortfolio,
  findInstrument,
  requirePortfolio,
  upsertInstrument,
  type NewTransaction,
} from "@/lib/repo";
import { searchCrypto } from "@/lib/providers/coingecko";
import { requireAdapter } from "@/lib/brokers/registry";
import {
  BrokerError,
  type Credentials,
  type InstrumentDescriptor,
  type RemoteAccount,
} from "@/lib/brokers/types";

/**
 * Broker-agnostic synchronisation.
 *
 * Model:
 *   broker_connections — one row per API key
 *   broker_links       — one row per (broker account -> portfolio) mapping
 *
 * One key can expose several accounts, and each account lands in its own
 * portfolio. That is the whole reason the two tables are separate: a person
 * with a брокерский счёт and an ИИС under one login should not have to choose
 * which of them to track.
 */

export interface ConnectionRow {
  id: number;
  user_id: number;
  broker: string;
  label: string;
  credentials_enc: string;
  status: string;
  status_detail: string;
  last_check_at: string | null;
  created_at: string;
}

export interface LinkRow {
  id: number;
  connection_id: number;
  portfolio_id: number;
  remote_account_id: string;
  remote_account_name: string;
  auto_sync: number;
  last_sync_at: string | null;
  last_sync_status: string;
  created_at: string;
}

/** A connection with its mappings, for display. Never carries credentials. */
export interface ConnectionView {
  id: number;
  broker: string;
  brokerName: string;
  label: string;
  status: string;
  statusDetail: string;
  lastCheckAt: string | null;
  createdAt: string;
  providesCashFlow: boolean;
  links: {
    id: number;
    portfolioId: number;
    portfolioName: string;
    remoteAccountId: string;
    remoteAccountName: string;
    autoSync: boolean;
    lastSyncAt: string | null;
    lastSyncStatus: string;
  }[];
}

// ------------------------------------------------------------ credentials

/**
 * Credentials are stored as an encrypted JSON object. Connections migrated from
 * the previous single-token schema hold a bare string, so decryption falls back
 * to wrapping it — no separate data migration pass, and no broken connection.
 */
function decodeCredentials(payload: string): Credentials {
  const plaintext = decryptSecret(payload);
  try {
    const parsed = JSON.parse(plaintext) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Credentials;
    }
  } catch {
    // Legacy format: the value is the token itself.
  }
  return { token: plaintext };
}

function encodeCredentials(credentials: Credentials): string {
  return encryptSecret(JSON.stringify(credentials));
}

// -------------------------------------------------------------- retrieval

export function listConnections(userId: number): ConnectionView[] {
  const connections = all<ConnectionRow>(
    "SELECT * FROM broker_connections WHERE user_id = ? ORDER BY id",
    userId,
  );
  if (connections.length === 0) return [];

  const links = all<LinkRow & { portfolio_name: string }>(
    `SELECT l.*, p.name AS portfolio_name
       FROM broker_links l
       JOIN portfolios p ON p.id = l.portfolio_id
       JOIN broker_connections c ON c.id = l.connection_id
      WHERE c.user_id = ?
      ORDER BY l.id`,
    userId,
  );

  return connections.map((connection) => {
    const adapter = requireAdapter(connection.broker);
    return {
      id: connection.id,
      broker: connection.broker,
      brokerName: adapter.name,
      label: connection.label,
      status: connection.status,
      statusDetail: connection.status_detail,
      lastCheckAt: connection.last_check_at,
      createdAt: connection.created_at,
      providesCashFlow: adapter.providesCashFlow,
      links: links
        .filter((link) => link.connection_id === connection.id)
        .map((link) => ({
          id: link.id,
          portfolioId: link.portfolio_id,
          portfolioName: link.portfolio_name,
          remoteAccountId: link.remote_account_id,
          remoteAccountName: link.remote_account_name,
          autoSync: link.auto_sync === 1,
          lastSyncAt: link.last_sync_at,
          lastSyncStatus: link.last_sync_status,
        })),
    };
  });
}

function requireConnection(userId: number, connectionId: number): ConnectionRow {
  const connection = get<ConnectionRow>(
    "SELECT * FROM broker_connections WHERE id = ? AND user_id = ?",
    connectionId,
    userId,
  );
  if (!connection) throw new BrokerError("Подключение не найдено");
  return connection;
}

function requireLink(userId: number, linkId: number): { link: LinkRow; connection: ConnectionRow } {
  const link = get<LinkRow>("SELECT * FROM broker_links WHERE id = ?", linkId);
  if (!link) throw new BrokerError("Привязка счёта не найдена");
  const connection = requireConnection(userId, link.connection_id);
  return { link, connection };
}

// ------------------------------------------------------------- connecting

/** Validate a key against the broker and report which accounts it can see. */
export async function probeCredentials(
  broker: string,
  credentials: Credentials,
): Promise<RemoteAccount[]> {
  const adapter = requireAdapter(broker);

  for (const field of adapter.credentialFields) {
    if (field.required && !credentials[field.key]?.trim()) {
      throw new BrokerError(`Не заполнено поле «${field.label}»`);
    }
  }

  return adapter.listAccounts(credentials);
}

/** Store a validated key. Returns the new connection id. */
export function saveConnection(params: {
  userId: number;
  broker: string;
  label: string;
  credentials: Credentials;
}): number {
  const adapter = requireAdapter(params.broker);
  const result = run(
    `INSERT INTO broker_connections
       (user_id, broker, label, credentials_enc, status, status_detail, last_check_at, created_at)
     VALUES (?, ?, ?, ?, 'ok', '', ?, ?)`,
    params.userId,
    params.broker,
    params.label.trim() || adapter.name,
    encodeCredentials(params.credentials),
    nowIso(),
    nowIso(),
  );
  return Number(result.lastInsertRowid);
}

/** Replace the key on an existing connection, keeping its account mappings. */
export function updateCredentials(
  userId: number,
  connectionId: number,
  credentials: Credentials,
): void {
  requireConnection(userId, connectionId);
  run(
    "UPDATE broker_connections SET credentials_enc = ?, status = 'ok', status_detail = '', last_check_at = ? WHERE id = ?",
    encodeCredentials(credentials),
    nowIso(),
    connectionId,
  );
}

export function renameConnection(userId: number, connectionId: number, label: string): void {
  requireConnection(userId, connectionId);
  run("UPDATE broker_connections SET label = ? WHERE id = ?", label.trim() || "Подключение", connectionId);
}

export function deleteConnection(userId: number, connectionId: number): void {
  requireConnection(userId, connectionId);
  // Imported operations stay in the ledger: they are history, not a cache.
  run("DELETE FROM broker_connections WHERE id = ?", connectionId);
}

/**
 * Map one broker account to a portfolio. `portfolioId` of 0 means "create a new
 * portfolio named after the account", which is what most people want on a first
 * connection.
 */
export function linkAccount(params: {
  userId: number;
  connectionId: number;
  remoteAccountId: string;
  remoteAccountName: string;
  portfolioId: number;
  newPortfolioName?: string;
}): number {
  const connection = requireConnection(params.userId, params.connectionId);
  const adapter = requireAdapter(connection.broker);

  let portfolioId = params.portfolioId;
  if (!portfolioId) {
    const name =
      params.newPortfolioName?.trim() ||
      `${adapter.name} · ${params.remoteAccountName || params.remoteAccountId}`;
    portfolioId = createPortfolio(params.userId, name, "RUB", adapter.name).id;
  } else {
    requirePortfolio(params.userId, portfolioId);
  }

  const existing = get<{ id: number }>(
    "SELECT id FROM broker_links WHERE connection_id = ? AND remote_account_id = ?",
    params.connectionId,
    params.remoteAccountId,
  );

  if (existing) {
    run(
      "UPDATE broker_links SET portfolio_id = ?, remote_account_name = ? WHERE id = ?",
      portfolioId,
      params.remoteAccountName,
      existing.id,
    );
    return existing.id;
  }

  const result = run(
    `INSERT INTO broker_links
       (connection_id, portfolio_id, remote_account_id, remote_account_name, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    params.connectionId,
    portfolioId,
    params.remoteAccountId,
    params.remoteAccountName,
    nowIso(),
  );
  return Number(result.lastInsertRowid);
}

export function unlinkAccount(userId: number, linkId: number): void {
  requireLink(userId, linkId);
  run("DELETE FROM broker_links WHERE id = ?", linkId);
}

export function setAutoSync(userId: number, linkId: number, enabled: boolean): void {
  requireLink(userId, linkId);
  run("UPDATE broker_links SET auto_sync = ? WHERE id = ?", enabled ? 1 : 0, linkId);
}

/** Re-read the account list for an existing connection. */
export async function refreshAccounts(
  userId: number,
  connectionId: number,
): Promise<RemoteAccount[]> {
  const connection = requireConnection(userId, connectionId);
  const adapter = requireAdapter(connection.broker);
  try {
    const accounts = await adapter.listAccounts(decodeCredentials(connection.credentials_enc));
    run(
      "UPDATE broker_connections SET status = 'ok', status_detail = '', last_check_at = ? WHERE id = ?",
      nowIso(),
      connectionId,
    );
    return accounts;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    run(
      "UPDATE broker_connections SET status = 'error', status_detail = ?, last_check_at = ? WHERE id = ?",
      message.slice(0, 400),
      nowIso(),
      connectionId,
    );
    throw error;
  }
}

// --------------------------------------------------- instrument resolution

/**
 * Turn an adapter's instrument descriptor into a catalog row.
 *
 * Crypto descriptors arrive with a ticker but no CoinGecko id, because an
 * exchange knows "BTC" and nothing about CoinGecko. The lookup happens here,
 * once per symbol per sync, and the id is persisted so it never repeats.
 */
async function resolveInstrument(
  descriptor: InstrumentDescriptor,
  cache: Map<string, number | null>,
): Promise<number | null> {
  const key = `${descriptor.source}|${descriptor.symbol}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const existing = findInstrument(descriptor.source, descriptor.symbol);
  if (existing) {
    // Backfill the FIGI so later syncs match without an extra broker call.
    if (descriptor.figi && !existing.figi) {
      run("UPDATE instruments SET figi = ? WHERE id = ?", descriptor.figi, existing.id);
    }
    cache.set(key, existing.id);
    return existing.id;
  }

  let sourceId = descriptor.sourceId ?? "";

  if (descriptor.source === "coingecko" && !sourceId) {
    const found = await searchCrypto(descriptor.symbol, 10);
    // Prefer an exact ticker match; CoinGecko search is fuzzy and the first hit
    // for "ETH" can easily be some unrelated token.
    const match = found.find((coin) => coin.symbol === descriptor.symbol.toUpperCase());
    if (!match) {
      cache.set(key, null);
      return null;
    }
    sourceId = match.id;
    descriptor = { ...descriptor, name: match.name };
  }

  const instrument = upsertInstrument({
    kind: descriptor.kind,
    symbol: descriptor.symbol,
    name: descriptor.name,
    currency: descriptor.currency,
    source: descriptor.source,
    sourceId,
    board: descriptor.board ?? "",
    exchange: descriptor.source === "moex" ? "MOEX" : "CoinGecko",
    country: descriptor.source === "moex" ? "RU" : "",
    isin: descriptor.isin ?? null,
    figi: descriptor.figi ?? null,
    lotSize: descriptor.lotSize ?? 1,
    faceValue: descriptor.faceValue ?? null,
    maturityDate: descriptor.maturityDate ?? null,
  });

  cache.set(key, instrument.id);
  return instrument.id;
}

// ---------------------------------------------------------------- syncing

export interface SyncOutcome {
  inserted: number;
  skipped: number;
  unresolved: number;
  accountName: string;
  portfolioName: string;
}

const CASH_ONLY = new Set(["DEPOSIT", "WITHDRAWAL", "FEE", "TAX"]);

/** Pull one broker account into its portfolio. Safe to run repeatedly. */
export async function syncLink(
  userId: number,
  linkId: number,
  options: { fullHistory?: boolean } = {},
): Promise<SyncOutcome> {
  const { link, connection } = requireLink(userId, linkId);
  const adapter = requireAdapter(connection.broker);
  const credentials = decodeCredentials(connection.credentials_enc);
  const startedAt = nowIso();

  const to = new Date();
  const from = options.fullHistory
    ? new Date(Date.now() - adapter.maxHistoryDays * 86_400_000)
    : link.last_sync_at
      ? // Overlap by a week: a broker can settle an operation after the fact,
        // and the external id makes the overlap free of duplicates.
        new Date(Date.parse(link.last_sync_at) - 7 * 86_400_000)
      : new Date(Date.now() - adapter.maxHistoryDays * 86_400_000);

  try {
    const operations = await adapter.fetchOperations(
      credentials,
      link.remote_account_id,
      from,
      to,
    );

    const cache = new Map<string, number | null>();
    const rows: NewTransaction[] = [];
    let unresolved = 0;

    for (const operation of operations) {
      const cashOnly = CASH_ONLY.has(operation.type) && operation.instrument === null;

      let instrumentId: number | null = null;
      if (!cashOnly) {
        if (!operation.instrument) {
          unresolved++;
          continue;
        }
        instrumentId = await resolveInstrument(operation.instrument, cache);
        if (instrumentId === null) {
          // Importing a trade without knowing what was traded would corrupt the
          // position rather than improve it.
          unresolved++;
          continue;
        }
      }

      rows.push({
        portfolioId: link.portfolio_id,
        instrumentId,
        type: operation.type,
        ts: operation.ts,
        quantity: operation.quantity,
        price: operation.price,
        amount:
          operation.type === "BUY" || operation.type === "SELL"
            ? operation.quantity * operation.price
            : operation.amount,
        fee: operation.fee,
        tax: operation.tax,
        currency: operation.currency,
        note: operation.note ?? "",
        // Namespaced by connection: two keys for the same broker must not
        // collide on the broker's own operation ids.
        source: `${adapter.id}:${connection.id}`,
        externalId: operation.externalId,
      });
    }

    const written = addTransactionsBulk(userId, rows);
    const status = `+${written.inserted}, дубликатов ${written.skipped}${
      unresolved > 0 ? `, не распознано ${unresolved}` : ""
    }`;

    run(
      "UPDATE broker_links SET last_sync_at = ?, last_sync_status = ? WHERE id = ?",
      nowIso(),
      status,
      linkId,
    );
    run(
      "UPDATE broker_connections SET status = 'ok', status_detail = '', last_check_at = ? WHERE id = ?",
      nowIso(),
      connection.id,
    );
    run(
      "INSERT INTO sync_log (user_id, kind, status, detail, started_at, finished_at) VALUES (?, 'broker', 'ok', ?, ?, ?)",
      userId,
      `${adapter.name} · ${link.remote_account_name}: ${status}`,
      startedAt,
      nowIso(),
    );

    const portfolio = get<{ name: string }>(
      "SELECT name FROM portfolios WHERE id = ?",
      link.portfolio_id,
    );

    return {
      inserted: written.inserted,
      skipped: written.skipped,
      unresolved,
      accountName: link.remote_account_name || link.remote_account_id,
      portfolioName: portfolio?.name ?? "",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    run(
      "UPDATE broker_links SET last_sync_status = ? WHERE id = ?",
      `ошибка: ${message.slice(0, 200)}`,
      linkId,
    );
    run(
      "UPDATE broker_connections SET status = 'error', status_detail = ?, last_check_at = ? WHERE id = ?",
      message.slice(0, 400),
      nowIso(),
      connection.id,
    );
    run(
      "INSERT INTO sync_log (user_id, kind, status, detail, started_at, finished_at) VALUES (?, 'broker', 'error', ?, ?, ?)",
      userId,
      `${adapter.name}: ${message.slice(0, 300)}`,
      startedAt,
      nowIso(),
    );
    throw error;
  }
}

/** Sync every mapping the user has enabled. Failures are collected, not thrown. */
export async function syncAll(
  userId: number,
): Promise<{ results: SyncOutcome[]; errors: string[] }> {
  const links = all<LinkRow>(
    `SELECT l.* FROM broker_links l
       JOIN broker_connections c ON c.id = l.connection_id
      WHERE c.user_id = ? AND l.auto_sync = 1
      ORDER BY l.id`,
    userId,
  );

  const results: SyncOutcome[] = [];
  const errors: string[] = [];

  for (const link of links) {
    try {
      results.push(await syncLink(userId, link.id));
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  return { results, errors };
}
