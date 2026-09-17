import type { InstrumentKind } from "@/lib/types";

/**
 * Recognising MOEX derivatives from a ticker.
 *
 * Brokers do not agree on how to label a FORTS contract: T-Invest returns an
 * `instrumentType` we can trust, Alor's trade feed returns a bare symbol and an
 * often empty board. Without this, `SI-12.23` and `RTS-9.26M160726CA105000` both
 * fall through to "share", get looked up on the stock market where they do not
 * exist, and sit in the portfolio forever as priceless open positions — because
 * expiry is not a trade, so nothing ever closes them.
 */

/** Futures: SI-12.23, GAZR-3.24, BR-12.23, NG-10.23, RTS-9.26 */
const FUTURES_DATED = /^[A-Z]{2,4}-\d{1,2}\.\d{2}$/;

/** Perpetual-style FX futures: USDRUBF, CNYRUBF, EURRUBF, GLDRUBF */
const FUTURES_PERPETUAL = /^[A-Z]{6}F$/;

/** Short FORTS codes: SiZ3, BRF4, RIH4 — month letter + year digit. */
const FUTURES_SHORT = /^[A-Za-z]{2,4}[FGHJKMNQUVXZ]\d$/;

/**
 * Options: the futures code, then M + expiry, then C/P (call/put),
 * A/E (American/European) and the strike — RTS-9.26M160726CA105000.
 */
const OPTION = /^[A-Z]{2,4}-\d{1,2}\.\d{2}M\d{6}[CP][AE]\d+$/;

/** FORTS board codes: futures and options respectively. */
const FUTURES_BOARDS = /^(RFUD|SPBFUT)/;
const OPTION_BOARDS = /^(ROPD|SPBOPT)/;

/**
 * Classify a FORTS instrument, or return null when the ticker is an ordinary
 * security. Null means "not a derivative", never "unknown" — the caller keeps
 * whatever kind it had derived by other means.
 */
export function derivativeKind(symbol: string, board = ""): InstrumentKind | null {
  const code = (board || "").toUpperCase();
  if (OPTION_BOARDS.test(code)) return "option";
  if (FUTURES_BOARDS.test(code)) return "futures";

  const ticker = (symbol || "").toUpperCase();
  if (OPTION.test(ticker)) return "option";
  if (FUTURES_DATED.test(ticker) || FUTURES_PERPETUAL.test(ticker)) return "futures";
  // Checked last and case-sensitively on the original: a short FORTS code such
  // as "SiZ3" is mixed-case by convention, and upper-casing first would let
  // ordinary four-letter tickers ending in a digit match it.
  if (FUTURES_SHORT.test(symbol ?? "")) return "futures";

  return null;
}

/**
 * The delivery date encoded in a dated contract, as an ISO date, or null.
 *
 * Used to tell a contract that expired years ago from one still trading, so the
 * absence of a quote can be explained rather than reported as a failure.
 */
export function expiryFromSymbol(symbol: string): string | null {
  const match = /^[A-Z]{2,4}-(\d{1,2})\.(\d{2})/.exec((symbol || "").toUpperCase());
  if (!match) return null;
  const month = Number(match[1]);
  if (month < 1 || month > 12) return null;
  // Two-digit years on FORTS are 2000-based; contracts predate nothing earlier.
  const year = 2000 + Number(match[2]);
  // Settlement is mid-month; the exact day does not matter for "has it expired".
  return `${year}-${String(month).padStart(2, "0")}-28`;
}
