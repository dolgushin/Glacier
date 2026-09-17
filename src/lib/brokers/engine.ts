import { all, get, nowIso, run } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import {
  addTransactionsBulk,
  createPortfolio,
  findInstrument,
  getInstrument,
  listTransactions,
  requirePortfolio,
  upsertInstrument,
  type NewTransaction,
} from "@/lib/repo";
import { buildPositions } from "@/lib/domain/positions";
import { latestFxRates } from "@/lib/sync";
import { searchCrypto } from "@/lib/providers/coingecko";
import type { Instrument } from "@/lib/types";
import { requireAdapter } from "@/lib/brokers/registry";
import {
  BrokerError,
  type Credentials,
  type InstrumentDescriptor,
  type RemoteAccount,
  type RemoteBalance,
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

// ----------------------------------------------------- reconciliation

export interface ReconcileRow {
  symbol: string;
  name: string;
  /** Units the broker reports holding. */
  brokerQuantity: number | null;
  /** Units our ledger derives. */
  ledgerQuantity: number | null;
  /** brokerQuantity - ledgerQuantity, in units. */
  difference: number;
  /** Difference valued at the last known price, in the instrument currency. */
  valueGap: number | null;
  currency: string;
  status: "match" | "differs" | "missing-here" | "extra-here";
}

export interface Reconciliation {
  rows: ReconcileRow[];
  /** Raw broker balances by symbol, so an import can reuse the average price. */
  balances: Map<string, RemoteBalance>;
  /** Total money the broker holds that our ledger does not know about. */
  unaccountedValue: number;
  checkedAt: string;
  accountName: string;
  portfolioName: string;
}

/**
 * Compare what the broker says it holds against what our ledger derives.
 *
 * This exists because "why does the app show less than my broker app" is
 * otherwise unanswerable without a database console. The usual cause is a
 * truncated import: holdings bought before the first synced date have no BUY in
 * the ledger, so they are invisible here while the broker still counts them —
 * and sales of those holdings book as pure profit, inflating the return.
 *
 * Quantities are the honest thing to compare. Prices come from our own cache on
 * both sides, so a difference here always means a missing or extra operation,
 * never a stale quote.
 */
export async function reconcile(userId: number, linkId: number): Promise<Reconciliation> {
  const { link, connection } = requireLink(userId, linkId);
  const adapter = requireAdapter(connection.broker);

  if (!adapter.fetchBalances) {
    throw new BrokerError(`${adapter.name} не отдаёт текущие остатки — сверка недоступна`);
  }

  const balances = await adapter.fetchBalances(
    decodeCredentials(connection.credentials_enc),
    link.remote_account_id,
  );

  const portfolio = get<{ name: string; base_currency: string }>(
    "SELECT name, base_currency FROM portfolios WHERE id = ?",
    link.portfolio_id,
  );

  // Ledger side: positions derived from this portfolio's transactions alone.
  const transactions = listTransactions(userId, { portfolioId: link.portfolio_id });
  const instrumentRows = all<Instrument>(
    `SELECT DISTINCT i.* FROM instruments i
       JOIN transactions t ON t.instrument_id = i.id
      WHERE t.portfolio_id = ?`,
    link.portfolio_id,
  );
  const positions = buildPositions({
    transactions,
    instruments: new Map(instrumentRows.map((i) => [i.id, i])),
    fxRates: latestFxRates(),
    baseCurrency: portfolio?.base_currency ?? "RUB",
  });

  const ledgerBySymbol = new Map(
    positions.filter((p) => p.quantity > 0).map((p) => [p.instrument.symbol.toUpperCase(), p]),
  );

  const cache = new Map<string, number | null>();
  const rows: ReconcileRow[] = [];
  const bySymbol = new Map<string, RemoteBalance>();
  const seen = new Set<string>();
  let unaccountedValue = 0;

  for (const balance of balances) {
    const symbol = balance.instrument.symbol.toUpperCase();
    seen.add(symbol);
    bySymbol.set(symbol, balance);

    const position = ledgerBySymbol.get(symbol);
    const ledgerQuantity = position?.quantity ?? null;
    const difference = balance.quantity - (ledgerQuantity ?? 0);

    // Price the gap with whatever we know; resolve the catalog entry so a
    // holding we have never seen still gets a name and a quote.
    let price = position?.lastPrice ?? null;
    let name = position?.instrument.name ?? balance.instrument.name;
    let currency = position?.currency ?? balance.instrument.currency;
    if (price === null) {
      const id = await resolveInstrument(balance.instrument, cache);
      const instrument = id === null ? undefined : getInstrument(id);
      price = instrument?.last_price ?? null;
      name = instrument?.name ?? name;
      currency = instrument?.currency ?? currency;
    }

    const valueGap = price === null ? null : difference * price;
    if (valueGap !== null && difference > 0) unaccountedValue += valueGap;

    rows.push({
      symbol,
      name,
      brokerQuantity: balance.quantity,
      ledgerQuantity,
      difference,
      valueGap,
      currency,
      status:
        ledgerQuantity === null
          ? "missing-here"
          : Math.abs(difference) < 1e-9
            ? "match"
            : "differs",
    });
  }

  // Anything we hold that the broker does not report back.
  for (const [symbol, position] of ledgerBySymbol) {
    if (seen.has(symbol)) continue;
    rows.push({
      symbol,
      name: position.instrument.name,
      brokerQuantity: null,
      ledgerQuantity: position.quantity,
      difference: -position.quantity,
      valueGap: position.lastPrice === null ? null : -position.quantity * position.lastPrice,
      currency: position.currency,
      status: "extra-here",
    });
  }

  const order = { "missing-here": 0, differs: 1, "extra-here": 2, match: 3 } as const;
  rows.sort(
    (a, b) => order[a.status] - order[b.status] || Math.abs(b.valueGap ?? 0) - Math.abs(a.valueGap ?? 0),
  );

  return {
    rows,
    balances: bySymbol,
    unaccountedValue,
    checkedAt: nowIso(),
    accountName: link.remote_account_name || link.remote_account_id,
    portfolioName: portfolio?.name ?? "",
  };
}

export interface OpeningImport {
  created: number;
  /** How many used the broker's own average price rather than today's quote. */
  atAveragePrice: number;
  /** Date the synthetic purchases were dated to. */
  datedAt: string;
  totalCost: number;
  skipped: number;
}

/**
 * Write the holdings the broker reports but the ledger never saw, as opening
 * purchases.
 *
 * Adding sixty of them by hand is not a real option, and leaving them out keeps
 * both the portfolio value and the return wrong. What this cannot recover is
 * *when* they were bought: the broker's API does not go back that far, which is
 * why they are missing in the first place. So the quantity and the cost are
 * right, the date is a stated approximation, and every row is tagged so it can
 * be found, corrected or removed later.
 *
 * Only the difference is written, never the full balance — a partially imported
 * position must not be counted twice. The external id makes a repeat run a no-op.
 */
export async function importOpeningPositions(
  userId: number,
  linkId: number,
): Promise<OpeningImport> {
  const { link, connection } = requireLink(userId, linkId);
  const reconciliation = await reconcile(userId, linkId);

  // Date them just before the earliest operation we do know about, so FIFO
  // matches later sales against these lots rather than leaving them unmatched.
  const earliest = get<{ ts: string }>(
    "SELECT MIN(ts) AS ts FROM transactions WHERE portfolio_id = ?",
    link.portfolio_id,
  )?.ts;
  const datedAt = earliest
    ? new Date(Date.parse(earliest) - 86_400_000).toISOString()
    : new Date(Date.now() - 86_400_000).toISOString();

  const cache = new Map<string, number | null>();
  const rows: NewTransaction[] = [];
  let atAveragePrice = 0;
  let totalCost = 0;
  let skipped = 0;

  for (const row of reconciliation.rows) {
    if (row.difference <= 1e-9) continue; // nothing missing, or we hold more

    const balance = reconciliation.balances.get(row.symbol);
    const instrumentId = balance ? await resolveInstrument(balance.instrument, cache) : null;
    if (instrumentId === null) {
      skipped++;
      continue;
    }

    const instrument = getInstrument(instrumentId);
    const price = balance?.averagePrice ?? instrument?.last_price ?? null;
    if (price === null || !(price > 0)) {
      skipped++;
      continue;
    }
    if (balance?.averagePrice) atAveragePrice++;

    totalCost += row.difference * price;
    rows.push({
      portfolioId: link.portfolio_id,
      instrumentId,
      type: "BUY",
      ts: datedAt,
      quantity: row.difference,
      price,
      amount: row.difference * price,
      currency: instrument?.currency ?? row.currency,
      note: balance?.averagePrice
        ? "Стартовая позиция из сверки, средняя цена брокера"
        : "Стартовая позиция из сверки, цена текущая — себестоимость приблизительная",
      source: `${connection.broker}:${connection.id}`,
      // Namespaced so a second run updates nothing and creates nothing.
      externalId: `opening:${row.symbol}`,
    });
  }

  const written = addTransactionsBulk(userId, rows);

  run(
    "INSERT INTO sync_log (user_id, kind, status, detail, started_at, finished_at) VALUES (?, 'broker', 'ok', ?, ?, ?)",
    userId,
    `Стартовые позиции: ${written.inserted} шт на ${Math.round(totalCost)}`,
    nowIso(),
    nowIso(),
  );

  return {
    created: written.inserted,
    atAveragePrice,
    datedAt: datedAt.slice(0, 10),
    totalCost,
    skipped,
  };
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
