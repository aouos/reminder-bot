import type { InlineKeyboardMarkup, TelegramMessage } from "./types";

const TG_API = "https://api.telegram.org/bot";

interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

interface SendMessageOptions {
  parseMode?: string | null;
  replyMarkup?: InlineKeyboardMarkup;
  disableNotification?: boolean;
  messageEffectId?: string;
}

export async function sendMessage(
  token: string,
  chatId: number | string,
  text: string,
  parseModeOrOptions: string | null | SendMessageOptions = "HTML",
): Promise<boolean> {
  const options = normalizeSendMessageOptions(parseModeOrOptions);
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
  };

  if (options.parseMode) {
    body.parse_mode = options.parseMode;
  }

  if (options.replyMarkup) {
    body.reply_markup = options.replyMarkup;
  }

  if (options.disableNotification !== undefined) {
    body.disable_notification = options.disableNotification;
  }

  if (options.messageEffectId) {
    body.message_effect_id = options.messageEffectId;
  }

  const result = await telegramRequest<TelegramMessage>(token, "sendMessage", body);
  return result.ok;
}

export async function sendChatAction(
  token: string,
  chatId: number | string,
  action: "typing" | "upload_photo" | "record_voice" | "upload_document" = "typing",
): Promise<boolean> {
  const result = await telegramRequest<true>(token, "sendChatAction", {
    chat_id: chatId,
    action,
  });
  return result.ok;
}

export async function answerCallbackQuery(
  token: string,
  callbackQueryId: string,
  text?: string,
  showAlert: boolean = false,
): Promise<boolean> {
  const result = await telegramRequest<true>(token, "answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text,
    show_alert: showAlert,
  });
  return result.ok;
}

export async function sendSticker(
  token: string,
  chatId: number | string,
  sticker: string,
): Promise<boolean> {
  const result = await telegramRequest<TelegramMessage>(token, "sendSticker", {
    chat_id: chatId,
    sticker,
  });
  return result.ok;
}

export async function editMessageReplyMarkup(
  token: string,
  chatId: number | string,
  messageId: number,
  replyMarkup: InlineKeyboardMarkup | null = null,
): Promise<boolean> {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    message_id: messageId,
  };

  if (replyMarkup) {
    body.reply_markup = replyMarkup;
  }

  const result = await telegramRequest<TelegramMessage | true>(token, "editMessageReplyMarkup", body);
  return result.ok;
}

export async function setWebhook(
  token: string,
  webhookUrl: string,
): Promise<boolean> {
  const result = await telegramRequest<true>(token, "setWebhook", {
    url: webhookUrl,
  });
  return result.ok;
}

export async function setMyCommands(token: string): Promise<boolean> {
  const commands = [
    { command: "start", description: "让阿尼亚开始提醒" },
    { command: "stop", description: "让阿尼亚暂停提醒" },
    { command: "test", description: "测试一条 Anya 提醒" },
    { command: "list", description: "查看今日提醒时间表" },
    { command: "status", description: "查看阿尼亚值班状态" },
    { command: "help", description: "查看可用指令" },
  ];

  const result = await telegramRequest<true>(token, "setMyCommands", { commands });
  return result.ok;
}

async function telegramRequest<T>(
  token: string,
  method: string,
  body?: Record<string, unknown>,
): Promise<TelegramApiResponse<T>> {
  const url = `${TG_API}${token}/${method}`;
  const init: RequestInit = body
    ? {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
    : { method: "POST" };

  const res = await fetch(url, init);
  if (!res.ok) {
    return {
      ok: false,
      description: `Telegram API returned ${res.status}`,
    };
  }

  return res.json<TelegramApiResponse<T>>();
}

function normalizeSendMessageOptions(
  parseModeOrOptions: string | null | SendMessageOptions,
): SendMessageOptions {
  if (
    typeof parseModeOrOptions === "string" ||
    parseModeOrOptions === null
  ) {
    return { parseMode: parseModeOrOptions };
  }

  return {
    parseMode: "HTML",
    ...parseModeOrOptions,
  };
}
