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
import type { InstrumentKind } from "@/lib/types";

/**
 * Алор — Alor OpenAPI v2.
 *
 * Authentication is two-stage: a long-lived refresh token from the personal
 * cabinet is exchanged for a short-lived JWT (~25 minutes), and the JWT signs
 * every data request. Nothing is stored but the refresh token.
 *
 * Portfolio discovery comes from the JWT itself — its payload carries the list
 * of portfolio codes the token may read, so no extra endpoint is needed.
 */

const OAUTH = "https://oauth.alor.ru";
const API = "https://api.alor.ru";
const BROKER = "Алор";

/** Alor portfolio codes carry their market in the prefix. */
export function marketOf(portfolio: string): string {
  const code = portfolio.toUpperCase();
  if (code.startsWith("D")) return "Фондовый рынок";
  if (code.startsWith("G")) return "Валютный рынок";
  if (/^7/.test(code)) return "Срочный рынок";
  return "Счёт";
}

// ------------------------------------------------------------------ auth

async function getJwt(credentials: Credentials): Promise<string> {
  const refresh = credentials.refreshToken?.trim();
  if (!refresh) throw new BrokerError("Не указан refresh-токен");

  const payload = await brokerFetch<{ AccessToken?: string }>({
    broker: BROKER,
    url: `${OAUTH}/refresh?token=${encodeURIComponent(refresh)}`,
    method: "POST",
    headers: { Accept: "application/json" },
  });

  if (!payload.AccessToken) {
    throw new BrokerError(
      "Алор не вернул JWT в ответ на refresh-токен.",
      "Проверьте, что токен скопирован целиком и не отозван в личном кабинете на alor.dev.",
    );
  }
  return payload.AccessToken;
}

/**
 * Read the portfolio list out of the JWT payload.
 *
 * The signature is not verified here on purpose: this is our own token, the
 * server is the one enforcing access, and all we want is the list of codes to
 * offer the user. Verifying it locally would add a dependency and prove nothing.
 */
export function portfoliosFromJwt(jwt: string): string[] {
  const part = jwt.split(".")[1];
  if (!part) return [];

  try {
    const json = Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const claims = JSON.parse(json) as Record<string, unknown>;

    // The claim is a space-separated string in current tokens, but an array in
    // older ones — accept both rather than guess.
    const raw = claims.portfolios ?? claims.agreements;
    if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
    if (typeof raw === "string") return raw.split(/[\s,]+/).filter(Boolean);
    return [];
  } catch {
    return [];
  }
}

function get<T>(jwt: string, path: string, params: Record<string, string | number> = {}): Promise<T> {
  const query = Object.entries(params)
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
    .join("&");

  return brokerFetch<T>({
    broker: BROKER,
    url: `${API}${path}${query ? `?${query}` : ""}`,
    headers: { Authorization: `Bearer ${jwt}`, Accept: "application/json" },
  });
}

// -------------------------------------------------------------- accounts

/** Account id encodes the exchange too, so the paths need no extra state. */
export function splitAccountId(accountId: string): { exchange: string; portfolio: string } {
  const [exchange, portfolio] = accountId.includes(":")
    ? accountId.split(":")
    : ["MOEX", accountId];
  return { exchange: exchange || "MOEX", portfolio };
}

async function listAccounts(credentials: Credentials): Promise<RemoteAccount[]> {
  const jwt = await getJwt(credentials);
  const portfolios = portfoliosFromJwt(jwt);

  if (portfolios.length === 0) {
    throw new BrokerError(
      "Токен принят, но в нём нет ни одного портфеля.",
      "Убедитесь, что токен выпущен для торгового счёта, а не только для рыночных данных.",
    );
  }

  return portfolios.map((portfolio) => ({
    id: `MOEX:${portfolio}`,
    name: portfolio,
    kind: marketOf(portfolio),
  }));
}

// ------------------------------------------------------------ catalogue

/** MOEX board code -> instrument kind. */
export function kindFromBoard(board: string): InstrumentKind {
  const code = (board || "").toUpperCase();
  if (/^(TQCB|TQOB|TQIR|TQRD|TQUD|EQOB|EQQI|PSOB)/.test(code)) return "bond";
  if (/^(TQTF|TQIF|TQBF)/.test(code)) return "etf";
  if (/^(TQBR|TQPI|SMAL|TQDE|EQNE)/.test(code)) return "share";
  return "share";
}

function describe(symbol: string, board: string, name?: string): InstrumentDescriptor {
  const kind = kindFromBoard(board);
  return {
    source: "moex",
    symbol: symbol.toUpperCase(),
    name: name || symbol.toUpperCase(),
    kind,
    currency: "RUB",
    board: board || (kind === "bond" ? "TQCB" : "TQBR"),
    sourceId: board || (kind === "bond" ? "TQCB" : "TQBR"),
  };
}

// ------------------------------------------------------------ operations

interface AlorTrade {
  id?: string | number;
  symbol?: string;
  board?: string;
  exchange?: string;
  date?: string;
  side?: string;
  qty?: number;
  qtyUnits?: number;
  qtyBatch?: number;
  price?: number;
  volume?: number;
  accruedInt?: number;
  commission?: number;
}

async function fetchOperations(
  credentials: Credentials,
  accountId: string,
  from: Date,
  to: Date,
): Promise<LedgerOperation[]> {
  const jwt = await getJwt(credentials);
  const { exchange, portfolio } = splitAccountId(accountId);

  const operations: LedgerOperation[] = [];
  const seen = new Set<string>();
  let cursor = "";

  // The endpoint caps a response at 1000 rows and pages by the id of the last
  // trade already seen, so walk until a short page comes back.
  for (let page = 0; page < 40; page++) {
    const trades = await get<AlorTrade[]>(
      jwt,
      `/md/v2/Stats/${exchange}/${encodeURIComponent(portfolio)}/history/trades`,
      {
        dateFrom: from.toISOString().slice(0, 10),
        limit: 1000,
        ...(cursor ? { from: cursor } : {}),
      },
    );

    if (!Array.isArray(trades) || trades.length === 0) break;

    for (const trade of trades) {
      const id = trade.id === undefined ? "" : String(trade.id);
      if (!id || seen.has(id)) continue;
      seen.add(id);

      if (!trade.symbol || !trade.date) continue;
      const stamp = new Date(trade.date);
      if (Number.isNaN(stamp.getTime()) || stamp > to) continue;

      const quantity = Number(trade.qtyUnits ?? trade.qty ?? 0);
      if (!(quantity > 0)) continue;

      /*
       * Bonds are quoted in percent of face value, shares in roubles. The
       * `volume` field is the money value of the trade either way, so deriving
       * the unit price from it keeps one code path for both — and matches how
       * prices are stored everywhere else in this app.
       */
      const rawPrice = Number(trade.price ?? 0);
      const volume = Number(trade.volume ?? 0);
      const price = volume > 0 ? volume / quantity : rawPrice;
      if (!(price > 0)) continue;

      operations.push({
        externalId: id,
        type: (trade.side ?? "").toLowerCase() === "sell" ? "SELL" : "BUY",
        ts: stamp.toISOString(),
        instrument: describe(trade.symbol, trade.board ?? ""),
        quantity,
        price,
        amount: quantity * price,
        fee: Math.abs(Number(trade.commission ?? 0)),
        tax: 0,
        currency: "RUB",
        note: trade.board ? `${trade.symbol} · ${trade.board}` : trade.symbol,
      });
    }

    if (trades.length < 1000) break;
    const last = trades[trades.length - 1];
    const nextCursor = last?.id === undefined ? "" : String(last.id);
    // No forward progress means the cursor is not advancing; stop rather than loop.
    if (!nextCursor || nextCursor === cursor) break;
    cursor = nextCursor;
  }

  return operations;
}

// -------------------------------------------------------------- balances

interface AlorPosition {
  symbol?: string;
  shortName?: string;
  exchange?: string;
  qtyUnits?: number;
  avgPrice?: number;
  lotSize?: number;
  isCurrency?: boolean;
}

async function fetchBalances(
  credentials: Credentials,
  accountId: string,
): Promise<RemoteBalance[]> {
  const jwt = await getJwt(credentials);
  const { exchange, portfolio } = splitAccountId(accountId);

  const positions = await get<AlorPosition[]>(
    jwt,
    `/md/v2/Clients/${exchange}/${encodeURIComponent(portfolio)}/positions`,
    { withoutCurrency: "true" },
  );

  if (!Array.isArray(positions)) return [];

  const balances: RemoteBalance[] = [];
  for (const position of positions) {
    const quantity = Number(position.qtyUnits ?? 0);
    if (!position.symbol || !(quantity > 0) || position.isCurrency) continue;
    balances.push({
      // The positions endpoint reports no board, so the kind is inferred later
      // from the MOEX catalogue when the instrument is resolved.
      instrument: describe(position.symbol, "", position.shortName),
      quantity,
    });
  }
  return balances;
}

export const alorAdapter: BrokerAdapter = {
  id: "alor",
  name: "Алор",
  summary:
    "Акции, облигации и фонды МосБиржи. Нужен refresh-токен Alor OpenAPI с правом только на чтение.",
  docsUrl: "https://alor.dev/open-api-tokens",
  docsLabel: "Где взять токен",
  maxHistoryDays: 365 * 3,
  // The endpoint returns trades only; deposits and withdrawals do not come through.
  providesCashFlow: false,
  credentialFields: [
    {
      key: "refreshToken",
      label: "Refresh-токен Alor OpenAPI",
      type: "password",
      required: true,
      placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
      hint: "Личный кабинет разработчика на alor.dev → Токены. Достаточно доступа только на чтение.",
    },
  ],
  listAccounts,
  fetchOperations,
  fetchBalances,
};
