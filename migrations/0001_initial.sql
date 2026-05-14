CREATE TABLE IF NOT EXISTS chats (
  chat_id INTEGER PRIMARY KEY,
  chat_type TEXT NOT NULL DEFAULT 'private',
  title TEXT,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  started_at TEXT,
  stopped_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chats_active ON chats(active);

CREATE TABLE IF NOT EXISTS user_stats (
  chat_id INTEGER PRIMARY KEY,
  streak_days INTEGER NOT NULL DEFAULT 0,
  total_done INTEGER NOT NULL DEFAULT 0,
  last_done_date TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reminder_feedback (
  id TEXT PRIMARY KEY,
  chat_id INTEGER NOT NULL,
  reminder_date TEXT NOT NULL,
  reminder_time TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('done', 'skip', 'snooze')),
  message_id INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(chat_id, reminder_date, reminder_time)
);

CREATE INDEX IF NOT EXISTS idx_reminder_feedback_chat_date
  ON reminder_feedback(chat_id, reminder_date);

CREATE TABLE IF NOT EXISTS reminder_deliveries (
  id TEXT PRIMARY KEY,
  chat_id INTEGER NOT NULL,
  reminder_date TEXT NOT NULL,
  reminder_time TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(chat_id, reminder_date, reminder_time)
);

CREATE INDEX IF NOT EXISTS idx_reminder_deliveries_chat_date
  ON reminder_deliveries(chat_id, reminder_date);

CREATE TABLE IF NOT EXISTS snoozes (
  id TEXT PRIMARY KEY,
  chat_id INTEGER NOT NULL,
  due_at TEXT NOT NULL,
  reminder_date TEXT NOT NULL,
  reminder_time TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'sent', 'cancelled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_snoozes_due
  ON snoozes(status, due_at);

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
