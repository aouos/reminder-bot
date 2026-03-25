export interface Env {
  TG_BOT_TOKEN: string;
  TIMEZONE: string;
  REMINDER_KV: KVNamespace;
}

export interface TimelineItem {
  hour: number;
  minute: number;
  message: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  text?: string;
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
