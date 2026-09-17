import { all, get, nowIso, run, tx as transaction } from "@/lib/db";
import type { Category, Instrument, InstrumentKind, Portfolio, Transaction, TxType } from "@/lib/types";
import { cashEffect } from "@/lib/domain/positions";

/**
 * Every read here is scoped by user_id. Ownership is never inferred from the
 * request body — a portfolio id alone is not authority to touch it.
 */

// ------------------------------------------------------------- portfolios

export function listPortfolios(userId: number, includeArchived = false): Portfolio[] {
  return all<Portfolio>(
    `SELECT * FROM portfolios
      WHERE user_id = ? ${includeArchived ? "" : "AND is_archived = 0"}
      ORDER BY sort_order, id`,
    userId,
  );
}

export function getPortfolio(userId: number, portfolioId: number): Portfolio | undefined {
  return get<Portfolio>("SELECT * FROM portfolios WHERE id = ? AND user_id = ?", portfolioId, userId);
}

/** Throws rather than returning undefined — callers must not proceed on a miss. */
export function requirePortfolio(userId: number, portfolioId: number): Portfolio {
  const portfolio = getPortfolio(userId, portfolioId);
  if (!portfolio) throw new Error("Портфель не найден");
  return portfolio;
}

export function createPortfolio(
  userId: number,
  name: string,
  baseCurrency = "RUB",
  broker = "",
): Portfolio {
  const order = get<{ n: number }>(
    "SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM portfolios WHERE user_id = ?",
    userId,
  )!.n;
  const result = run(
    `INSERT INTO portfolios (user_id, name, base_currency, broker, sort_order, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    userId,
    name.trim() || "Портфель",
    baseCurrency,
    broker.trim(),
    order,
    nowIso(),
  );
  return get<Portfolio>("SELECT * FROM portfolios WHERE id = ?", Number(result.lastInsertRowid))!;
}

export function renamePortfolio(userId: number, portfolioId: number, name: string): void {
  requirePortfolio(userId, portfolioId);
  run("UPDATE portfolios SET name = ? WHERE id = ?", name.trim() || "Портфель", portfolioId);
}

export function deletePortfolio(userId: number, portfolioId: number): void {
  requirePortfolio(userId, portfolioId);
  run("DELETE FROM portfolios WHERE id = ?", portfolioId);
}

export function setArchived(userId: number, portfolioId: number, archived: boolean): void {
  requirePortfolio(userId, portfolioId);
  run("UPDATE portfolios SET is_archived = ? WHERE id = ?", archived ? 1 : 0, portfolioId);
}

// ------------------------------------------------------------- categories

export function listCategories(portfolioId: number): Category[] {
  return all<Category>(
    "SELECT * FROM categories WHERE portfolio_id = ? ORDER BY sort_order, id",
    portfolioId,
  );
}

export function createCategory(
  userId: number,
  portfolioId: number,
  name: string,
  targetWeight = 0,
  color = "var(--chart-1)",
): Category {
  requirePortfolio(userId, portfolioId);
  const order = get<{ n: number }>(
    "SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM categories WHERE portfolio_id = ?",
    portfolioId,
  )!.n;
  const result = run(
    `INSERT INTO categories (portfolio_id, name, target_weight, color, sort_order)
     VALUES (?, ?, ?, ?, ?)`,
    portfolioId,
    name.trim() || "Без названия",
    targetWeight,
    color,
    order,
  );
  return get<Category>("SELECT * FROM categories WHERE id = ?", Number(result.lastInsertRowid))!;
}

export function updateCategory(
  userId: number,
  categoryId: number,
  patch: { name?: string; targetWeight?: number; color?: string },
): void {
  const owner = get<{ user_id: number }>(
    `SELECT p.user_id FROM categories c JOIN portfolios p ON p.id = c.portfolio_id WHERE c.id = ?`,
    categoryId,
  );
  if (!owner || owner.user_id !== userId) throw new Error("Категория не найдена");

  if (patch.name !== undefined) run("UPDATE categories SET name = ? WHERE id = ?", patch.name.trim(), categoryId);
  if (patch.targetWeight !== undefined)
    run("UPDATE categories SET target_weight = ? WHERE id = ?", Math.max(0, patch.targetWeight), categoryId);
  if (patch.color !== undefined) run("UPDATE categories SET color = ? WHERE id = ?", patch.color, categoryId);
}

export function deleteCategory(userId: number, categoryId: number): void {
  const owner = get<{ user_id: number }>(
    `SELECT p.user_id FROM categories c JOIN portfolios p ON p.id = c.portfolio_id WHERE c.id = ?`,
    categoryId,
  );
  if (!owner || owner.user_id !== userId) throw new Error("Категория не найдена");
  run("DELETE FROM categories WHERE id = ?", categoryId);
}

// ------------------------------------------------------------ instruments

export function getInstrument(id: number): Instrument | undefined {
  return get<Instrument>("SELECT * FROM instruments WHERE id = ?", id);
}

export function findInstrument(source: string, symbol: string, ownerUserId: number | null = null) {
  return get<Instrument>(
    "SELECT * FROM instruments WHERE source = ? AND symbol = ? AND COALESCE(owner_user_id, 0) = ?",
    source,
    symbol,
    ownerUserId ?? 0,
  );
}

export interface UpsertInstrument {
  kind: InstrumentKind;
  symbol: string;
  name: string;
  currency?: string;
  source: string;
  sourceId?: string;
  isin?: string | null;
  figi?: string | null;
  exchange?: string;
  board?: string;
  sector?: string;
  country?: string;
  lotSize?: number;
  faceValue?: number | null;
  couponValue?: number | null;
  couponPeriod?: number | null;
  maturityDate?: string | null;
  ownerUserId?: number | null;
}

/** Insert or refresh a catalog entry; never clobbers a cached price. */
export function upsertInstrument(input: UpsertInstrument): Instrument {
  const existing = findInstrument(input.source, input.symbol, input.ownerUserId ?? null);
  if (existing) {
    run(
      `UPDATE instruments
          SET name = ?, kind = ?, currency = ?, source_id = ?, isin = ?, figi = ?,
              exchange = ?, board = ?, sector = ?, country = ?, lot_size = ?,
              face_value = ?, coupon_value = ?, coupon_period = ?, maturity_date = ?
        WHERE id = ?`,
      input.name || existing.name,
      input.kind,
      input.currency ?? existing.currency,
      input.sourceId ?? existing.source_id,
      input.isin ?? existing.isin,
      input.figi ?? existing.figi,
      input.exchange ?? existing.exchange,
      input.board ?? existing.board,
      input.sector ?? existing.sector,
      input.country ?? existing.country,
      input.lotSize ?? existing.lot_size,
      input.faceValue ?? existing.face_value,
      input.couponValue ?? existing.coupon_value,
      input.couponPeriod ?? existing.coupon_period,
      input.maturityDate ?? existing.maturity_date,
      existing.id,
    );
    return getInstrument(existing.id)!;
  }

  const result = run(
    `INSERT INTO instruments
       (owner_user_id, kind, symbol, name, currency, source, source_id, isin, figi,
        exchange, board, sector, country, lot_size, face_value, coupon_value,
        coupon_period, maturity_date, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    input.ownerUserId ?? null,
    input.kind,
    input.symbol,
    input.name,
    input.currency ?? "RUB",
    input.source,
    input.sourceId ?? "",
    input.isin ?? null,
    input.figi ?? null,
    input.exchange ?? "",
    input.board ?? "",
    input.sector ?? "",
    input.country ?? "",
    input.lotSize ?? 1,
    input.faceValue ?? null,
    input.couponValue ?? null,
    input.couponPeriod ?? null,
    input.maturityDate ?? null,
    nowIso(),
  );
  return getInstrument(Number(result.lastInsertRowid))!;
}

/** Every instrument the user actually holds or has traded. */
export function instrumentsForUser(userId: number): Instrument[] {
  return all<Instrument>(
    `SELECT DISTINCT i.* FROM instruments i
       JOIN transactions t ON t.instrument_id = i.id
       JOIN portfolios p ON p.id = t.portfolio_id
      WHERE p.user_id = ?`,
    userId,
  );
}

/** Every instrument held by anyone — the set worth keeping quotes fresh for. */
export function instrumentsInUse(): Instrument[] {
  return all<Instrument>(
    `SELECT DISTINCT i.* FROM instruments i JOIN transactions t ON t.instrument_id = i.id`,
  );
}

export function setPrice(instrumentId: number, price: number, date: string): void {
  run(
    "INSERT INTO prices (instrument_id, date, close) VALUES (?, ?, ?) ON CONFLICT(instrument_id, date) DO UPDATE SET close = excluded.close",
    instrumentId,
    date,
    price,
  );
  // Only the newest date may set the cached "current" price. Backfilling a year
  // of history must not overwrite today's quote with a year-old close.
  run(
    `UPDATE instruments
        SET last_price = ?, last_price_at = ?
      WHERE id = ?
        AND ? >= COALESCE((SELECT MAX(date) FROM prices WHERE instrument_id = ?), '')`,
    price,
    nowIso(),
    instrumentId,
    date,
    instrumentId,
  );
}

// ----------------------------------------------------------- transactions

export function listTransactions(
  userId: number,
  options: { portfolioId?: number; instrumentId?: number; limit?: number } = {},
): Transaction[] {
  const clauses = ["p.user_id = ?"];
  const params: unknown[] = [userId];

  if (options.portfolioId) {
    clauses.push("t.portfolio_id = ?");
    params.push(options.portfolioId);
  }
  if (options.instrumentId) {
    clauses.push("t.instrument_id = ?");
    params.push(options.instrumentId);
  }

  const limit = options.limit ? `LIMIT ${Math.max(1, Math.floor(options.limit))}` : "";
  return all<Transaction>(
    `SELECT t.* FROM transactions t
       JOIN portfolios p ON p.id = t.portfolio_id
      WHERE ${clauses.join(" AND ")}
      ORDER BY t.ts DESC, t.id DESC ${limit}`,
    ...params,
  );
}

export interface NewTransaction {
  portfolioId: number;
  instrumentId: number | null;
  categoryId?: number | null;
  type: TxType;
  ts: string;
  quantity?: number;
  price?: number;
  amount?: number;
  fee?: number;
  tax?: number;
  currency?: string;
  fxRate?: number;
  note?: string;
  source?: string;
  externalId?: string | null;
}

export function addTransaction(userId: number, input: NewTransaction): number {
  requirePortfolio(userId, input.portfolioId);

  const quantity = input.quantity ?? 0;
  const price = input.price ?? 0;
  const fee = input.fee ?? 0;
  const tax = input.tax ?? 0;
  // For trades the amount is derived; for cash operations it is the input.
  const amount =
    input.amount ?? (input.type === "BUY" || input.type === "SELL" ? quantity * price : 0);

  const result = run(
    `INSERT INTO transactions
       (portfolio_id, instrument_id, category_id, type, ts, quantity, price, amount,
        fee, tax, currency, fx_rate, note, source, external_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    input.portfolioId,
    input.instrumentId,
    input.categoryId ?? null,
    input.type,
    input.ts,
    quantity,
    price,
    amount,
    fee,
    tax,
    input.currency ?? "RUB",
    input.fxRate ?? 1,
    (input.note ?? "").slice(0, 500),
    input.source ?? "manual",
    input.externalId ?? null,
    nowIso(),
  );
  return Number(result.lastInsertRowid);
}

/**
 * Bulk insert for CSV and broker sync. Rows carrying an external_id that is
 * already present are skipped, so re-importing the same report is a no-op.
 * Returns how many were written and how many were recognised as duplicates.
 */
export function addTransactionsBulk(
  userId: number,
  rows: NewTransaction[],
): { inserted: number; skipped: number } {
  let inserted = 0;
  let skipped = 0;

  transaction(() => {
    for (const row of rows) {
      if (row.externalId) {
        const exists = get<{ id: number }>(
          "SELECT id FROM transactions WHERE portfolio_id = ? AND source = ? AND external_id = ?",
          row.portfolioId,
          row.source ?? "manual",
          row.externalId,
        );
        if (exists) {
          skipped++;
          continue;
        }
      }
      addTransaction(userId, row);
      inserted++;
    }
  });

  return { inserted, skipped };
}

export function deleteTransaction(userId: number, transactionId: number): void {
  const owner = get<{ user_id: number }>(
    `SELECT p.user_id FROM transactions t JOIN portfolios p ON p.id = t.portfolio_id WHERE t.id = ?`,
    transactionId,
  );
  if (!owner || owner.user_id !== userId) throw new Error("Операция не найдена");
  run("DELETE FROM transactions WHERE id = ?", transactionId);
}

/** Net cash effect of a whole ledger, for quick display. */
export function netCash(transactions: Transaction[]): number {
  return transactions.reduce((sum, item) => sum + cashEffect(item) * item.fx_rate, 0);
}
