import { all, get, nowIso, run } from "@/lib/db";

/**
 * Telegram-бот: уведомления и короткие справки.
 *
 * Токен один на установку (GLACIER_TELEGRAM_TOKEN), привязка — по одноразовому
 * коду: пользователь жмёт «Привязать» в настройках, получает код и отправляет
 * его боту командой /start. Бот знает chat_id, а код говорит, чей это чат.
 * Дальше чат получает выплаты, сбои синхронизации и отвечает на /week.
 */

const API = "https://api.telegram.org";
const TIMEOUT_MS = 10_000;

export function telegramToken(): string | null {
  return process.env.GLACIER_TELEGRAM_TOKEN?.trim() || null;
}

/** Отправка сообщения. Молча не падает: уведомление не должно ломать раунд. */
export async function sendTelegram(chatId: string, text: string): Promise<boolean> {
  const token = telegramToken();
  if (!token) return false;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${API}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Имя бота для подсказки в настройках («напишите @…»). */
export async function telegramBotName(): Promise<string | null> {
  const token = telegramToken();
  if (!token) return null;
  try {
    const response = await fetch(`${API}/bot${token}/getMe`);
    const payload = (await response.json()) as { ok?: boolean; result?: { username?: string } };
    return payload.ok ? (payload.result?.username ?? null) : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------- link codes

/** Одноразовый код привязки для пользователя. */
export function issueTelegramCode(userId: number): string {
  const code = Math.random().toString(36).slice(2, 8).toUpperCase();
  run("UPDATE users SET telegram_code = ? WHERE id = ?", code, userId);
  return code;
}

export function unlinkTelegram(userId: number): void {
  run("UPDATE users SET telegram_chat_id = NULL, telegram_code = NULL WHERE id = ?", userId);
}

export function telegramChatId(userId: number): string | null {
  return (
    get<{ telegram_chat_id: string | null }>(
      "SELECT telegram_chat_id FROM users WHERE id = ?",
      userId,
    )?.telegram_chat_id ?? null
  );
}

// ------------------------------------------------------------- webhook

export interface TelegramUpdate {
  message?: {
    text?: string;
    chat?: { id?: number | string };
  };
}

/**
 * Разбор апдейта от бота. Возвращает ответ, который надо отправить в чат,
 * или null, если апдейт не для нас (не команда, не текст).
 */
export function handleUpdate(update: TelegramUpdate): {
  chatId: string;
  reply: string;
} | null {
  const text = update.message?.text?.trim();
  const chatId = update.message?.chat?.id;
  if (!text || chatId === undefined || chatId === null) return null;
  const chat = String(chatId);

  if (text.startsWith("/start")) {
    const code = text.slice(6).trim().toUpperCase();
    if (!code) {
      return { chatId: chat, reply: "Отправьте код привязки из настроек Glacier: /start КОД" };
    }

    const user = get<{ id: number; name: string }>(
      "SELECT id, name FROM users WHERE telegram_code = ? AND telegram_code IS NOT NULL",
      code,
    );
    if (!user) {
      return { chatId: chat, reply: "Код не найден или уже использован. Выпустите новый в настройках Glacier." };
    }

    run("UPDATE users SET telegram_chat_id = ?, telegram_code = NULL WHERE id = ?", chat, user.id);
    return {
      chatId: chat,
      reply:
        `Готово, ${user.name || "друг"}! Теперь сюда будут приходить выплаты и сбои синхронизации. ` +
        "Команда /week — выплаты на ближайшие 7 дней.",
    };
  }

  if (text.startsWith("/week")) {
    return { chatId: chat, reply: upcomingPayoutsText(chat) };
  }

  return null;
}

/** Выплаты ближайшей недели по портфелям владельца чата. */
function upcomingPayoutsText(chatId: string): string {
  const user = get<{ id: number }>("SELECT id FROM users WHERE telegram_chat_id = ?", chatId);
  if (!user) return "Чат не привязан. Отправьте /start с кодом из настроек Glacier.";

  const today = nowIso().slice(0, 10);
  const weekAhead = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);

  const rows = all<{
    symbol: string;
    kind: string;
    pay_date: string;
    amount: number;
    currency: string;
    quantity: number;
  }>(
    `SELECT i.symbol, p.kind, p.pay_date, p.amount, p.currency,
            (SELECT SUM(t.quantity * CASE t.type WHEN 'BUY' THEN 1 WHEN 'SELL' THEN -1 ELSE 0 END)
               FROM transactions t
               JOIN portfolios pf ON pf.id = t.portfolio_id
              WHERE t.instrument_id = i.id AND pf.user_id = ? AND t.ts <= ?) AS quantity
       FROM payouts p
       JOIN instruments i ON i.id = p.instrument_id
      WHERE p.pay_date BETWEEN ? AND ?
        AND EXISTS (
          SELECT 1 FROM transactions t
            JOIN portfolios pf ON pf.id = t.portfolio_id
           WHERE t.instrument_id = i.id AND pf.user_id = ?
        )
      ORDER BY p.pay_date`,
    user.id, today, today, weekAhead, user.id,
  );

  const lines = rows
    .filter((row) => (row.quantity ?? 0) > 0)
    .map((row) => {
      const total = row.amount * row.quantity;
      const label = row.kind === "coupon" ? "купон" : row.kind === "dividend" ? "дивиденд" : "выплата";
      return `${row.pay_date.slice(5)} · ${row.symbol} ${label} ≈ ${Math.round(total).toLocaleString("ru-RU")} ${row.currency === "RUB" ? "₽" : row.currency}`;
    });

  return lines.length > 0
    ? `Выплаты на ближайшие 7 дней:\n${lines.join("\n")}`
    : "На ближайшие 7 дней выплат по вашим бумагам нет.";
}

// ------------------------------------------------------- round notifications

/**
 * Уведомления после раунда автосинхронизации.
 *
 * Выплаты, появившиеся в журнале за время раунда, и сбои синхронизации —
 * владельцу счёта. Тихий раунд ничего не шлёт: бот, который пишет «всё хорошо»
 * каждый час, отключают за неделю.
 */
export async function notifyRound(startedAt: string, errors: string[]): Promise<number> {
  if (!telegramToken()) return 0;

  // Ошибки — владельцам привязок, о которых речь. Текст ошибки уже содержит
  // название счёта; чтобы не строить обратный разбор, шлём всем привязанным
  // пользователям, у которых есть активные подключения.
  let sent = 0;

  if (errors.length > 0) {
    const linked = all<{ telegram_chat_id: string; name: string }>(
      `SELECT DISTINCT u.telegram_chat_id, u.name
         FROM users u
         JOIN broker_connections c ON c.user_id = u.id
         JOIN broker_links l ON l.connection_id = c.id AND l.auto_sync = 1
        WHERE u.telegram_chat_id IS NOT NULL`,
    );
    for (const target of linked) {
      const ok = await sendTelegram(
        target.telegram_chat_id,
        `⚠️ Автосинхронизация: ${errors.join("; ")}`,
      );
      if (ok) sent++;
    }
  }

  // Выплаты, появившиеся в журнале с начала раунда (загруженные, не ручные).
  const income = all<{
    user_id: number;
    telegram_chat_id: string | null;
    symbol: string;
    type: string;
    amount: number;
    currency: string;
  }>(
    `SELECT p.user_id, u.telegram_chat_id, i.symbol, t.type, t.amount, t.currency
       FROM transactions t
       JOIN portfolios p ON p.id = t.portfolio_id
       JOIN users u ON u.id = p.user_id
       JOIN instruments i ON i.id = t.instrument_id
      WHERE t.type IN ('DIVIDEND','COUPON','AMORTIZATION')
        AND t.source <> 'manual'
        AND t.created_at >= ?
        AND u.telegram_chat_id IS NOT NULL`,
    startedAt,
  );

  const byChat = new Map<string, string[]>();
  for (const row of income) {
    if (!row.telegram_chat_id) continue;
    const label =
      row.type === "DIVIDEND" ? "дивиденд" : row.type === "COUPON" ? "купон" : "амортизация";
    const line = `💰 ${row.symbol}: ${label} ${row.amount.toLocaleString("ru-RU")} ${row.currency === "RUB" ? "₽" : row.currency}`;
    const list = byChat.get(row.telegram_chat_id) ?? [];
    list.push(line);
    byChat.set(row.telegram_chat_id, list);
  }

  for (const [chatId, lines] of byChat) {
    const ok = await sendTelegram(chatId, lines.join("\n"));
    if (ok) sent++;
  }

  return sent;
}
