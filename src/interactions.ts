import type { InlineKeyboardMarkup, ScheduleItem } from "./types";

export type ReminderAction = "done" | "skip";
export type FeedbackAction = ReminderAction;
export type StickerScene =
  | "wake"
  | "water"
  | "move"
  | "meal"
  | "sleep"
  | "focus"
  | "default";

export interface ParsedReminderCallback {
  kind: "reminder" | "test";
  action: ReminderAction;
  reminderDate: string;
  reminderTime: string;
}

export interface ParsedStickerSceneCallback {
  stickerId: string;
  scene: StickerScene;
}

export const STICKER_SCENES: Array<{ scene: StickerScene; label: string }> = [
  { scene: "wake", label: "🌅 起床" },
  { scene: "water", label: "💧 喝水" },
  { scene: "move", label: "🧘 活动" },
  { scene: "meal", label: "🍱 吃饭" },
  { scene: "sleep", label: "🌙 睡前" },
  { scene: "focus", label: "📚 专注" },
  { scene: "default", label: "⭐ 默认" },
];

const ACTION_TO_CODE: Record<ReminderAction, string> = {
  done: "d",
  skip: "k",
};

const CODE_TO_ACTION: Record<string, ReminderAction> = {
  d: "done",
  k: "skip",
};

export function buildReminderKeyboard(
  reminderDate: string,
  reminderTime: string,
): InlineKeyboardMarkup {
  return buildActionKeyboard("r", reminderDate, reminderTime);
}

export function buildTestReminderKeyboard(
  reminderDate: string,
  reminderTime: string,
): InlineKeyboardMarkup {
  return buildActionKeyboard("t", reminderDate, reminderTime);
}

function buildActionKeyboard(
  prefix: "r" | "t",
  reminderDate: string,
  reminderTime: string,
): InlineKeyboardMarkup {
  const time = reminderTime.replace(":", "");

  return {
    inline_keyboard: [
      [
        { text: "✅ 完成", callback_data: buildCallbackData(prefix, "done", reminderDate, time) },
        { text: "⏭️ 跳过", callback_data: buildCallbackData(prefix, "skip", reminderDate, time) },
      ],
    ],
  };
}

export function buildStickerSceneKeyboard(stickerId: string): InlineKeyboardMarkup {
  const rows = [];
  for (let index = 0; index < STICKER_SCENES.length; index += 2) {
    rows.push(
      STICKER_SCENES.slice(index, index + 2).map(({ scene, label }) => ({
        text: label,
        callback_data: buildStickerSceneCallbackData(stickerId, scene),
      })),
    );
  }

  return {
    inline_keyboard: rows,
  };
}

export function parseStickerSceneCallbackData(
  data: string | undefined,
): ParsedStickerSceneCallback | null {
  if (!data) return null;

  const [prefix, scene, stickerId] = data.split(":");
  if (prefix !== "sticker" || !isStickerScene(scene) || !stickerId) {
    return null;
  }

  return { scene, stickerId };
}

export function parseReminderCallbackData(
  data: string | undefined,
): ParsedReminderCallback | null {
  if (!data) return null;

  const [prefix, actionCode, reminderDate, time] = data.split(":");
  if (
    (prefix !== "r" && prefix !== "t")
    || !actionCode
    || !reminderDate
    || !time
  ) {
    return null;
  }

  const action = CODE_TO_ACTION[actionCode];
  if (!action || !/^\d{4}-\d{2}-\d{2}$/.test(reminderDate) || !/^\d{4}$/.test(time)) {
    return null;
  }

  return {
    kind: prefix === "t" ? "test" : "reminder",
    action,
    reminderDate,
    reminderTime: `${time.slice(0, 2)}:${time.slice(2)}`,
  };
}

export function getLocalDate(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function formatReminderTime(item: ScheduleItem): string {
  return `${String(item.hour).padStart(2, "0")}:${String(item.minute).padStart(2, "0")}`;
}

export function getReminderScene(item?: ScheduleItem, fallbackText: string = ""): string {
  const text = `${item?.message ?? ""}\n${fallbackText}`;

  if (/起床|早晨|晨间|窗帘/.test(text)) return "wake";
  if (/喝水|补充水分|水/.test(text)) return "water";
  if (/走|散步|活动|伸展|肩颈|脖子|拉伸/.test(text)) return "move";
  if (/早餐|午餐|晚餐|吃饭|餐/.test(text)) return "meal";
  if (/午休|睡|晚安|上床|屏幕宵禁/.test(text)) return "sleep";
  if (/工作|学习|屏幕|坐姿/.test(text)) return "focus";
  return "default";
}

function buildCallbackData(
  prefix: "r" | "t",
  action: ReminderAction,
  reminderDate: string,
  compactTime: string,
): string {
  return `${prefix}:${ACTION_TO_CODE[action]}:${reminderDate}:${compactTime}`;
}

function buildStickerSceneCallbackData(stickerId: string, scene: StickerScene): string {
  return `sticker:${scene}:${stickerId}`;
}

function isStickerScene(value: string): value is StickerScene {
  return STICKER_SCENES.some(({ scene }) => scene === value);
}
