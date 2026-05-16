import type { Env } from "./types";
import type { FeedbackAction, StickerScene } from "./interactions";

const ENABLED_KEY = "enabled";

export interface BotStatus {
  enabled: boolean;
  updatedAt: string | null;
  streakDays: number;
  totalDone: number;
}

export interface ReminderJobInput {
  id: string;
  reminderDate: string;
  reminderTime: string;
  dueAt: string;
  expiresAt: string;
  message: string;
  scene: string;
}

export interface ReminderJob {
  id: string;
  reminderDate: string;
  reminderTime: string;
  dueAt: string;
  expiresAt: string;
  message: string;
  scene: string;
  status: "pending" | "sending" | "sent" | "failed" | "missed";
  attempts: number;
}

export interface ReminderJobStatus {
  reminderTime: string;
  status: ReminderJob["status"];
}

export interface StickerCandidate {
  fileId: string;
  weight: number;
}

interface BotStateRow {
  value: string;
  updated_at: string;
}

interface FeedbackStatusRow {
  reminder_time: string;
  action: FeedbackAction;
}

interface ReminderJobRow {
  id: string;
  reminder_date: string;
  reminder_time: string;
  due_at: string;
  expires_at: string;
  message: string;
  scene: string;
  status: ReminderJob["status"];
  attempts: number;
}

interface ReminderJobStatusRow {
  reminder_time: string;
  status: ReminderJob["status"];
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

interface DoneDateRow {
  reminder_date: string;
}

interface CountRow {
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

export async function setBotEnabled(env: Env, enabled: boolean): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO bot_state (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `).bind(ENABLED_KEY, enabled ? "1" : "0", now).run();
}

export async function getBotStatus(env: Env): Promise<BotStatus> {
  const [state, stats] = await Promise.all([
    env.DB.prepare(`
      SELECT value, updated_at
      FROM bot_state
      WHERE key = ?
    `).bind(ENABLED_KEY).first<BotStateRow>(),
    getBotStats(env),
  ]);

  return {
    enabled: state?.value === "1",
    updatedAt: state?.updated_at ?? null,
    ...stats,
  };
}

export async function ensureReminderJobs(
  env: Env,
  jobs: ReminderJobInput[],
): Promise<void> {
  if (jobs.length === 0) return;

  const now = new Date().toISOString();
  await env.DB.batch(
    jobs.map((job) => env.DB.prepare(`
      INSERT INTO reminder_jobs (
        id, reminder_date, reminder_time, due_at, expires_at,
        message, scene, status, attempts, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)
      ON CONFLICT(reminder_date, reminder_time) DO UPDATE SET
        due_at = excluded.due_at,
        expires_at = excluded.expires_at,
        message = excluded.message,
        scene = excluded.scene,
        updated_at = excluded.updated_at
      WHERE reminder_jobs.status = 'pending'
    `).bind(
      job.id,
      job.reminderDate,
      job.reminderTime,
      job.dueAt,
      job.expiresAt,
      job.message,
      job.scene,
      now,
      now,
    )),
  );
}

export async function hasReminderJobsForDate(
  env: Env,
  reminderDate: string,
): Promise<boolean> {
  const row = await env.DB.prepare(`
    SELECT id
    FROM reminder_jobs
    WHERE reminder_date = ?
    LIMIT 1
  `).bind(reminderDate).first<{ id: string }>();

  return Boolean(row);
}

export async function getDueReminderJobs(
  env: Env,
  now: Date,
  notBefore: Date,
  limit: number = 10,
): Promise<ReminderJob[]> {
  const isoNow = now.toISOString();
  const isoNotBefore = notBefore.toISOString();
  const { results } = await env.DB.prepare(`
    SELECT
      id, reminder_date, reminder_time, due_at, expires_at,
      message, scene, status, attempts
    FROM reminder_jobs
    WHERE due_at <= ?
      AND due_at >= ?
      AND expires_at > ?
      AND status = 'pending'
    ORDER BY due_at ASC
    LIMIT ?
  `).bind(isoNow, isoNotBefore, isoNow, limit).all<ReminderJobRow>();

  return results.map(reminderJobFromRow);
}

export async function claimReminderJob(
  env: Env,
  id: string,
  now: Date,
  lockMs: number,
): Promise<boolean> {
  const isoNow = now.toISOString();
  const lockedUntil = new Date(now.getTime() + lockMs).toISOString();
  const result = await env.DB.prepare(`
    UPDATE reminder_jobs
    SET
      status = 'sending',
      attempts = attempts + 1,
      locked_until = ?,
      updated_at = ?
    WHERE id = ?
      AND due_at <= ?
      AND expires_at > ?
      AND status = 'pending'
  `).bind(lockedUntil, isoNow, id, isoNow, isoNow).run();

  return result.meta.changes > 0;
}

export async function markReminderJobSent(env: Env, id: string, now: Date): Promise<void> {
  const isoNow = now.toISOString();
  await env.DB.prepare(`
    UPDATE reminder_jobs
    SET status = 'sent',
        sent_at = ?,
        locked_until = NULL,
        updated_at = ?
    WHERE id = ?
  `).bind(isoNow, isoNow, id).run();
}

export async function markReminderJobFailed(
  env: Env,
  id: string,
): Promise<void> {
  await env.DB.prepare(`
    UPDATE reminder_jobs
    SET status = 'failed',
        locked_until = NULL,
        updated_at = ?
    WHERE id = ?
  `).bind(new Date().toISOString(), id).run();
}

export async function markExpiredReminderJobs(env: Env, now: Date): Promise<void> {
  const isoNow = now.toISOString();
  await env.DB.prepare(`
    UPDATE reminder_jobs
    SET status = 'missed',
        locked_until = NULL,
        updated_at = ?
    WHERE expires_at <= ?
      AND status IN ('pending', 'sending')
  `).bind(isoNow, isoNow).run();
}

export async function markMissedReminderJobsBefore(
  env: Env,
  before: Date,
  now: Date,
): Promise<void> {
  const isoNow = now.toISOString();
  const isoBefore = before.toISOString();
  await env.DB.prepare(`
    UPDATE reminder_jobs
    SET status = 'missed',
        locked_until = NULL,
        updated_at = ?
    WHERE due_at < ?
      AND due_at <= ?
      AND status = 'pending'
  `).bind(isoNow, isoBefore, isoNow).run();
}

export async function getReminderJobStatusesForDate(
  env: Env,
  reminderDate: string,
): Promise<Map<string, ReminderJob["status"]>> {
  const { results } = await env.DB.prepare(`
    SELECT reminder_time, status
    FROM reminder_jobs
    WHERE reminder_date = ?
  `).bind(reminderDate).all<ReminderJobStatusRow>();

  return new Map(results.map((row) => [row.reminder_time, row.status]));
}

export async function recordFeedback(
  env: Env,
  input: {
    reminderDate: string;
    reminderTime: string;
    action: FeedbackAction;
    messageId?: number;
  },
): Promise<void> {
  const previous = await env.DB.prepare(`
    SELECT action
    FROM reminder_feedback
    WHERE reminder_date = ? AND reminder_time = ?
  `).bind(input.reminderDate, input.reminderTime).first<{ action: string }>();

  const now = new Date().toISOString();
  const id = `${input.reminderDate}:${input.reminderTime}`;

  if (previous?.action === "done" && input.action !== "done") {
    return;
  }

  await env.DB.prepare(`
    INSERT INTO reminder_feedback (
      id, reminder_date, reminder_time, action,
      message_id, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(reminder_date, reminder_time) DO UPDATE SET
      action = excluded.action,
      message_id = excluded.message_id,
      updated_at = excluded.updated_at
  `).bind(
    id,
    input.reminderDate,
    input.reminderTime,
    input.action,
    input.messageId ?? null,
    now,
    now,
  ).run();
}

export async function getReminderFeedbackForDate(
  env: Env,
  reminderDate: string,
): Promise<Map<string, FeedbackAction>> {
  const { results } = await env.DB.prepare(`
    SELECT reminder_time, action
    FROM reminder_feedback
    WHERE reminder_date = ?
  `).bind(reminderDate).all<FeedbackStatusRow>();

  return new Map(results.map((row) => [row.reminder_time, row.action]));
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

async function getBotStats(env: Env): Promise<Pick<BotStatus, "streakDays" | "totalDone">> {
  const [total, dates] = await Promise.all([
    env.DB.prepare(`
      SELECT COUNT(*) AS count
      FROM reminder_feedback
      WHERE action = 'done'
    `).first<CountRow>(),
    env.DB.prepare(`
      SELECT DISTINCT reminder_date
      FROM reminder_feedback
      WHERE action = 'done'
      ORDER BY reminder_date DESC
    `).all<DoneDateRow>(),
  ]);

  return {
    totalDone: total?.count ?? 0,
    streakDays: countStreak(dates.results.map((row) => row.reminder_date)),
  };
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

function reminderJobFromRow(row: ReminderJobRow): ReminderJob {
  return {
    id: row.id,
    reminderDate: row.reminder_date,
    reminderTime: row.reminder_time,
    dueAt: row.due_at,
    expiresAt: row.expires_at,
    message: row.message,
    scene: row.scene,
    status: row.status,
    attempts: row.attempts,
  };
}

function countStreak(doneDates: string[]): number {
  const doneSet = new Set(doneDates);
  if (doneSet.size === 0) return 0;

  const current = new Date(`${[...doneSet][0]}T00:00:00.000Z`);
  let streak = 0;

  while (doneSet.has(current.toISOString().slice(0, 10))) {
    streak += 1;
    current.setUTCDate(current.getUTCDate() - 1);
  }

  return streak;
}
