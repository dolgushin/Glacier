import { brokerFetch } from "@/lib/brokers/http";
import {
  BrokerError,
  type BrokerAdapter,
  type Credentials,
  type InstrumentDescriptor,
  type LedgerOperation,
  type RemoteAccount,
  type RemoteBalance,
} from "@/lib/brokers/types";
import { derivativeKind, expiryFromSymbol } from "@/lib/brokers/derivatives";
import { isDerivative, type InstrumentKind, type TxType } from "@/lib/types";

/**
 * T-Invest (Т-Инвестиции).
 *
 * The gRPC contract is exposed over HTTP POST: each method is a URL, each body
 * is JSON, and money arrives as {units, nano} rather than a number. A read-only
 * token is sufficient — nothing here places an order.
 */

const BASE = "https://invest-public-api.tinkoff.ru/rest/tinkoff.public.invest.api.contract.v1";
const BROKER = "Т-Инвестиции";

function call<T>(service: string, method: string, token: string, body: unknown): Promise<T> {
  return brokerFetch<T>({
    broker: BROKER,
    url: `${BASE}.${service}/${method}`,
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body ?? {}),
  });
}

interface MoneyValue {
  units?: string | number;
  nano?: number;
  currency?: string;
}

/** {units: "123", nano: 450000000} -> 123.45 */
function toNumber(value: MoneyValue | undefined | null): number {
  if (!value) return 0;
  const units = Number(value.units ?? 0);
  const nano = Number(value.nano ?? 0);
  if (!Number.isFinite(units) || !Number.isFinite(nano)) return 0;
  return units + nano / 1e9;
}

const normaliseCurrency = (value: string | undefined): string =>
  (value ?? "rub").toUpperCase().replace("SUR", "RUB");

// ----------------------------------------------------------------- accounts

const ACCOUNT_TYPES: Record<string, string> = {
  ACCOUNT_TYPE_TINKOFF: "Брокерский счёт",
  ACCOUNT_TYPE_TINKOFF_IIS: "ИИС",
  ACCOUNT_TYPE_INVEST_BOX: "Инвесткопилка",
  ACCOUNT_TYPE_INVEST_FUND: "Фонд",
};

async function listAccounts(credentials: Credentials): Promise<RemoteAccount[]> {
  const token = credentials.token?.trim();
  if (!token) throw new BrokerError("Не указан токен");

  const payload = await call<{
    accounts?: { id: string; name?: string; type?: string; status?: string }[];
  }>("UsersService", "GetAccounts", token, {});

  const accounts = (payload.accounts ?? [])
    // A closed account has no future operations worth syncing.
    .filter((account) => account.status !== "ACCOUNT_STATUS_CLOSED")
    .map((account) => ({
      id: account.id,
      name: account.name || "Брокерский счёт",
      kind: ACCOUNT_TYPES[account.type ?? ""] ?? undefined,
    }));

  if (accounts.length === 0) {
    throw new BrokerError(
      "Токен действителен, но не видит ни одного открытого счёта.",
      "Убедитесь, что токен создан для того же клиента, у которого есть брокерский счёт.",
    );
  }
  return accounts;
}

// --------------------------------------------------------------- catalogue

interface RawInstrument {
  ticker?: string;
  name?: string;
  currency?: string;
  lot?: number;
  isin?: string;
  figi?: string;
  instrumentType?: string;
  nominal?: MoneyValue;
  maturityDate?: string;
}

function mapKind(instrumentType: string): InstrumentKind {
  switch (instrumentType.toLowerCase()) {
    case "share":
      return "share";
    case "bond":
      return "bond";
    case "etf":
      return "etf";
    case "currency":
      return "currency";
    case "futures":
      return "futures";
    case "option":
      return "option";
    default:
      return "custom";
  }
}

/**
 * Resolve a FIGI to catalog data. Cached per sync run by the caller, since a
 * portfolio of 40 positions would otherwise issue 40 lookups per page of
 * operations.
 */
async function describeInstrument(
  token: string,
  figi: string,
): Promise<InstrumentDescriptor | null> {
  if (!figi) return null;

  try {
    const payload = await call<{ instrument?: RawInstrument }>(
      "InstrumentsService",
      "GetInstrumentBy",
      token,
      { idType: "INSTRUMENT_ID_TYPE_FIGI", id: figi },
    );
    const raw = payload.instrument;
    if (!raw?.ticker) return null;

    const declared = mapKind(raw.instrumentType ?? "");
    // The ticker is consulted only where the catalog gave nothing useful, so a
    // contract T-Invest classified itself still wins over the pattern match.
    const kind =
      declared === "custom" ? (derivativeKind(raw.ticker) ?? declared) : declared;
    // Derivatives trade on FORTS, not on the stock market: leaving the board
    // empty keeps them out of the TQBR quote request that can never match them.
    const board = isDerivative(kind) ? "" : kind === "bond" ? "TQCB" : "TQBR";
    return {
      source: "moex",
      symbol: raw.ticker.toUpperCase(),
      name: raw.name ?? raw.ticker,
      kind,
      currency: normaliseCurrency(raw.currency),
      board,
      sourceId: board,
      isin: raw.isin || null,
      figi: raw.figi ?? figi,
      lotSize: raw.lot ?? 1,
      faceValue: raw.nominal ? toNumber(raw.nominal) : null,
      maturityDate:
        (raw.maturityDate ? raw.maturityDate.slice(0, 10) : null) ??
        (isDerivative(kind) ? expiryFromSymbol(raw.ticker) : null),
    };
  } catch (error) {
    // One unknown instrument must not abort a whole sync; the engine counts it.
    if (error instanceof BrokerError && error.message.includes("отклонил ключ")) throw error;
    return null;
  }
}

// -------------------------------------------------------------- operations

/** T-Invest operation type -> ledger type. Unmapped types are ignored. */
const OPERATION_MAP: Record<string, TxType> = {
  OPERATION_TYPE_BUY: "BUY",
  OPERATION_TYPE_BUY_CARD: "BUY",
  OPERATION_TYPE_BUY_MARGIN: "BUY",
  OPERATION_TYPE_SELL: "SELL",
  OPERATION_TYPE_SELL_MARGIN: "SELL",
  OPERATION_TYPE_DIVIDEND: "DIVIDEND",
  OPERATION_TYPE_COUPON: "COUPON",
  OPERATION_TYPE_BOND_REPAYMENT: "REDEMPTION",
  OPERATION_TYPE_BOND_REPAYMENT_FULL: "REDEMPTION",
  OPERATION_TYPE_DIVIDEND_TAX: "TAX",
  OPERATION_TYPE_BOND_TAX: "TAX",
  OPERATION_TYPE_TAX: "TAX",
  OPERATION_TYPE_TAX_CORRECTION: "TAX",
  OPERATION_TYPE_BROKER_FEE: "FEE",
  OPERATION_TYPE_SERVICE_FEE: "FEE",
  OPERATION_TYPE_MARGIN_FEE: "FEE",
  OPERATION_TYPE_SUCCESS_FEE: "FEE",
  OPERATION_TYPE_INPUT: "DEPOSIT",
  OPERATION_TYPE_OUTPUT: "WITHDRAWAL",
};

interface RawOperation {
  id?: string;
  figi?: string;
  date?: string;
  operationType?: string;
  payment?: MoneyValue;
  price?: MoneyValue;
  quantity?: string | number;
  currency?: string;
}

async function fetchOperations(
  credentials: Credentials,
  accountId: string,
  from: Date,
  to: Date,
): Promise<LedgerOperation[]> {
  const token = credentials.token?.trim();
  if (!token) throw new BrokerError("Не указан токен");

  const payload = await call<{ operations?: RawOperation[] }>(
    "OperationsService",
    "GetOperations",
    token,
    {
      accountId,
      from: from.toISOString(),
      to: to.toISOString(),
      state: "OPERATION_STATE_EXECUTED",
    },
  );

  const raws = payload.operations ?? [];

  // Resolve each distinct FIGI once, not once per operation.
  const descriptors = new Map<string, InstrumentDescriptor | null>();
  for (const figi of new Set(raws.map((operation) => operation.figi).filter(Boolean) as string[])) {
    descriptors.set(figi, await describeInstrument(token, figi));
  }

  const operations: LedgerOperation[] = [];

  for (const raw of raws) {
    const type = OPERATION_MAP[raw.operationType ?? ""];
    // Unknown or unexecuted operations are skipped rather than guessed at.
    if (!type || !raw.id || !raw.date) continue;

    const amount = Math.abs(toNumber(raw.payment));
    const quantity = Math.abs(Number(raw.quantity ?? 0)) || 0;
    if (amount === 0 && quantity === 0) continue;

    operations.push({
      externalId: raw.id,
      type,
      ts: raw.date,
      instrument: raw.figi ? (descriptors.get(raw.figi) ?? null) : null,
      quantity,
      price: toNumber(raw.price),
      amount,
      fee: 0,
      tax: 0,
      currency: normaliseCurrency(raw.payment?.currency ?? raw.currency),
    });
  }

  return operations;
}

// ---------------------------------------------------------------- balances

async function fetchBalances(
  credentials: Credentials,
  accountId: string,
): Promise<RemoteBalance[]> {
  const token = credentials.token?.trim();
  if (!token) throw new BrokerError("Не указан токен");

  const payload = await call<{
    positions?: { figi?: string; quantity?: MoneyValue; averagePositionPrice?: MoneyValue }[];
  }>("OperationsService", "GetPortfolio", token, { accountId });

  const balances: RemoteBalance[] = [];
  for (const position of payload.positions ?? []) {
    const quantity = toNumber(position.quantity);
    if (!position.figi || quantity === 0) continue;
    const instrument = await describeInstrument(token, position.figi);
    if (!instrument) continue;
    // A MoneyValue carries its own currency, so this is money, not a percentage.
    const averagePrice = position.averagePositionPrice ? toNumber(position.averagePositionPrice) : null;
    balances.push({ instrument, quantity, averagePrice: averagePrice || null });
  }
  return balances;
}

export const tinvestAdapter: BrokerAdapter = {
  id: "tinvest",
  name: "Т-Инвестиции",
  summary: "Акции, облигации и фонды МосБиржи. Нужен токен T-Invest API с правом только на чтение.",
  docsUrl: "https://www.tbank.ru/invest/settings/api/",
  docsLabel: "Где взять токен",
  maxHistoryDays: 365 * 5,
  providesCashFlow: true,
  credentialFields: [
    {
      key: "token",
      label: "Токен T-Invest API",
      type: "password",
      required: true,
      placeholder: "t.xxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      hint: "Личный кабинет → Настройки → Токены. Выбирайте режим «только чтение».",
    },
  ],
  listAccounts,
  fetchOperations,
  fetchBalances,
};
