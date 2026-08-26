import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const paths = {
  root,
  data: path.join(root, 'data'),
  audio: path.join(root, 'data', 'uploads', 'audio'),
  covers: path.join(root, 'data', 'uploads', 'covers'),
};

for (const dir of [paths.data, paths.audio, paths.covers]) {
  fs.mkdirSync(dir, { recursive: true });
}

export const db = new Database(path.join(paths.data, 'onde.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// The first draft of this app modelled live radio stations. Nothing is live any
// more: one episode is one audio file, optionally part of a series. Tables whose
// shape changed are dropped once, the first time this version opens an old file.
const hasTable = (name) =>
  Boolean(db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name));
const hasColumn = (table, column) =>
  hasTable(table) && db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);

if (hasTable('stations') || hasColumn('ratings', 'station_id') || hasColumn('playlist_items', 'ref_id')) {
  db.pragma('foreign_keys = OFF');
  db.exec(`
    DROP TABLE IF EXISTS station_tracks;
    DROP TABLE IF EXISTS favorites;
    DROP TABLE IF EXISTS plays;
    DROP TABLE IF EXISTS ratings;
    DROP TABLE IF EXISTS playlist_items;
    DROP TABLE IF EXISTS tracks;
    DROP TABLE IF EXISTS stations;
  `);
  db.pragma('foreign_keys = ON');
}

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT NOT NULL UNIQUE,
  username   TEXT NOT NULL UNIQUE,
  password   TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'listener',
  bio        TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS series (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT NOT NULL UNIQUE,
  title       TEXT NOT NULL,
  tagline     TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  authors     TEXT NOT NULL DEFAULT '',
  cover       TEXT,
  published   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS episodes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  slug         TEXT NOT NULL UNIQUE,
  series_id    INTEGER REFERENCES series(id) ON DELETE SET NULL,
  number       INTEGER NOT NULL DEFAULT 0,
  title        TEXT NOT NULL,
  subtitle     TEXT NOT NULL DEFAULT '',
  description  TEXT NOT NULL DEFAULT '',
  credits      TEXT NOT NULL DEFAULT '',
  authors      TEXT NOT NULL DEFAULT '',
  tags         TEXT NOT NULL DEFAULT '',
  duration     REAL NOT NULL DEFAULT 0,
  file         TEXT NOT NULL,
  mime         TEXT NOT NULL DEFAULT 'audio/mpeg',
  size         INTEGER NOT NULL DEFAULT 0,
  cover        TEXT,
  published    INTEGER NOT NULL DEFAULT 0,
  published_at TEXT,
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ratings (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  episode_id INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  score      INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, episode_id)
);

-- "À écouter" : the listen-later shelf.
CREATE TABLE IF NOT EXISTS bookmarks (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  episode_id INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, episode_id)
);

CREATE TABLE IF NOT EXISTS follows (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  series_id  INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, series_id)
);

-- Where each listener stopped, so an episode can be resumed days later.
CREATE TABLE IF NOT EXISTS progress (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  episode_id INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  position   REAL NOT NULL DEFAULT 0,
  completed  INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, episode_id)
);

CREATE TABLE IF NOT EXISTS playlists (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  is_public   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS playlist_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  episode_id  INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL DEFAULT 0,
  added_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (playlist_id, episode_id)
);

CREATE TABLE IF NOT EXISTS plays (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  episode_id INTEGER REFERENCES episodes(id) ON DELETE CASCADE,
  played_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_user    ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_episodes_series  ON episodes(series_id, number);
CREATE INDEX IF NOT EXISTS idx_episodes_pub     ON episodes(published, published_at);
CREATE INDEX IF NOT EXISTS idx_ratings_episode  ON ratings(episode_id);
CREATE INDEX IF NOT EXISTS idx_bookmarks_user   ON bookmarks(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_follows_user     ON follows(user_id);
CREATE INDEX IF NOT EXISTS idx_progress_user    ON progress(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_items_playlist   ON playlist_items(playlist_id, position);
CREATE INDEX IF NOT EXISTS idx_plays_episode    ON plays(episode_id, played_at);
CREATE INDEX IF NOT EXISTS idx_plays_user       ON plays(user_id, played_at);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  episode_id INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'visible' CHECK (status IN ('visible','hidden')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Anything a listener flags lands here and waits in the studio queue.
CREATE TABLE IF NOT EXISTS reports (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('comment','playlist','user')),
  target_id   INTEGER NOT NULL,
  reason      TEXT NOT NULL DEFAULT '',
  detail      TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  handled_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  handled_at  TEXT
);

-- Every moderation gesture is written down, so a decision can be re-read later.
CREATE TABLE IF NOT EXISTS mod_actions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id   INTEGER,
  detail      TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_comments_episode ON comments(episode_id, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_user    ON comments(user_id);
CREATE INDEX IF NOT EXISTS idx_reports_status   ON reports(status, created_at);
CREATE INDEX IF NOT EXISTS idx_mod_actions      ON mod_actions(created_at);
`);

/** Adds a column to an existing table, once. */
function addColumn(table, column, ddl) {
  if (!hasColumn(table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}

// active | suspended (cannot post) | banned (cannot sign in)
addColumn('users', 'status', `TEXT NOT NULL DEFAULT 'active'`);
addColumn('users', 'moderation_note', `TEXT NOT NULL DEFAULT ''`);
// A playlist the studio has taken out of the public list.
addColumn('playlists', 'moderated', 'INTEGER NOT NULL DEFAULT 0');

db.prepare(`DELETE FROM sessions WHERE expires_at < datetime('now')`).run();
