import type { Env, InlineKeyboardMarkup, TelegramUpdate } from "./types";
import {
  answerCallbackQuery,
  editMessageReplyMarkup,
  sendChatAction,
  sendMessage,
  setCommandsMenuButton,
  setWebhook,
  setMyCommands,
} from "./telegram";
import { handleCommand } from "./commands";
import { timeline } from "./timeline";
import { generateReminderMessage } from "./ai";
import { sendStickerForScene } from "./stickers";
import {
  createSnooze,
  getActiveChatIds,
  getDueSnoozes,
  mapStickerToScene,
  markSnoozeSent,
  recordFeedback,
  upsertStickerAsset,
} from "./db";
import {
  buildReminderKeyboard,
  buildStickerSceneKeyboard,
  buildTestReminderKeyboard,
  formatReminderTime,
  getLocalDate,
  getReminderScene,
  parseReminderCallbackData,
  parseStickerSceneCallbackData,
  STICKER_SCENES,
} from "./interactions";

const REMINDER_SNOOZE_DELAY_MS = 10 * 60 * 1000;
const TEST_SNOOZE_DELAY_MS = 10 * 1000;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // POST /webhook - Telegram webhook endpoint
    if (request.method === "POST" && url.pathname === "/webhook") {
      return handleWebhook(request, env, ctx);
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
    _controller: ScheduledController,
    env: Env,
  ): Promise<void> {
    const now = new Date();
    await sendDueSnoozes(env, now);

    const localTime = new Date(
      now.toLocaleString("en-US", { timeZone: env.TIMEZONE }),
    );
    const currentHour = localTime.getHours();
    const currentMinute = localTime.getMinutes();

    const matched = timeline.find(
      (item) => item.hour === currentHour && item.minute === currentMinute,
    );

    if (!matched) return;

    const chatIds = await getActiveChatIds(env);
    if (chatIds.length === 0) return;

    await Promise.allSettled(
      chatIds.map((chatId) => sendChatAction(env.TG_BOT_TOKEN, chatId)),
    );

    const message = await generateReminderMessage({ env, item: matched, now });
    const isGenerated = message !== matched.message;
    const reminderDate = getLocalDate(now, env.TIMEZONE);
    const reminderTime = formatReminderTime(matched);
    const replyMarkup = buildReminderKeyboard(reminderDate, reminderTime);
    const scene = getReminderScene(matched, message);

    await Promise.allSettled(
      chatIds.map(async (chatId) => {
        await sendStickerForScene(env, chatId, scene);
        return sendReminderMessage(
          env.TG_BOT_TOKEN,
          chatId,
          message,
          matched.message,
          isGenerated,
          replyMarkup,
        );
      }),
    );
  },
};

async function sendReminderMessage(
  token: string,
  chatId: number,
  message: string,
  fallbackMessage: string,
  isGenerated: boolean,
  replyMarkup: InlineKeyboardMarkup,
): Promise<boolean> {
  const ok = await sendMessage(token, chatId, message, {
    parseMode: isGenerated ? null : "HTML",
    replyMarkup,
  });
  if (ok || !isGenerated) return ok;

  return sendMessage(token, chatId, fallbackMessage, {
    parseMode: "HTML",
    replyMarkup,
  });
}

async function handleWebhook(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  try {
    const update: TelegramUpdate = await request.json();

    if (update.callback_query) {
      return handleCallbackQuery(update.callback_query, env, ctx);
    }

    if (update.message?.text?.startsWith("/")) {
      return handleCommand(update.message, env);
    }

    if (update.message?.sticker) {
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
  ctx: ExecutionContext,
): Promise<Response> {
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

  const chatId = query.message?.chat.id ?? query.from.id;
  const messageId = query.message?.message_id;
  const item = timeline.find((entry) => formatReminderTime(entry) === parsed.reminderTime);

  if (parsed.kind === "test") {
    return handleTestCallback(query, env, ctx, parsed, chatId, messageId, item);
  }

  if (parsed.action === "snooze") {
    const dueAt = new Date(Date.now() + REMINDER_SNOOZE_DELAY_MS);
    await createSnooze(env, {
      chatId,
      dueAt,
      reminderDate: parsed.reminderDate,
      reminderTime: parsed.reminderTime,
      message: query.message?.text ?? item?.message ?? "该完成这条提醒啦。",
    });

    await recordFeedback(env, {
      chatId,
      reminderDate: parsed.reminderDate,
      reminderTime: parsed.reminderTime,
      action: parsed.action,
      messageId,
    });

    if (messageId) {
      await editMessageReplyMarkup(env.TG_BOT_TOKEN, chatId, messageId);
    }

    await answerCallbackQuery(env.TG_BOT_TOKEN, query.id, "10 分钟后阿尼亚再来。");
    return new Response("OK");
  }

  await recordFeedback(env, {
    chatId,
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
  ctx: ExecutionContext,
  parsed: NonNullable<ReturnType<typeof parseReminderCallbackData>>,
  chatId: number,
  messageId: number | undefined,
  item: typeof timeline[number] | undefined,
): Promise<Response> {
  // Test callbacks exercise the button flow without touching feedback or stats.
  if (messageId) {
    await editMessageReplyMarkup(env.TG_BOT_TOKEN, chatId, messageId);
  }

  if (parsed.action === "snooze") {
    const message = query.message?.text ?? item?.message ?? "该完成这条提醒啦。";
    ctx.waitUntil(sendTestReminderAfterDelay(
      env,
      chatId,
      message,
      parsed.reminderDate,
      parsed.reminderTime,
      item,
    ));
    await answerCallbackQuery(env.TG_BOT_TOKEN, query.id, "10 秒后阿尼亚再测试一次。");
    return new Response("OK");
  }

  const text = parsed.action === "done"
    ? "测试完成，不写入统计。"
    : "测试跳过，不写入统计。";
  await answerCallbackQuery(env.TG_BOT_TOKEN, query.id, text);
  return new Response("OK");
}

async function sendTestReminderAfterDelay(
  env: Env,
  chatId: number,
  message: string,
  reminderDate: string,
  reminderTime: string,
  item: typeof timeline[number] | undefined,
): Promise<void> {
  await delay(TEST_SNOOZE_DELAY_MS);
  await sendStickerForScene(env, chatId, getReminderScene(item, message));
  await sendMessage(env.TG_BOT_TOKEN, chatId, `⏰ 阿尼亚测试重发：\n\n${message}`, {
    parseMode: null,
    replyMarkup: buildTestReminderKeyboard(reminderDate, reminderTime),
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendDueSnoozes(env: Env, now: Date): Promise<void> {
  const snoozes = await getDueSnoozes(env, now);

  await Promise.allSettled(
    snoozes.map(async (snooze) => {
      await sendStickerForScene(env, snooze.chatId, getReminderScene(undefined, snooze.message));

      const ok = await sendMessage(
        env.TG_BOT_TOKEN,
        snooze.chatId,
        `⏰ 阿尼亚又来提醒啦：\n\n${snooze.message}`,
        {
          parseMode: null,
          replyMarkup: buildReminderKeyboard(snooze.reminderDate, snooze.reminderTime),
        },
      );

      if (ok) {
        await markSnoozeSent(env, snooze.id);
      }
    }),
  );
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
