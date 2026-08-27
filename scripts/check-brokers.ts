/**
 * Verifies the parts of the broker layer that can be checked without a real
 * key: the schema migration, the adapter registry, and — most importantly —
 * what the user is actually told when a key or a connection fails.
 *
 *   node --import ./scripts/register-alias.mjs scripts/check-brokers.ts
 */
import { all } from "@/lib/db";
import { listAdapters, brokerCatalogue } from "@/lib/brokers/registry";
import { probeCredentials } from "@/lib/brokers/engine";
import { BrokerError } from "@/lib/brokers/types";
import { hasExtraCa } from "@/lib/brokers/http";

function heading(text: string) {
  console.log(`\n── ${text} ${"─".repeat(Math.max(0, 58 - text.length))}`);
}

async function main() {
  heading("Схема");
  const tables = all<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
  ).map((row) => row.name);

  for (const expected of ["broker_connections", "broker_links"]) {
    console.log(`  ${tables.includes(expected) ? "✓" : "✗"} ${expected}`);
  }
  const legacy = tables.includes("broker_accounts");
  const backup = tables.includes("broker_accounts_v1_backup");
  console.log(
    `  ${!legacy ? "✓" : "✗"} старая broker_accounts убрана` +
      (backup ? " (данные сохранены в broker_accounts_v1_backup)" : ""),
  );

  const connections = all<{ n: number }>("SELECT COUNT(*) AS n FROM broker_connections")[0].n;
  const links = all<{ n: number }>("SELECT COUNT(*) AS n FROM broker_links")[0].n;
  console.log(`  подключений: ${connections}, привязок счетов: ${links}`);

  heading("Реестр адаптеров");
  for (const info of brokerCatalogue()) {
    const fields = info.credentialFields.map((field) => field.key).join(", ");
    console.log(
      `  ${info.name.padEnd(14)} поля: ${fields.padEnd(20)} ` +
        `история ${info.maxHistoryDays} дн  ${info.providesCashFlow ? "с движением денег" : "только сделки"}`,
    );
  }

  const withBalances = listAdapters().filter((adapter) => adapter.fetchBalances).length;
  console.log(`  адаптеров с чтением остатков: ${withBalances} из ${listAdapters().length}`);

  heading("Что увидит пользователь при неверном ключе");
  console.log(`  NODE_EXTRA_CA_CERTS ${hasExtraCa() ? "задан" : "не задан"}`);

  const cases: { broker: string; credentials: Record<string, string> }[] = [
    { broker: "tinvest", credentials: { token: "t.invalid-token-for-diagnostics" } },
    { broker: "alor", credentials: { refreshToken: "invalid-refresh-token" } },
    { broker: "bybit", credentials: { apiKey: "invalidKey", apiSecret: "invalidSecret" } },
    { broker: "binance", credentials: { apiKey: "invalidKey", apiSecret: "invalidSecret" } },
  ];

  for (const testCase of cases) {
    process.stdout.write(`\n  ${testCase.broker}:\n`);
    try {
      const accounts = await probeCredentials(testCase.broker, testCase.credentials);
      console.log(`    ⚠ неожиданно принято, счетов: ${accounts.length}`);
    } catch (error) {
      if (error instanceof BrokerError) {
        console.log(`    ошибка: ${error.message}`);
        if (error.hint) {
          console.log(`    подсказка: ${error.hint.slice(0, 200)}${error.hint.length > 200 ? "…" : ""}`);
        } else {
          console.log("    ⚠ подсказки нет — пользователю неясно, что делать");
        }
      } else {
        console.log(`    ✗ утекла необработанная ошибка: ${(error as Error).message}`);
      }
    }
  }

  heading("Изоляция ключей");
  const leaky = all<{ credentials_enc: string }>(
    "SELECT credentials_enc FROM broker_connections",
  ).filter((row) => !row.credentials_enc.includes(":"));
  console.log(
    leaky.length === 0
      ? "  ✓ все сохранённые ключи в формате шифротекста iv:tag:data"
      : `  ✗ ${leaky.length} ключей выглядят незашифрованными`,
  );

  console.log();
}

main().catch((error) => {
  console.error("\n✗ Проверка упала:", error);
  process.exit(1);
});
