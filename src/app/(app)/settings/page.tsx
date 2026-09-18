import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listPortfolios } from "@/lib/repo";
import { lastSyncInfo } from "@/lib/sync";
import { listConnections } from "@/lib/brokers/engine";
import { CSV_TEMPLATE } from "@/lib/import/csv";
import { relativeTime } from "@/lib/format";
import { Tag, Button, Section, Empty } from "@/components/ui";
import { CsvImportPanel, PasswordPanel, RefreshPanel, TelegramPanel } from "./panels";
import { telegramChatId } from "@/lib/telegram";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requireUser();
  const portfolios = listPortfolios(user.id);
  const syncInfo = lastSyncInfo();
  const connections = listConnections(user.id);
  const linkedAccounts = connections.reduce((sum, item) => sum + item.links.length, 0);
  const telegramLinked = telegramChatId(user.id) !== null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Настройки</h1>
        <p className="text-xs text-ink-mute">Источники данных, импорт и безопасность</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section
          title="Котировки и курсы"
          subtitle="Обновляются автоматически при открытии обзора, не чаще раза в 10 минут"
        >
          <RefreshPanel />

          <div className="mt-5 border-t border-rule pt-4">
            <h3 className="mb-3 text-xs font-medium text-ink-soft">Последние обновления</h3>
            {syncInfo.length === 0 ? (
              <p className="text-xs text-ink-mute">Синхронизаций ещё не было</p>
            ) : (
              <div className="space-y-2">
                {syncInfo.map((entry) => (
                  <div
                    key={entry.kind}
                    className="flex flex-wrap items-center justify-between gap-2 text-xs"
                  >
                    <span className="text-ink-soft">
                      {entry.kind === "prices"
                        ? "Котировки"
                        : entry.kind === "fx"
                          ? "Курсы валют"
                          : entry.kind === "payouts"
                            ? "Купоны и выплаты"
                            : entry.kind === "brokers-auto"
                              ? "Автосинхронизация"
                              : "Брокер"}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="text-ink-mute">{entry.detail}</span>
                      <Tag tone={entry.status === "ok" ? "good" : "bad"}>
                        {relativeTime(entry.started_at)}
                      </Tag>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mt-4 border border-rule bg-surface p-3 text-xs leading-relaxed text-ink-mute">
            Источники: <span className="text-ink">MOEX ISS</span> — акции, облигации, фонды и
            графики купонов; <span className="text-ink">CoinGecko</span> — криптовалюты;{" "}
            <span className="text-ink">ЦБ РФ</span> — официальные курсы валют. Все три бесплатны
            и не требуют ключа. Если источник недоступен, остаётся последняя известная цена.
          </div>
        </Section>

        <Section title="Смена пароля" subtitle="После смены все остальные сессии будут завершены">
          <PasswordPanel />
        </Section>

        <Section
          title="Telegram-уведомления"
          subtitle="Новые выплаты и сбои автосинхронизации — в личный чат с ботом"
        >
          <TelegramPanel linked={telegramLinked} />
        </Section>
      </div>

      <Section
        title="Импорт из CSV"
        subtitle="Повторный импорт того же файла безопасен — строки с идентификатором не задваиваются"
      >
        {portfolios.length === 0 ? (
          <Empty title="Сначала создайте портфель" />
        ) : (
          <CsvImportPanel portfolios={portfolios} template={CSV_TEMPLATE} />
        )}
      </Section>

      <Section
        title="Подключения брокеров"
        subtitle="Ключи API, счета и их привязка к портфелям"
        action={
          <Link href="/connections" className="text-xs text-accent hover:underline">
            Перейти к подключениям →
          </Link>
        }
      >
        {connections.length === 0 ? (
          <Empty
            title="Ни один брокер не подключён"
            hint="Добавьте API-ключ, и сделки будут подтягиваться автоматически. Можно подключить несколько брокеров и несколько ключей одного брокера."
            action={
              <Link href="/connections">
                <Button>Подключить брокера</Button>
              </Link>
            }
          />
        ) : (
          <div className="space-y-2">
            {connections.map((connection) => (
              <div
                key={connection.id}
                className="flex flex-wrap items-center justify-between gap-3 border border-rule bg-surface px-4 py-3"
              >
                <div>
                  <div className="flex items-center gap-2 text-sm text-ink">
                    {connection.label}
                    <Tag tone={connection.status === 'error' ? 'bad' : 'good'}>
                      {connection.brokerName}
                    </Tag>
                  </div>
                  <div className="text-[11px] text-ink-mute">
                    Счетов привязано: {connection.links.length} · проверялся{' '}
                    {relativeTime(connection.lastCheckAt)}
                  </div>
                </div>
                <Link href="/connections" className="text-xs text-accent hover:underline">
                  Управлять →
                </Link>
              </div>
            ))}
            <p className="pt-1 text-xs text-ink-mute">
              Всего счетов на синхронизации: {linkedAccounts}
            </p>
          </div>
        )}
      </Section>
    </div>
  );
}
