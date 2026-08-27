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
 * Binance spot.
 *
 * Signed requests are HMAC-SHA256 over the raw query string. The signature has
 * to cover the string exactly as sent, so the query is built once as text and
 * never re-encoded — running it through URLSearchParams twice is the classic
 * way to get a signature that is right in theory and rejected in practice.
 */

const BASE = "https://api.binance.com";
const BROKER = "Binance";

/** Quote assets we recognise when splitting a trading pair like BTCUSDT. */
const QUOTE_ASSETS = [
  "USDT", "FDUSD", "USDC", "TUSD", "BUSD", "BTC", "ETH", "BNB", "EUR", "TRY", "RUB", "DAI",
];

/** Coins that are cash, not an investment position. */
const STABLECOINS = new Set(["USDT", "USDC", "FDUSD", "TUSD", "BUSD", "DAI"]);

/**
 * Exported for testing against the signature example published in Binance's
 * own API documentation.
 */
export function signQuery(query: string, secret: string): string {
  return createHmac("sha256", secret).update(query).digest("hex");
}

function buildQuery(params: Record<string, string | number>): string {
  return Object.entries(params)
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
    .join("&");
}

async function signedGet<T>(
  credentials: Credentials,
  path: string,
  params: Record<string, string | number> = {},
): Promise<T> {
  const apiKey = credentials.apiKey?.trim();
  const secret = credentials.apiSecret?.trim();
  if (!apiKey || !secret) throw new BrokerError("Не указаны API key и secret");

  const query = buildQuery({ ...params, timestamp: Date.now(), recvWindow: 20_000 });
  const signature = signQuery(query, secret);

  return brokerFetch<T>({
    broker: BROKER,
    url: `${BASE}${path}?${query}&signature=${signature}`,
    headers: { "X-MBX-APIKEY": apiKey },
  });
}

// ----------------------------------------------------------------- accounts

interface AccountResponse {
  accountType?: string;
  canTrade?: boolean;
  balances?: { asset: string; free: string; locked: string }[];
}

async function listAccounts(credentials: Credentials): Promise<RemoteAccount[]> {
  const account = await signedGet<AccountResponse>(credentials, "/api/v3/account");
  // Binance has one spot account per key, so the "account list" is synthetic.
  return [
    {
      id: "spot",
      name: "Спотовый счёт",
      kind: account.accountType ? `Binance ${account.accountType}` : "Binance",
    },
  ];
}

// ---------------------------------------------------------------- balances

function describeCoin(asset: string): InstrumentDescriptor {
  return {
    source: "coingecko",
    symbol: asset.toUpperCase(),
    name: asset.toUpperCase(),
    kind: "crypto",
    currency: "RUB",
    // Resolved to a CoinGecko id by the sync engine via symbol lookup.
    sourceId: "",
  };
}

async function readBalances(credentials: Credentials): Promise<{ asset: string; total: number }[]> {
  const account = await signedGet<AccountResponse>(credentials, "/api/v3/account");
  return (account.balances ?? [])
    .map((balance) => ({
      asset: balance.asset.toUpperCase(),
      total: Number(balance.free ?? 0) + Number(balance.locked ?? 0),
    }))
    .filter((balance) => balance.total > 0);
}

async function fetchBalances(credentials: Credentials): Promise<RemoteBalance[]> {
  const balances = await readBalances(credentials);
  return balances
    .filter((balance) => !STABLECOINS.has(balance.asset))
    .map((balance) => ({ instrument: describeCoin(balance.asset), quantity: balance.total }));
}

// -------------------------------------------------------------- operations

interface MyTrade {
  id?: number;
  orderId?: number;
  symbol?: string;
  price?: string;
  qty?: string;
  quoteQty?: string;
  commission?: string;
  commissionAsset?: string;
  time?: number;
  isBuyer?: boolean;
}

/** "BTCUSDT" -> {base: "BTC", quote: "USDT"} */
export function splitPair(symbol: string): { base: string; quote: string } | null {
  const upper = symbol.toUpperCase();
  for (const quote of QUOTE_ASSETS) {
    if (upper.endsWith(quote) && upper.length > quote.length) {
      return { base: upper.slice(0, -quote.length), quote };
    }
  }
  return null;
}

/**
 * Binance will not enumerate trades across all pairs: /api/v3/myTrades requires
 * a symbol. The workable approach is to derive candidate pairs from the assets
 * currently held and query those.
 *
 * The consequence is honest and worth stating: a coin bought and fully sold
 * before the sync leaves no balance, so its pair is never queried and those
 * trades are missed. The UI says as much next to the connection.
 */
async function fetchOperations(
  credentials: Credentials,
  _accountId: string,
  from: Date,
  to: Date,
): Promise<LedgerOperation[]> {
  const balances = await readBalances(credentials);
  const held = balances.map((balance) => balance.asset).filter((asset) => !STABLECOINS.has(asset));

  // Pair each held coin with the stablecoins that are actually in the account,
  // falling back to USDT which is what most spot pairs are quoted in.
  const quotes = balances
    .map((balance) => balance.asset)
    .filter((asset) => STABLECOINS.has(asset));
  const candidateQuotes = quotes.length > 0 ? [...new Set([...quotes, "USDT"])] : ["USDT"];

  const operations: LedgerOperation[] = [];

  for (const base of held) {
    for (const quote of candidateQuotes) {
      if (base === quote) continue;
      let trades: MyTrade[];
      try {
        trades = await signedGet<MyTrade[]>(credentials, "/api/v3/myTrades", {
          symbol: `${base}${quote}`,
          startTime: from.getTime(),
          endTime: to.getTime(),
          limit: 1000,
        });
      } catch (error) {
        // An unknown pair answers 400; that just means this coin is not traded
        // against this quote asset.
        if (error instanceof BrokerError && /400/.test(error.message)) continue;
        throw error;
      }
      if (!Array.isArray(trades)) continue;

      for (const trade of trades) {
        if (!trade.id || !trade.symbol || !trade.time) continue;
        const quantity = Number(trade.qty ?? 0);
        const price = Number(trade.price ?? 0);
        if (!(quantity > 0) || !(price > 0)) continue;

        const commission = Number(trade.commission ?? 0);
        operations.push({
          externalId: `${trade.symbol}-${trade.id}`,
          type: trade.isBuyer ? "BUY" : "SELL",
          ts: new Date(trade.time).toISOString(),
          instrument: describeCoin(base),
          quantity,
          price,
          amount: quantity * price,
          // Only count the fee when it was charged in the quote currency;
          // a fee paid in BNB is a separate asset, not part of this trade's cost.
          fee: trade.commissionAsset?.toUpperCase() === quote ? commission : 0,
          tax: 0,
          currency: quote,
          note: `${trade.symbol}`,
        });
      }
    }
  }

  return operations;
}

export const binanceAdapter: BrokerAdapter = {
  id: "binance",
  name: "Binance",
  summary:
    "Спотовые сделки и остатки по криптовалютам. Нужен API-ключ с правом только на чтение.",
  docsUrl: "https://www.binance.com/en/my/settings/api-management",
  docsLabel: "Управление API-ключами",
  maxHistoryDays: 365,
  providesCashFlow: false,
  credentialFields: [
    {
      key: "apiKey",
      label: "API Key",
      type: "text",
      required: true,
      placeholder: "vmPUZE6mv9SD5VNHk4HlWFsOr6aKE2zv…",
      hint: "Создавайте ключ без права на вывод средств и без права торговли.",
    },
    {
      key: "apiSecret",
      label: "Secret Key",
      type: "password",
      required: true,
      hint: "Показывается только один раз при создании ключа.",
    },
  ],
  listAccounts,
  fetchOperations,
  fetchBalances,
};
