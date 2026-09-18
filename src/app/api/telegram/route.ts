import { NextResponse } from "next/server";
import { handleUpdate, telegramToken, type TelegramUpdate } from "@/lib/telegram";

export const dynamic = "force-dynamic";

/**
 * Вебхук Telegram-бота.
 *
 * Telegram подписывает вызов заголовком X-Telegram-Bot-Api-Secret-Token, если
 * он задан в setWebhook — он же GLACIER_TELEGRAM_WEBHOOK_SECRET. Без него (или
 * без токена бота) эндпоинта нет: 404, как и у cron.
 *
 * Регистрация вебхука — один раз, руками администратора:
 *
 *   curl "https://api.telegram.org/bot$TOKEN/setWebhook" \
 *     -d url=https://<хост>/api/telegram \
 *     -d secret_token=$GLACIER_TELEGRAM_WEBHOOK_SECRET
 */
export async function POST(request: Request) {
  const token = telegramToken();
  const secret = process.env.GLACIER_TELEGRAM_WEBHOOK_SECRET?.trim() ?? "";
  if (!token || !secret) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const presented = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (presented !== secret) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const update = (await request.json().catch(() => null)) as TelegramUpdate | null;
  const result = update ? handleUpdate(update) : null;

  if (result) {
    // Fire-and-forget: Telegram ждёт 200, повторную попытку отправки он сделает
    // сам, а вот задержка ответа ради sendMessage нам не нужна.
    const { sendTelegram } = await import("@/lib/telegram");
    void sendTelegram(result.chatId, result.reply);
  }

  return NextResponse.json({ ok: true });
}
