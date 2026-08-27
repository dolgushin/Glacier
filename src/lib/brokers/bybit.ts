import { createHmac } from "node:crypto";
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

/**
 * Bybit v5.
 *
 * Unlike Binance, Bybit will enumerate executions without naming a symbol, so a
 * full trade history is reachable by paging. The signature covers
 * timestamp + apiKey + recvWindow + queryString, in that exact order.
 */

const BASE = "https://api.bybit.com";
const BROKER = "Bybit";
const RECV_WINDOW = "20000";

const STABLECOINS = new Set(["USDT", "USDC", "DAI", "TUSD", "BUSD"]);

/** Exported for testing: the exact preimage Bybit expects. */
export function signaturePayload(
  timestamp: string,
  apiKey: string,
  recvWindow: string,
  query: string,
): string {
  return `${timestamp}${apiKey}${recvWindow}${query}`;
}

export function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

interface BybitEnvelope<T> {
  retCode?: number;
  retMsg?: string;
  result?: T;
}

async function signedGet<T>(
  credentials: Credentials,
  path: string,
  params: Record<string, string | number> = {},
): Promise<T> {
  const apiKey = credentials.apiKey?.trim();
  const secret = credentials.apiSecret?.trim();
  if (!apiKey || !secret) throw new BrokerError("Не указаны API key и secret");

  const query = Object.entries(params)
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
    .join("&");
  const timestamp = String(Date.now());
  const signature = sign(signaturePayload(timestamp, apiKey, RECV_WINDOW, query), secret);

  const payload = await brokerFetch<BybitEnvelope<T>>({
    broker: BROKER,
    url: query ? `${BASE}${path}?${query}` : `${BASE}${path}`,
    headers: {
      "X-BAPI-API-KEY": apiKey,
      "X-BAPI-TIMESTAMP": timestamp,
      "X-BAPI-RECV-WINDOW": RECV_WINDOW,
      "X-BAPI-SIGN": signature,
    },
  });

  // Bybit answers HTTP 200 with an error code in the body, so the envelope has
  // to be checked explicitly or failures pass silently as empty results.
  if (payload.retCode !== 0) {
    const code = payload.retCode;
    if (code === 10003 || code === 10004 || code === 10005) {
      throw new BrokerError(
        `Bybit отклонил ключ: ${payload.retMsg ?? "ошибка авторизации"} (код ${code}).`,
        "Проверьте API key и secret, а также ограничение по IP в настройках ключа.",
      );
    }
    if (code === 10002) {
      throw new BrokerError(
        "Bybit: расхождение времени между сервером и биржей.",
        "Синхронизируйте системные часы этой машины.",
      );
    }
    throw new BrokerError(`Bybit вернул ошибку: ${payload.retMsg ?? "неизвестно"} (код ${code}).`);
  }

  return payload.result as T;
}

// ----------------------------------------------------------------- accounts

async function listAccounts(credentials: Credentials): Promise<RemoteAccount[]> {
  // Reading the wallet is the cheapest call that proves the key works.
  await signedGet<unknown>(credentials, "/v5/account/wallet-balance", {
    accountType: "UNIFIED",
  });
  return [{ id: "UNIFIED", name: "Единый торговый счёт", kind: "Bybit Unified" }];
}

// ---------------------------------------------------------------- balances

function describeCoin(asset: string): InstrumentDescriptor {
  return {
    source: "coingecko",
    symbol: asset.toUpperCase(),
    name: asset.toUpperCase(),
    kind: "crypto",
    currency: "RUB",
    sourceId: "",
  };
}

interface WalletBalance {
  list?: { coin?: { coin?: string; walletBalance?: string }[] }[];
}

async function fetchBalances(
  credentials: Credentials,
  accountId: string,
): Promise<RemoteBalance[]> {
  const result = await signedGet<WalletBalance>(credentials, "/v5/account/wallet-balance", {
    accountType: accountId || "UNIFIED",
  });

  const balances: RemoteBalance[] = [];
  for (const account of result?.list ?? []) {
    for (const entry of account.coin ?? []) {
      const asset = entry.coin?.toUpperCase();
      const quantity = Number(entry.walletBalance ?? 0);
      if (!asset || !(quantity > 0) || STABLECOINS.has(asset)) continue;
      balances.push({ instrument: describeCoin(asset), quantity });
    }
  }
  return balances;
}

// -------------------------------------------------------------- operations

interface Execution {
  execId?: string;
  symbol?: string;
  side?: string;
  execPrice?: string;
  execQty?: string;
  execFee?: string;
  feeCurrency?: string;
  execTime?: string;
}

const QUOTE_ASSETS = ["USDT", "USDC", "BTC", "ETH", "EUR", "DAI"];

function splitPair(symbol: string): { base: string; quote: string } | null {
  const upper = symbol.toUpperCase();
  for (const quote of QUOTE_ASSETS) {
    if (upper.endsWith(quote) && upper.length > quote.length) {
      return { base: upper.slice(0, -quote.length), quote };
    }
  }
  return null;
}

/**
 * Bybit caps each execution query at a 7-day window, so a long history has to
 * be walked week by week, each week paged by cursor.
 */
async function fetchOperations(
  credentials: Credentials,
  _accountId: string,
  from: Date,
  to: Date,
): Promise<LedgerOperation[]> {
  const WEEK = 7 * 86_400_000;
  const operations: LedgerOperation[] = [];
  const seen = new Set<string>();

  // Guard the loop: a five-year range is 260 windows, and each window may page.
  let windowStart = Math.max(from.getTime(), to.getTime() - 2 * 365 * 86_400_000);
  let windows = 0;

  while (windowStart < to.getTime() && windows++ < 120) {
    const windowEnd = Math.min(windowStart + WEEK, to.getTime());
    let cursor = "";

    for (let page = 0; page < 20; page++) {
      const result = await signedGet<{ list?: Execution[]; nextPageCursor?: string }>(
        credentials,
        "/v5/execution/list",
        {
          category: "spot",
          startTime: windowStart,
          endTime: windowEnd,
          limit: 100,
          ...(cursor ? { cursor } : {}),
        },
      );

      for (const execution of result?.list ?? []) {
        if (!execution.execId || !execution.symbol || !execution.execTime) continue;
        if (seen.has(execution.execId)) continue;
        seen.add(execution.execId);

        const pair = splitPair(execution.symbol);
        if (!pair) continue;

        const quantity = Number(execution.execQty ?? 0);
        const price = Number(execution.execPrice ?? 0);
        if (!(quantity > 0) || !(price > 0)) continue;

        const fee = Number(execution.execFee ?? 0);
        operations.push({
          externalId: execution.execId,
          type: execution.side?.toLowerCase() === "buy" ? "BUY" : "SELL",
          ts: new Date(Number(execution.execTime)).toISOString(),
          instrument: describeCoin(pair.base),
          quantity,
          price,
          amount: quantity * price,
          fee: execution.feeCurrency?.toUpperCase() === pair.quote ? Math.abs(fee) : 0,
          tax: 0,
          currency: pair.quote,
          note: execution.symbol,
        });
      }

      cursor = result?.nextPageCursor ?? "";
      if (!cursor) break;
    }

    windowStart = windowEnd;
  }

  return operations;
}

export const bybitAdapter: BrokerAdapter = {
  id: "bybit",
  name: "Bybit",
  summary:
    "Спотовые сделки и остатки единого торгового счёта. Нужен API-ключ с правом только на чтение.",
  docsUrl: "https://www.bybit.com/app/user/api-management",
  docsLabel: "Управление API-ключами",
  maxHistoryDays: 730,
  providesCashFlow: false,
  credentialFields: [
    {
      key: "apiKey",
      label: "API Key",
      type: "text",
      required: true,
      hint: "Создавайте ключ только с правами на чтение, без вывода средств.",
    },
    { key: "apiSecret", label: "API Secret", type: "password", required: true },
  ],
  listAccounts,
  fetchOperations,
  fetchBalances,
};
