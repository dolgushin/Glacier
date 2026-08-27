import type { InstrumentKind, TxType } from "@/lib/types";

/**
 * The broker abstraction.
 *
 * The sync engine knows nothing about any particular broker: it asks an adapter
 * which credential fields to render, which accounts a key can see, and what
 * operations happened. Adding a broker means adding one file and one registry
 * entry — no changes to the engine, the schema, or the UI.
 */

export type BrokerId = "tinvest" | "alor" | "bybit" | "binance";

export type CredentialFieldType = "text" | "password";

/** Declarative description of one credential input, rendered by the UI. */
export interface CredentialField {
  key: string;
  label: string;
  type: CredentialFieldType;
  required: boolean;
  placeholder?: string;
  hint?: string;
}

/** Named credential values for one connection. Never leaves the server. */
export type Credentials = Record<string, string>;

/** An account as the broker names it. */
export interface RemoteAccount {
  id: string;
  name: string;
  /** "Брокерский счёт", "ИИС", "Unified trading" — shown next to the name. */
  kind?: string;
}

/**
 * Enough information to create or match a catalog entry. Adapters produce this
 * so the engine never has to guess what a broker's ticker refers to.
 */
export interface InstrumentDescriptor {
  source: "moex" | "coingecko";
  symbol: string;
  name: string;
  kind: InstrumentKind;
  currency: string;
  /** CoinGecko coin id, or MOEX board. */
  sourceId?: string;
  isin?: string | null;
  figi?: string | null;
  board?: string;
  lotSize?: number;
  faceValue?: number | null;
  maturityDate?: string | null;
}

/** One ledger-ready fact pulled from a broker. */
export interface LedgerOperation {
  /** The broker's own id. Makes re-import idempotent. */
  externalId: string;
  type: TxType;
  ts: string;
  /** Null for pure cash movements. */
  instrument: InstrumentDescriptor | null;
  quantity: number;
  price: number;
  /** Absolute value; the sign is implied by `type`. */
  amount: number;
  fee: number;
  tax: number;
  currency: string;
  note?: string;
}

/** A current holding, used for reconciliation rather than for the ledger. */
export interface RemoteBalance {
  instrument: InstrumentDescriptor;
  quantity: number;
}

export class BrokerError extends Error {
  /**
   * What the user should do about it. Shown verbatim under the error, so it
   * must be actionable.
   *
   * Declared as a plain field rather than a constructor parameter property:
   * parameter properties need a code transform, and Node's type stripping —
   * which the test runner and seed script rely on — only erases types.
   */
  readonly hint?: string;

  constructor(message: string, hint?: string) {
    super(message);
    this.name = "BrokerError";
    this.hint = hint;
  }
}

export interface BrokerAdapter {
  id: BrokerId;
  name: string;
  /** One line under the broker name in the picker. */
  summary: string;
  docsUrl: string;
  docsLabel: string;
  credentialFields: CredentialField[];
  /** How far back the broker lets us read, for an honest UI hint. */
  maxHistoryDays: number;
  /**
   * Whether the broker reports a full operation history. Crypto exchanges
   * usually expose only trades, not deposits, so the resulting ledger will
   * not reconcile to a cash balance — the UI says so.
   */
  providesCashFlow: boolean;

  /** Validate the key and list what it can see. Throws BrokerError on failure. */
  listAccounts(credentials: Credentials): Promise<RemoteAccount[]>;

  /** Operations in [from, to). Must be safe to call with overlapping ranges. */
  fetchOperations(
    credentials: Credentials,
    accountId: string,
    from: Date,
    to: Date,
  ): Promise<LedgerOperation[]>;

  /** Current holdings, where the broker exposes them. */
  fetchBalances?(credentials: Credentials, accountId: string): Promise<RemoteBalance[]>;
}
