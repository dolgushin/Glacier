"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import {
  addTransaction,
  createCategory,
  createPortfolio,
  deleteCategory,
  deletePortfolio,
  deleteTransaction,
  findInstrument,
  renamePortfolio,
  requirePortfolio,
  setPrice,
  updateCategory,
  upsertInstrument,
} from "@/lib/repo";
import { today } from "@/lib/db";
import { fetchSecurityDetails, fetchHistory, marketFor } from "@/lib/providers/moex";
import { fetchCryptoHistory } from "@/lib/providers/coingecko";
import { refreshFx, refreshPayouts, refreshQuotes } from "@/lib/sync";
import type { InstrumentKind, TxType } from "@/lib/types";
import { instrumentsForUser } from "@/lib/repo";

export interface ActionState {
  error?: string;
  success?: string;
}

const text = (data: FormData, key: string) => String(data.get(key) ?? "").trim();
const num = (data: FormData, key: string, fallback = 0) => {
  // Accept both "1 234,56" and "1234.56" — people paste from broker reports.
  const raw = text(data, key).replace(/\s/g, "").replace(",", ".");
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
};

function fail(error: unknown): ActionState {
  return { error: error instanceof Error ? error.message : "Не удалось выполнить операцию" };
}

// ------------------------------------------------------------- portfolios

export async function createPortfolioAction(
  _previous: ActionState,
  data: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  try {
    createPortfolio(user.id, text(data, "name"), text(data, "currency") || "RUB", text(data, "broker"));
  } catch (error) {
    return fail(error);
  }
  revalidatePath("/portfolios");
  revalidatePath("/dashboard");
  return { success: "Портфель создан" };
}

export async function renamePortfolioAction(
  _previous: ActionState,
  data: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  try {
    renamePortfolio(user.id, Number(data.get("portfolioId")), text(data, "name"));
  } catch (error) {
    return fail(error);
  }
  revalidatePath("/portfolios");
  return { success: "Название обновлено" };
}

export async function deletePortfolioAction(
  _previous: ActionState,
  data: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  try {
    // Deleting a portfolio destroys its whole ledger — require the name typed back.
    const portfolio = requirePortfolio(user.id, Number(data.get("portfolioId")));
    if (text(data, "confirm") !== portfolio.name) {
      return { error: "Введите название портфеля в точности, чтобы подтвердить удаление" };
    }
    deletePortfolio(user.id, portfolio.id);
  } catch (error) {
    return fail(error);
  }
  revalidatePath("/portfolios");
  revalidatePath("/dashboard");
  return { success: "Портфель удалён" };
}

// ------------------------------------------------------------- categories

export async function createCategoryAction(
  _previous: ActionState,
  data: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  try {
    createCategory(
      user.id,
      Number(data.get("portfolioId")),
      text(data, "name"),
      num(data, "target"),
      text(data, "color") || "#64748b",
    );
  } catch (error) {
    return fail(error);
  }
  revalidatePath("/rebalance");
  revalidatePath("/portfolios");
  return { success: "Категория создана" };
}

export async function updateCategoryAction(
  _previous: ActionState,
  data: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  try {
    updateCategory(user.id, Number(data.get("categoryId")), {
      name: text(data, "name") || undefined,
      targetWeight: data.get("target") !== null ? num(data, "target") : undefined,
      color: text(data, "color") || undefined,
    });
  } catch (error) {
    return fail(error);
  }
  revalidatePath("/rebalance");
  revalidatePath("/portfolios");
  return { success: "Сохранено" };
}

export async function deleteCategoryAction(
  _previous: ActionState,
  data: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  try {
    deleteCategory(user.id, Number(data.get("categoryId")));
  } catch (error) {
    return fail(error);
  }
  revalidatePath("/rebalance");
  revalidatePath("/portfolios");
  return { success: "Категория удалена" };
}

// ----------------------------------------------------------- transactions

/**
 * Resolve the instrument the form is referring to, creating the catalog entry on
 * first use and enriching it with reference data (lot size, face value, coupon).
 */
async function resolveInstrument(data: FormData, userId: number): Promise<number | null> {
  const source = text(data, "source");
  const symbol = text(data, "symbol").toUpperCase();
  if (!symbol) return null;

  if (source === "manual") {
    const instrument = upsertInstrument({
      kind: "custom",
      symbol,
      name: text(data, "instrumentName") || symbol,
      currency: text(data, "currency") || "RUB",
      source: "manual",
      ownerUserId: userId,
    });
    // A custom asset has no feed; the user's stated price is the price.
    const price = num(data, "price");
    if (price > 0) setPrice(instrument.id, price, today());
    return instrument.id;
  }

  if (source === "coingecko") {
    const existing = findInstrument("coingecko", symbol);
    if (existing) return existing.id;
    return upsertInstrument({
      kind: "crypto",
      symbol,
      name: text(data, "instrumentName") || symbol,
      currency: "RUB",
      source: "coingecko",
      sourceId: text(data, "sourceId"),
      exchange: "CoinGecko",
    }).id;
  }

  // MOEX
  const kind = (text(data, "kind") || "share") as InstrumentKind;
  const board = text(data, "board") || (kind === "bond" ? "TQCB" : "TQBR");
  const existing = findInstrument("moex", symbol);
  if (existing) return existing.id;

  const details = await fetchSecurityDetails(symbol, kind, board);
  return upsertInstrument({
    kind,
    symbol,
    name: details.name || text(data, "instrumentName") || symbol,
    currency: details.currency || "RUB",
    source: "moex",
    sourceId: board,
    isin: text(data, "isin") || null,
    exchange: "MOEX",
    board,
    country: "RU",
    lotSize: details.lotSize ?? 1,
    faceValue: details.faceValue ?? null,
    couponValue: details.couponValue ?? null,
    couponPeriod: details.couponPeriod ?? null,
    maturityDate: details.maturityDate ?? null,
  }).id;
}

export async function addTransactionAction(
  _previous: ActionState,
  data: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const type = text(data, "type") as TxType;

  try {
    const portfolioId = Number(data.get("portfolioId"));
    requirePortfolio(user.id, portfolioId);

    // Cash-only operations carry no instrument.
    const cashOnly = type === "DEPOSIT" || type === "WITHDRAWAL" || type === "FEE" || type === "TAX";
    const instrumentId = cashOnly ? null : await resolveInstrument(data, user.id);

    if (!cashOnly && instrumentId === null) {
      return { error: "Выберите инструмент" };
    }

    const quantity = num(data, "quantity");
    const price = num(data, "price");
    if ((type === "BUY" || type === "SELL") && (quantity <= 0 || price <= 0)) {
      return { error: "Укажите количество и цену больше нуля" };
    }

    const amountField = num(data, "amount");
    const amount =
      type === "BUY" || type === "SELL"
        ? quantity * price
        : type === "SPLIT"
          ? 0
          : amountField;

    if (!cashOnly && type !== "BUY" && type !== "SELL" && type !== "SPLIT" && amount <= 0) {
      return { error: "Укажите сумму больше нуля" };
    }

    const categoryRaw = text(data, "categoryId");

    addTransaction(user.id, {
      portfolioId,
      instrumentId,
      categoryId: categoryRaw ? Number(categoryRaw) : null,
      type,
      ts: text(data, "date") || today(),
      quantity: type === "SPLIT" ? num(data, "ratio", 1) : quantity,
      price,
      amount,
      fee: num(data, "fee"),
      tax: num(data, "tax"),
      currency: text(data, "currency") || "RUB",
      fxRate: num(data, "fxRate", 1) || 1,
      note: text(data, "note"),
      source: "manual",
    });
  } catch (error) {
    return fail(error);
  }

  revalidatePath("/transactions");
  revalidatePath("/dashboard");
  revalidatePath("/assets");
  return { success: "Операция добавлена" };
}

export async function deleteTransactionAction(
  _previous: ActionState,
  data: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  try {
    deleteTransaction(user.id, Number(data.get("transactionId")));
  } catch (error) {
    return fail(error);
  }
  revalidatePath("/transactions");
  revalidatePath("/dashboard");
  return { success: "Операция удалена" };
}

// -------------------------------------------------------------- sync jobs

export async function refreshAllAction(): Promise<ActionState> {
  await requireUser();
  const [fx, quotes] = await Promise.all([refreshFx(), refreshQuotes()]);
  await refreshPayouts();
  revalidatePath("/dashboard");
  revalidatePath("/assets");
  return { success: `Обновлено котировок: ${quotes.updated}, курсов валют: ${fx.updated}` };
}

/**
 * Pull daily closes for everything the user holds, so the value chart has a
 * history on day one instead of accumulating one point per day.
 */
export async function backfillHistoryAction(
  _previous: ActionState,
  data: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const days = Math.min(Math.max(Number(data.get("days")) || 365, 30), 1825);
  const from = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

  let loaded = 0;
  try {
    for (const instrument of instrumentsForUser(user.id)) {
      if (instrument.source === "moex") {
        const board = instrument.board || (instrument.kind === "bond" ? "TQCB" : "TQBR");
        const history = await fetchHistory(instrument.symbol, board, marketFor(instrument.kind), from);
        for (const point of history) {
          // MOEX quotes bonds in percent of face; store money like everywhere else.
          const close =
            instrument.kind === "bond"
              ? (point.close / 100) * (instrument.face_value ?? 1000)
              : point.close;
          setPrice(instrument.id, close, point.date);
          loaded++;
        }
      } else if (instrument.source === "coingecko") {
        const history = await fetchCryptoHistory(instrument.source_id, Math.min(days, 365));
        for (const point of history) {
          setPrice(instrument.id, point.close, point.date);
          loaded++;
        }
      }
    }
  } catch (error) {
    return fail(error);
  }

  revalidatePath("/dashboard");
  return { success: `Загружено ${loaded} дневных котировок за ${days} дн.` };
}
