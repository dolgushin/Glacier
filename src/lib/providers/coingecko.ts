/**
 * CoinGecko public API. The free tier is unauthenticated but rate-limited to
 * roughly 10-30 calls/minute, so every call here is batched and the results are
 * cached in the `prices` table rather than fetched per render.
 */

const API = "https://api.coingecko.com/api/v3";
const TIMEOUT_MS = 15_000;

async function cg<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  const url = new URL(`${API}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));

  const key = process.env.COINGECKO_API_KEY;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ...(key ? { "x-cg-demo-api-key": key } : {}),
      },
    });
    if (response.status === 429) throw new Error("CoinGecko rate limit reached, try again in a minute");
    if (!response.ok) throw new Error(`CoinGecko ${response.status}`);
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export interface CryptoAsset {
  id: string;
  symbol: string;
  name: string;
}

export async function searchCrypto(query: string, limit = 15): Promise<CryptoAsset[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  try {
    const payload = await cg<{ coins?: { id: string; symbol: string; name: string }[] }>("/search", {
      query: trimmed,
    });
    return (payload.coins ?? []).slice(0, limit).map((coin) => ({
      id: coin.id,
      symbol: coin.symbol.toUpperCase(),
      name: coin.name,
    }));
  } catch {
    return [];
  }
}

/** Spot prices for many coins at once, quoted in `currency`. */
export async function fetchCryptoPrices(
  ids: string[],
  currency = "rub",
): Promise<Map<string, number>> {
  const prices = new Map<string, number>();
  if (ids.length === 0) return prices;

  const vs = currency.toLowerCase();
  for (let offset = 0; offset < ids.length; offset += 100) {
    const chunk = ids.slice(offset, offset + 100);
    try {
      const payload = await cg<Record<string, Record<string, number>>>("/simple/price", {
        ids: chunk.join(","),
        vs_currencies: vs,
      });
      for (const [id, quote] of Object.entries(payload)) {
        const price = quote?.[vs];
        if (typeof price === "number" && Number.isFinite(price)) prices.set(id, price);
      }
    } catch {
      // Keep whatever is already cached.
    }
  }
  return prices;
}

/** Daily closes for a coin over the last `days` days. */
export async function fetchCryptoHistory(
  id: string,
  days = 365,
  currency = "rub",
): Promise<{ date: string; close: number }[]> {
  try {
    const payload = await cg<{ prices?: [number, number][] }>(`/coins/${id}/market_chart`, {
      vs_currency: currency.toLowerCase(),
      days,
      interval: "daily",
    });
    const byDate = new Map<string, number>();
    for (const [timestamp, price] of payload.prices ?? []) {
      byDate.set(new Date(timestamp).toISOString().slice(0, 10), price);
    }
    return [...byDate].map(([date, close]) => ({ date, close }));
  } catch {
    return [];
  }
}
