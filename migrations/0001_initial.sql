CREATE TABLE IF NOT EXISTS bot_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reminder_jobs (
  id TEXT PRIMARY KEY,
  reminder_date TEXT NOT NULL,
  reminder_time TEXT NOT NULL,
  due_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  message TEXT NOT NULL,
  scene TEXT NOT NULL DEFAULT 'default',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending', 'sending', 'sent', 'failed', 'missed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(reminder_date, reminder_time)
);

CREATE INDEX IF NOT EXISTS idx_reminder_jobs_due
  ON reminder_jobs(status, due_at);

CREATE INDEX IF NOT EXISTS idx_reminder_jobs_date
  ON reminder_jobs(reminder_date);

CREATE TABLE IF NOT EXISTS reminder_feedback (
  id TEXT PRIMARY KEY,
  reminder_date TEXT NOT NULL,
  reminder_time TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('done', 'skip')),
  message_id INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(reminder_date, reminder_time)
);

CREATE INDEX IF NOT EXISTS idx_reminder_feedback_date
  ON reminder_feedback(reminder_date);

CREATE TABLE IF NOT EXISTS sticker_assets (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL UNIQUE,
  emoji TEXT,
  label TEXT,
  type TEXT NOT NULL DEFAULT 'video' CHECK(type IN ('static', 'animated', 'video')),
  source TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sticker_mappings (
  id TEXT PRIMARY KEY,
  scene TEXT NOT NULL,
  sticker_id TEXT NOT NULL,
  weight INTEGER NOT NULL DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  FOREIGN KEY (sticker_id) REFERENCES sticker_assets(id)
);

CREATE INDEX IF NOT EXISTS idx_sticker_mappings_scene
  ON sticker_mappings(scene, enabled);
