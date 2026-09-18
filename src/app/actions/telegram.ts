"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { issueTelegramCode, telegramBotName, unlinkTelegram } from "@/lib/telegram";

export interface TelegramState {
  error?: string;
  success?: string;
  code?: string;
  botName?: string | null;
}

/**
 * Выпустить одноразовый код привязки. Код показывается один раз в ответе
 * действия — в базе он живёт до использования, но в разметку страницы не
 * попадает.
 */
export async function telegramLinkAction(_previous: TelegramState): Promise<TelegramState> {
  const user = await requireUser();

  if (!process.env.GLACIER_TELEGRAM_TOKEN?.trim()) {
    return {
      error:
        "Бот не настроен на этом сервере. Администратору: задайте GLACIER_TELEGRAM_TOKEN в .env.",
    };
  }

  const code = issueTelegramCode(user.id);
  const botName = await telegramBotName();

  revalidatePath("/settings");
  return {
    success: "Код выпущен. Он одноразовый и сгорит при привязке.",
    code,
    botName,
  };
}

export async function telegramUnlinkAction(_previous: TelegramState): Promise<TelegramState> {
  const user = await requireUser();
  unlinkTelegram(user.id);
  revalidatePath("/settings");
  return { success: "Привязка снята. Уведомления больше не приходят." };
}
