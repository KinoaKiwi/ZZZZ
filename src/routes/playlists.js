import { Router } from 'express';
import { db } from '../db.js';
import { requireUser, requireActiveUser } from '../auth.js';
import { asInt, str, bool } from '../util.js';
import { serializeEpisode } from './catalog.js';

const router = Router();

const LIST_COLS = `
  p.id, p.name, p.description, p.is_public, p.moderated, p.created_at, p.updated_at,
  u.username AS owner, p.user_id,
  (SELECT COUNT(*) FROM playlist_items i
    JOIN episodes e ON e.id = i.episode_id
    WHERE i.playlist_id = p.id AND e.published = 1) AS item_count,
  (SELECT COALESCE(SUM(e.duration), 0) FROM playlist_items i
    JOIN episodes e ON e.id = i.episode_id
    WHERE i.playlist_id = p.id AND e.published = 1) AS total_duration
`;

const shape = (row) => ({ ...row, is_public: Boolean(row.is_public), moderated: Boolean(row.moderated) });

const ITEM_COLS = `
  i.id AS item_id, i.position,
  e.id, e.slug, e.title, e.subtitle, e.description, e.credits, e.authors, e.tags,
  e.duration, e.file, e.cover, e.number, e.published, e.published_at, e.created_at, e.size,
  e.series_id, s.slug AS series_slug, s.title AS series_title, s.cover AS series_cover,
  (SELECT COUNT(*) FROM ratings r WHERE r.episode_id = e.id)               AS rating_count,
  (SELECT ROUND(AVG(r.score), 2) FROM ratings r WHERE r.episode_id = e.id) AS rating_avg,
  (SELECT COUNT(*) FROM plays pl WHERE pl.episode_id = e.id)               AS play_count
`;

function items(playlistId, user) {
  return db
    .prepare(`SELECT ${ITEM_COLS} FROM playlist_items i
              JOIN episodes e ON e.id = i.episode_id
              LEFT JOIN series s ON s.id = e.series_id
              WHERE i.playlist_id = ? AND e.published = 1
              ORDER BY i.position, i.id`)
    .all(playlistId)
    .map((row) => {
      const { item_id: itemId, position, ...episode } = row;
      return { item_id: itemId, position, episode: serializeEpisode(episode, user) };
    });
}

const owned = (id, userId) => db.prepare('SELECT * FROM playlists WHERE id = ? AND user_id = ?').get(id, userId);
const touch = (id) => db.prepare(`UPDATE playlists SET updated_at = datetime('now') WHERE id = ?`).run(id);
const readOne = (id) =>
  db.prepare(`SELECT ${LIST_COLS} FROM playlists p JOIN users u ON u.id = p.user_id WHERE p.id = ?`).get(id);

router.get('/playlists', requireUser, (req, res) => {
  const rows = db
    .prepare(`SELECT ${LIST_COLS} FROM playlists p JOIN users u ON u.id = p.user_id
              WHERE p.user_id = ? ORDER BY p.updated_at DESC`)
    .all(req.user.id);
  res.json({ playlists: rows.map(shape) });
});

router.get('/playlists/public', (_req, res) => {
  const rows = db
    .prepare(`SELECT ${LIST_COLS} FROM playlists p JOIN users u ON u.id = p.user_id
              WHERE p.is_public = 1 AND p.moderated = 0 ORDER BY p.updated_at DESC LIMIT 60`)
    .all();
  res.json({ playlists: rows.map(shape) });
});

router.post('/playlists', requireUser, (req, res) => {
  const name = str(req.body?.name, 80);
  if (!name) return res.status(400).json({ error: 'Donnez un nom à la playlist.' });

  const info = db
    .prepare('INSERT INTO playlists (user_id, name, description, is_public) VALUES (?, ?, ?, ?)')
    .run(req.user.id, name, str(req.body?.description, 400), bool(req.body?.is_public));
  res.status(201).json({ playlist: shape(readOne(info.lastInsertRowid)) });
});

router.get('/playlists/:id', (req, res) => {
  const id = asInt(req.params.id);
  const row = readOne(id);
  if (!row) return res.status(404).json({ error: 'Playlist introuvable.' });

  const mine = Boolean(req.user && row.user_id === req.user.id);
  const visible = row.is_public && !row.moderated;
  if (!visible && !mine && req.user?.role !== 'admin') return res.status(404).json({ error: 'Playlist introuvable.' });

  res.json({ playlist: { ...shape(row), is_mine: mine }, items: items(id, req.user) });
});

router.patch('/playlists/:id', requireUser, (req, res) => {
  const id = asInt(req.params.id);
  const playlist = owned(id, req.user.id);
  if (!playlist) return res.status(404).json({ error: 'Playlist introuvable.' });

  const name = req.body?.name === undefined ? playlist.name : str(req.body.name, 80) || playlist.name;
  const description = req.body?.description === undefined ? playlist.description : str(req.body.description, 400);
  const isPublic = req.body?.is_public === undefined ? playlist.is_public : bool(req.body.is_public);

  db.prepare(`UPDATE playlists SET name = ?, description = ?, is_public = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(name, description, isPublic, id);
  res.json({ playlist: shape(readOne(id)) });
});

router.delete('/playlists/:id', requireUser, (req, res) => {
  const info = db.prepare('DELETE FROM playlists WHERE id = ? AND user_id = ?').run(asInt(req.params.id), req.user.id);
  if (!info.changes) return res.status(404).json({ error: 'Playlist introuvable.' });
  res.json({ ok: true });
});

router.post('/playlists/:id/items', requireUser, (req, res) => {
  const id = asInt(req.params.id);
  if (!owned(id, req.user.id)) return res.status(404).json({ error: 'Playlist introuvable.' });

  // A whole series can be dropped in at once; otherwise it is a single episode.
  const seriesId = asInt(req.body?.series_id);
  const wanted = seriesId
    ? db.prepare('SELECT id FROM episodes WHERE series_id = ? AND published = 1 ORDER BY number, id').all(seriesId).map((r) => r.id)
    : [asInt(req.body?.episode_id)].filter(Boolean);

  if (!wanted.length) return res.status(404).json({ error: 'Rien à ajouter.' });

  const insert = db.prepare(`INSERT OR IGNORE INTO playlist_items (playlist_id, episode_id, position) VALUES (?, ?, ?)`);
  let { pos } = db
    .prepare('SELECT COALESCE(MAX(position), 0) AS pos FROM playlist_items WHERE playlist_id = ?')
    .get(id);

  let added = 0;
  db.transaction(() => {
    for (const episodeId of wanted) {
      if (!db.prepare('SELECT 1 FROM episodes WHERE id = ? AND published = 1').get(episodeId)) continue;
      const info = insert.run(id, episodeId, ++pos);
      added += info.changes;
    }
  })();

  if (!added) return res.status(409).json({ error: 'Déjà dans cette playlist.' });
  touch(id);
  res.status(201).json({ added, items: items(id, req.user) });
});

router.delete('/playlists/:id/items/:itemId', requireUser, (req, res) => {
  const id = asInt(req.params.id);
  if (!owned(id, req.user.id)) return res.status(404).json({ error: 'Playlist introuvable.' });

  db.prepare('DELETE FROM playlist_items WHERE id = ? AND playlist_id = ?').run(asInt(req.params.itemId), id);
  touch(id);
  res.json({ items: items(id, req.user) });
});

router.put('/playlists/:id/order', requireUser, (req, res) => {
  const id = asInt(req.params.id);
  if (!owned(id, req.user.id)) return res.status(404).json({ error: 'Playlist introuvable.' });

  const ids = Array.isArray(req.body?.item_ids) ? req.body.item_ids.map((v) => asInt(v)) : [];
  const stmt = db.prepare('UPDATE playlist_items SET position = ? WHERE id = ? AND playlist_id = ?');
  db.transaction(() => ids.forEach((itemId, i) => stmt.run(i + 1, itemId, id)))();
  touch(id);

  res.json({ items: items(id, req.user) });
});

export default router;
