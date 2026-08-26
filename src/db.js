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

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  email        TEXT NOT NULL UNIQUE,
  username     TEXT NOT NULL UNIQUE,
  password     TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'listener',
  bio          TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  tagline     TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  genre       TEXT NOT NULL DEFAULT '',
  kind        TEXT NOT NULL DEFAULT 'live' CHECK (kind IN ('live','mixtape')),
  stream_url  TEXT NOT NULL DEFAULT '',
  cover       TEXT,
  published   INTEGER NOT NULL DEFAULT 0,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tracks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  artist      TEXT NOT NULL DEFAULT '',
  album       TEXT NOT NULL DEFAULT '',
  year        TEXT NOT NULL DEFAULT '',
  duration    REAL NOT NULL DEFAULT 0,
  file        TEXT NOT NULL,
  mime        TEXT NOT NULL DEFAULT 'audio/mpeg',
  size        INTEGER NOT NULL DEFAULT 0,
  cover       TEXT,
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS station_tracks (
  station_id INTEGER NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  track_id   INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  position   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (station_id, track_id)
);

CREATE TABLE IF NOT EXISTS ratings (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  station_id INTEGER NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  score      INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, station_id)
);

CREATE TABLE IF NOT EXISTS favorites (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  station_id INTEGER NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, station_id)
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
  kind        TEXT NOT NULL CHECK (kind IN ('track','station')),
  ref_id      INTEGER NOT NULL,
  position    INTEGER NOT NULL DEFAULT 0,
  added_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS plays (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  station_id INTEGER REFERENCES stations(id) ON DELETE CASCADE,
  track_id   INTEGER REFERENCES tracks(id) ON DELETE CASCADE,
  played_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_user   ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_st_station      ON station_tracks(station_id, position);
CREATE INDEX IF NOT EXISTS idx_ratings_station ON ratings(station_id);
CREATE INDEX IF NOT EXISTS idx_fav_user        ON favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_items_playlist  ON playlist_items(playlist_id, position);
CREATE INDEX IF NOT EXISTS idx_plays_station   ON plays(station_id, played_at);
CREATE INDEX IF NOT EXISTS idx_plays_user      ON plays(user_id, played_at);
`);

db.prepare(`DELETE FROM sessions WHERE expires_at < datetime('now')`).run();

const DEMO = [
  {
    slug: 'groove-salad', name: 'Groove Salad', genre: 'Downtempo',
    tagline: 'Ambiance liquide, tempo bas.',
    description: "Un flux ambient / downtempo diffuse par SomaFM. Exemple de station live : supprimez-la depuis le studio quand vos propres radios seront en ligne.",
    stream_url: 'https://ice1.somafm.com/groovesalad-128-mp3',
  },
  {
    slug: 'drone-zone', name: 'Drone Zone', genre: 'Ambient',
    tagline: 'Nappes longues, pas de percussions.',
    description: 'Ambient atmospherique diffuse par SomaFM. Station de demonstration.',
    stream_url: 'https://ice1.somafm.com/dronezone-128-mp3',
  },
  {
    slug: 'indie-pop-rocks', name: 'Indie Pop Rocks', genre: 'Indie',
    tagline: 'Guitares, refrains, poussiere.',
    description: 'Selection indie pop diffusee par SomaFM. Station de demonstration.',
    stream_url: 'https://ice1.somafm.com/indiepop-128-mp3',
  },
  {
    slug: 'fip', name: 'FIP', genre: 'Eclectique',
    tagline: 'Le grand ecart, sans transition.',
    description: 'Flux public de Radio France. Station de demonstration.',
    stream_url: 'https://icecast.radiofrance.fr/fip-midfi.mp3',
  },
];

const seed = db.prepare(`
  INSERT INTO stations (slug, name, tagline, description, genre, kind, stream_url, published)
  VALUES (@slug, @name, @tagline, @description, @genre, 'live', @stream_url, 1)
`);

export function seedDemoStations() {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM stations').get();
  if (n > 0 || process.env.SEED_DEMO === '0') return 0;
  const tx = db.transaction((rows) => rows.forEach((r) => seed.run(r)));
  tx(DEMO);
  return DEMO.length;
}
