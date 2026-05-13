import { sendTestReminder } from "./commands";
import {
  getChatStatus,
  getReminderFeedbackForDate,
  getStickerSceneCounts,
  setChatActive,
} from "./db";
import { formatReminderTime, getLocalDate, STICKER_SCENES } from "./interactions";
import { timeline } from "./timeline";
import type { Env } from "./types";

const AUTH_MAX_AGE_SECONDS = 24 * 60 * 60;

interface MiniAppUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
}

interface MiniAppAuth {
  user: MiniAppUser;
  chatId: number;
}

export async function handleMiniAppRequest(
  request: Request,
  env: Env,
): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/app") {
    return htmlResponse(renderMiniAppHtml());
  }

  if (!url.pathname.startsWith("/api/app/")) {
    return Response.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  const auth = await authenticateMiniAppRequest(request, env);
  if (!auth) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  if (request.method === "GET" && url.pathname === "/api/app/summary") {
    return Response.json({ ok: true, data: await buildMiniAppSummary(env, auth) });
  }

  if (request.method === "POST" && url.pathname === "/api/app/toggle") {
    const body = await readJsonBody<{ active?: unknown }>(request);
    const active = body?.active === true;
    await setChatActive(env, {
      id: auth.chatId,
      type: "private",
      username: auth.user.username ?? null,
      firstName: auth.user.first_name ?? null,
      lastName: auth.user.last_name ?? null,
    }, active);
    return Response.json({ ok: true, data: await buildMiniAppSummary(env, auth) });
  }

  if (request.method === "POST" && url.pathname === "/api/app/test") {
    await sendTestReminder(auth.chatId, env);
    return Response.json({ ok: true });
  }

  return Response.json({ ok: false, error: "Not found" }, { status: 404 });
}

async function buildMiniAppSummary(env: Env, auth: MiniAppAuth): Promise<object> {
  const now = new Date();
  const localNow = new Date(now.toLocaleString("en-US", { timeZone: env.TIMEZONE }));
  const currentMinutes = localNow.getHours() * 60 + localNow.getMinutes();
  const reminderDate = getLocalDate(now, env.TIMEZONE);
  const [status, feedback, stickerCounts] = await Promise.all([
    getChatStatus(env, auth.chatId),
    getReminderFeedbackForDate(env, auth.chatId, reminderDate),
    getStickerSceneCounts(env),
  ]);

  const items = timeline.map((item) => {
    const time = formatReminderTime(item);
    const itemMinutes = item.hour * 60 + item.minute;
    const action = feedback.get(time) ?? null;
    return {
      time,
      title: stripHtml(item.message.split("\n")[0]),
      action,
      state: action ?? (itemMinutes <= currentMinutes ? "missed" : "pending"),
    };
  });

  const doneCount = items.filter((item) => item.action === "done").length;
  const skipCount = items.filter((item) => item.action === "skip").length;
  const snoozeCount = items.filter((item) => item.action === "snooze").length;

  return {
    user: {
      id: auth.user.id,
      name: [auth.user.first_name, auth.user.last_name].filter(Boolean).join(" ")
        || auth.user.username
        || "bolt特工",
    },
    chat: {
      active: status?.active ?? false,
      startedAt: status?.startedAt ?? null,
      streakDays: status?.streakDays ?? 0,
      totalDone: status?.totalDone ?? 0,
    },
    today: {
      date: reminderDate,
      now: localNow.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
      totalCount: timeline.length,
      doneCount,
      skipCount,
      snoozeCount,
      items,
    },
    stickers: STICKER_SCENES.map(({ scene, label }) => ({
      scene,
      label,
      count: stickerCounts.get(scene) ?? 0,
    })),
  };
}

async function authenticateMiniAppRequest(
  request: Request,
  env: Env,
): Promise<MiniAppAuth | null> {
  const authorization = request.headers.get("Authorization") ?? "";
  const initData = authorization.startsWith("tma ")
    ? authorization.slice(4)
    : "";
  if (!initData || !await verifyTelegramInitData(initData, env.TG_BOT_TOKEN)) {
    return null;
  }

  const params = new URLSearchParams(initData);
  const userRaw = params.get("user");
  if (!userRaw) return null;

  try {
    const user = JSON.parse(userRaw) as MiniAppUser;
    return Number.isFinite(user.id) ? { user, chatId: user.id } : null;
  } catch {
    return null;
  }
}

async function verifyTelegramInitData(initData: string, botToken: string): Promise<boolean> {
  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");
  const authDate = Number(params.get("auth_date"));
  if (!receivedHash || !Number.isFinite(authDate)) return false;

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - authDate) > AUTH_MAX_AGE_SECONDS) return false;

  params.delete("hash");
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const encoder = new TextEncoder();
  const webAppDataKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode("WebAppData"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const secret = await crypto.subtle.sign("HMAC", webAppDataKey, encoder.encode(botToken));
  const dataKey = await crypto.subtle.importKey(
    "raw",
    secret,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const calculated = await crypto.subtle.sign("HMAC", dataKey, encoder.encode(dataCheckString));

  return timingSafeEqual(new Uint8Array(calculated), hexToBytes(receivedHash));
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;

  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a[index] ^ b[index];
  }
  return diff === 0;
}

function hexToBytes(hex: string): Uint8Array {
  if (!/^[a-f0-9]+$/i.test(hex) || hex.length % 2 !== 0) {
    return new Uint8Array();
  }

  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

async function readJsonBody<T>(request: Request): Promise<T | null> {
  try {
    return await request.json<T>();
  } catch {
    return null;
  }
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, "");
}

function htmlResponse(html: string): Response {
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function renderMiniAppHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>Reminder Bot</title>
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
  <style>
    :root { color-scheme: light dark; --bg: #f6f3ec; --text: #202124; --muted: #77736b; --line: #ded8cc; --panel: #fffaf0; --accent: #2f8f6b; --danger: #b4463a; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: var(--bg); color: var(--text); }
    main { max-width: 720px; margin: 0 auto; padding: 16px 14px 28px; }
    header { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; margin-bottom: 14px; }
    h1 { font-size: 22px; line-height: 1.2; margin: 0 0 4px; }
    h2 { font-size: 15px; margin: 18px 0 10px; color: var(--muted); font-weight: 700; }
    .muted { color: var(--muted); font-size: 13px; }
    .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 12px; }
    .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
    .stat { padding: 10px 8px; border: 1px solid var(--line); border-radius: 8px; background: rgba(255,255,255,.48); }
    .stat strong { display: block; font-size: 20px; }
    button { border: 0; border-radius: 8px; padding: 10px 12px; font-size: 15px; font-weight: 700; color: white; background: var(--accent); }
    button.secondary { background: #6e756f; }
    button.danger { background: var(--danger); }
    button:disabled { opacity: .55; }
    .actions { display: flex; gap: 8px; margin-top: 12px; }
    .actions button { flex: 1; }
    .timeline { display: grid; gap: 8px; }
    .item { display: grid; grid-template-columns: 54px 28px 1fr; gap: 8px; align-items: center; padding: 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--panel); }
    .time { font-variant-numeric: tabular-nums; font-weight: 700; }
    .title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .stickers { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
    .sticker { display: flex; justify-content: space-between; gap: 8px; padding: 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--panel); }
    .error { color: var(--danger); white-space: pre-wrap; }
    @media (prefers-color-scheme: dark) { :root { --bg: #171918; --text: #f4f1ea; --muted: #aaa39a; --line: #343a36; --panel: #202421; --accent: #31a97d; --danger: #c9574d; } .stat { background: rgba(255,255,255,.04); } }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>阿尼亚提醒控制台</h1>
        <div id="subtitle" class="muted">加载中...</div>
      </div>
      <button id="refresh" class="secondary">刷新</button>
    </header>
    <section id="content"></section>
  </main>
  <script>
    const tg = window.Telegram?.WebApp;
    tg?.ready();
    tg?.expand();
    const initData = tg?.initData || "";
    const content = document.querySelector("#content");
    const subtitle = document.querySelector("#subtitle");
    const refresh = document.querySelector("#refresh");
    let summary = null;

    refresh.addEventListener("click", load);

    async function api(path, options = {}) {
      const res = await fetch(path, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          "Authorization": "tma " + initData,
          ...(options.headers || {})
        }
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "请求失败");
      return data.data;
    }

    async function load() {
      if (!initData) {
        subtitle.textContent = "请从 Telegram Mini App 打开";
        content.innerHTML = '<div class="panel error">没有检测到 Telegram initData。请从 bot 的菜单按钮打开控制台。</div>';
        return;
      }
      refresh.disabled = true;
      try {
        summary = await api("/api/app/summary");
        render(summary);
      } catch (error) {
        content.innerHTML = '<div class="panel error">' + escapeHtml(error.message) + '</div>';
      } finally {
        refresh.disabled = false;
      }
    }

    function render(data) {
      subtitle.textContent = data.user.name + " · " + data.today.date + " " + data.today.now;
      const activeText = data.chat.active ? "值班中" : "已暂停";
      content.innerHTML = \`
        <section class="panel">
          <div class="grid">
            <div class="stat"><span class="muted">状态</span><strong>\${activeText}</strong></div>
            <div class="stat"><span class="muted">完成</span><strong>\${data.today.doneCount}/\${data.today.totalCount}</strong></div>
            <div class="stat"><span class="muted">连续</span><strong>\${data.chat.streakDays}</strong></div>
            <div class="stat"><span class="muted">总计</span><strong>\${data.chat.totalDone}</strong></div>
          </div>
          <div class="actions">
            <button id="toggle" class="\${data.chat.active ? 'danger' : ''}">\${data.chat.active ? '暂停提醒' : '开启提醒'}</button>
            <button id="test" class="secondary">发送测试</button>
          </div>
        </section>
        <h2>今日时间线</h2>
        <section class="timeline">\${data.today.items.map(renderItem).join("")}</section>
        <h2>贴纸场景</h2>
        <section class="stickers">\${data.stickers.map(renderSticker).join("")}</section>
      \`;
      document.querySelector("#toggle").addEventListener("click", toggleActive);
      document.querySelector("#test").addEventListener("click", sendTest);
    }

    function renderItem(item) {
      const icon = item.state === "done" ? "✅" : item.state === "skip" ? "⏭️" : item.state === "snooze" ? "💤" : item.state === "missed" ? "▫️" : "⏳";
      return '<div class="item"><div class="time">' + item.time + '</div><div>' + icon + '</div><div class="title">' + escapeHtml(item.title) + '</div></div>';
    }

    function renderSticker(item) {
      return '<div class="sticker"><span>' + escapeHtml(item.label) + '</span><strong>' + item.count + '</strong></div>';
    }

    async function toggleActive(event) {
      event.currentTarget.disabled = true;
      summary = await api("/api/app/toggle", { method: "POST", body: JSON.stringify({ active: !summary.chat.active }) });
      render(summary);
    }

    async function sendTest(event) {
      event.currentTarget.disabled = true;
      try {
        await api("/api/app/test", { method: "POST", body: "{}" });
        tg?.showPopup?.({ title: "已发送", message: "阿尼亚发出测试提醒了。", buttons: [{ type: "ok" }] });
      } finally {
        event.currentTarget.disabled = false;
      }
    }

    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
    }

    load();
  </script>
</body>
</html>`;
}
