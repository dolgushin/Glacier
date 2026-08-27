"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { addTransactionsBulk, findInstrument, requirePortfolio, upsertInstrument } from "@/lib/repo";
import type { NewTransaction } from "@/lib/repo";
import { parseCsv, type ParsedRow } from "@/lib/import/csv";
import { searchSecurities, fetchSecurityDetails } from "@/lib/providers/moex";
import { searchCrypto } from "@/lib/providers/coingecko";
import { refreshQuotes } from "@/lib/sync";

export interface ImportState {
  error?: string;
  success?: string;
  /** Per-line problems, shown so nothing fails silently. */
  issues?: string[];
}

/**
 * Resolve every distinct ticker in an import to a catalog instrument.
 * Done once per symbol rather than per row — a 2000-line report would otherwise
 * hammer MOEX with duplicate lookups.
 */
async function resolveSymbols(
  rows: ParsedRow[],
  userId: number,
): Promise<{ ids: Map<string, number>; missing: string[] }> {
  const ids = new Map<string, number>();
  const missing: string[] = [];

  const unique = new Map<string, ParsedRow>();
  for (const row of rows) {
    if (!row.symbol) continue;
    const key = `${row.source}|${row.symbol}`;
    if (!unique.has(key)) unique.set(key, row);
  }

  for (const [key, row] of unique) {
    const owner = row.source === "manual" ? userId : null;
    const existing = findInstrument(row.source, row.symbol, owner);
    if (existing) {
      ids.set(key, existing.id);
      continue;
    }

    if (row.source === "manual") {
      ids.set(
        key,
        upsertInstrument({
          kind: "custom",
          symbol: row.symbol,
          name: row.name || row.symbol,
          currency: row.currency,
          source: "manual",
          ownerUserId: userId,
        }).id,
      );
      continue;
    }

    if (row.source === "coingecko") {
      const found = await searchCrypto(row.symbol, 5);
      const match =
        found.find((coin) => coin.symbol === row.symbol) ?? found[0];
      if (!match) {
        missing.push(row.symbol);
        continue;
      }
      ids.set(
        key,
        upsertInstrument({
          kind: "crypto",
          symbol: match.symbol,
          name: match.name,
          currency: "RUB",
          source: "coingecko",
          sourceId: match.id,
          exchange: "CoinGecko",
        }).id,
      );
      continue;
    }

    // MOEX
    const found = await searchSecurities(row.symbol, 5);
    const match = found.find((security) => security.secid === row.symbol);
    if (!match) {
      missing.push(row.symbol);
      continue;
    }
    const details = await fetchSecurityDetails(match.secid, match.kind, match.board);
    ids.set(
      key,
      upsertInstrument({
        kind: match.kind,
        symbol: match.secid,
        name: details.name || match.name,
        currency: details.currency || "RUB",
        source: "moex",
        sourceId: match.board,
        board: match.board,
        exchange: "MOEX",
        country: "RU",
        isin: match.isin || null,
        lotSize: details.lotSize ?? 1,
        faceValue: details.faceValue ?? null,
        couponValue: details.couponValue ?? null,
        couponPeriod: details.couponPeriod ?? null,
        maturityDate: details.maturityDate ?? null,
      }).id,
    );
  }

  return { ids, missing };
}

export async function importCsvAction(
  _previous: ImportState,
  data: FormData,
): Promise<ImportState> {
  const user = await requireUser();
  const portfolioId = Number(data.get("portfolioId"));

  try {
    requirePortfolio(user.id, portfolioId);
  } catch {
    return { error: "Портфель не найден" };
  }

  const file = data.get("file");
  const pasted = String(data.get("pasted") ?? "").trim();

  let content = pasted;
  if (!content && file instanceof File && file.size > 0) {
    content = await file.text();
  }
  if (!content) return { error: "Загрузите файл или вставьте содержимое CSV" };

  const parsed = parseCsv(content);
  if (parsed.rows.length === 0) {
    return {
      error: "Не удалось разобрать ни одной строки",
      issues: parsed.errors.map((issue) => `Строка ${issue.line}: ${issue.message}`),
    };
  }

  const { ids, missing } = await resolveSymbols(parsed.rows, user.id);

  const toWrite: NewTransaction[] = [];
  const skippedRows: string[] = [];

  for (const row of parsed.rows) {
    const cashOnly =
      row.type === "DEPOSIT" || row.type === "WITHDRAWAL" || row.type === "FEE" || row.type === "TAX";
    const instrumentId = cashOnly ? null : (ids.get(`${row.source}|${row.symbol}`) ?? null);

    if (!cashOnly && instrumentId === null) {
      skippedRows.push(`Строка ${row.line}: инструмент «${row.symbol}» не найден`);
      continue;
    }

    toWrite.push({
      portfolioId,
      instrumentId,
      type: row.type,
      ts: row.date,
      quantity: row.quantity,
      price: row.price,
      amount: row.amount,
      fee: row.fee,
      tax: row.tax,
      currency: row.currency,
      note: row.note,
      source: "csv",
      externalId: row.externalId,
    });
  }

  const written = addTransactionsBulk(user.id, toWrite);

  // New instruments have no price yet; fetch so the dashboard is not blank.
  await refreshQuotes();

  revalidatePath("/dashboard");
  revalidatePath("/transactions");
  revalidatePath("/assets");

  const issues = [
    ...parsed.errors.map((issue) => `Строка ${issue.line}: ${issue.message}`),
    ...skippedRows,
  ];
  if (missing.length > 0) {
    issues.push(`Не найдены на бирже: ${[...new Set(missing)].join(", ")}`);
  }

  return {
    success: `Импортировано ${written.inserted} операций${
      written.skipped > 0 ? `, пропущено дубликатов: ${written.skipped}` : ""
    }`,
    issues: issues.length > 0 ? issues : undefined,
  };
}
