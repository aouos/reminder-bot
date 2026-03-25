import type { Env, TelegramMessage } from "./types";
import { sendMessage } from "./telegram";
import { timeline } from "./timeline";

export async function handleCommand(
  message: TelegramMessage,
  env: Env,
): Promise<Response> {
  const chatId = message.chat.id;
  const text = message.text?.trim() ?? "";
  const command = text.split(/\s+/)[0].replace(/@\w+$/, "").toLowerCase();

  switch (command) {
    case "/start":
      return handleStart(chatId, env);
    case "/stop":
      return handleStop(chatId, env);
    case "/test":
      return handleTest(chatId, env);
    case "/list":
      return handleList(chatId, env);
    case "/status":
      return handleStatus(chatId, env);
    default:
      return new Response("OK");
  }
}

async function handleStart(chatId: number, env: Env): Promise<Response> {
  await env.REMINDER_KV.put(`chat:${chatId}`, JSON.stringify({
    active: true,
    startedAt: new Date().toISOString(),
  }));

  await sendMessage(
    env.TG_BOT_TOKEN,
    chatId,
    "✅ <b>提醒已开启！</b>\n\n我会在每天的固定时间给你发送提醒消息。\n\n<b>可用指令：</b>\n· /list — 查看今日时间表\n· /status — 查看提醒状态\n· /test — 发送测试消息\n· /stop — 关闭提醒",
  );

  return new Response("OK");
}

async function handleStop(chatId: number, env: Env): Promise<Response> {
  await env.REMINDER_KV.put(`chat:${chatId}`, JSON.stringify({
    active: false,
    stoppedAt: new Date().toISOString(),
  }));

  await sendMessage(
    env.TG_BOT_TOKEN,
    chatId,
    "⏸️ <b>提醒已关闭。</b>\n\n使用 /start 重新开启。",
  );

  return new Response("OK");
}

async function handleTest(chatId: number, env: Env): Promise<Response> {
  const now = new Date();
  const localNow = new Date(now.toLocaleString("en-US", { timeZone: env.TIMEZONE }));
  const currentMinutes = localNow.getHours() * 60 + localNow.getMinutes();
  const next = timeline.find((item) => item.hour * 60 + item.minute > currentMinutes);
  const nextInfo = next
    ? `\n\n⏭️ 下一条提醒: <code>${String(next.hour).padStart(2, "0")}:${String(next.minute).padStart(2, "0")}</code>`
    : "\n\n✅ 今天的提醒已全部发完";

  await sendMessage(
    env.TG_BOT_TOKEN,
    chatId,
    "🔔 <b>测试消息</b>\n\n如果你收到了这条消息，说明 Bot 工作正常！\n\n⏰ 当前时间: " +
      now.toLocaleString("zh-CN", { timeZone: env.TIMEZONE }) + nextInfo,
  );

  return new Response("OK");
}

async function handleList(chatId: number, env: Env): Promise<Response> {
  const now = new Date();
  const currentTime = new Date(
    now.toLocaleString("en-US", { timeZone: env.TIMEZONE }),
  );
  const currentMinutes = currentTime.getHours() * 60 + currentTime.getMinutes();

  const totalCount = timeline.length;
  const doneCount = timeline.filter((item) => item.hour * 60 + item.minute <= currentMinutes).length;

  let msg = `📋 <b>今日提醒时间表</b>（${doneCount}/${totalCount}）\n\n`;
  for (const item of timeline) {
    const itemMinutes = item.hour * 60 + item.minute;
    const timeStr = `${String(item.hour).padStart(2, "0")}:${String(item.minute).padStart(2, "0")}`;
    const isPast = itemMinutes <= currentMinutes;
    const indicator = isPast ? "✅" : "⏳";
    // 只显示消息的第一行（标题部分）
    const title = item.message.split("\n")[0].replace(/<[^>]*>/g, "");
    msg += `${indicator} <code>${timeStr}</code>  ${title}\n`;
  }

  msg += `\n🕐 当前时间: ${currentTime.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`;

  await sendMessage(env.TG_BOT_TOKEN, chatId, msg);
  return new Response("OK");
}

async function handleStatus(chatId: number, env: Env): Promise<Response> {
  const data = await env.REMINDER_KV.get(`chat:${chatId}`);

  let msg: string;
  if (!data) {
    msg = "ℹ️ 你还没有开启过提醒。\n\n使用 /start 开启每日提醒。";
  } else {
    const state = JSON.parse(data);
    if (state.active) {
      const startTime = new Date(state.startedAt).toLocaleString("zh-CN", { timeZone: env.TIMEZONE });
      msg = `🟢 <b>提醒状态: 已开启</b>\n\n📅 开启时间: ${startTime}\n⏰ 共 ${timeline.length} 个提醒时间点\n\n使用 /list 查看时间表`;
    } else {
      const stopTime = new Date(state.stoppedAt).toLocaleString("zh-CN", { timeZone: env.TIMEZONE });
      msg = `🔴 <b>提醒状态: 已关闭</b>\n\n📅 关闭时间: ${stopTime}\n\n使用 /start 重新开启`;
    }
  }

  await sendMessage(env.TG_BOT_TOKEN, chatId, msg);
  return new Response("OK");
}
