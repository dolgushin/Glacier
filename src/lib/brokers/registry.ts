import { tinvestAdapter } from "@/lib/brokers/tinvest";
import { alorAdapter } from "@/lib/brokers/alor";
import { bybitAdapter } from "@/lib/brokers/bybit";
import { binanceAdapter } from "@/lib/brokers/binance";
import type { BrokerAdapter, BrokerId } from "@/lib/brokers/types";

/**
 * The list of supported brokers. Adding one means writing an adapter and adding
 * it here — the sync engine, the schema and the UI need no changes.
 */
const ADAPTERS: BrokerAdapter[] = [tinvestAdapter, alorAdapter, bybitAdapter, binanceAdapter];

const BY_ID = new Map<string, BrokerAdapter>(ADAPTERS.map((adapter) => [adapter.id, adapter]));

export function listAdapters(): BrokerAdapter[] {
  return ADAPTERS;
}

export function getAdapter(id: string): BrokerAdapter | undefined {
  return BY_ID.get(id);
}

export function requireAdapter(id: string): BrokerAdapter {
  const adapter = BY_ID.get(id);
  if (!adapter) throw new Error(`Неизвестный брокер: ${id}`);
  return adapter;
}

export function isBrokerId(value: string): value is BrokerId {
  return BY_ID.has(value);
}

/**
 * Serialisable description for the client: everything the connection form needs
 * to render itself, and nothing that could leak a credential.
 */
export interface BrokerInfo {
  id: string;
  name: string;
  summary: string;
  docsUrl: string;
  docsLabel: string;
  credentialFields: BrokerAdapter["credentialFields"];
  maxHistoryDays: number;
  providesCashFlow: boolean;
}

export function brokerCatalogue(): BrokerInfo[] {
  return ADAPTERS.map((adapter) => ({
    id: adapter.id,
    name: adapter.name,
    summary: adapter.summary,
    docsUrl: adapter.docsUrl,
    docsLabel: adapter.docsLabel,
    credentialFields: adapter.credentialFields,
    maxHistoryDays: adapter.maxHistoryDays,
    providesCashFlow: adapter.providesCashFlow,
  }));
}
