import type { Env, TelegramMessage } from "./types";
import type { FeedbackAction, StickerScene } from "./interactions";

export interface ChatStatus {
  active: boolean;
  startedAt: string | null;
  stoppedAt: string | null;
  streakDays: number;
  totalDone: number;
  lastDoneDate: string | null;
}

export interface DueSnooze {
  id: string;
  chatId: number;
  reminderDate: string;
  reminderTime: string;
  message: string;
}

export interface StickerCandidate {
  fileId: string;
  weight: number;
}

export interface ChatIdentity {
  id: number;
  type?: string;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  title?: string | null;
}

interface ChatStatusRow {
  active: number;
  started_at: string | null;
  stopped_at: string | null;
  streak_days: number | null;
  total_done: number | null;
  last_done_date: string | null;
}

interface StatsRow {
  streak_days: number;
  total_done: number;
  last_done_date: string | null;
}

interface ActionRow {
  action: string;
}

interface FeedbackStatusRow {
  reminder_time: string;
  action: FeedbackAction;
}

interface DeliveryTimeRow {
  reminder_time: string;
}

interface ChatIdRow {
  chat_id: number;
}

interface DueSnoozeRow {
  id: string;
  chat_id: number;
  reminder_date: string;
  reminder_time: string;
  message: string;
}

interface StickerRow {
  file_id: string;
  weight: number;
}

interface StickerAssetRow {
  id: string;
}

interface StickerSceneCountRow {
  scene: string;
  count: number;
}

export interface StickerAssetInput {
  id: string;
  fileId: string;
  emoji: string | null;
  label: string;
  type: "static" | "animated" | "video";
  source: string;
}

export async function activateChat(env: Env, message: TelegramMessage): Promise<void> {
  await setChatActive(env, chatIdentityFromMessage(message), true);
}

export async function deactivateChat(env: Env, message: TelegramMessage): Promise<void> {
  await setChatActive(env, chatIdentityFromMessage(message), false);
}

export async function setChatActive(
  env: Env,
  chat: ChatIdentity,
  active: boolean,
): Promise<void> {
  const now = new Date().toISOString();
  const stoppedAt = active ? null : now;
  await env.DB.prepare(`
    INSERT INTO chats (
      chat_id, chat_type, title, username, first_name, last_name,
      active, started_at, stopped_at, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(chat_id) DO UPDATE SET
      chat_type = excluded.chat_type,
      title = excluded.title,
      username = excluded.username,
      first_name = excluded.first_name,
      last_name = excluded.last_name,
      active = excluded.active,
      started_at = CASE
        WHEN excluded.active = 1 THEN COALESCE(chats.started_at, excluded.started_at)
        ELSE chats.started_at
      END,
      stopped_at = excluded.stopped_at,
      updated_at = excluded.updated_at
  `).bind(
    chat.id,
    chat.type ?? "private",
    chat.title ?? null,
    chat.username ?? null,
    chat.firstName ?? null,
    chat.lastName ?? null,
    active ? 1 : 0,
    active ? now : null,
    stoppedAt,
    now,
    now,
  ).run();
}

export async function getChatStatus(env: Env, chatId: number): Promise<ChatStatus | null> {
  const row = await env.DB.prepare(`
    SELECT
      c.active,
      c.started_at,
      c.stopped_at,
      s.streak_days,
      s.total_done,
      s.last_done_date
    FROM chats c
    LEFT JOIN user_stats s ON s.chat_id = c.chat_id
    WHERE c.chat_id = ?
  `).bind(chatId).first<ChatStatusRow>();

  if (!row) return null;

  return {
    active: row.active === 1,
    startedAt: row.started_at,
    stoppedAt: row.stopped_at,
    streakDays: row.streak_days ?? 0,
    totalDone: row.total_done ?? 0,
    lastDoneDate: row.last_done_date,
  };
}

export async function getActiveChatIds(env: Env): Promise<number[]> {
  const { results } = await env.DB.prepare(`
    SELECT chat_id
    FROM chats
    WHERE active = 1
  `).all<ChatIdRow>();

  return results.map((row) => row.chat_id);
}

export async function recordFeedback(
  env: Env,
  input: {
    chatId: number;
    reminderDate: string;
    reminderTime: string;
    action: FeedbackAction;
    messageId?: number;
  },
): Promise<void> {
  const previous = await env.DB.prepare(`
    SELECT action
    FROM reminder_feedback
    WHERE chat_id = ? AND reminder_date = ? AND reminder_time = ?
  `).bind(
    input.chatId,
    input.reminderDate,
    input.reminderTime,
  ).first<ActionRow>();

  const now = new Date().toISOString();
  const id = `${input.chatId}:${input.reminderDate}:${input.reminderTime}`;

  // Treat completion as final so replayed old callbacks cannot desync stats.
  if (previous?.action === "done" && input.action !== "done") {
    return;
  }

  await env.DB.prepare(`
    INSERT INTO reminder_feedback (
      id, chat_id, reminder_date, reminder_time, action,
      message_id, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(chat_id, reminder_date, reminder_time) DO UPDATE SET
      action = excluded.action,
      message_id = excluded.message_id,
      updated_at = excluded.updated_at
  `).bind(
    id,
    input.chatId,
    input.reminderDate,
    input.reminderTime,
    input.action,
    input.messageId ?? null,
    now,
    now,
  ).run();

  // Only the first "done" for a reminder should advance streak stats.
  if (input.action === "done" && previous?.action !== "done") {
    await applyDoneStats(env, input.chatId, input.reminderDate);
  }
}

export async function getReminderFeedbackForDate(
  env: Env,
  chatId: number,
  reminderDate: string,
): Promise<Map<string, FeedbackAction>> {
  const { results } = await env.DB.prepare(`
    SELECT reminder_time, action
    FROM reminder_feedback
    WHERE chat_id = ? AND reminder_date = ?
  `).bind(chatId, reminderDate).all<FeedbackStatusRow>();

  return new Map(results.map((row) => [row.reminder_time, row.action]));
}

export async function getReminderDeliveryTimesForDate(
  env: Env,
  chatId: number,
  reminderDate: string,
): Promise<Set<string>> {
  const { results } = await env.DB.prepare(`
    SELECT reminder_time
    FROM reminder_deliveries
    WHERE chat_id = ? AND reminder_date = ?
  `).bind(chatId, reminderDate).all<DeliveryTimeRow>();

  return new Set(results.map((row) => row.reminder_time));
}

export async function claimReminderDelivery(
  env: Env,
  input: {
    chatId: number;
    reminderDate: string;
    reminderTime: string;
  },
): Promise<boolean> {
  const id = `${input.chatId}:${input.reminderDate}:${input.reminderTime}`;
  const now = new Date().toISOString();

  const result = await env.DB.prepare(`
    INSERT OR IGNORE INTO reminder_deliveries (
      id, chat_id, reminder_date, reminder_time, created_at
    )
    VALUES (?, ?, ?, ?, ?)
  `).bind(
    id,
    input.chatId,
    input.reminderDate,
    input.reminderTime,
    now,
  ).run();

  return result.meta.changes > 0;
}

export async function releaseReminderDelivery(
  env: Env,
  input: {
    chatId: number;
    reminderDate: string;
    reminderTime: string;
  },
): Promise<void> {
  await env.DB.prepare(`
    DELETE FROM reminder_deliveries
    WHERE chat_id = ? AND reminder_date = ? AND reminder_time = ?
  `).bind(
    input.chatId,
    input.reminderDate,
    input.reminderTime,
  ).run();
}

export async function getStickerSceneCounts(env: Env): Promise<Map<string, number>> {
  const { results } = await env.DB.prepare(`
    SELECT m.scene, COUNT(*) AS count
    FROM sticker_mappings m
    JOIN sticker_assets a ON a.id = m.sticker_id
    WHERE m.enabled = 1 AND a.enabled = 1
    GROUP BY m.scene
  `).all<StickerSceneCountRow>();

  return new Map(results.map((row) => [row.scene, row.count]));
}

export async function createSnooze(
  env: Env,
  input: {
    chatId: number;
    dueAt: Date;
    reminderDate: string;
    reminderTime: string;
    message: string;
  },
): Promise<void> {
  const now = new Date().toISOString();
  // Keep only one pending snooze per reminder. This prevents repeated taps from
  // scheduling duplicate delayed reminders.
  await env.DB.prepare(`
    UPDATE snoozes
    SET status = 'cancelled', updated_at = ?
    WHERE chat_id = ?
      AND reminder_date = ?
      AND reminder_time = ?
      AND status = 'pending'
  `).bind(
    now,
    input.chatId,
    input.reminderDate,
    input.reminderTime,
  ).run();

  await env.DB.prepare(`
    INSERT INTO snoozes (
      id, chat_id, due_at, reminder_date, reminder_time,
      message, status, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
  `).bind(
    crypto.randomUUID(),
    input.chatId,
    input.dueAt.toISOString(),
    input.reminderDate,
    input.reminderTime,
    input.message,
    now,
    now,
  ).run();
}

export async function getDueSnoozes(
  env: Env,
  now: Date,
  limit: number = 20,
): Promise<DueSnooze[]> {
  const { results } = await env.DB.prepare(`
    SELECT id, chat_id, reminder_date, reminder_time, message
    FROM snoozes
    WHERE status = 'pending' AND due_at <= ?
    ORDER BY due_at ASC
    LIMIT ?
  `).bind(now.toISOString(), limit).all<DueSnoozeRow>();

  return results.map((row) => ({
    id: row.id,
    chatId: row.chat_id,
    reminderDate: row.reminder_date,
    reminderTime: row.reminder_time,
    message: row.message,
  }));
}

export async function markSnoozeSent(env: Env, id: string): Promise<void> {
  await env.DB.prepare(`
    UPDATE snoozes
    SET status = 'sent', updated_at = ?
    WHERE id = ?
  `).bind(new Date().toISOString(), id).run();
}

export async function getStickerCandidates(
  env: Env,
  scene: string,
): Promise<StickerCandidate[]> {
  const candidates = await queryStickerCandidates(env, scene);
  if (candidates.length > 0 || scene === "default") {
    return candidates;
  }

  return queryStickerCandidates(env, "default");
}

export async function upsertStickerAsset(
  env: Env,
  input: StickerAssetInput,
): Promise<string> {
  const existing = await env.DB.prepare(`
    SELECT id
    FROM sticker_assets
    WHERE file_id = ?
  `).bind(input.fileId).first<StickerAssetRow>();

  const now = new Date().toISOString();

  if (existing) {
    await env.DB.prepare(`
      UPDATE sticker_assets
      SET
        emoji = ?,
        label = ?,
        type = ?,
        source = ?,
        enabled = 1
      WHERE id = ?
    `).bind(
      input.emoji,
      input.label,
      input.type,
      input.source,
      existing.id,
    ).run();

    return existing.id;
  }

  await env.DB.prepare(`
    INSERT INTO sticker_assets (
      id, file_id, emoji, label, type, source, enabled, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, 1, ?)
  `).bind(
    input.id,
    input.fileId,
    input.emoji,
    input.label,
    input.type,
    input.source,
    now,
  ).run();

  return input.id;
}

export async function mapStickerToScene(
  env: Env,
  input: {
    stickerId: string;
    scene: StickerScene;
    weight?: number;
  },
): Promise<void> {
  await env.DB.prepare(`
    INSERT INTO sticker_mappings (
      id, scene, sticker_id, weight, enabled, created_at
    )
    VALUES (?, ?, ?, ?, 1, ?)
    ON CONFLICT(id) DO UPDATE SET
      weight = excluded.weight,
      enabled = 1
  `).bind(
    `${input.scene}:${input.stickerId}`,
    input.scene,
    input.stickerId,
    input.weight ?? 1,
    new Date().toISOString(),
  ).run();
}

async function queryStickerCandidates(
  env: Env,
  scene: string,
): Promise<StickerCandidate[]> {
  const { results } = await env.DB.prepare(`
    SELECT a.file_id, m.weight
    FROM sticker_mappings m
    JOIN sticker_assets a ON a.id = m.sticker_id
    WHERE m.scene = ?
      AND m.enabled = 1
      AND a.enabled = 1
    ORDER BY m.created_at DESC
  `).bind(scene).all<StickerRow>();

  return results.map((row) => ({
    fileId: row.file_id,
    weight: Math.max(1, row.weight),
  }));
}

async function applyDoneStats(
  env: Env,
  chatId: number,
  doneDate: string,
): Promise<StatsRow> {
  const current = await getStats(env, chatId);
  const now = new Date().toISOString();
  const totalDone = current.total_done + 1;
  let streakDays = current.streak_days;

  if (current.last_done_date !== doneDate) {
    streakDays = current.last_done_date && nextDate(current.last_done_date) === doneDate
      ? current.streak_days + 1
      : 1;
  }

  await env.DB.prepare(`
    INSERT INTO user_stats (
      chat_id, streak_days, total_done, last_done_date, updated_at
    )
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(chat_id) DO UPDATE SET
      streak_days = excluded.streak_days,
      total_done = excluded.total_done,
      last_done_date = excluded.last_done_date,
      updated_at = excluded.updated_at
  `).bind(chatId, streakDays, totalDone, doneDate, now).run();

  return {
    streak_days: streakDays,
    total_done: totalDone,
    last_done_date: doneDate,
  };
}

async function getStats(env: Env, chatId: number): Promise<StatsRow> {
  const row = await env.DB.prepare(`
    SELECT streak_days, total_done, last_done_date
    FROM user_stats
    WHERE chat_id = ?
  `).bind(chatId).first<StatsRow>();

  return row ?? {
    streak_days: 0,
    total_done: 0,
    last_done_date: null,
  };
}

function nextDate(date: string): string {
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

function chatIdentityFromMessage(message: TelegramMessage): ChatIdentity {
  return {
    id: message.chat.id,
    type: message.chat.type,
    title: message.chat.title ?? null,
    username: message.chat.username ?? message.from?.username ?? null,
    firstName: message.chat.first_name ?? message.from?.first_name ?? null,
    lastName: message.chat.last_name ?? message.from?.last_name ?? null,
  };
}
