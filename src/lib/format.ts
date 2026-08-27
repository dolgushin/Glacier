const CURRENCY_SYMBOLS: Record<string, string> = {
  RUB: "₽",
  USD: "$",
  EUR: "€",
  CNY: "¥",
  GBP: "£",
};

export function currencySymbol(code: string): string {
  return CURRENCY_SYMBOLS[code] ?? code;
}

/** Money, rounded to whole units — the precision a portfolio is actually read at. */
export function money(value: number, currency = "RUB", fractionDigits?: number): string {
  const digits = fractionDigits ?? (Math.abs(value) < 100 && value !== 0 ? 2 : 0);
  const formatted = new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
  return `${formatted} ${currencySymbol(currency)}`;
}

/** Money with an explicit sign, for profit and loss. */
export function signedMoney(value: number, currency = "RUB"): string {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${money(Math.abs(value), currency)}`;
}

export function number(value: number, maxDigits = 4): string {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: maxDigits }).format(value);
}

/** Fraction (0.1734) -> "17,34 %". */
export function percent(value: number | null, digits = 2): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value * 100)} %`;
}

export function signedPercent(value: number | null, digits = 2): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${percent(Math.abs(value), digits)}`;
}

export function date(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", year: "numeric" }).format(parsed);
}

export function dateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

const MONTHS = [
  "янв", "фев", "мар", "апр", "май", "июн",
  "июл", "авг", "сен", "окт", "ноя", "дек",
];

/** "2026-03" -> "мар 2026" */
export function monthLabel(value: string): string {
  const [year, month] = value.split("-");
  const index = Number(month) - 1;
  return `${MONTHS[index] ?? month} ${year}`;
}

/** "давно" indicator for a sync timestamp. */
export function relativeTime(value: string | null | undefined): string {
  if (!value) return "никогда";
  const delta = Date.now() - Date.parse(value);
  if (!Number.isFinite(delta)) return "никогда";
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return "только что";
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.floor(hours / 24);
  return `${days} дн назад`;
}

/** Tailwind class for a profit figure. */
export function pnlClass(value: number): string {
  if (value > 0) return "text-gain";
  if (value < 0) return "text-loss";
  return "text-ink-mute";
}
