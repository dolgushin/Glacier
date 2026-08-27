import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { searchSecurities } from "@/lib/providers/moex";
import { searchCrypto } from "@/lib/providers/coingecko";
import { KIND_LABELS, type InstrumentKind } from "@/lib/types";

export const dynamic = "force-dynamic";

export interface SearchHit {
  source: "moex" | "coingecko";
  symbol: string;
  name: string;
  kind: InstrumentKind;
  kindLabel: string;
  currency: string;
  board: string;
  sourceId: string;
  isin: string;
}

/** Unified instrument lookup for the add-transaction form. */
export async function GET(request: Request) {
  if (!(await currentUser())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (query.length < 2) return NextResponse.json({ results: [] });

  // Both sources are independent; a slow or dead one must not block the other.
  const [moex, crypto] = await Promise.allSettled([
    searchSecurities(query, 15),
    searchCrypto(query, 8),
  ]);

  const results: SearchHit[] = [];

  if (moex.status === "fulfilled") {
    for (const security of moex.value) {
      results.push({
        source: "moex",
        symbol: security.secid,
        name: security.name,
        kind: security.kind,
        kindLabel: KIND_LABELS[security.kind],
        currency: security.currency,
        board: security.board,
        sourceId: security.board,
        isin: security.isin,
      });
    }
  }

  if (crypto.status === "fulfilled") {
    for (const coin of crypto.value) {
      results.push({
        source: "coingecko",
        symbol: coin.symbol,
        name: coin.name,
        kind: "crypto",
        kindLabel: KIND_LABELS.crypto,
        currency: "RUB",
        board: "",
        sourceId: coin.id,
        isin: "",
      });
    }
  }

  return NextResponse.json({ results });
}
