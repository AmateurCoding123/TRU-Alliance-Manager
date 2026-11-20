-- TRU Alliance Manager database (Cloudflare D1, bound to the Pages project as "DB").
--
-- Every statement uses IF NOT EXISTS, so running this on the live database is
-- safe: it only creates tables that are missing and never changes or deletes data.
--
--   npx wrangler d1 execute <database-name> --remote --file=schema.sql
--
-- The events, members and signups tables were created by hand before this file
-- existed; their definitions here are rebuilt from what the code needs.

-- Alliance events. event_date is an ISO date/time (saved in UTC since Nov 2026).
CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  event_name  TEXT NOT NULL,
  event_date  TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT ''
);

-- Everyone who has ever signed up for an event (names checked against MightPulse).
CREATE TABLE IF NOT EXISTS members (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  player_name TEXT NOT NULL UNIQUE
);

-- Event sign-ups. The UNIQUE rule is what stops someone signing up twice.
CREATE TABLE IF NOT EXISTS signups (
  event_id  INTEGER NOT NULL REFERENCES events(id),
  member_id INTEGER NOT NULL REFERENCES members(id),
  UNIQUE (event_id, member_id)
);

-- The tables below are also created automatically by the API the first time
-- they are needed; they are listed here so the whole database is in one place.

-- Leadership logins (only a hash of each login token is stored).
CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);

-- Recent wrong leadership passwords, used to block password guessing.
CREATE TABLE IF NOT EXISTS login_failures (
  ip TEXT NOT NULL,
  at INTEGER NOT NULL
);

-- Attendance log (leadership only). attended: 1 = took part, 0 = missed.
CREATE TABLE IF NOT EXISTS attendance (
  event_id    INTEGER NOT NULL,
  player_name TEXT NOT NULL,
  attended    INTEGER NOT NULL,
  PRIMARY KEY (event_id, player_name)
);

-- Leader Chat messages. Each message is saved in English and Korean;
-- source_lang ('en' or 'ko') says which one the sender wrote. The other is
-- the automatic translation (NULL if translation was unavailable).
CREATE TABLE IF NOT EXISTS leader_chat (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  sent_at     INTEGER NOT NULL,
  sender      TEXT NOT NULL,
  source_lang TEXT NOT NULL,
  text_en     TEXT,
  text_ko     TEXT
);

-- Daily power snapshots, one table per alliance (kept for 90 days).
CREATE TABLE IF NOT EXISTS power_snapshots (
  snap_date   TEXT NOT NULL,
  player_name TEXT NOT NULL,
  power       INTEGER NOT NULL,
  PRIMARY KEY (snap_date, player_name)
);
CREATE TABLE IF NOT EXISTS power_snapshots_academy (
  snap_date   TEXT NOT NULL,
  player_name TEXT NOT NULL,
  power       INTEGER NOT NULL,
  PRIMARY KEY (snap_date, player_name)
);
