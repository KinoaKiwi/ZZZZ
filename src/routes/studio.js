import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseFile } from 'music-metadata';
import { db, paths } from '../db.js';
import { requireAdmin } from '../auth.js';
import { asInt, str, bool, slugify, uniqueSlug, normalizeTags } from '../util.js';
import { serializeEpisode, serializeSeries } from './catalog.js';

const router = Router();
router.use(requireAdmin);

const AUDIO_EXT = new Set(['.mp3', '.ogg', '.oga', '.opus', '.wav', '.flac', '.m4a', '.aac', '.webm']);
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif']);

const randomName = (ext) => `${Date.now().toString(36)}-${crypto.randomBytes(8).toString('hex')}${ext}`;

const uploader = (dir, allowed) =>
  multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, dir),
      filename: (_req, file, cb) => cb(null, randomName(path.extname(file.originalname).toLowerCase())),
    }),
    limits: { fileSize: 400 * 1024 * 1024, files: 20 },
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (!allowed.has(ext)) return cb(new Error(`Format non accepté : ${ext || file.originalname}`));
      cb(null, true);
    },
  });

const uploadAudio = uploader(paths.audio, AUDIO_EXT);
const uploadImage = uploader(paths.covers, IMAGE_EXT);

const removeFile = (dir, name) => {
  if (!name) return;
  fs.rm(path.join(dir, path.basename(name)), { force: true }, () => {});
};

const ADMIN_EPISODE_COLS = `
  e.*, s.slug AS series_slug, s.title AS series_title, s.cover AS series_cover,
  (SELECT COUNT(*) FROM ratings r WHERE r.episode_id = e.id)               AS rating_count,
  (SELECT ROUND(AVG(r.score), 2) FROM ratings r WHERE r.episode_id = e.id) AS rating_avg,
  (SELECT COUNT(*) FROM plays p WHERE p.episode_id = e.id)                 AS play_count
`;

const readEpisode = (id) =>
  db.prepare(`SELECT ${ADMIN_EPISODE_COLS} FROM episodes e LEFT JOIN series s ON s.id = e.series_id WHERE e.id = ?`).get(id);

/* --------------------------------------------------------------- uploads */

router.post('/uploads', uploadAudio.array('files', 20), async (req, res) => {
  const created = [];
  const seriesId = asInt(req.body?.series_id) || null;

  for (const file of req.files ?? []) {
    let meta = {};
    let duration = 0;
    let coverName = null;

    try {
      const parsed = await parseFile(file.path, { duration: true });
      meta = parsed.common ?? {};
      duration = parsed.format?.duration ?? 0;

      const picture = meta.picture?.[0];
      if (picture) {
        const ext = picture.format === 'image/png' ? '.png' : picture.format === 'image/webp' ? '.webp' : '.jpg';
        coverName = randomName(ext);
        fs.writeFileSync(path.join(paths.covers, coverName), Buffer.from(picture.data));
      }
    } catch {
      // Unreadable tags are not fatal: the file still plays, it just arrives untitled.
    }

    const fallback = path.basename(file.originalname, path.extname(file.originalname)).replace(/[_-]+/g, ' ').trim();
    const title = str(meta.title, 200) || fallback || 'Sans titre';

    const { next } = db
      .prepare('SELECT COALESCE(MAX(number), 0) + 1 AS next FROM episodes WHERE series_id IS ?')
      .get(seriesId);

    const info = db
      .prepare(`INSERT INTO episodes (slug, series_id, number, title, authors, duration, file, mime, size, cover, created_by)
                VALUES (@slug, @series_id, @number, @title, @authors, @duration, @file, @mime, @size, @cover, @created_by)`)
      .run({
        slug: uniqueSlug(db, 'episodes', slugify(title, 'episode')),
        series_id: seriesId,
        number: seriesId ? next : 0,
        title,
        authors: str(meta.artist, 200),
        duration,
        file: file.filename,
        mime: file.mimetype || 'audio/mpeg',
        size: file.size,
        cover: coverName,
        created_by: req.user.id,
      });

    created.push(serializeEpisode(readEpisode(info.lastInsertRowid), null));
  }

  if (!created.length) return res.status(400).json({ error: 'Aucun fichier audio reçu.' });
  res.status(201).json({ episodes: created });
});

router.post('/covers', uploadImage.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucune image reçue.' });
  res.status(201).json({ cover: req.file.filename, cover_url: `/media/covers/${req.file.filename}` });
});

/* -------------------------------------------------------------- episodes */

router.get('/episodes', (req, res) => {
  const q = str(req.query.q, 80);
  const state = ['draft', 'published'].includes(req.query.state) ? req.query.state : null;
  const series = asInt(req.query.series) || null;

  const where = [];
  const params = { like: `%${q}%` };
  if (q) where.push('(e.title LIKE @like OR e.subtitle LIKE @like OR e.authors LIKE @like OR s.title LIKE @like)');
  if (state) where.push(`e.published = ${state === 'published' ? 1 : 0}`);
  if (series) { where.push('e.series_id = @series'); params.series = series; }

  const rows = db
    .prepare(`SELECT ${ADMIN_EPISODE_COLS} FROM episodes e LEFT JOIN series s ON s.id = e.series_id
              ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
              ORDER BY e.created_at DESC, e.id DESC LIMIT 500`)
    .all(params);

  res.json({ episodes: rows.map((row) => serializeEpisode(row, null)) });
});

router.patch('/episodes/:id', (req, res) => {
  const id = asInt(req.params.id);
  const current = readEpisode(id);
  if (!current) return res.status(404).json({ error: 'Épisode introuvable.' });

  const title = req.body?.title === undefined ? current.title : str(req.body.title, 200) || current.title;
  const published = req.body?.published === undefined ? current.published : bool(req.body.published);

  let seriesId = current.series_id;
  if (req.body?.series_id !== undefined) {
    const wanted = asInt(req.body.series_id) || null;
    seriesId = wanted && db.prepare('SELECT 1 FROM series WHERE id = ?').get(wanted) ? wanted : null;
  }

  const next = {
    id,
    title,
    // A published permalink is frozen; a draft's slug keeps following its title.
    slug: req.body?.slug
      ? uniqueSlug(db, 'episodes', slugify(str(req.body.slug, 80), 'episode'), id)
      : current.published
        ? current.slug
        : uniqueSlug(db, 'episodes', slugify(title, 'episode'), id),
    subtitle: req.body?.subtitle === undefined ? current.subtitle : str(req.body.subtitle, 200),
    description: req.body?.description === undefined ? current.description : str(req.body.description, 4000),
    credits: req.body?.credits === undefined ? current.credits : str(req.body.credits, 2000),
    authors: req.body?.authors === undefined ? current.authors : str(req.body.authors, 200),
    tags: req.body?.tags === undefined ? current.tags : normalizeTags(req.body.tags),
    series_id: seriesId,
    number: req.body?.number === undefined ? current.number : asInt(req.body.number),
    cover: req.body?.cover === undefined ? current.cover : str(req.body.cover, 200) || null,
    published,
    // The publication date is stamped the first time a piece goes out.
    published_at: published ? current.published_at ?? new Date().toISOString().slice(0, 19).replace('T', ' ') : current.published_at,
  };

  db.prepare(`UPDATE episodes SET slug = @slug, series_id = @series_id, number = @number, title = @title,
                subtitle = @subtitle, description = @description, credits = @credits, authors = @authors,
                tags = @tags, cover = @cover, published = @published, published_at = @published_at,
                updated_at = datetime('now')
              WHERE id = @id`)
    .run(next);

  res.json({ episode: serializeEpisode(readEpisode(id), null) });
});

router.delete('/episodes/:id', (req, res) => {
  const id = asInt(req.params.id);
  const episode = db.prepare('SELECT * FROM episodes WHERE id = ?').get(id);
  if (!episode) return res.status(404).json({ error: 'Épisode introuvable.' });

  db.prepare('DELETE FROM episodes WHERE id = ?').run(id);
  removeFile(paths.audio, episode.file);
  removeFile(paths.covers, episode.cover);
  res.json({ ok: true });
});

/* ---------------------------------------------------------------- series */

const ADMIN_SERIES_COLS = `
  s.*,
  (SELECT COUNT(*) FROM episodes e WHERE e.series_id = s.id)                     AS episode_count,
  (SELECT COUNT(*) FROM episodes e WHERE e.series_id = s.id AND e.published = 1) AS published_count,
  (SELECT COALESCE(SUM(e.duration), 0) FROM episodes e WHERE e.series_id = s.id) AS total_duration,
  (SELECT COUNT(*) FROM follows f WHERE f.series_id = s.id)                      AS follower_count
`;

const readSeries = (id) => db.prepare(`SELECT ${ADMIN_SERIES_COLS} FROM series s WHERE s.id = ?`).get(id);

router.get('/series', (_req, res) => {
  const rows = db.prepare(`SELECT ${ADMIN_SERIES_COLS} FROM series s ORDER BY s.updated_at DESC, s.id DESC`).all();
  res.json({ series: rows.map((row) => serializeSeries(row, null)) });
});

router.get('/series/:id', (req, res) => {
  const id = asInt(req.params.id);
  const row = readSeries(id);
  if (!row) return res.status(404).json({ error: 'Série introuvable.' });

  const episodes = db
    .prepare(`SELECT ${ADMIN_EPISODE_COLS} FROM episodes e LEFT JOIN series s ON s.id = e.series_id
              WHERE e.series_id = ? ORDER BY e.number, e.id`)
    .all(id);

  res.json({ series: serializeSeries(row, null), episodes: episodes.map((e) => serializeEpisode(e, null)) });
});

function readSeriesBody(body, current = null) {
  const title = body?.title === undefined ? current?.title : str(body.title, 120);
  if (!title) return { error: 'Le titre de la série est obligatoire.' };

  return {
    value: {
      title,
      tagline: body?.tagline === undefined ? current?.tagline ?? '' : str(body.tagline, 160),
      description: body?.description === undefined ? current?.description ?? '' : str(body.description, 4000),
      authors: body?.authors === undefined ? current?.authors ?? '' : str(body.authors, 200),
      cover: body?.cover === undefined ? current?.cover ?? null : str(body.cover, 200) || null,
      published: body?.published === undefined ? current?.published ?? 0 : bool(body.published),
    },
  };
}

router.post('/series', (req, res) => {
  const { value, error } = readSeriesBody(req.body);
  if (error) return res.status(400).json({ error });

  const slug = uniqueSlug(db, 'series', slugify(str(req.body?.slug, 80) || value.title, 'serie'));
  const info = db
    .prepare(`INSERT INTO series (slug, title, tagline, description, authors, cover, published)
              VALUES (@slug, @title, @tagline, @description, @authors, @cover, @published)`)
    .run({ ...value, slug });

  res.status(201).json({ series: serializeSeries(readSeries(info.lastInsertRowid), null) });
});

router.patch('/series/:id', (req, res) => {
  const id = asInt(req.params.id);
  const current = db.prepare('SELECT * FROM series WHERE id = ?').get(id);
  if (!current) return res.status(404).json({ error: 'Série introuvable.' });

  const { value, error } = readSeriesBody(req.body, current);
  if (error) return res.status(400).json({ error });

  const slug = req.body?.slug ? uniqueSlug(db, 'series', slugify(str(req.body.slug, 80), 'serie'), id) : current.slug;
  db.prepare(`UPDATE series SET slug = @slug, title = @title, tagline = @tagline, description = @description,
                authors = @authors, cover = @cover, published = @published, updated_at = datetime('now')
              WHERE id = @id`)
    .run({ ...value, slug, id });

  res.json({ series: serializeSeries(readSeries(id), null) });
});

router.delete('/series/:id', (req, res) => {
  const id = asInt(req.params.id);
  if (!db.prepare('SELECT 1 FROM series WHERE id = ?').get(id)) {
    return res.status(404).json({ error: 'Série introuvable.' });
  }
  // Episodes survive their series; they simply become standalone pieces.
  db.prepare('DELETE FROM series WHERE id = ?').run(id);
  res.json({ ok: true });
});

router.put('/series/:id/order', (req, res) => {
  const id = asInt(req.params.id);
  if (!db.prepare('SELECT 1 FROM series WHERE id = ?').get(id)) {
    return res.status(404).json({ error: 'Série introuvable.' });
  }

  const ids = Array.isArray(req.body?.episode_ids) ? req.body.episode_ids.map((v) => asInt(v)).filter(Boolean) : [];
  const stmt = db.prepare('UPDATE episodes SET number = ? WHERE id = ? AND series_id = ?');
  db.transaction(() => {
    ids.forEach((episodeId, i) => stmt.run(i + 1, episodeId, id));
    db.prepare(`UPDATE series SET updated_at = datetime('now') WHERE id = ?`).run(id);
  })();

  const episodes = db
    .prepare(`SELECT ${ADMIN_EPISODE_COLS} FROM episodes e LEFT JOIN series s ON s.id = e.series_id
              WHERE e.series_id = ? ORDER BY e.number, e.id`)
    .all(id);
  res.json({ episodes: episodes.map((e) => serializeEpisode(e, null)) });
});

/* ----------------------------------------------------------------- stats */

/** Fills the gaps so a quiet day is a zero, not a missing point. */
function dailySeries(rows, days = 30) {
  const counts = new Map(rows.map((r) => [r.day, r.n]));
  const out = [];
  const today = new Date();

  for (let i = days - 1; i >= 0; i -= 1) {
    const date = new Date(today);
    date.setUTCDate(today.getUTCDate() - i);
    const day = date.toISOString().slice(0, 10);
    out.push({ day, n: counts.get(day) ?? 0 });
  }
  return out;
}

router.get('/stats', (_req, res) => {
  const one = (sql) => db.prepare(sql).get().n;

  const completion = db
    .prepare('SELECT COUNT(*) AS started, COALESCE(SUM(completed), 0) AS finished FROM progress')
    .get();

  res.json({
    totals: {
      episodes: one('SELECT COUNT(*) AS n FROM episodes'),
      published: one('SELECT COUNT(*) AS n FROM episodes WHERE published = 1'),
      drafts: one('SELECT COUNT(*) AS n FROM episodes WHERE published = 0'),
      series: one('SELECT COUNT(*) AS n FROM series'),
      users: one('SELECT COUNT(*) AS n FROM users'),
      suspended: one(`SELECT COUNT(*) AS n FROM users WHERE status <> 'active'`),
      new_users_30d: one(`SELECT COUNT(*) AS n FROM users WHERE created_at > datetime('now', '-30 days')`),
      playlists: one('SELECT COUNT(*) AS n FROM playlists'),
      public_playlists: one('SELECT COUNT(*) AS n FROM playlists WHERE is_public = 1 AND moderated = 0'),
      ratings: one('SELECT COUNT(*) AS n FROM ratings'),
      comments: one('SELECT COUNT(*) AS n FROM comments'),
      comments_hidden: one(`SELECT COUNT(*) AS n FROM comments WHERE status = 'hidden'`),
      reports_open: one(`SELECT COUNT(*) AS n FROM reports WHERE status = 'open'`),
      plays: one('SELECT COUNT(*) AS n FROM plays'),
      plays_7d: one(`SELECT COUNT(*) AS n FROM plays WHERE played_at > datetime('now', '-7 days')`),
      plays_30d: one(`SELECT COUNT(*) AS n FROM plays WHERE played_at > datetime('now', '-30 days')`),
      listeners_30d: one(`SELECT COUNT(DISTINCT user_id) AS n FROM plays
                          WHERE user_id IS NOT NULL AND played_at > datetime('now', '-30 days')`),
      duration: one('SELECT COALESCE(SUM(duration), 0) AS n FROM episodes WHERE published = 1'),
      storage: one('SELECT COALESCE(SUM(size), 0) AS n FROM episodes'),
      // Time actually spent listening: finished pieces count in full, the rest where they stopped.
      listened: one(`SELECT COALESCE(SUM(CASE WHEN pr.completed = 1 THEN e.duration ELSE pr.position END), 0) AS n
                     FROM progress pr JOIN episodes e ON e.id = pr.episode_id`),
      never_played: one(`SELECT COUNT(*) AS n FROM episodes e
                         WHERE e.published = 1 AND NOT EXISTS (SELECT 1 FROM plays p WHERE p.episode_id = e.id)`),
      avg_rating: db.prepare('SELECT ROUND(AVG(score), 2) AS n FROM ratings').get().n,
    },

    completion: {
      started: completion.started,
      finished: completion.finished,
      rate: completion.started ? Math.round((completion.finished / completion.started) * 100) : 0,
    },

    plays_daily: dailySeries(
      db.prepare(`SELECT date(played_at) AS day, COUNT(*) AS n FROM plays
                  WHERE played_at > datetime('now', '-30 days') GROUP BY day`).all(),
    ),

    signups_daily: dailySeries(
      db.prepare(`SELECT date(created_at) AS day, COUNT(*) AS n FROM users
                  WHERE created_at > datetime('now', '-30 days') GROUP BY day`).all(),
    ),

    ratings_spread: db.prepare('SELECT score, COUNT(*) AS n FROM ratings GROUP BY score ORDER BY score').all(),

    top: db
      .prepare(`SELECT e.title, e.slug, e.duration,
                  (SELECT COUNT(*) FROM plays p WHERE p.episode_id = e.id)                          AS plays,
                  (SELECT COUNT(*) FROM progress pr WHERE pr.episode_id = e.id)                     AS started,
                  (SELECT COUNT(*) FROM progress pr WHERE pr.episode_id = e.id AND pr.completed = 1) AS finished,
                  (SELECT ROUND(AVG(r.score), 2) FROM ratings r WHERE r.episode_id = e.id)          AS rating_avg
                FROM episodes e WHERE e.published = 1
                ORDER BY plays DESC, e.title LIMIT 10`)
      .all(),

    tags: topTags(),
    recent_users: db.prepare('SELECT username, created_at, role, status FROM users ORDER BY created_at DESC LIMIT 6').all(),
  });
});

/** Themes ranked by the listening they actually pulled in, not by how often they are typed. */
function topTags() {
  const rows = db
    .prepare(`SELECT e.tags, (SELECT COUNT(*) FROM plays p WHERE p.episode_id = e.id) AS plays
              FROM episodes e WHERE e.published = 1 AND e.tags <> ''`)
    .all();

  const counts = new Map();
  for (const { tags, plays } of rows) {
    for (const tag of tags.split(',')) {
      const entry = counts.get(tag) ?? { tag, episodes: 0, plays: 0 };
      entry.episodes += 1;
      entry.plays += plays;
      counts.set(tag, entry);
    }
  }
  return [...counts.values()].sort((a, b) => b.plays - a.plays || b.episodes - a.episodes).slice(0, 10);
}

/* ------------------------------------------------------------ modération */

const logAction = (adminId, action, targetType, targetId, detail = '') =>
  db.prepare('INSERT INTO mod_actions (admin_id, action, target_type, target_id, detail) VALUES (?, ?, ?, ?, ?)')
    .run(adminId, action, targetType, targetId, detail);

const COMMENT_ROW = `
  c.id, c.body, c.status, c.created_at,
  u.id AS user_id, u.username, u.status AS user_status,
  e.slug AS episode_slug, e.title AS episode_title,
  (SELECT COUNT(*) FROM reports r WHERE r.target_type = 'comment' AND r.target_id = c.id AND r.status = 'open') AS reports
`;

const commentQuery = (where) => `
  SELECT ${COMMENT_ROW} FROM comments c
  JOIN users u ON u.id = c.user_id
  JOIN episodes e ON e.id = c.episode_id
  ${where} ORDER BY c.created_at DESC LIMIT 100
`;

/** Attaches a readable preview to each report, so the queue can be judged at a glance. */
function hydrateReport(report) {
  const previews = {
    comment: () => {
      const row = db
        .prepare(`SELECT c.body, c.status, u.username, e.title, e.slug FROM comments c
                  JOIN users u ON u.id = c.user_id JOIN episodes e ON e.id = c.episode_id WHERE c.id = ?`)
        .get(report.target_id);
      return row
        ? { label: `« ${row.body.slice(0, 140)} »`, meta: `${row.username} · ${row.title}`, link: `/piece/${row.slug}`, gone: false, status: row.status }
        : null;
    },
    playlist: () => {
      const row = db
        .prepare('SELECT p.name, p.moderated, u.username FROM playlists p JOIN users u ON u.id = p.user_id WHERE p.id = ?')
        .get(report.target_id);
      return row
        ? { label: row.name, meta: `playlist de ${row.username}`, link: `/playlist/${report.target_id}`, gone: false, status: row.moderated ? 'hidden' : 'visible' }
        : null;
    },
    user: () => {
      const row = db.prepare('SELECT username, status FROM users WHERE id = ?').get(report.target_id);
      return row ? { label: row.username, meta: 'compte', link: null, gone: false, status: row.status } : null;
    },
  };

  return {
    ...report,
    target: previews[report.target_type]?.() ?? { label: 'élément supprimé', meta: '', link: null, gone: true, status: null },
  };
}

router.get('/moderation', (_req, res) => {
  const reports = db
    .prepare(`SELECT r.*, u.username AS reporter FROM reports r
              LEFT JOIN users u ON u.id = r.reporter_id
              ORDER BY r.status = 'open' DESC, r.created_at DESC LIMIT 100`)
    .all()
    .map(hydrateReport);

  const comments = db.prepare(commentQuery('')).all();

  const playlists = db
    .prepare(`SELECT p.id, p.name, p.description, p.is_public, p.moderated, p.updated_at, u.username AS owner,
                (SELECT COUNT(*) FROM playlist_items i WHERE i.playlist_id = p.id) AS item_count,
                (SELECT COUNT(*) FROM reports r WHERE r.target_type = 'playlist' AND r.target_id = p.id AND r.status = 'open') AS reports
              FROM playlists p JOIN users u ON u.id = p.user_id
              WHERE p.is_public = 1 ORDER BY p.updated_at DESC LIMIT 60`)
    .all();

  const flagged = db
    .prepare(`SELECT u.id, u.username, u.email, u.status, u.moderation_note, u.created_at,
                (SELECT COUNT(*) FROM comments c WHERE c.user_id = u.id) AS comments,
                (SELECT COUNT(*) FROM reports r WHERE r.target_type = 'user' AND r.target_id = u.id AND r.status = 'open') AS reports
              FROM users u
              WHERE u.status <> 'active'
                 OR EXISTS (SELECT 1 FROM reports r WHERE r.target_type = 'user' AND r.target_id = u.id AND r.status = 'open')
              ORDER BY u.created_at DESC`)
    .all();

  res.json({ reports, comments, playlists, flagged });
});

router.get('/log', (_req, res) => {
  const entries = db
    .prepare(`SELECT m.*, u.username AS admin FROM mod_actions m
              LEFT JOIN users u ON u.id = m.admin_id ORDER BY m.created_at DESC LIMIT 120`)
    .all();
  res.json({ entries });
});

router.patch('/comments/:id', (req, res) => {
  const id = asInt(req.params.id);
  const status = req.body?.status === 'hidden' ? 'hidden' : 'visible';
  const comment = db.prepare('SELECT * FROM comments WHERE id = ?').get(id);
  if (!comment) return res.status(404).json({ error: 'Message introuvable.' });

  db.prepare('UPDATE comments SET status = ? WHERE id = ?').run(status, id);
  logAction(req.user.id, status === 'hidden' ? 'comment.hide' : 'comment.show', 'comment', id, comment.body.slice(0, 120));

  res.json({ comment: db.prepare(commentQuery('WHERE c.id = @id')).get({ id }) });
});

router.delete('/comments/:id', (req, res) => {
  const id = asInt(req.params.id);
  const comment = db.prepare('SELECT * FROM comments WHERE id = ?').get(id);
  if (!comment) return res.status(404).json({ error: 'Message introuvable.' });

  db.prepare('DELETE FROM comments WHERE id = ?').run(id);
  db.prepare(`UPDATE reports SET status = 'resolved', handled_by = ?, handled_at = datetime('now')
              WHERE target_type = 'comment' AND target_id = ? AND status = 'open'`).run(req.user.id, id);
  logAction(req.user.id, 'comment.delete', 'comment', id, comment.body.slice(0, 120));

  res.json({ ok: true });
});

router.patch('/reports/:id', (req, res) => {
  const id = asInt(req.params.id);
  const status = ['resolved', 'dismissed', 'open'].includes(req.body?.status) ? req.body.status : 'resolved';
  if (!db.prepare('SELECT 1 FROM reports WHERE id = ?').get(id)) {
    return res.status(404).json({ error: 'Signalement introuvable.' });
  }

  db.prepare(`UPDATE reports SET status = ?, handled_by = ?, handled_at = datetime('now') WHERE id = ?`)
    .run(status, req.user.id, id);
  logAction(req.user.id, `report.${status}`, 'report', id);

  res.json({ ok: true });
});

router.patch('/playlists/:id', (req, res) => {
  const id = asInt(req.params.id);
  const playlist = db.prepare('SELECT * FROM playlists WHERE id = ?').get(id);
  if (!playlist) return res.status(404).json({ error: 'Playlist introuvable.' });

  const moderated = bool(req.body?.moderated);
  db.prepare('UPDATE playlists SET moderated = ? WHERE id = ?').run(moderated, id);
  logAction(req.user.id, moderated ? 'playlist.hide' : 'playlist.show', 'playlist', id, playlist.name);

  res.json({ ok: true, moderated: Boolean(moderated) });
});

/* ----------------------------------------------------------------- users */

router.get('/users', (_req, res) => {
  const users = db
    .prepare(`SELECT u.id, u.email, u.username, u.role, u.status, u.moderation_note, u.created_at,
                (SELECT COUNT(*) FROM ratings r WHERE r.user_id = u.id)     AS ratings,
                (SELECT COUNT(*) FROM playlists p WHERE p.user_id = u.id)   AS playlists,
                (SELECT COUNT(*) FROM comments c WHERE c.user_id = u.id)    AS comments,
                (SELECT COUNT(*) FROM plays p WHERE p.user_id = u.id)       AS plays
              FROM users u ORDER BY u.created_at DESC`)
    .all();
  res.json({ users });
});

router.patch('/users/:id', (req, res) => {
  const id = asInt(req.params.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'Compte introuvable.' });

  if (req.body?.role !== undefined) {
    const role = req.body.role === 'admin' ? 'admin' : 'listener';
    if (id === req.user.id && role !== 'admin') {
      return res.status(400).json({ error: 'Impossible de retirer vos propres droits.' });
    }
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
    logAction(req.user.id, `user.role.${role}`, 'user', id, user.username);
  }

  if (req.body?.status !== undefined) {
    const status = ['active', 'suspended', 'banned'].includes(req.body.status) ? req.body.status : 'active';
    if (id === req.user.id && status !== 'active') {
      return res.status(400).json({ error: 'Impossible de vous suspendre vous-même.' });
    }
    db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, id);
    // A banned account should not keep an open session anywhere.
    if (status === 'banned') db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    logAction(req.user.id, `user.${status}`, 'user', id, user.username);
  }

  if (req.body?.moderation_note !== undefined) {
    db.prepare('UPDATE users SET moderation_note = ? WHERE id = ?').run(str(req.body.moderation_note, 500), id);
  }

  res.json({ ok: true });
});

router.delete('/users/:id', (req, res) => {
  const id = asInt(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'Impossible de supprimer votre propre compte ici.' });

  const user = db.prepare('SELECT username FROM users WHERE id = ?').get(id);
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  logAction(req.user.id, 'user.delete', 'user', id, user?.username ?? '');

  res.json({ ok: true });
});

export default router;
