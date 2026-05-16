import { dailySchedule } from "./schedule";
import type { Env } from "./types";
import { ensureReminderJobs, hasReminderJobsForDate } from "./db";
import { formatReminderTime, getReminderScene } from "./interactions";

const REMINDER_JOB_EXPIRE_MS = 90 * 60 * 1000;

export async function ensureReminderJobsForDate(
  env: Env,
  reminderDate: string,
  force: boolean = false,
): Promise<void> {
  if (!force && await hasReminderJobsForDate(env, reminderDate)) {
    return;
  }

  await ensureReminderJobs(env, buildDailyReminderJobs(reminderDate, env.TIMEZONE));
}

export function isLocalMidnight(date: Date, timeZone: string): boolean {
  const parts = getTimeZoneParts(date, timeZone);
  return parts.hour === 0 && parts.minute === 0;
}

function buildDailyReminderJobs(reminderDate: string, timeZone: string) {
  return dailySchedule.map((item) => {
    const reminderTime = formatReminderTime(item);
    const dueAt = localDateTimeToUtc(reminderDate, item.hour, item.minute, timeZone);

    return {
      id: `${reminderDate}:${reminderTime}`,
      reminderDate,
      reminderTime,
      dueAt: dueAt.toISOString(),
      expiresAt: new Date(dueAt.getTime() + REMINDER_JOB_EXPIRE_MS).toISOString(),
      message: item.message,
      scene: getReminderScene(item),
    };
  });
}

function localDateTimeToUtc(
  localDate: string,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const [year, month, day] = localDate.split("-").map(Number);
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const actual = getTimeZoneParts(utcGuess, timeZone);
  const desiredUtc = Date.UTC(year, month - 1, day, hour, minute);
  const actualUtc = Date.UTC(
    actual.year,
    actual.month - 1,
    actual.day,
    actual.hour,
    actual.minute,
  );

  return new Date(utcGuess.getTime() - (actualUtc - desiredUtc));
}

function getTimeZoneParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
  };
}
