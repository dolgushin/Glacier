"use client";

import { useActionState } from "react";
import { importOpeningAction, reconcileAction, type BrokerState } from "@/app/actions/brokers";
import { Notice, Table, Tag, Td, Th } from "@/components/ui";
import { money, number, pnlClass } from "@/lib/format";
import type { Reconciliation } from "@/lib/brokers/engine";

const initial: BrokerState & { reconciliation?: Reconciliation } = {};

const STATUS: Record<string, { label: string; tone: "good" | "bad" | "warn" | "neutral" }> = {
  match: { label: "сходится", tone: "good" },
  differs: { label: "расходится", tone: "warn" },
  "missing-here": { label: "нет в журнале", tone: "bad" },
  "extra-here": { label: "нет у брокера", tone: "warn" },
};

/**
 * Side-by-side comparison of the broker's holdings and the ledger's.
 *
 * Quantities, not money, are the subject: both sides are priced from the same
 * cache, so any difference is a missing or extra operation rather than a stale
 * quote.
 */
export function ReconcilePanel({ linkId }: { linkId: number }) {
  const [state, action, pending] = useActionState(reconcileAction, initial);
  const [importState, importAction, importing] = useActionState(importOpeningAction, initial);
  const result = state.reconciliation;
  const missing = result?.rows.filter((row) => row.status === "missing-here").length ?? 0;

  return (
    <div>
      <form action={action}>
        <input type="hidden" name="linkId" value={linkId} />
        <button
          type="submit"
          disabled={pending}
          title="Сравнить остатки у брокера с тем, что выведено из журнала"
          className="rounded-md border border-rule px-2.5 py-1.5 text-xs text-ink-soft transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
        >
          {pending ? "Сверяю…" : "Сверить с брокером"}
        </button>
      </form>

      {state.error && (
        <div className="mt-3">
          <Notice>
            <div>{state.error}</div>
            {state.hint && <div className="mt-1.5 text-xs opacity-90">{state.hint}</div>}
          </Notice>
        </div>
      )}

      {result && (
        <div className="mt-3">
          <Notice tone={result.rows.some((row) => row.status !== "match") ? "info" : "success"}>
            <div>{state.success}</div>
            {state.hint && <div className="mt-1.5 text-xs opacity-90">{state.hint}</div>}
          </Notice>

          {result.unaccountedValue > 0 && (
            <div className="mt-3 rounded-md border border-rule bg-sunk p-4">
              <p className="text-sm text-ink-soft">
                У брокера есть бумаг на{" "}
                <span className="tnum font-semibold text-ink">
                  {money(result.unaccountedValue, "RUB")}
                </span>
                , которых журнал не знает. Примерно на эту сумму наша оценка портфеля и занижена.
              </p>

              {missing > 0 && (
                <form
                  action={importAction}
                  className="mt-3"
                  onSubmit={(event) => {
                    if (
                      !confirm(
                        `Добавить ${missing} стартовых позиций в журнал?\n\n` +
                          "Количество и себестоимость будут верными, но дату покупки брокер не " +
                          "отдаёт — она будет проставлена концом известной истории, поэтому " +
                          "доходность по этим бумагам останется приблизительной.\n\n" +
                          "Записи помечаются «Стартовая позиция», их можно найти и удалить в журнале сделок.",
                      )
                    ) {
                      event.preventDefault();
                    }
                  }}
                >
                  <input type="hidden" name="linkId" value={linkId} />
                  <button
                    type="submit"
                    disabled={importing}
                    className="rounded-md bg-accent px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-accent-ink disabled:bg-rule-mid"
                  >
                    {importing
                      ? "Добавляю…"
                      : `Добавить ${missing} недостающих позиций в журнал`}
                  </button>
                  <p className="mt-2 text-xs text-ink-mute">
                    Сначала попробуйте «Полная» — если брокер отдаёт настоящую историю, она лучше
                    восстановленной.
                  </p>
                </form>
              )}
            </div>
          )}

          {(importState.error || importState.success) && (
            <div className="mt-3">
              <Notice tone={importState.error ? "error" : "success"}>
                <div>{importState.error ?? importState.success}</div>
                {importState.hint && (
                  <div className="mt-1.5 text-xs leading-relaxed opacity-90">{importState.hint}</div>
                )}
              </Notice>
            </div>
          )}

          <div className="mt-3">
            <Table minWidth={560}>
              <thead>
                <tr>
                  <Th>Актив</Th>
                  <Th align="right">У брокера</Th>
                  <Th align="right">В журнале</Th>
                  <Th align="right">Разница</Th>
                  <Th>Статус</Th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row) => (
                  <tr key={row.symbol}>
                    <Td>
                      <span className="code text-[13px] font-medium text-ink">{row.symbol}</span>
                      <div className="max-w-[210px] truncate text-xs text-ink-mute">{row.name}</div>
                    </Td>
                    <Td align="right" className="tnum text-ink-soft">
                      {row.brokerQuantity === null ? "—" : number(row.brokerQuantity, 8)}
                    </Td>
                    <Td align="right" className="tnum text-ink-soft">
                      {row.ledgerQuantity === null ? "—" : number(row.ledgerQuantity, 8)}
                    </Td>
                    <Td align="right" className="tnum">
                      {row.status === "match" ? (
                        <span className="text-ink-faint">—</span>
                      ) : (
                        <>
                          <span className={pnlClass(row.difference)}>
                            {row.difference > 0 ? "+" : "−"}
                            {number(Math.abs(row.difference), 8)}
                          </span>
                          {row.valueGap !== null && (
                            <div className="text-[11px] text-ink-mute">
                              {money(Math.abs(row.valueGap), row.currency)}
                            </div>
                          )}
                        </>
                      )}
                    </Td>
                    <Td>
                      <Tag tone={STATUS[row.status].tone}>{STATUS[row.status].label}</Tag>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>

          <p className="mt-3 text-xs leading-relaxed text-ink-mute">
            <span className="text-ink-soft">«Нет в журнале»</span> — брокер держит бумагу, а у нас
            нет ни одной операции по ней. Почти всегда это усечённая история: покупка была раньше
            первой синхронизации. Такие бумаги не только не попадают в стоимость — их продажа
            засчитывается как чистая прибыль, потому что списывать нечего, и доходность оказывается
            завышенной.
          </p>
        </div>
      )}
    </div>
  );
}
