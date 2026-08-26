import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseFile } from 'music-metadata';
import { db, paths } from '../db.js';
import { requireAdmin } from '../auth.js';
import { asInt, str, bool, slugify, uniqueSlug, isStreamUrl } from '../util.js';
import { serializeStation, serializeTrack } from './stations.js';

const router = Router();
router.use(requireAdmin);

const AUDIO_EXT = new Set(['.mp3', '.ogg', '.oga', '.opus', '.wav', '.flac', '.m4a', '.aac', '.webm']);
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif']);

const randomName = (ext) => `${Date.now().toString(36)}-${crypto.randomBytes(8).toString('hex')}${ext}`;

const storageFor = (dir, allowed) =>
  multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, dir),
      filename: (_req, file, cb) => cb(null, randomName(path.extname(file.originalname).toLowerCase())),
    }),
    limits: { fileSize: 120 * 1024 * 1024, files: 20 },
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (!allowed.has(ext)) return cb(new Error(`Format non accepte : ${ext || file.originalname}`));
      cb(null, true);
    },
  });

const uploadAudio = storageFor(paths.audio, AUDIO_EXT);
const uploadImage = storageFor(paths.covers, IMAGE_EXT);

const removeFile = (dir, name) => {
  if (!name) return;
  fs.rm(path.join(dir, path.basename(name)), { force: true }, () => {});
};

/* ---------------------------------------------------------------- uploads */

router.post('/uploads', uploadAudio.array('files', 20), async (req, res) => {
  const created = [];

  for (const file of req.files ?? []) {
    let meta = {};
    let coverName = null;

    try {
      const parsed = await parseFile(file.path, { duration: true });
      meta = parsed.common ?? {};
      const picture = meta.picture?.[0];
      if (picture) {
        const ext = picture.format === 'image/png' ? '.png' : picture.format === 'image/webp' ? '.webp' : '.jpg';
        coverName = randomName(ext);
        fs.writeFileSync(path.join(paths.covers, coverName), Buffer.from(picture.data));
      }
      meta.duration = parsed.format?.duration ?? 0;
    } catch {
      // Unreadable tags are not fatal: the file still plays, it just lands untitled.
    }

    const fallbackTitle = path.basename(file.originalname, path.extname(file.originalname));
    const info = db
      .prepare(`INSERT INTO tracks (title, artist, album, year, duration, file, mime, size, cover, uploaded_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        str(meta.title, 200) || fallbackTitle,
        str(meta.artist, 200),
        str(meta.album, 200),
        meta.year ? String(meta.year) : '',
        Number(meta.duration) || 0,
        file.filename,
        file.mimetype || 'audio/mpeg',
        file.size,
        coverName,
        req.user.id,
      );

    created.push(serializeTrack(db.prepare('SELECT * FROM tracks WHERE id = ?').get(info.lastInsertRowid)));
  }

  if (!created.length) return res.status(400).json({ error: 'Aucun fichier audio recu.' });
  res.status(201).json({ tracks: created });
});

router.post('/covers', uploadImage.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucune image recue.' });
  res.status(201).json({ cover: req.file.filename, cover_url: `/media/covers/${req.file.filename}` });
});

/* ----------------------------------------------------------------- tracks */

router.get('/tracks', (req, res) => {
  const q = str(req.query.q, 80);
  const rows = db
    .prepare(`SELECT t.*,
                (SELECT COUNT(*) FROM station_tracks st WHERE st.track_id = t.id) AS station_count
              FROM tracks t
              WHERE (@q = '' OR t.title LIKE @like OR t.artist LIKE @like OR t.album LIKE @like)
              ORDER BY t.created_at DESC, t.id DESC LIMIT 500`)
    .all({ q, like: `%${q}%` });
  res.json({ tracks: rows.map(serializeTrack) });
});

router.patch('/tracks/:id', (req, res) => {
  const id = asInt(req.params.id);
  const track = db.prepare('SELECT * FROM tracks WHERE id = ?').get(id);
  if (!track) return res.status(404).json({ error: 'Titre introuvable.' });

  const next = {
    title: req.body?.title === undefined ? track.title : str(req.body.title, 200) || track.title,
    artist: req.body?.artist === undefined ? track.artist : str(req.body.artist, 200),
    album: req.body?.album === undefined ? track.album : str(req.body.album, 200),
    year: req.body?.year === undefined ? track.year : str(req.body.year, 10),
    cover: req.body?.cover === undefined ? track.cover : str(req.body.cover, 200) || null,
  };

  db.prepare('UPDATE tracks SET title = ?, artist = ?, album = ?, year = ?, cover = ? WHERE id = ?')
    .run(next.title, next.artist, next.album, next.year, next.cover, id);
  res.json({ track: serializeTrack(db.prepare('SELECT * FROM tracks WHERE id = ?').get(id)) });
});

router.delete('/tracks/:id', (req, res) => {
  const id = asInt(req.params.id);
  const track = db.prepare('SELECT * FROM tracks WHERE id = ?').get(id);
  if (!track) return res.status(404).json({ error: 'Titre introuvable.' });

  db.prepare('DELETE FROM tracks WHERE id = ?').run(id);
  db.prepare(`DELETE FROM playlist_items WHERE kind = 'track' AND ref_id = ?`).run(id);
  removeFile(paths.audio, track.file);
  removeFile(paths.covers, track.cover);
  res.json({ ok: true });
});

/* --------------------------------------------------------------- stations */

const ADMIN_STATION_COLS = `
  s.*,
  (SELECT COUNT(*) FROM station_tracks st WHERE st.station_id = s.id)      AS track_count,
  (SELECT COUNT(*) FROM ratings r WHERE r.station_id = s.id)               AS rating_count,
  (SELECT ROUND(AVG(r.score), 2) FROM ratings r WHERE r.station_id = s.id) AS rating_avg,
  (SELECT COUNT(*) FROM favorites f WHERE f.station_id = s.id)             AS favorite_count,
  (SELECT COUNT(*) FROM plays p WHERE p.station_id = s.id)                 AS play_count
`;

router.get('/stations', (_req, res) => {
  const rows = db.prepare(`SELECT ${ADMIN_STATION_COLS} FROM stations s ORDER BY s.updated_at DESC, s.id DESC`).all();
  res.json({ stations: rows.map((r) => serializeStation(r, null)) });
});

router.get('/stations/:id', (req, res) => {
  const id = asInt(req.params.id);
  const row = db.prepare(`SELECT ${ADMIN_STATION_COLS} FROM stations s WHERE s.id = ?`).get(id);
  if (!row) return res.status(404).json({ error: 'Station introuvable.' });

  const tracks = db
    .prepare(`SELECT t.*, st.position FROM station_tracks st JOIN tracks t ON t.id = st.track_id
              WHERE st.station_id = ? ORDER BY st.position, t.id`)
    .all(id)
    .map(serializeTrack);

  res.json({ station: serializeStation(row, null), tracks });
});

function readStationBody(body, current = null) {
  const kind = body?.kind === 'mixtape' ? 'mixtape' : body?.kind === 'live' ? 'live' : current?.kind ?? 'live';
  const name = body?.name === undefined ? current?.name : str(body.name, 120);
  const streamUrl = body?.stream_url === undefined ? current?.stream_url ?? '' : str(body.stream_url, 500);

  if (!name) return { error: 'Le nom de la station est obligatoire.' };
  if (kind === 'live' && !isStreamUrl(streamUrl)) {
    return { error: 'Une station live a besoin d une URL de flux en http(s).' };
  }

  return {
    value: {
      name,
      kind,
      stream_url: kind === 'live' ? streamUrl : '',
      tagline: body?.tagline === undefined ? current?.tagline ?? '' : str(body.tagline, 160),
      description: body?.description === undefined ? current?.description ?? '' : str(body.description, 2000),
      genre: body?.genre === undefined ? current?.genre ?? '' : str(body.genre, 40),
      cover: body?.cover === undefined ? current?.cover ?? null : str(body.cover, 200) || null,
      published: body?.published === undefined ? current?.published ?? 0 : bool(body.published),
    },
  };
}

router.post('/stations', (req, res) => {
  const { value, error } = readStationBody(req.body);
  if (error) return res.status(400).json({ error });

  const slug = uniqueSlug(db, slugify(str(req.body?.slug, 60) || value.name));
  const info = db
    .prepare(`INSERT INTO stations (slug, name, tagline, description, genre, kind, stream_url, cover, published, created_by)
              VALUES (@slug, @name, @tagline, @description, @genre, @kind, @stream_url, @cover, @published, @created_by)`)
    .run({ ...value, slug, created_by: req.user.id });

  const row = db.prepare(`SELECT ${ADMIN_STATION_COLS} FROM stations s WHERE s.id = ?`).get(info.lastInsertRowid);
  res.status(201).json({ station: serializeStation(row, null) });
});

router.patch('/stations/:id', (req, res) => {
  const id = asInt(req.params.id);
  const current = db.prepare('SELECT * FROM stations WHERE id = ?').get(id);
  if (!current) return res.status(404).json({ error: 'Station introuvable.' });

  const { value, error } = readStationBody(req.body, current);
  if (error) return res.status(400).json({ error });

  const slug = req.body?.slug ? uniqueSlug(db, slugify(str(req.body.slug, 60)), id) : current.slug;
  db.prepare(`UPDATE stations SET slug = @slug, name = @name, tagline = @tagline, description = @description,
                genre = @genre, kind = @kind, stream_url = @stream_url, cover = @cover, published = @published,
                updated_at = datetime('now')
              WHERE id = @id`)
    .run({ ...value, slug, id });

  const row = db.prepare(`SELECT ${ADMIN_STATION_COLS} FROM stations s WHERE s.id = ?`).get(id);
  res.json({ station: serializeStation(row, null) });
});

router.delete('/stations/:id', (req, res) => {
  const id = asInt(req.params.id);
  const station = db.prepare('SELECT * FROM stations WHERE id = ?').get(id);
  if (!station) return res.status(404).json({ error: 'Station introuvable.' });

  db.prepare('DELETE FROM stations WHERE id = ?').run(id);
  db.prepare(`DELETE FROM playlist_items WHERE kind = 'station' AND ref_id = ?`).run(id);
  res.json({ ok: true });
});

/** Replaces the whole programme of a mixtape, in the order given. */
router.put('/stations/:id/tracks', (req, res) => {
  const id = asInt(req.params.id);
  if (!db.prepare('SELECT 1 FROM stations WHERE id = ?').get(id)) {
    return res.status(404).json({ error: 'Station introuvable.' });
  }

  const ids = Array.isArray(req.body?.track_ids) ? req.body.track_ids.map((v) => asInt(v)).filter(Boolean) : [];
  const insert = db.prepare('INSERT OR REPLACE INTO station_tracks (station_id, track_id, position) VALUES (?, ?, ?)');

  db.transaction(() => {
    db.prepare('DELETE FROM station_tracks WHERE station_id = ?').run(id);
    ids.forEach((trackId, i) => {
      if (db.prepare('SELECT 1 FROM tracks WHERE id = ?').get(trackId)) insert.run(id, trackId, i + 1);
    });
    db.prepare(`UPDATE stations SET updated_at = datetime('now') WHERE id = ?`).run(id);
  })();

  const tracks = db
    .prepare(`SELECT t.*, st.position FROM station_tracks st JOIN tracks t ON t.id = st.track_id
              WHERE st.station_id = ? ORDER BY st.position, t.id`)
    .all(id)
    .map(serializeTrack);
  res.json({ tracks });
});

/* ------------------------------------------------------------------ users */

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

/* ------------------------------------------------------------------ stats */

router.get('/stats', (_req, res) => {
  const one = (sql) => db.prepare(sql).get().n;
  res.json({
    totals: {
      stations: one('SELECT COUNT(*) AS n FROM stations'),
      published: one('SELECT COUNT(*) AS n FROM stations WHERE published = 1'),
      tracks: one('SELECT COUNT(*) AS n FROM tracks'),
      users: one('SELECT COUNT(*) AS n FROM users'),
      playlists: one('SELECT COUNT(*) AS n FROM playlists'),
      ratings: one('SELECT COUNT(*) AS n FROM ratings'),
      plays: one('SELECT COUNT(*) AS n FROM plays'),
      plays_7d: one(`SELECT COUNT(*) AS n FROM plays WHERE played_at > datetime('now', '-7 days')`),
      storage: db.prepare('SELECT COALESCE(SUM(size), 0) AS n FROM tracks').get().n,
    },
    top: db
      .prepare(`SELECT s.name, s.slug, COUNT(p.id) AS plays,
                  (SELECT ROUND(AVG(r.score), 2) FROM ratings r WHERE r.station_id = s.id) AS rating_avg
                FROM stations s LEFT JOIN plays p ON p.station_id = s.id
                GROUP BY s.id ORDER BY plays DESC, s.name LIMIT 8`)
      .all(),
    recent_users: db.prepare('SELECT username, created_at, role FROM users ORDER BY created_at DESC LIMIT 6').all(),
  });
});

export default router;
