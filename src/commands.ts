import type { Env, TelegramMessage } from "./types";
import { sendMessage } from "./telegram";
import { dailySchedule } from "./schedule";
import { ensureReminderJobsForDate } from "./jobs";
import {
  getBotStatus,
  getReminderJobStatusesForDate,
  getReminderFeedbackForDate,
  getStickerSceneCounts,
  markExpiredReminderJobs,
  markMissedReminderJobsBefore,
  setBotEnabled,
} from "./db";
import {
  buildTestReminderKeyboard,
  formatReminderTime,
  getLocalDate,
  getReminderScene,
  STICKER_SCENES,
} from "./interactions";
import { sendStickerForScene } from "./stickers";

const HELP_TEXT = [
  "✅ <b>阿尼亚开始值班！</b>",
  "",
  "bolt特工，阿尼亚会按时间提醒你。",
  "",
  "<b>常用指令：</b>",
  "· /list — 今日时间表",
  "· /stats — 今日统计",
  "· /stickers — 贴纸场景",
  "· /test — 测试提醒",
  "· /stop — 暂停提醒",
].join("\n");

export async function handleCommand(
  message: TelegramMessage,
  env: Env,
): Promise<Response> {
  const chatId = message.chat.id;
  const text = message.text?.trim() ?? "";
  const command = text.split(/\s+/)[0].replace(/@\w+$/, "").toLowerCase();
  const targetChatId = getTargetChatId(env);

  if (targetChatId === null) {
    await sendMessage(
      env.TG_BOT_TOKEN,
      chatId,
      `⚙️ <b>还没有配置 TG_CHAT_ID。</b>\n\n当前 chat id：<code>${chatId}</code>\n\n把它像 TG_BOT_TOKEN 一样配置到 Worker Secret 后再部署。`,
    );
    return new Response("OK");
  }

  if (chatId !== targetChatId) {
    await sendMessage(env.TG_BOT_TOKEN, chatId, "这个 bot 已绑定固定 chat。");
    return new Response("OK");
  }

  switch (command) {
    case "/start":
      return handleStart(message, env);
    case "/stop":
      return handleStop(message, env);
    case "/test":
      return handleTest(chatId, env);
    case "/list":
      return handleList(chatId, env);
    case "/status":
      return handleStatus(chatId, env);
    case "/stats":
      return handleStats(chatId, env);
    case "/stickers":
      return handleStickers(chatId, env);
    default:
      return handleUnknownCommand(chatId, env);
  }
}

async function handleStart(message: TelegramMessage, env: Env): Promise<Response> {
  const chatId = message.chat.id;
  await setBotEnabled(env, true);

  await sendMessage(env.TG_BOT_TOKEN, chatId, HELP_TEXT);

  return new Response("OK");
}

async function handleStop(message: TelegramMessage, env: Env): Promise<Response> {
  const chatId = message.chat.id;
  await setBotEnabled(env, false);

  await sendMessage(
    env.TG_BOT_TOKEN,
    chatId,
    "⏸️ <b>阿尼亚先收工。</b>\n\nbolt特工要重新开启的话，发送 /start。",
  );

  return new Response("OK");
}

async function handleTest(chatId: number, env: Env): Promise<Response> {
  await sendTestReminder(chatId, env);
  return new Response("OK");
}

export async function sendTestReminder(chatId: number, env: Env): Promise<void> {
  const now = new Date();
  const localNow = new Date(now.toLocaleString("en-US", { timeZone: env.TIMEZONE }));
  const currentMinutes = localNow.getHours() * 60 + localNow.getMinutes();
  const item = dailySchedule.find((entry) => entry.hour * 60 + entry.minute > currentMinutes)
    ?? dailySchedule[0];

  if (!item) {
    await sendMessage(env.TG_BOT_TOKEN, chatId, "嘎ーん 😱 阿尼亚没有找到提醒时间表。");
    return;
  }

  const reminderDate = getLocalDate(now, env.TIMEZONE);
  const reminderTime = formatReminderTime(item);

  await sendStickerForScene(env, chatId, getReminderScene(item));
  await sendMessage(env.TG_BOT_TOKEN, chatId, item.message, {
    parseMode: "HTML",
    replyMarkup: buildTestReminderKeyboard(reminderDate, reminderTime),
  });
}

async function handleList(chatId: number, env: Env): Promise<Response> {
  const now = new Date();
  const currentTime = new Date(
    now.toLocaleString("en-US", { timeZone: env.TIMEZONE }),
  );
  const reminderDate = getLocalDate(now, env.TIMEZONE);
  const state = await getBotStatus(env);

  await ensureReminderJobsForDate(env, reminderDate);
  await markExpiredReminderJobs(env, now);
  if (state.enabled && state.updatedAt) {
    await markMissedReminderJobsBefore(env, new Date(state.updatedAt), now);
  }

  const [feedback, jobs] = await Promise.all([
    getReminderFeedbackForDate(env, reminderDate),
    getReminderJobStatusesForDate(env, reminderDate),
  ]);
  const currentMinutes = currentTime.getHours() * 60 + currentTime.getMinutes();

  let msg = "📋 <b>今日提醒时间表</b>\n\n";

  for (const item of dailySchedule) {
    const itemMinutes = item.hour * 60 + item.minute;
    const timeStr = `${String(item.hour).padStart(2, "0")}:${String(item.minute).padStart(2, "0")}`;
    const action = feedback.get(timeStr);
    const indicator = getListIndicator(action, itemMinutes <= currentMinutes, jobs.get(timeStr));
    const title = item.message.split("\n")[0].replace(/<[^>]*>/g, "");
    msg += `${indicator} <code>${timeStr}</code>  ${title}\n`;
  }

  await sendMessage(env.TG_BOT_TOKEN, chatId, msg);
  return new Response("OK");
}

function getListIndicator(action: string | undefined, isPast: boolean, status: string | undefined): string {
  switch (action) {
    case "done":
      return "✅";
    case "skip":
      return "⏭️";
    default:
      if (status === "sent") return "📨";
      if (status === "sending") return "📤";
      if (status === "failed") return "⚠️";
      if (status === "missed") return "❌";
      return isPast ? "▫️" : "⏳";
  }
}

async function handleStatus(chatId: number, env: Env): Promise<Response> {
  const state = await getBotStatus(env);

  let msg: string;
  if (state.enabled) {
    const updateTime = state.updatedAt
      ? new Date(state.updatedAt).toLocaleString("zh-CN", { timeZone: env.TIMEZONE })
      : "未知";
    msg = `🟢 <b>阿尼亚正在值班</b>\n\n📅 更新时间: ${updateTime}\n⏰ 共 ${dailySchedule.length} 个提醒时间点\n🔥 连续完成: ${state.streakDays} 天\n✅ 完成次数: ${state.totalDone}\n\n/list 可以看时间表。`;
  } else {
    const updateTime = state.updatedAt
      ? new Date(state.updatedAt).toLocaleString("zh-CN", { timeZone: env.TIMEZONE })
      : "未知";
    msg = `🔴 <b>阿尼亚已经收工</b>\n\n📅 更新时间: ${updateTime}\n🔥 连续完成: ${state.streakDays} 天\n✅ 完成次数: ${state.totalDone}\n\n/start 可以重新开启。`;
  }

  await sendMessage(env.TG_BOT_TOKEN, chatId, msg);
  return new Response("OK");
}

async function handleStats(chatId: number, env: Env): Promise<Response> {
  const now = new Date();
  const date = getLocalDate(now, env.TIMEZONE);
  const [state, feedback] = await Promise.all([
    getBotStatus(env),
    getReminderFeedbackForDate(env, date),
  ]);
  const doneCount = [...feedback.values()].filter((action) => action === "done").length;
  const skipCount = [...feedback.values()].filter((action) => action === "skip").length;

  const msg = [
    "📊 <b>今日统计</b>",
    "",
    `✅ 完成：${doneCount}/${dailySchedule.length}`,
    `⏭️ 跳过：${skipCount}`,
    "",
    `🔥 连续完成：${state?.streakDays ?? 0} 天`,
    `🎯 总完成：${state?.totalDone ?? 0} 次`,
  ].join("\n");

  await sendMessage(env.TG_BOT_TOKEN, chatId, msg);
  return new Response("OK");
}

async function handleStickers(chatId: number, env: Env): Promise<Response> {
  const counts = await getStickerSceneCounts(env);
  const lines = STICKER_SCENES.map(({ scene, label }) => {
    const count = counts.get(scene) ?? 0;
    return `${label} <code>${scene}</code>：${count}`;
  });

  await sendMessage(
    env.TG_BOT_TOKEN,
    chatId,
    ["🖼️ <b>贴纸场景</b>", "", ...lines, "", "发送贴纸给阿尼亚，可以继续添加或映射场景。"].join("\n"),
  );
  return new Response("OK");
}

async function handleUnknownCommand(chatId: number, env: Env): Promise<Response> {
  await sendMessage(
    env.TG_BOT_TOKEN,
    chatId,
    "嘎ーん 😱 阿尼亚没看懂这个指令。可以试试 /list、/stats、/stickers 或 /test。",
  );
  return new Response("OK");
}

function getTargetChatId(env: Env): number | null {
  const value = env.TG_CHAT_ID?.trim();
  if (!value) return null;

  const chatId = Number(value);
  return Number.isSafeInteger(chatId) ? chatId : null;
}
