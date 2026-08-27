import { requireUser } from "@/lib/auth";
import { listPortfolios } from "@/lib/repo";
import { listConnections } from "@/lib/brokers/engine";
import { brokerCatalogue } from "@/lib/brokers/registry";
import { hasExtraCa } from "@/lib/brokers/http";
import { Section } from "@/components/ui";
import { ConnectionsManager } from "./manager";

export const dynamic = "force-dynamic";

export default async function ConnectionsPage() {
  const user = await requireUser();

  const connections = listConnections(user.id);
  const portfolios = listPortfolios(user.id).map((portfolio) => ({
    id: portfolio.id,
    name: portfolio.name,
  }));
  const brokers = brokerCatalogue();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Подключения брокеров</h1>
        <p className="text-xs text-ink-mute">
          Добавьте столько ключей, сколько нужно — у разных брокеров и у одного. Каждый счёт
          загружается в свой портфель.
        </p>
      </div>

      <ConnectionsManager
        connections={connections}
        portfolios={portfolios}
        brokers={brokers}
        extraCaConfigured={hasExtraCa()}
      />

      <Section title="Как это устроено">
        <div className="space-y-3 text-xs leading-relaxed text-ink-mute">
          <p>
            <span className="text-ink">Ключ и портфель разделены.</span> Одно подключение — это
            один API-ключ. У ключа может быть несколько счетов (брокерский, ИИС, субсчёт), и каждый
            привязывается к своему портфелю независимо.
          </p>
          <p>
            <span className="text-ink">Хранение.</span> Ключи шифруются AES-256-GCM на ключе из{" "}
            <code className="text-ink-soft">GLACIER_SECRET</code> и расшифровываются только на время
            запроса к брокеру. Обратно в браузер они не возвращаются никогда — после сохранения вы
            их больше не увидите, только замените.
          </p>
          <p>
            <span className="text-ink">Повторная синхронизация безопасна.</span> Каждая операция
            записывается с идентификатором брокера, а идентификатор дополнительно привязан к номеру
            подключения. Два ключа одного брокера не столкнутся между собой, а повторный запуск не
            создаст дублей.
          </p>
          <p>
            <span className="text-ink">Права ключа.</span> Для учёта достаточно доступа только на
            чтение. Сервис не выставляет заявки и не выводит средства — не давайте ключу лишних прав.
          </p>
        </div>
      </Section>
    </div>
  );
}
