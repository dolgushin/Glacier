/**
 * Central Bank of Russia official FX rates, via the cbr-xml-daily mirror
 * (the CBR's own endpoint serves XML with a Windows-1251 declaration).
 * Rates are expressed as roubles per one unit of the currency.
 */

const DAILY = "https://www.cbr-xml-daily.ru/daily_json.js";
const ARCHIVE = (date: string) =>
  `https://www.cbr-xml-daily.ru/archive/${date.replace(/-/g, "/")}/daily_json.js`;

interface CbrResponse {
  Date: string;
  Valute: Record<string, { CharCode: string; Nominal: number; Value: number }>;
}

async function load(url: string): Promise<Map<string, number>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
    if (!response.ok) throw new Error(`CBR ${response.status}`);
    const payload = (await response.json()) as CbrResponse;

    const rates = new Map<string, number>([["RUB", 1]]);
    for (const entry of Object.values(payload.Valute ?? {})) {
      if (!entry?.CharCode || !entry.Nominal) continue;
      rates.set(entry.CharCode, entry.Value / entry.Nominal);
    }
    return rates;
  } finally {
    clearTimeout(timer);
  }
}

/** Today's official rates (the CBR publishes on business days only). */
export async function fetchRates(): Promise<Map<string, number>> {
  return load(DAILY);
}

/** Rates for a specific date; the archive has gaps on weekends and holidays. */
export async function fetchRatesForDate(date: string): Promise<Map<string, number>> {
  return load(ARCHIVE(date));
}
