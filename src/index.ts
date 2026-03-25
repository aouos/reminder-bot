import type { Env, TelegramUpdate } from "./types";
import { sendMessage, setWebhook, setMyCommands } from "./telegram";
import { handleCommand } from "./commands";
import { timeline } from "./timeline";

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
      const [webhookOk, commandsOk] = await Promise.all([
        setWebhook(env.TG_BOT_TOKEN, webhookUrl),
        setMyCommands(env.TG_BOT_TOKEN),
      ]);

      const allOk = webhookOk && commandsOk;
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
    const now = new Date();
    const localTime = new Date(
      now.toLocaleString("en-US", { timeZone: env.TIMEZONE }),
    );
    const currentHour = localTime.getHours();
    const currentMinute = localTime.getMinutes();

    // Find matching timeline item
    const matched = timeline.find(
      (item) => item.hour === currentHour && item.minute === currentMinute,
    );

    if (!matched) return;

    // Get all active chats from KV
    const chatIds = await getActiveChatIds(env);

    // Send message to all active chats
    await Promise.allSettled(
      chatIds.map((chatId) =>
        sendMessage(env.TG_BOT_TOKEN, chatId, matched.message),
      ),
    );
  },
};

async function handleWebhook(
  request: Request,
  env: Env,
): Promise<Response> {
  try {
    const update: TelegramUpdate = await request.json();

    if (update.message?.text?.startsWith("/")) {
      return handleCommand(update.message, env);
    }

    return new Response("OK");
  } catch {
    return new Response("Bad Request", { status: 400 });
  }
}

async function getActiveChatIds(env: Env): Promise<number[]> {
  const list = await env.REMINDER_KV.list({ prefix: "chat:" });
  const chatIds: number[] = [];

  for (const key of list.keys) {
    const data = await env.REMINDER_KV.get(key.name);
    if (data) {
      const state = JSON.parse(data);
      if (state.active) {
        const chatId = Number(key.name.replace("chat:", ""));
        if (!isNaN(chatId)) chatIds.push(chatId);
      }
    }
  }

  return chatIds;
}
