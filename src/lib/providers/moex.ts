import type { InstrumentKind } from "@/lib/types";

/**
 * MOEX ISS. Free, no key, no registration — but it answers with a column-array
 * format ({columns: [...], data: [[...]]}) that has to be zipped into objects,
 * and it will happily return HTTP 200 with an HTML error page. Everything here
 * fails soft: a dead source must degrade the app, not break it.
 */

const ISS = "https://iss.moex.com/iss";
const TIMEOUT_MS = 15_000;

type Block = { columns: string[]; data: unknown[][] };

async function iss(path: string, params: Record<string, string | number> = {}): Promise<Record<string, Block>> {
  const url = new URL(`${ISS}${path}`);
  url.searchParams.set("iss.meta", "off");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`MOEX ${response.status} for ${url.pathname}`);
    const text = await response.text();
    if (!text.trimStart().startsWith("{")) throw new Error(`MOEX returned non-JSON for ${url.pathname}`);
    return JSON.parse(text) as Record<string, Block>;
  } finally {
    clearTimeout(timer);
  }
}

/** Zip ISS's {columns, data} into plain objects. */
function rows(block: Block | undefined): Record<string, unknown>[] {
  if (!block?.columns || !Array.isArray(block.data)) return [];
  return block.data.map((row) => {
    const object: Record<string, unknown> = {};
    block.columns.forEach((column, index) => {
      object[column] = row[index];
    });
    return object;
  });
}

const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const str = (value: unknown): string => (value == null ? "" : String(value));

// ------------------------------------------------------------- instruments

export interface MoexSecurity {
  secid: string;
  name: string;
  isin: string;
  kind: InstrumentKind;
  board: string;
  market: string;
  currency: string;
  lotSize: number;
  faceValue: number | null;
  couponValue: number | null;
  couponPeriod: number | null;
  maturityDate: string | null;
}

/** ISS `type` -> our instrument kind. Anything unrecognised is skipped. */
function mapKind(type: string): InstrumentKind | null {
  if (type.includes("bond")) return "bond";
  if (type === "common_share" || type === "preferred_share") return "share";
  if (type.includes("ppif") || type.includes("etf")) return "etf";
  if (type.includes("currency")) return "currency";
  return null;
}

function marketFor(kind: InstrumentKind): string {
  return kind === "bond" ? "bonds" : "shares";
}

/** Full-text search across traded MOEX stock-market securities. */
export async function searchSecurities(query: string, limit = 20): Promise<MoexSecurity[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const found: MoexSecurity[] = [];
  // Shares and bonds live in different ISS markets; ask both.
  for (const market of ["shares", "bonds"]) {
    try {
      const data = await iss("/securities.json", {
        q: trimmed,
        engine: "stock",
        market,
        is_trading: 1,
        limit,
        "securities.columns": "secid,shortname,isin,type,primary_boardid,is_traded",
      });
      for (const row of rows(data.securities)) {
        const kind = mapKind(str(row.type));
        if (!kind || !row.is_traded) continue;
        found.push({
          secid: str(row.secid),
          name: str(row.shortname),
          isin: str(row.isin),
          kind,
          board: str(row.primary_boardid),
          market,
          currency: "RUB",
          lotSize: 1,
          faceValue: null,
          couponValue: null,
          couponPeriod: null,
          maturityDate: null,
        });
      }
    } catch {
      // One market being down must not blank the whole search.
    }
  }

  // Exact ticker match first, then prefix, then the rest.
  const upper = trimmed.toUpperCase();
  return found
    .sort((a, b) => {
      const score = (s: MoexSecurity) =>
        s.secid === upper ? 0 : s.secid.startsWith(upper) ? 1 : 2;
      return score(a) - score(b) || a.secid.localeCompare(b.secid);
    })
    .slice(0, limit);
}

/** Reference data (lot size, face value, coupon, maturity) for one security. */
export async function fetchSecurityDetails(
  secid: string,
  kind: InstrumentKind,
  board: string,
): Promise<Partial<MoexSecurity>> {
  const market = marketFor(kind);
  const columns =
    kind === "bond"
      ? "SECID,SHORTNAME,LOTSIZE,FACEVALUE,FACEUNIT,MATDATE,COUPONVALUE,COUPONPERIOD,CURRENCYID"
      : "SECID,SHORTNAME,LOTSIZE,ISIN,CURRENCYID";

  try {
    const data = await iss(
      `/engines/stock/markets/${market}/boards/${board}/securities/${encodeURIComponent(secid)}.json`,
      { "iss.only": "securities", "securities.columns": columns },
    );
    const row = rows(data.securities)[0];
    if (!row) return {};
    return {
      name: str(row.SHORTNAME) || undefined,
      lotSize: num(row.LOTSIZE) ?? 1,
      // ISS reports SUR for roubles.
      currency: str(row.FACEUNIT || row.CURRENCYID).replace("SUR", "RUB") || "RUB",
      faceValue: num(row.FACEVALUE),
      couponValue: num(row.COUPONVALUE),
      couponPeriod: num(row.COUPONPERIOD),
      maturityDate: str(row.MATDATE) || null,
    };
  } catch {
    return {};
  }
}

// ----------------------------------------------------------------- quotes

export interface Quote {
  secid: string;
  price: number;
}

/**
 * Batch quotes for one board. Falls back LAST -> MARKETPRICE -> PREVPRICE,
 * because an illiquid security has no LAST for days at a time.
 *
 * Bond prices come as a percentage of face value; the caller converts using the
 * instrument's face_value. Doing it here would need reference data per call.
 */
export async function fetchQuotes(
  board: string,
  market: string,
  secids: string[],
): Promise<Map<string, number>> {
  const quotes = new Map<string, number>();
  if (secids.length === 0) return quotes;

  // ISS caps the URL length; 100 tickers per request is comfortably inside it.
  for (let offset = 0; offset < secids.length; offset += 100) {
    const chunk = secids.slice(offset, offset + 100);
    try {
      const data = await iss(`/engines/stock/markets/${market}/boards/${board}/securities.json`, {
        securities: chunk.join(","),
        "iss.only": "securities,marketdata",
        "securities.columns": "SECID,PREVPRICE",
        "marketdata.columns": "SECID,LAST,MARKETPRICE",
      });

      const fallback = new Map<string, number>();
      for (const row of rows(data.securities)) {
        const price = num(row.PREVPRICE);
        if (price !== null) fallback.set(str(row.SECID), price);
      }
      for (const row of rows(data.marketdata)) {
        const secid = str(row.SECID);
        const price = num(row.LAST) ?? num(row.MARKETPRICE) ?? fallback.get(secid) ?? null;
        if (price !== null) quotes.set(secid, price);
      }
      for (const [secid, price] of fallback) {
        if (!quotes.has(secid)) quotes.set(secid, price);
      }
    } catch {
      // Skip this chunk; the previous cached price stays in force.
    }
  }
  return quotes;
}

/** Daily closes for charting and benchmark comparison. */
export async function fetchHistory(
  secid: string,
  board: string,
  market: string,
  from: string,
): Promise<{ date: string; close: number }[]> {
  const out: { date: string; close: number }[] = [];
  let start = 0;

  // ISS pages history 100 rows at a time.
  for (let page = 0; page < 40; page++) {
    let batch: Record<string, unknown>[];
    try {
      const data = await iss(
        `/history/engines/stock/markets/${market}/boards/${board}/securities/${encodeURIComponent(secid)}.json`,
        { "iss.only": "history", "history.columns": "TRADEDATE,CLOSE,LEGALCLOSEPRICE", from, start },
      );
      batch = rows(data.history);
    } catch {
      break;
    }
    if (batch.length === 0) break;

    for (const row of batch) {
      const close = num(row.CLOSE) ?? num(row.LEGALCLOSEPRICE);
      const date = str(row.TRADEDATE);
      if (close !== null && date) out.push({ date, close });
    }
    start += batch.length;
  }
  return out;
}

// ---------------------------------------------------------------- payouts

export interface MoexPayout {
  kind: "coupon" | "amortization";
  exDate: string | null;
  payDate: string | null;
  amount: number;
  currency: string;
}

/**
 * Announced coupons and amortisation for a bond.
 *
 * Note: the equivalent endpoint for share dividends
 * (/iss/securities/{secid}/dividends.json) returns no `dividends` block on the
 * public ISS deployment — it silently falls back to the security description.
 * Share payouts are therefore forecast from recorded history instead; see
 * src/lib/domain/payouts.ts.
 */
export async function fetchBondPayouts(secid: string): Promise<MoexPayout[]> {
  try {
    const data = await iss(`/securities/${encodeURIComponent(secid)}/bondization.json`, {
      "iss.only": "coupons,amortizations",
      limit: 100,
    });

    const payouts: MoexPayout[] = [];
    for (const row of rows(data.coupons)) {
      const amount = num(row.value);
      if (amount === null || amount === 0) continue;
      payouts.push({
        kind: "coupon",
        exDate: str(row.recorddate) || null,
        payDate: str(row.coupondate) || null,
        amount,
        currency: str(row.faceunit).replace("SUR", "RUB") || "RUB",
      });
    }
    for (const row of rows(data.amortizations)) {
      const amount = num(row.value);
      if (amount === null || amount === 0) continue;
      payouts.push({
        kind: "amortization",
        exDate: null,
        payDate: str(row.amortdate) || null,
        amount,
        currency: str(row.faceunit).replace("SUR", "RUB") || "RUB",
      });
    }
    return payouts;
  } catch {
    return [];
  }
}

export { marketFor };
