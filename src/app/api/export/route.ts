import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { loadContext, resolvePortfolioId } from "@/lib/context";
import { listPortfolios } from "@/lib/repo";
import { KIND_LABELS, TX_TYPE_LABELS } from "@/lib/types";
import { csvDocument, exportFilename } from "@/lib/export/csv";

export const dynamic = "force-dynamic";

/**
 * Выгрузка данных пользователя одним файлом.
 *
 *   /api/export?what=transactions | positions | payouts [&p=<portfolioId>]
 *
 * Данные принадлежат пользователю: это его журнал, позиции и выплаты, в
 * формате, который открывает Excel и принимает наш же импорт. Авторизация —
 * та же сессия, что у страниц; чужой ?p= отсекается в resolvePortfolioId.
 */
export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const what = url.searchParams.get("what") ?? "transactions";

  const portfolios = listPortfolios(user.id);
  const portfolioId = resolvePortfolioId(portfolios, url.searchParams.get("p") ?? undefined);
  const context = loadContext(user.id, portfolioId);
  const { transactions, instruments, summary } = context;

  const instrumentOf = (id: number | null) => (id === null ? null : (instruments.get(id) ?? null));

  let header: string[];
  let rows: (string | number)[][];

  if (what === "positions") {
    header = [
      "Тикер", "Название", "Тип", "Количество", "Средняя цена", "Текущая цена",
      "Стоимость", "Нереализованная прибыль", "Реализованная прибыль", "Выплаты получено",
      "Валюта",
    ];
    rows = summary.positions.map((position) => [
      position.instrument.symbol,
      position.instrument.name,
      KIND_LABELS[position.instrument.kind] ?? position.instrument.kind,
      position.quantity,
      position.averagePrice.toFixed(4),
      position.lastPrice?.toFixed(4) ?? "",
      position.marketValue.toFixed(2),
      position.unrealizedPnl.toFixed(2),
      position.realizedPnl.toFixed(2),
      position.income.toFixed(2),
      position.currency,
    ]);
  } else if (what === "payouts") {
    header = ["Дата", "Тикер", "Название", "Тип", "Сумма", "Валюта"];
    rows = transactions
      .filter((tx) => ["DIVIDEND", "COUPON", "AMORTIZATION", "INTEREST"].includes(tx.type))
      .map((tx) => {
        const instrument = instrumentOf(tx.instrument_id);
        return [
          tx.ts.slice(0, 10),
          instrument?.symbol ?? "",
          instrument?.name ?? "",
          TX_TYPE_LABELS[tx.type] ?? tx.type,
          tx.amount.toFixed(2),
          tx.currency,
        ];
      });
  } else if (what === "transactions") {
    header = [
      "Дата", "Тип", "Тикер", "Название", "Количество", "Цена", "Сумма",
      "Комиссия", "Налог", "Валюта", "Комментарий",
    ];
    rows = transactions.map((tx) => {
      const instrument = instrumentOf(tx.instrument_id);
      return [
        tx.ts.slice(0, 10),
        TX_TYPE_LABELS[tx.type] ?? tx.type,
        instrument?.symbol ?? "",
        instrument?.name ?? "",
        tx.quantity,
        tx.price,
        tx.amount,
        tx.fee,
        tx.tax,
        tx.currency,
        tx.note,
      ];
    });
  } else {
    return NextResponse.json({ error: "unknown export kind" }, { status: 400 });
  }

  return new NextResponse(csvDocument(header, rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportFilename(what)}"`,
    },
  });
}
