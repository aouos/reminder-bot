import type { Env, InlineKeyboardMarkup, TelegramUpdate } from "./types";
import {
  answerCallbackQuery,
  editMessageReplyMarkup,
  sendMessage,
  setCommandsMenuButton,
  setWebhook,
  setMyCommands,
} from "./telegram";
import { handleCommand } from "./commands";
import { ensureReminderJobsForDate, isLocalMidnight } from "./jobs";
import { sendStickerForScene } from "./stickers";
import {
  claimReminderJob,
  getDueReminderJobs,
  getBotStatus,
  mapStickerToScene,
  markExpiredReminderJobs,
  markMissedReminderJobsBefore,
  markReminderJobFailed,
  markReminderJobSent,
  recordFeedback,
  upsertStickerAsset,
} from "./db";
import {
  buildReminderKeyboard,
  buildStickerSceneKeyboard,
  getLocalDate,
  parseReminderCallbackData,
  parseStickerSceneCallbackData,
  STICKER_SCENES,
} from "./interactions";

const REMINDER_LOCK_MS = 2 * 60 * 1000;
const MESSAGE_SEND_ATTEMPTS = 3;
const MESSAGE_RETRY_DELAY_MS = 500;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // POST /webhook - Telegram webhook endpoint
    if (request.method === "POST" && url.pathname === "/webhook") {
      return handleWebhook(request, env);
    }

    // GET /setup - Register webhook and bot commands
    if (url.pathname === "/setup") {
      const webhookUrl = `${url.origin}/webhook`;
      const [webhookOk, commandsOk, menuOk] = await Promise.all([
        setWebhook(env.TG_BOT_TOKEN, webhookUrl),
        setMyCommands(env.TG_BOT_TOKEN),
        setCommandsMenuButton(env.TG_BOT_TOKEN),
      ]);

      const allOk = webhookOk && commandsOk && menuOk;
      const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reminder Bot Setup</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f0f0f; color: #e0e0e0; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .card { background: #1a1a1a; border-radius: 16px; padding: 40px; max-width: 480px; width: 90%; border: 1px solid #2a2a2a; }
    .icon { font-size: 48px; margin-bottom: 16px; }
    h1 { font-size: 22px; font-weight: 600; margin-bottom: 8px; color: #fff; }
    .subtitle { color: #888; font-size: 14px; margin-bottom: 28px; }
    .item { display: flex; align-items: center; justify-content: space-between; padding: 14px 0; border-bottom: 1px solid #222; }
    .item:last-child { border-bottom: none; }
    .item-label { font-size: 15px; color: #ccc; }
    .badge { padding: 4px 12px; border-radius: 20px; font-size: 13px; font-weight: 500; }
    .badge.ok { background: #0d2818; color: #4ade80; }
    .badge.fail { background: #2d0a0a; color: #f87171; }
    .url { margin-top: 20px; padding: 12px 16px; background: #111; border-radius: 8px; font-family: monospace; font-size: 13px; color: #888; word-break: break-all; }
    .footer { margin-top: 24px; text-align: center; font-size: 13px; color: #555; }
    .footer a { color: #60a5fa; text-decoration: none; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${allOk ? "🎉" : "⚠️"}</div>
    <h1>${allOk ? "Setup 完成！" : "Setup 部分失败"}</h1>
    <p class="subtitle">${allOk ? "Bot 已准备就绪，可以开始使用了" : "请检查 TG_BOT_TOKEN 是否正确"}</p>
    <div class="item">
      <span class="item-label">Webhook 注册</span>
      <span class="badge ${webhookOk ? "ok" : "fail"}">${webhookOk ? "✓ 成功" : "✗ 失败"}</span>
    </div>
    <div class="item">
      <span class="item-label">指令菜单注册</span>
      <span class="badge ${commandsOk ? "ok" : "fail"}">${commandsOk ? "✓ 成功" : "✗ 失败"}</span>
    </div>
    <div class="item">
      <span class="item-label">菜单按钮恢复</span>
      <span class="badge ${menuOk ? "ok" : "fail"}">${menuOk ? "✓ 成功" : "✗ 失败"}</span>
    </div>
    <div class="url">${webhookUrl}</div>
    <div class="footer">打开 Telegram 搜索你的 Bot → 发送 /start 开始</div>
  </div>
</body>
</html>`;

      return new Response(html, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // GET / - Health check
    return Response.json({
      status: "ok",
      name: "reminder-bot",
      time: new Date().toLocaleString("zh-CN", { timeZone: env.TIMEZONE }),
      endpoints: {
        "/setup": "Register Telegram webhook and bot commands",
        "/webhook": "Telegram webhook (POST)",
      },
    });
  },

  async scheduled(
    controller: ScheduledController,
    env: Env,
  ): Promise<void> {
    const targetChatId = getTargetChatId(env);
    if (targetChatId === null) return;

    const status = await getBotStatus(env);
    if (!status.enabled) return;

    const now = new Date();
    const scheduledAt = new Date(controller.scheduledTime);
    const reminderDate = getLocalDate(scheduledAt, env.TIMEZONE);
    const enabledSince = status.updatedAt ? new Date(status.updatedAt) : now;

    await ensureReminderJobsForDate(env, reminderDate, isLocalMidnight(scheduledAt, env.TIMEZONE));
    await markExpiredReminderJobs(env, now);
    await markMissedReminderJobsBefore(env, enabledSince, now);

    const dueJobs = await getDueReminderJobs(env, now, enabledSince);
    if (dueJobs.length === 0) return;

    for (const job of dueJobs) {
      const claimed = await claimReminderJob(env, job.id, now, REMINDER_LOCK_MS);
      if (!claimed) continue;

      try {
        await sendStickerForScene(env, targetChatId, job.scene);
        const ok = await sendReminderMessageWithRetry(
          env.TG_BOT_TOKEN,
          targetChatId,
          job.message,
          buildReminderKeyboard(job.reminderDate, job.reminderTime),
        );

        if (ok) {
          await markReminderJobSent(env, job.id, new Date());
          continue;
        }

        await markReminderJobFailed(env, job.id);
      } catch (error) {
        console.warn(
          "Reminder job delivery failed",
          error instanceof Error ? error.message : String(error),
        );
        await markReminderJobFailed(env, job.id);
      }
    }
  },
};

function getTargetChatId(env: Env): number | null {
  const value = env.TG_CHAT_ID?.trim();
  if (!value) return null;

  const chatId = Number(value);
  return Number.isSafeInteger(chatId) ? chatId : null;
}

function isTargetChat(env: Env, chatId: number): boolean {
  const targetChatId = getTargetChatId(env);
  return targetChatId !== null && targetChatId === chatId;
}

async function sendReminderMessage(
  token: string,
  chatId: number,
  message: string,
  replyMarkup: InlineKeyboardMarkup,
): Promise<boolean> {
  return sendMessage(token, chatId, message, {
    parseMode: "HTML",
    replyMarkup,
  });
}

async function sendReminderMessageWithRetry(
  token: string,
  chatId: number,
  message: string,
  replyMarkup: InlineKeyboardMarkup,
): Promise<boolean> {
  for (let attempt = 1; attempt <= MESSAGE_SEND_ATTEMPTS; attempt += 1) {
    try {
      const ok = await sendReminderMessage(token, chatId, message, replyMarkup);
      if (ok) return true;
    } catch (error) {
      console.warn(
        "Reminder message send attempt failed",
        error instanceof Error ? error.message : String(error),
      );
    }

    if (attempt < MESSAGE_SEND_ATTEMPTS) {
      await delay(MESSAGE_RETRY_DELAY_MS);
    }
  }

  return false;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function handleWebhook(
  request: Request,
  env: Env,
): Promise<Response> {
  try {
    const update: TelegramUpdate = await request.json();

    if (update.callback_query) {
      return handleCallbackQuery(update.callback_query, env);
    }

    if (update.message?.text?.startsWith("/")) {
      return handleCommand(update.message, env);
    }

    if (update.message?.sticker) {
      if (!isTargetChat(env, update.message.chat.id)) {
        return new Response("OK");
      }

      return handleStickerMessage(update.message, env);
    }

    return new Response("OK");
  } catch {
    return new Response("Bad Request", { status: 400 });
  }
}

async function handleCallbackQuery(
  query: NonNullable<TelegramUpdate["callback_query"]>,
  env: Env,
): Promise<Response> {
  const callbackChatId = query.message?.chat.id ?? query.from.id;
  if (!isTargetChat(env, callbackChatId)) {
    await answerCallbackQuery(env.TG_BOT_TOKEN, query.id, "这个 bot 已绑定固定 chat。");
    return new Response("OK");
  }

  const stickerMapping = parseStickerSceneCallbackData(query.data);
  if (stickerMapping) {
    const label = STICKER_SCENES.find(({ scene }) => scene === stickerMapping.scene)?.label
      ?? stickerMapping.scene;

    await mapStickerToScene(env, {
      stickerId: stickerMapping.stickerId,
      scene: stickerMapping.scene,
    });

    if (query.message) {
      await editMessageReplyMarkup(
        env.TG_BOT_TOKEN,
        query.message.chat.id,
        query.message.message_id,
      );
    }

    await answerCallbackQuery(env.TG_BOT_TOKEN, query.id, `已用于${label}`);

    return new Response("OK");
  }

  const parsed = parseReminderCallbackData(query.data);
  if (!parsed) {
    await answerCallbackQuery(env.TG_BOT_TOKEN, query.id, "嘎ーん，这个按钮过期啦。");
    return new Response("OK");
  }

  const chatId = callbackChatId;
  const messageId = query.message?.message_id;

  if (parsed.kind === "test") {
    return handleTestCallback(query, env, parsed, chatId, messageId);
  }

  await recordFeedback(env, {
    reminderDate: parsed.reminderDate,
    reminderTime: parsed.reminderTime,
    action: parsed.action,
    messageId,
  });

  if (messageId) {
    await editMessageReplyMarkup(env.TG_BOT_TOKEN, chatId, messageId);
  }

  if (parsed.action === "done") {
    await answerCallbackQuery(env.TG_BOT_TOKEN, query.id, "完成已记录。");
    return new Response("OK");
  }

  if (parsed.action === "skip") {
    await answerCallbackQuery(env.TG_BOT_TOKEN, query.id, "这次已跳过。");
    return new Response("OK");
  }

  return new Response("OK");
}

async function handleTestCallback(
  query: NonNullable<TelegramUpdate["callback_query"]>,
  env: Env,
  parsed: NonNullable<ReturnType<typeof parseReminderCallbackData>>,
  chatId: number,
  messageId: number | undefined,
): Promise<Response> {
  // Test callbacks exercise the button flow without touching feedback or stats.
  if (messageId) {
    await editMessageReplyMarkup(env.TG_BOT_TOKEN, chatId, messageId);
  }

  const text = parsed.action === "done"
    ? "测试完成，不写入统计。"
    : "测试跳过，不写入统计。";
  await answerCallbackQuery(env.TG_BOT_TOKEN, query.id, text);
  return new Response("OK");
}

async function handleStickerMessage(
  message: NonNullable<TelegramUpdate["message"]>,
  env: Env,
): Promise<Response> {
  const sticker = message.sticker;
  if (!sticker) return new Response("OK");

  const stickerType = sticker.is_video
    ? "video"
    : sticker.is_animated
      ? "animated"
      : "static";
  const label = sticker.emoji ? `${sticker.emoji} sticker` : "sticker";
  const source = sticker.set_name ?? "unknown";
  const stickerId = await upsertStickerAsset(env, {
    id: crypto.randomUUID(),
    fileId: sticker.file_id,
    emoji: sticker.emoji ?? null,
    label,
    type: stickerType,
    source,
  });

  await sendMessage(
    env.TG_BOT_TOKEN,
    message.chat.id,
    [
      "阿尼亚收到贴纸啦。",
      `<code>${escapeHtml(sticker.file_id)}</code>`,
      "",
      `emoji: ${sticker.emoji ?? "无"}`,
      `类型: ${stickerType}`,
      `贴纸包: ${escapeHtml(source)}`,
      "",
      "bolt特工，点一下这个贴纸应该用于哪个场景。",
    ].join("\n"),
    {
      parseMode: "HTML",
      replyMarkup: buildStickerSceneKeyboard(stickerId),
    },
  );

  return new Response("OK");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
