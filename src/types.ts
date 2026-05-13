export interface Env {
  TG_BOT_TOKEN: string;
  TIMEZONE: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  AI_SOUL?: string;
  MINI_APP_URL?: string;
  DB: D1Database;
}

export interface TimelineItem {
  hour: number;
  minute: number;
  message: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  text?: string;
  sticker?: TelegramSticker;
  reply_markup?: InlineKeyboardMarkup;
}

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: string;
  title?: string;
  first_name?: string;
  last_name?: string;
  username?: string;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

export interface TelegramSticker {
  file_id: string;
  file_unique_id: string;
  type: "regular" | "mask" | "custom_emoji";
  width: number;
  height: number;
  is_animated: boolean;
  is_video: boolean;
  emoji?: string;
  set_name?: string;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

export interface InlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
  web_app?: TelegramWebAppInfo;
}

export interface TelegramWebAppInfo {
  url: string;
}
