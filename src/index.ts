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

      return Response.json({
        webhook: webhookOk ? "✅ set" : "❌ failed",
        commands: commandsOk ? "✅ set" : "❌ failed",
        webhookUrl,
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
