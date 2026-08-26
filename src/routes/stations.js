import { Router } from 'express';
import { db } from '../db.js';
import { requireUser } from '../auth.js';
import { asInt, str } from '../util.js';

const router = Router();

const STATION_COLS = `
  s.id, s.slug, s.name, s.tagline, s.description, s.genre, s.kind,
  s.stream_url, s.cover, s.published, s.created_at,
  (SELECT COUNT(*) FROM station_tracks st WHERE st.station_id = s.id)        AS track_count,
  (SELECT COUNT(*) FROM ratings r WHERE r.station_id = s.id)                 AS rating_count,
  (SELECT ROUND(AVG(r.score), 2) FROM ratings r WHERE r.station_id = s.id)   AS rating_avg,
  (SELECT COUNT(*) FROM favorites f WHERE f.station_id = s.id)               AS favorite_count,
  (SELECT COUNT(*) FROM plays p WHERE p.station_id = s.id)                   AS play_count
`;

export function serializeStation(row, user) {
  if (!row) return null;
  const out = {
    ...row,
    published: Boolean(row.published),
    rating_avg: row.rating_avg ?? null,
    cover_url: row.cover ? `/media/covers/${row.cover}` : null,
  };
  if (user) {
    out.my_rating =
      db.prepare('SELECT score FROM ratings WHERE user_id = ? AND station_id = ?').get(user.id, row.id)?.score ?? null;
    out.is_favorite = Boolean(
      db.prepare('SELECT 1 FROM favorites WHERE user_id = ? AND station_id = ?').get(user.id, row.id),
    );
  }
  return out;
}

export function serializeTrack(row) {
  if (!row) return null;
  return {
    ...row,
    audio_url: `/media/audio/${row.file}`,
    cover_url: row.cover ? `/media/covers/${row.cover}` : null,
  };
}

const ORDER = {
  recent: 's.created_at DESC, s.id DESC',
  name: 's.name COLLATE NOCASE ASC',
  rating: 'rating_avg IS NULL, rating_avg DESC, rating_count DESC',
  popular: 'play_count DESC, favorite_count DESC',
};

router.get('/stations', (req, res) => {
  const q = str(req.query.q, 80);
  const genre = str(req.query.genre, 40);
  const kind = ['live', 'mixtape'].includes(req.query.kind) ? req.query.kind : null;
  const order = ORDER[req.query.sort] ?? ORDER.recent;

  const where = ['s.published = 1'];
  const params = {};
  if (q) {
    where.push('(s.name LIKE @q OR s.tagline LIKE @q OR s.genre LIKE @q OR s.description LIKE @q)');
    params.q = `%${q}%`;
  }
  if (genre) { where.push('s.genre = @genre COLLATE NOCASE'); params.genre = genre; }
  if (kind) { where.push('s.kind = @kind'); params.kind = kind; }

  const rows = db
    .prepare(`SELECT ${STATION_COLS} FROM stations s WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT 200`)
    .all(params);

  res.json({ stations: rows.map((r) => serializeStation(r, req.user)) });
});

router.get('/stations/genres', (_req, res) => {
  const rows = db
    .prepare(`SELECT genre, COUNT(*) AS n FROM stations
              WHERE published = 1 AND genre <> '' GROUP BY genre COLLATE NOCASE ORDER BY n DESC, genre`)
    .all();
  res.json({ genres: rows });
});

router.get('/stations/:slug', (req, res) => {
  const row = db.prepare(`SELECT ${STATION_COLS} FROM stations s WHERE s.slug = ?`).get(req.params.slug);
  if (!row) return res.status(404).json({ error: 'Station introuvable.' });
  if (!row.published && req.user?.role !== 'admin') {
    return res.status(404).json({ error: 'Station introuvable.' });
  }

  const tracks = db
    .prepare(`SELECT t.*, st.position FROM station_tracks st
              JOIN tracks t ON t.id = st.track_id
              WHERE st.station_id = ? ORDER BY st.position, t.id`)
    .all(row.id)
    .map(serializeTrack);

  const breakdown = db
    .prepare('SELECT score, COUNT(*) AS n FROM ratings WHERE station_id = ? GROUP BY score')
    .all(row.id);

  res.json({ station: serializeStation(row, req.user), tracks, breakdown });
});

router.put('/stations/:id/rating', requireUser, (req, res) => {
  const id = asInt(req.params.id);
  const score = asInt(req.body?.score);
  if (score < 1 || score > 5) return res.status(400).json({ error: 'Note attendue entre 1 et 5.' });

  const station = db.prepare('SELECT id, published FROM stations WHERE id = ?').get(id);
  if (!station || !station.published) return res.status(404).json({ error: 'Station introuvable.' });

  db.prepare(`INSERT INTO ratings (user_id, station_id, score) VALUES (?, ?, ?)
              ON CONFLICT(user_id, station_id) DO UPDATE SET score = excluded.score, created_at = datetime('now')`)
    .run(req.user.id, id, score);

  res.json(ratingSummary(id, req.user));
});

router.delete('/stations/:id/rating', requireUser, (req, res) => {
  const id = asInt(req.params.id);
  db.prepare('DELETE FROM ratings WHERE user_id = ? AND station_id = ?').run(req.user.id, id);
  res.json(ratingSummary(id, req.user));
});

function ratingSummary(stationId, user) {
  const agg = db
    .prepare('SELECT COUNT(*) AS rating_count, ROUND(AVG(score), 2) AS rating_avg FROM ratings WHERE station_id = ?')
    .get(stationId);
  const mine = db
    .prepare('SELECT score FROM ratings WHERE user_id = ? AND station_id = ?')
    .get(user.id, stationId)?.score ?? null;
  return { ...agg, rating_avg: agg.rating_avg ?? null, my_rating: mine };
}

router.put('/stations/:id/favorite', requireUser, (req, res) => {
  const id = asInt(req.params.id);
  const station = db.prepare('SELECT id, published FROM stations WHERE id = ?').get(id);
  if (!station || !station.published) return res.status(404).json({ error: 'Station introuvable.' });

  db.prepare('INSERT OR IGNORE INTO favorites (user_id, station_id) VALUES (?, ?)').run(req.user.id, id);
  res.json({ is_favorite: true });
});

router.delete('/stations/:id/favorite', requireUser, (req, res) => {
  db.prepare('DELETE FROM favorites WHERE user_id = ? AND station_id = ?').run(req.user.id, asInt(req.params.id));
  res.json({ is_favorite: false });
});

router.get('/favorites', requireUser, (req, res) => {
  const rows = db
    .prepare(`SELECT ${STATION_COLS} FROM favorites f JOIN stations s ON s.id = f.station_id
              WHERE f.user_id = ? AND s.published = 1 ORDER BY f.created_at DESC`)
    .all(req.user.id);
  res.json({ stations: rows.map((r) => serializeStation(r, req.user)) });
});

router.post('/plays', (req, res) => {
  const stationId = asInt(req.body?.station_id) || null;
  const trackId = asInt(req.body?.track_id) || null;
  if (!stationId && !trackId) return res.status(400).json({ error: 'Rien a enregistrer.' });

  db.prepare('INSERT INTO plays (user_id, station_id, track_id) VALUES (?, ?, ?)')
    .run(req.user?.id ?? null, stationId, trackId);
  res.status(204).end();
});

router.get('/history', requireUser, (req, res) => {
  const rows = db
    .prepare(`SELECT p.played_at, s.slug, s.name, s.genre, s.kind, t.title AS track_title, t.artist AS track_artist
              FROM plays p
              LEFT JOIN stations s ON s.id = p.station_id
              LEFT JOIN tracks t   ON t.id = p.track_id
              WHERE p.user_id = ? ORDER BY p.played_at DESC LIMIT 60`)
    .all(req.user.id);
  res.json({ history: rows });
});

/** Public track index: only titles that are on air somewhere. */
router.get('/tracks', (req, res) => {
  const q = str(req.query.q, 80);
  const where = ['EXISTS (SELECT 1 FROM station_tracks st JOIN stations s ON s.id = st.station_id WHERE st.track_id = t.id AND s.published = 1)'];
  const params = {};
  if (q) { where.push('(t.title LIKE @q OR t.artist LIKE @q OR t.album LIKE @q)'); params.q = `%${q}%`; }

  const rows = db
    .prepare(`SELECT t.* FROM tracks t WHERE ${where.join(' AND ')} ORDER BY t.artist COLLATE NOCASE, t.title LIMIT 300`)
    .all(params);
  res.json({ tracks: rows.map(serializeTrack) });
});

export default router;
