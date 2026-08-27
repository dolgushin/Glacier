/**
 * Money-weighted annualised return (XIRR).
 *
 * Newton's method is what most implementations use and it diverges on exactly
 * the portfolios that matter here — sign-alternating flows, a position fully
 * closed and reopened, a large late deposit. So: bracket the root by scanning,
 * then bisect. Slower, but it either returns a correct answer or honestly
 * reports that no rate exists.
 */

export interface CashFlow {
  /** ISO date (or datetime); only the date part matters. */
  date: string;
  /** Negative = money leaves the investor, positive = money returns. */
  amount: number;
}

const DAYS_PER_YEAR = 365;
const MIN_RATE = -0.999999;
const MAX_RATE = 1000;

function npv(flows: { days: number; amount: number }[], rate: number): number {
  let total = 0;
  for (const flow of flows) {
    total += flow.amount / Math.pow(1 + rate, flow.days / DAYS_PER_YEAR);
  }
  return total;
}

/**
 * Returns the annualised rate as a fraction (0.17 = 17% годовых), or null when
 * the flows admit no solution (all same sign, single flow, degenerate dates).
 */
export function xirr(cashFlows: CashFlow[]): number | null {
  if (cashFlows.length < 2) return null;

  const sorted = [...cashFlows].sort((a, b) => a.date.localeCompare(b.date));
  const start = Date.parse(sorted[0].date.slice(0, 10));
  if (Number.isNaN(start)) return null;

  const flows = sorted
    .map((flow) => ({
      days: (Date.parse(flow.date.slice(0, 10)) - start) / 86_400_000,
      amount: flow.amount,
    }))
    .filter((flow) => Number.isFinite(flow.days) && Number.isFinite(flow.amount) && flow.amount !== 0);

  if (flows.length < 2) return null;

  const hasPositive = flows.some((f) => f.amount > 0);
  const hasNegative = flows.some((f) => f.amount < 0);
  if (!hasPositive || !hasNegative) return null;

  // All flows on the same day: no time span, no annualised rate.
  if (flows[flows.length - 1].days === 0) return null;

  // 1. Bracket a sign change on a log-ish grid across the plausible range.
  const probes: number[] = [MIN_RATE];
  for (let exponent = -6; exponent <= 3; exponent += 0.125) {
    const magnitude = Math.pow(10, exponent);
    if (magnitude <= 1) probes.push(-magnitude);
    probes.push(magnitude);
  }
  probes.push(MAX_RATE);
  probes.sort((a, b) => a - b);

  let low = NaN;
  let high = NaN;
  let previousRate = probes[0];
  let previousValue = npv(flows, previousRate);

  for (let i = 1; i < probes.length; i++) {
    const rate = probes[i];
    const value = npv(flows, rate);
    if (!Number.isFinite(value)) {
      previousRate = rate;
      previousValue = value;
      continue;
    }
    if (value === 0) return rate;
    if (Number.isFinite(previousValue) && previousValue * value < 0) {
      low = previousRate;
      high = rate;
      break;
    }
    previousRate = rate;
    previousValue = value;
  }

  if (Number.isNaN(low)) return null;

  // 2. Bisect. 200 iterations takes the interval far below float resolution.
  for (let i = 0; i < 200; i++) {
    const mid = (low + high) / 2;
    const value = npv(flows, mid);
    if (value === 0 || (high - low) / 2 < 1e-12) return mid;
    if (npv(flows, low) * value < 0) high = mid;
    else low = mid;
  }

  return (low + high) / 2;
}

/**
 * Simple (non-annualised) return: total profit over average invested capital.
 * Used as a fallback in the UI when XIRR is undefined.
 */
export function simpleReturn(invested: number, profit: number): number | null {
  if (invested <= 0) return null;
  return profit / invested;
}
