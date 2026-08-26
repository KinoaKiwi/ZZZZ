import { Router } from 'express';
import { db } from '../db.js';
import { requireUser, requireActiveUser } from '../auth.js';
import { asInt, str } from '../util.js';

const router = Router();

const EPISODE_COLS = `
  e.id, e.slug, e.title, e.subtitle, e.description, e.credits, e.authors, e.tags,
  e.duration, e.file, e.cover, e.number, e.published, e.published_at, e.created_at, e.size,
  e.series_id, s.slug AS series_slug, s.title AS series_title, s.cover AS series_cover,
  (SELECT COUNT(*) FROM ratings r WHERE r.episode_id = e.id)               AS rating_count,
  (SELECT ROUND(AVG(r.score), 2) FROM ratings r WHERE r.episode_id = e.id) AS rating_avg,
  (SELECT COUNT(*) FROM plays p WHERE p.episode_id = e.id)                 AS play_count
`;

export function serializeEpisode(row, user) {
  if (!row) return null;

  const out = {
    ...row,
    published: Boolean(row.published),
    tags: row.tags ? row.tags.split(',') : [],
    rating_avg: row.rating_avg ?? null,
    audio_url: `/media/audio/${row.file}`,
    cover_url: row.cover
      ? `/media/covers/${row.cover}`
      : row.series_cover
        ? `/media/covers/${row.series_cover}`
        : null,
    series: row.series_id ? { id: row.series_id, slug: row.series_slug, title: row.series_title } : null,
  };
  delete out.series_cover;
  delete out.series_slug;
  delete out.series_title;

  if (user) {
    out.my_rating =
      db.prepare('SELECT score FROM ratings WHERE user_id = ? AND episode_id = ?').get(user.id, row.id)?.score ?? null;
    out.bookmarked = Boolean(
      db.prepare('SELECT 1 FROM bookmarks WHERE user_id = ? AND episode_id = ?').get(user.id, row.id),
    );
    const progress = db
      .prepare('SELECT position, completed FROM progress WHERE user_id = ? AND episode_id = ?')
      .get(user.id, row.id);
    out.progress = progress ? { position: progress.position, completed: Boolean(progress.completed) } : null;
  }
  return out;
}

const SERIES_COLS = `
  s.id, s.slug, s.title, s.tagline, s.description, s.authors, s.cover, s.published, s.created_at,
  (SELECT COUNT(*) FROM episodes e WHERE e.series_id = s.id AND e.published = 1)        AS episode_count,
  (SELECT COALESCE(SUM(e.duration), 0) FROM episodes e WHERE e.series_id = s.id AND e.published = 1) AS total_duration,
  (SELECT COUNT(*) FROM follows f WHERE f.series_id = s.id)                             AS follower_count
`;

export function serializeSeries(row, user) {
  if (!row) return null;
  const out = { ...row, published: Boolean(row.published), cover_url: row.cover ? `/media/covers/${row.cover}` : null };
  if (user) {
    out.following = Boolean(db.prepare('SELECT 1 FROM follows WHERE user_id = ? AND series_id = ?').get(user.id, row.id));
  }
  return out;
}

const ORDER = {
  recent: 'COALESCE(e.published_at, e.created_at) DESC, e.id DESC',
  oldest: 'COALESCE(e.published_at, e.created_at) ASC, e.id ASC',
  rating: 'rating_avg IS NULL, rating_avg DESC, rating_count DESC',
  popular: 'play_count DESC, rating_count DESC',
  short: 'e.duration ASC',
  long: 'e.duration DESC',
  title: 'e.title COLLATE NOCASE ASC',
};

const FROM = 'FROM episodes e LEFT JOIN series s ON s.id = e.series_id';

/* -------------------------------------------------------------- catalogue */

router.get('/episodes', (req, res) => {
  const q = str(req.query.q, 80);
  const tag = str(req.query.tag, 40);
  const series = str(req.query.series, 80);
  const order = ORDER[req.query.sort] ?? ORDER.recent;

  const where = ['e.published = 1'];
  const params = {};

  if (q) {
    where.push('(e.title LIKE @q OR e.subtitle LIKE @q OR e.description LIKE @q OR e.authors LIKE @q OR s.title LIKE @q)');
    params.q = `%${q}%`;
  }
  if (tag) {
    where.push(`(',' || e.tags || ',') LIKE ('%,' || @tag || ',%')`);
    params.tag = tag;
  }
  if (series) { where.push('s.slug = @series'); params.series = series; }

  const rows = db
    .prepare(`SELECT ${EPISODE_COLS} ${FROM} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT 300`)
    .all(params);

  res.json({ episodes: rows.map((row) => serializeEpisode(row, req.user)) });
});

router.get('/tags', (_req, res) => {
  const counts = new Map();
  for (const { tags } of db.prepare(`SELECT tags FROM episodes WHERE published = 1 AND tags <> ''`).all()) {
    for (const tag of tags.split(',')) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  const list = [...counts.entries()].map(([tag, n]) => ({ tag, n })).sort((a, b) => b.n - a.n || a.tag.localeCompare(b.tag));
  res.json({ tags: list });
});

router.get('/episodes/:slug', (req, res) => {
  const row = db.prepare(`SELECT ${EPISODE_COLS} ${FROM} WHERE e.slug = ?`).get(req.params.slug);
  if (!row || (!row.published && req.user?.role !== 'admin')) {
    return res.status(404).json({ error: 'Épisode introuvable.' });
  }

  const breakdown = db
    .prepare('SELECT score, COUNT(*) AS n FROM ratings WHERE episode_id = ? GROUP BY score')
    .all(row.id);

  // Other episodes of the same series, or a few recent pieces if it stands alone.
  const siblings = row.series_id
    ? db.prepare(`SELECT ${EPISODE_COLS} ${FROM} WHERE e.series_id = ? AND e.published = 1 AND e.id <> ?
                  ORDER BY e.number, e.id LIMIT 20`).all(row.series_id, row.id)
    : db.prepare(`SELECT ${EPISODE_COLS} ${FROM} WHERE e.published = 1 AND e.id <> ?
                  ORDER BY COALESCE(e.published_at, e.created_at) DESC LIMIT 4`).all(row.id);

  res.json({
    episode: serializeEpisode(row, req.user),
    series: row.series_id
      ? serializeSeries(db.prepare(`SELECT ${SERIES_COLS} FROM series s WHERE s.id = ?`).get(row.series_id), req.user)
      : null,
    siblings: siblings.map((s) => serializeEpisode(s, req.user)),
    breakdown,
  });
});

/* ----------------------------------------------------------------- series */

router.get('/series', (req, res) => {
  const rows = db
    .prepare(`SELECT ${SERIES_COLS} FROM series s WHERE s.published = 1
              ORDER BY episode_count > 0 DESC, s.title COLLATE NOCASE`)
    .all();
  res.json({ series: rows.map((row) => serializeSeries(row, req.user)) });
});

router.get('/series/:slug', (req, res) => {
  const row = db.prepare(`SELECT ${SERIES_COLS} FROM series s WHERE s.slug = ?`).get(req.params.slug);
  if (!row || (!row.published && req.user?.role !== 'admin')) {
    return res.status(404).json({ error: 'Série introuvable.' });
  }

  const episodes = db
    .prepare(`SELECT ${EPISODE_COLS} ${FROM} WHERE e.series_id = ? AND e.published = 1 ORDER BY e.number, e.id`)
    .all(row.id);

  res.json({ series: serializeSeries(row, req.user), episodes: episodes.map((e) => serializeEpisode(e, req.user)) });
});

/* ---------------------------------------------------------------- ratings */

function ratingSummary(episodeId, user) {
  const agg = db
    .prepare('SELECT COUNT(*) AS rating_count, ROUND(AVG(score), 2) AS rating_avg FROM ratings WHERE episode_id = ?')
    .get(episodeId);
  const mine = db
    .prepare('SELECT score FROM ratings WHERE user_id = ? AND episode_id = ?')
    .get(user.id, episodeId)?.score ?? null;
  return { ...agg, rating_avg: agg.rating_avg ?? null, my_rating: mine };
}

const publishedEpisode = (id) => db.prepare('SELECT id FROM episodes WHERE id = ? AND published = 1').get(id);

router.put('/episodes/:id/rating', requireActiveUser, (req, res) => {
  const id = asInt(req.params.id);
  const score = asInt(req.body?.score);
  if (score < 1 || score > 5) return res.status(400).json({ error: 'Note attendue entre 1 et 5.' });
  if (!publishedEpisode(id)) return res.status(404).json({ error: 'Épisode introuvable.' });

  db.prepare(`INSERT INTO ratings (user_id, episode_id, score) VALUES (?, ?, ?)
              ON CONFLICT(user_id, episode_id) DO UPDATE SET score = excluded.score, created_at = datetime('now')`)
    .run(req.user.id, id, score);
  res.json(ratingSummary(id, req.user));
});

router.delete('/episodes/:id/rating', requireUser, (req, res) => {
  const id = asInt(req.params.id);
  db.prepare('DELETE FROM ratings WHERE user_id = ? AND episode_id = ?').run(req.user.id, id);
  res.json(ratingSummary(id, req.user));
});

/* -------------------------------------------------------------- bookmarks */

router.put('/episodes/:id/bookmark', requireUser, (req, res) => {
  const id = asInt(req.params.id);
  if (!publishedEpisode(id)) return res.status(404).json({ error: 'Épisode introuvable.' });
  db.prepare('INSERT OR IGNORE INTO bookmarks (user_id, episode_id) VALUES (?, ?)').run(req.user.id, id);
  res.json({ bookmarked: true });
});

router.delete('/episodes/:id/bookmark', requireUser, (req, res) => {
  db.prepare('DELETE FROM bookmarks WHERE user_id = ? AND episode_id = ?').run(req.user.id, asInt(req.params.id));
  res.json({ bookmarked: false });
});

router.get('/bookmarks', requireUser, (req, res) => {
  const rows = db
    .prepare(`SELECT ${EPISODE_COLS} ${FROM}
              JOIN bookmarks b ON b.episode_id = e.id
              WHERE b.user_id = ? AND e.published = 1 ORDER BY b.created_at DESC`)
    .all(req.user.id);
  res.json({ episodes: rows.map((row) => serializeEpisode(row, req.user)) });
});

/* ---------------------------------------------------------------- follows */

router.put('/series/:id/follow', requireUser, (req, res) => {
  const id = asInt(req.params.id);
  if (!db.prepare('SELECT 1 FROM series WHERE id = ? AND published = 1').get(id)) {
    return res.status(404).json({ error: 'Série introuvable.' });
  }
  db.prepare('INSERT OR IGNORE INTO follows (user_id, series_id) VALUES (?, ?)').run(req.user.id, id);
  res.json({ following: true });
});

router.delete('/series/:id/follow', requireUser, (req, res) => {
  db.prepare('DELETE FROM follows WHERE user_id = ? AND series_id = ?').run(req.user.id, asInt(req.params.id));
  res.json({ following: false });
});

router.get('/follows', requireUser, (req, res) => {
  const rows = db
    .prepare(`SELECT ${SERIES_COLS} FROM series s JOIN follows f ON f.series_id = s.id
              WHERE f.user_id = ? AND s.published = 1 ORDER BY f.created_at DESC`)
    .all(req.user.id);
  res.json({ series: rows.map((row) => serializeSeries(row, req.user)) });
});

/* --------------------------------------------------------------- progress */

router.put('/episodes/:id/progress', requireUser, (req, res) => {
  const id = asInt(req.params.id);
  const position = Math.max(0, Number(req.body?.position) || 0);
  const completed = req.body?.completed ? 1 : 0;
  if (!publishedEpisode(id)) return res.status(404).json({ error: 'Épisode introuvable.' });

  db.prepare(`INSERT INTO progress (user_id, episode_id, position, completed) VALUES (?, ?, ?, ?)
              ON CONFLICT(user_id, episode_id) DO UPDATE
              SET position = excluded.position, completed = excluded.completed, updated_at = datetime('now')`)
    .run(req.user.id, id, position, completed);
  res.status(204).end();
});

/** The shelf of pieces started but not finished. */
router.get('/continue', requireUser, (req, res) => {
  const rows = db
    .prepare(`SELECT ${EPISODE_COLS} ${FROM}
              JOIN progress pr ON pr.episode_id = e.id
              WHERE pr.user_id = ? AND pr.completed = 0 AND pr.position > 30 AND e.published = 1
              ORDER BY pr.updated_at DESC LIMIT 12`)
    .all(req.user.id);
  res.json({ episodes: rows.map((row) => serializeEpisode(row, req.user)) });
});

/* ----------------------------------------------------------------- écoute */

router.post('/plays', (req, res) => {
  const id = asInt(req.body?.episode_id);
  if (!id) return res.status(400).json({ error: 'Rien à enregistrer.' });
  db.prepare('INSERT INTO plays (user_id, episode_id) VALUES (?, ?)').run(req.user?.id ?? null, id);
  res.status(204).end();
});

router.get('/history', requireUser, (req, res) => {
  const rows = db
    .prepare(`SELECT p.played_at, e.slug, e.title, e.duration, s.title AS series_title
              FROM plays p JOIN episodes e ON e.id = p.episode_id
              LEFT JOIN series s ON s.id = e.series_id
              WHERE p.user_id = ? ORDER BY p.played_at DESC LIMIT 60`)
    .all(req.user.id);
  res.json({ history: rows });
});

export default router;
