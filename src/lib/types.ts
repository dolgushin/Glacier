export type Role = "user" | "admin";

export type InstrumentKind =
  | "share"
  | "bond"
  | "etf"
  | "crypto"
  | "currency"
  | "futures"
  | "option"
  | "custom";

/**
 * Derivatives are held, not owned: a futures position is variation margin, not a
 * lot with a cost basis, and a contract that expired leaves no asset behind. The
 * FIFO engine models ownership, so these are kept out of portfolio value and
 * counted only through the money they moved.
 */
export const DERIVATIVE_KINDS: InstrumentKind[] = ["futures", "option"];

export const isDerivative = (kind: InstrumentKind): boolean =>
  kind === "futures" || kind === "option";

export type TxType =
  | "BUY"
  | "SELL"
  | "DIVIDEND"
  | "COUPON"
  | "AMORTIZATION"
  | "REDEMPTION"
  | "DEPOSIT"
  | "WITHDRAWAL"
  | "FEE"
  | "TAX"
  | "INTEREST"
  | "SPLIT";

/** Transactions that change the quantity of an instrument held. */
export const TRADE_TYPES: TxType[] = ["BUY", "SELL", "SPLIT", "REDEMPTION"];

/** Transactions that pay the investor income on a holding. */
export const INCOME_TYPES: TxType[] = ["DIVIDEND", "COUPON", "AMORTIZATION", "INTEREST"];

/** Transactions that move money in or out of the portfolio boundary. */
export const CASHFLOW_TYPES: TxType[] = ["DEPOSIT", "WITHDRAWAL"];

export const TX_TYPE_LABELS: Record<TxType, string> = {
  BUY: "Покупка",
  SELL: "Продажа",
  DIVIDEND: "Дивиденд",
  COUPON: "Купон",
  AMORTIZATION: "Амортизация",
  REDEMPTION: "Погашение",
  DEPOSIT: "Внесение средств",
  WITHDRAWAL: "Вывод средств",
  FEE: "Комиссия",
  TAX: "Налог",
  INTEREST: "Проценты",
  SPLIT: "Сплит",
};

export const KIND_LABELS: Record<InstrumentKind, string> = {
  share: "Акция",
  bond: "Облигация",
  etf: "Фонд",
  crypto: "Криптовалюта",
  currency: "Валюта",
  futures: "Фьючерс",
  option: "Опцион",
  custom: "Прочее",
};

export interface User {
  id: number;
  email: string;
  name: string;
  password_hash: string;
  role: Role;
  base_currency: string;
  is_active: number;
  created_at: string;
  last_login_at: string | null;
}

export interface Portfolio {
  id: number;
  user_id: number;
  name: string;
  base_currency: string;
  broker: string;
  is_archived: number;
  sort_order: number;
  created_at: string;
}

export interface Category {
  id: number;
  portfolio_id: number;
  name: string;
  target_weight: number;
  color: string;
  sort_order: number;
}

export interface Instrument {
  id: number;
  owner_user_id: number | null;
  kind: InstrumentKind;
  symbol: string;
  name: string;
  currency: string;
  source: string;
  source_id: string;
  isin: string | null;
  figi: string | null;
  exchange: string;
  board: string;
  sector: string;
  country: string;
  lot_size: number;
  face_value: number | null;
  coupon_value: number | null;
  coupon_period: number | null;
  maturity_date: string | null;
  last_price: number | null;
  last_price_at: string | null;
  meta: string;
  created_at: string;
}

export interface Transaction {
  id: number;
  portfolio_id: number;
  instrument_id: number | null;
  category_id: number | null;
  type: TxType;
  ts: string;
  quantity: number;
  price: number;
  amount: number;
  fee: number;
  tax: number;
  currency: string;
  fx_rate: number;
  note: string;
  source: string;
  external_id: string | null;
  created_at: string;
}

export interface Payout {
  id: number;
  instrument_id: number;
  kind: "dividend" | "coupon" | "amortization";
  ex_date: string | null;
  pay_date: string | null;
  amount: number;
  currency: string;
  status: "announced" | "forecast";
  source: string;
  fetched_at: string;
}

export interface BrokerAccount {
  id: number;
  user_id: number;
  portfolio_id: number;
  broker: string;
  token_enc: string;
  account_id: string;
  account_name: string;
  auto_sync: number;
  last_sync_at: string | null;
  last_sync_status: string;
  created_at: string;
}
