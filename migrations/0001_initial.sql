PRAGMA foreign_keys = ON;
CREATE TABLE groups (
  id TEXT PRIMARY KEY CHECK (id GLOB '-[0-9]*'),
  title TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Europe/Madrid',
  lesson_time TEXT NOT NULL DEFAULT '10:00',
  quiz_time TEXT NOT NULL DEFAULT '18:00',
  level TEXT NOT NULL DEFAULT 'A1' CHECK (level IN ('A1','A2','B1')),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),
  created_at INTEGER NOT NULL
);
CREATE TABLE access_tokens (
  token_hash TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  scopes TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE lessons (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('lesson','quiz')),
  topic TEXT NOT NULL,
  publish_at INTEGER NOT NULL,
  dedupe_key TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','preparing','sending','sent','failed','uncertain')),
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER,
  message_id INTEGER,
  poll_id TEXT UNIQUE,
  correct_option INTEGER,
  explanation TEXT,
  error_code TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (group_id, dedupe_key)
);
CREATE INDEX lessons_due ON lessons(status, publish_at);
CREATE INDEX lessons_group ON lessons(group_id, created_at);
CREATE TABLE poll_answers (
  lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  option_id INTEGER,
  correct INTEGER NOT NULL CHECK (correct IN (0,1)),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (lesson_id, user_id)
);
CREATE TABLE telegram_updates (
  update_id INTEGER PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('processing','done')),
  lease_until INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
