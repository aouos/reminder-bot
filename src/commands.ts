import type { Env, TelegramMessage } from "./types";
import { sendChatAction, sendMessage } from "./telegram";
import { timeline } from "./timeline";
import {
  activateChat,
  deactivateChat,
  getChatStatus,
  getReminderFeedbackForDate,
  getStickerSceneCounts,
} from "./db";
import { generateReminderMessage } from "./ai";
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
  await activateChat(env, message);

  await sendMessage(env.TG_BOT_TOKEN, chatId, HELP_TEXT);

  return new Response("OK");
}

async function handleStop(message: TelegramMessage, env: Env): Promise<Response> {
  const chatId = message.chat.id;
  await deactivateChat(env, message);

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
  const item = timeline.find((entry) => entry.hour * 60 + entry.minute > currentMinutes)
    ?? timeline[0];

  if (!item) {
    await sendMessage(env.TG_BOT_TOKEN, chatId, "嘎ーん 😱 阿尼亚没有找到提醒时间表。");
    return;
  }

  await sendChatAction(env.TG_BOT_TOKEN, chatId);

  const reminderDate = getLocalDate(now, env.TIMEZONE);
  const reminderTime = formatReminderTime(item);
  const generated = await generateReminderMessage({ env, item, now });
  const isGenerated = generated !== item.message;

  await sendStickerForScene(env, chatId, getReminderScene(item, generated));
  await sendMessage(env.TG_BOT_TOKEN, chatId, generated, {
    parseMode: isGenerated ? null : "HTML",
    replyMarkup: buildTestReminderKeyboard(reminderDate, reminderTime),
  });
}

async function handleList(chatId: number, env: Env): Promise<Response> {
  const now = new Date();
  const currentTime = new Date(
    now.toLocaleString("en-US", { timeZone: env.TIMEZONE }),
  );
  const reminderDate = getLocalDate(now, env.TIMEZONE);
  const feedback = await getReminderFeedbackForDate(env, chatId, reminderDate);
  const currentMinutes = currentTime.getHours() * 60 + currentTime.getMinutes();

  const totalCount = timeline.length;
  const doneCount = [...feedback.values()].filter((action) => action === "done").length;
  const skipCount = [...feedback.values()].filter((action) => action === "skip").length;
  const snoozeCount = [...feedback.values()].filter((action) => action === "snooze").length;

  let msg = `📋 <b>今日提醒时间表</b>（完成 ${doneCount}/${totalCount}）\n`;
  if (skipCount > 0 || snoozeCount > 0) {
    msg += `⏭️ 跳过 ${skipCount} · 💤 延后 ${snoozeCount}\n`;
  }
  msg += "\n";

  for (const item of timeline) {
    const itemMinutes = item.hour * 60 + item.minute;
    const timeStr = `${String(item.hour).padStart(2, "0")}:${String(item.minute).padStart(2, "0")}`;
    const action = feedback.get(timeStr);
    const indicator = getListIndicator(action, itemMinutes <= currentMinutes);
    const title = item.message.split("\n")[0].replace(/<[^>]*>/g, "");
    msg += `${indicator} <code>${timeStr}</code>  ${title}\n`;
  }

  msg += `\n🕐 当前时间: ${currentTime.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`;

  await sendMessage(env.TG_BOT_TOKEN, chatId, msg);
  return new Response("OK");
}

function getListIndicator(action: string | undefined, isPast: boolean): string {
  switch (action) {
    case "done":
      return "✅";
    case "skip":
      return "⏭️";
    case "snooze":
      return "💤";
    default:
      return isPast ? "▫️" : "⏳";
  }
}

async function handleStatus(chatId: number, env: Env): Promise<Response> {
  const state = await getChatStatus(env, chatId);

  let msg: string;
  if (!state) {
    msg = "ℹ️ 阿尼亚还没开始值班。\n\nbolt特工发送 /start 就可以开启提醒。";
  } else if (state.active) {
    const startTime = state.startedAt
      ? new Date(state.startedAt).toLocaleString("zh-CN", { timeZone: env.TIMEZONE })
      : "未知";
    msg = `🟢 <b>阿尼亚正在值班</b>\n\n📅 开启时间: ${startTime}\n⏰ 共 ${timeline.length} 个提醒时间点\n🔥 连续完成: ${state.streakDays} 天\n✅ 完成次数: ${state.totalDone}\n\n/list 可以看时间表。`;
  } else {
    const stopTime = state.stoppedAt
      ? new Date(state.stoppedAt).toLocaleString("zh-CN", { timeZone: env.TIMEZONE })
      : "未知";
    msg = `🔴 <b>阿尼亚已经收工</b>\n\n📅 关闭时间: ${stopTime}\n🔥 连续完成: ${state.streakDays} 天\n✅ 完成次数: ${state.totalDone}\n\n/start 可以重新开启。`;
  }

  await sendMessage(env.TG_BOT_TOKEN, chatId, msg);
  return new Response("OK");
}

async function handleStats(chatId: number, env: Env): Promise<Response> {
  const now = new Date();
  const date = getLocalDate(now, env.TIMEZONE);
  const [state, feedback] = await Promise.all([
    getChatStatus(env, chatId),
    getReminderFeedbackForDate(env, chatId, date),
  ]);
  const doneCount = [...feedback.values()].filter((action) => action === "done").length;
  const skipCount = [...feedback.values()].filter((action) => action === "skip").length;
  const snoozeCount = [...feedback.values()].filter((action) => action === "snooze").length;

  const msg = [
    "📊 <b>今日统计</b>",
    "",
    `✅ 完成：${doneCount}/${timeline.length}`,
    `⏭️ 跳过：${skipCount}`,
    `💤 延后：${snoozeCount}`,
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
