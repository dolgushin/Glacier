import type { Category } from "@/lib/types";
import type { Position } from "@/lib/domain/positions";

/**
 * Rebalancing works on categories, not individual tickers: the investor sets a
 * target weight per category and the plan restores it. Buying is preferred over
 * selling — realising a gain to rebalance triggers tax, so the default plan only
 * ever adds money.
 */

export interface DriftRow {
  categoryId: number | null;
  name: string;
  color: string;
  value: number;
  currentShare: number;
  targetShare: number;
  /** currentShare - targetShare. Positive = overweight. */
  drift: number;
  /** Money needed to reach the target at the current total value. */
  gap: number;
}

export function computeDrift(positions: Position[], categories: Category[]): DriftRow[] {
  const values = new Map<number | null, number>();
  let total = 0;

  for (const position of positions) {
    if (position.quantity <= 0) continue;
    const value = position.marketValue * position.fxRate;
    const key = position.categoryId;
    values.set(key, (values.get(key) ?? 0) + value);
    total += value;
  }

  const rows: DriftRow[] = categories.map((category) => {
    const value = values.get(category.id) ?? 0;
    const currentShare = total > 0 ? value / total : 0;
    const targetShare = category.target_weight / 100;
    return {
      categoryId: category.id,
      name: category.name,
      color: category.color,
      value,
      currentShare,
      targetShare,
      drift: currentShare - targetShare,
      gap: targetShare * total - value,
    };
  });

  const uncategorised = values.get(null) ?? 0;
  if (uncategorised > 0) {
    const currentShare = total > 0 ? uncategorised / total : 0;
    rows.push({
      categoryId: null,
      name: "Без категории",
      color: "#475569",
      value: uncategorised,
      currentShare,
      targetShare: 0,
      drift: currentShare,
      gap: -uncategorised,
    });
  }

  return rows.sort((a, b) => b.value - a.value);
}

export interface BuySuggestion {
  symbol: string;
  name: string;
  categoryName: string;
  lastPrice: number;
  lotSize: number;
  /** Whole lots to buy. */
  lots: number;
  quantity: number;
  cost: number;
  currency: string;
}

export interface BuyPlan {
  suggestions: BuySuggestion[];
  spent: number;
  leftover: number;
  /** Category weights the plan would produce. */
  resulting: { name: string; share: number; targetShare: number }[];
}

/**
 * Greedy plan for investing `budget`: repeatedly buy one lot of whatever leaves
 * the portfolio closest to its targets. Greedy rather than exact because lot
 * sizes make this integer programming, and a personal tracker does not need the
 * last rouble of optimality — it needs an answer that is obviously sane.
 */
export function planPurchases(
  positions: Position[],
  categories: Category[],
  budget: number,
  baseCurrency: string,
): BuyPlan {
  const open = positions.filter(
    (position) => position.quantity > 0 && position.lastPrice !== null && position.lastPrice > 0,
  );
  if (open.length === 0 || budget <= 0) {
    return { suggestions: [], spent: 0, leftover: budget, resulting: [] };
  }

  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const targets = new Map<number | null, number>();
  for (const category of categories) targets.set(category.id, category.target_weight / 100);

  // Current value per category, and the running plan.
  const values = new Map<number | null, number>();
  let total = 0;
  for (const position of open) {
    const value = position.marketValue * position.fxRate;
    values.set(position.categoryId, (values.get(position.categoryId) ?? 0) + value);
    total += value;
  }

  // A category with no explicit target keeps its current weight.
  for (const key of values.keys()) {
    if (!targets.has(key)) targets.set(key, total > 0 ? (values.get(key) ?? 0) / total : 0);
  }
  const targetSum = [...targets.values()].reduce((sum, value) => sum + value, 0);
  if (targetSum > 0) {
    for (const [key, value] of targets) targets.set(key, value / targetSum);
  }

  const bought = new Map<number, number>(); // instrument id -> lots
  let spent = 0;

  /** Sum of squared deviation from target — the thing each purchase minimises. */
  const error = (): number => {
    const grandTotal = total + spent;
    if (grandTotal <= 0) return 0;
    let sum = 0;
    for (const [key, target] of targets) {
      const share = (values.get(key) ?? 0) / grandTotal;
      sum += (share - target) ** 2;
    }
    return sum;
  };

  // Cap the iterations: a large budget against a cheap lot could otherwise spin
  // for a very long time.
  for (let step = 0; step < 500; step++) {
    let best: { position: Position; cost: number; error: number } | null = null;

    for (const position of open) {
      const lotSize = position.instrument.lot_size || 1;
      const cost = lotSize * (position.lastPrice as number) * position.fxRate;
      if (cost <= 0 || spent + cost > budget) continue;

      const key = position.categoryId;
      const previous = values.get(key) ?? 0;
      values.set(key, previous + cost);
      spent += cost;
      const candidateError = error();
      values.set(key, previous);
      spent -= cost;

      if (!best || candidateError < best.error) {
        best = { position, cost, error: candidateError };
      }
    }

    if (!best) break;

    const key = best.position.categoryId;
    values.set(key, (values.get(key) ?? 0) + best.cost);
    spent += best.cost;
    bought.set(best.position.instrument.id, (bought.get(best.position.instrument.id) ?? 0) + 1);
  }

  const suggestions: BuySuggestion[] = [];
  for (const position of open) {
    const lots = bought.get(position.instrument.id);
    if (!lots) continue;
    const lotSize = position.instrument.lot_size || 1;
    suggestions.push({
      symbol: position.instrument.symbol,
      name: position.instrument.name,
      categoryName:
        position.categoryId !== null
          ? (categoryById.get(position.categoryId)?.name ?? "Без категории")
          : "Без категории",
      lastPrice: position.lastPrice as number,
      lotSize,
      lots,
      quantity: lots * lotSize,
      cost: lots * lotSize * (position.lastPrice as number) * position.fxRate,
      currency: baseCurrency,
    });
  }
  suggestions.sort((a, b) => b.cost - a.cost);

  const grandTotal = total + spent;
  const resulting = [...targets.entries()].map(([key, target]) => ({
    name:
      key !== null ? (categoryById.get(key)?.name ?? "Без категории") : "Без категории",
    share: grandTotal > 0 ? (values.get(key) ?? 0) / grandTotal : 0,
    targetShare: target,
  }));

  return { suggestions, spent, leftover: budget - spent, resulting };
}

export interface SellSuggestion {
  symbol: string;
  name: string;
  quantity: number;
  proceeds: number;
}

/**
 * What to sell to raise `amount` while moving the portfolio toward its targets:
 * take from the most overweight categories first.
 */
export function planWithdrawal(
  positions: Position[],
  categories: Category[],
  amount: number,
): SellSuggestion[] {
  const drift = computeDrift(positions, categories)
    .filter((row) => row.value > 0)
    .sort((a, b) => b.drift - a.drift);

  const suggestions: SellSuggestion[] = [];
  let remaining = amount;

  for (const row of drift) {
    if (remaining <= 0.01) break;
    const inCategory = positions
      .filter((position) => position.quantity > 0 && position.categoryId === row.categoryId)
      .sort((a, b) => b.marketValue * b.fxRate - a.marketValue * a.fxRate);

    for (const position of inCategory) {
      if (remaining <= 0.01) break;
      const value = position.marketValue * position.fxRate;
      const take = Math.min(value, remaining);
      const price = (position.lastPrice ?? 0) * position.fxRate;
      if (price <= 0) continue;

      const lotSize = position.instrument.lot_size || 1;
      const lots = Math.min(
        Math.floor(position.quantity / lotSize),
        Math.ceil(take / (price * lotSize)),
      );
      if (lots <= 0) continue;

      const quantity = lots * lotSize;
      const proceeds = quantity * price;
      suggestions.push({
        symbol: position.instrument.symbol,
        name: position.instrument.name,
        quantity,
        proceeds,
      });
      remaining -= proceeds;
    }
  }

  return suggestions;
}
