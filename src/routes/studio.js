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

/* ----------------------------------------------------------------- users */

router.get('/users', (_req, res) => {
  const users = db
    .prepare(`SELECT u.id, u.email, u.username, u.role, u.created_at,
                (SELECT COUNT(*) FROM ratings r WHERE r.user_id = u.id)   AS ratings,
                (SELECT COUNT(*) FROM playlists p WHERE p.user_id = u.id) AS playlists
              FROM users u ORDER BY u.created_at DESC`)
    .all();
  res.json({ users });
});

router.patch('/users/:id', (req, res) => {
  const id = asInt(req.params.id);
  const role = req.body?.role === 'admin' ? 'admin' : 'listener';
  if (id === req.user.id && role !== 'admin') {
    return res.status(400).json({ error: 'Impossible de retirer vos propres droits.' });
  }
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
  res.json({ ok: true });
});

router.delete('/users/:id', (req, res) => {
  const id = asInt(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'Impossible de supprimer votre propre compte ici.' });
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ ok: true });
});

/* ----------------------------------------------------------------- stats */

router.get('/stats', (_req, res) => {
  const one = (sql) => db.prepare(sql).get().n;
  res.json({
    totals: {
      episodes: one('SELECT COUNT(*) AS n FROM episodes'),
      published: one('SELECT COUNT(*) AS n FROM episodes WHERE published = 1'),
      series: one('SELECT COUNT(*) AS n FROM series'),
      users: one('SELECT COUNT(*) AS n FROM users'),
      playlists: one('SELECT COUNT(*) AS n FROM playlists'),
      ratings: one('SELECT COUNT(*) AS n FROM ratings'),
      plays: one('SELECT COUNT(*) AS n FROM plays'),
      plays_7d: one(`SELECT COUNT(*) AS n FROM plays WHERE played_at > datetime('now', '-7 days')`),
      duration: one('SELECT COALESCE(SUM(duration), 0) AS n FROM episodes WHERE published = 1'),
      storage: one('SELECT COALESCE(SUM(size), 0) AS n FROM episodes'),
    },
    top: db
      .prepare(`SELECT e.title, e.slug, COUNT(p.id) AS plays,
                  (SELECT ROUND(AVG(r.score), 2) FROM ratings r WHERE r.episode_id = e.id) AS rating_avg
                FROM episodes e LEFT JOIN plays p ON p.episode_id = e.id
                GROUP BY e.id ORDER BY plays DESC, e.title LIMIT 8`)
      .all(),
    recent_users: db.prepare('SELECT username, created_at, role FROM users ORDER BY created_at DESC LIMIT 6').all(),
  });
});

export default router;
