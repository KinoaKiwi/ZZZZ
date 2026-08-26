import { Router } from 'express';
import { db } from '../db.js';
import { requireUser } from '../auth.js';
import { asInt, str, bool } from '../util.js';
import { serializeStation, serializeTrack } from './stations.js';

const router = Router();

const LIST_COLS = `
  p.id, p.name, p.description, p.is_public, p.created_at, p.updated_at,
  u.username AS owner, p.user_id,
  (SELECT COUNT(*) FROM playlist_items i WHERE i.playlist_id = p.id) AS item_count
`;

const shape = (row) => ({ ...row, is_public: Boolean(row.is_public) });

/** Resolves stored references into real tracks/stations, dropping anything deleted since. */
function hydrate(playlistId, user) {
  const items = db
    .prepare('SELECT * FROM playlist_items WHERE playlist_id = ? ORDER BY position, id')
    .all(playlistId);

  const out = [];
  for (const item of items) {
    if (item.kind === 'track') {
      const track = db.prepare('SELECT * FROM tracks WHERE id = ?').get(item.ref_id);
      if (track) out.push({ item_id: item.id, kind: 'track', position: item.position, track: serializeTrack(track) });
    } else {
      const station = db
        .prepare(`SELECT s.*,
                    (SELECT COUNT(*) FROM station_tracks st WHERE st.station_id = s.id) AS track_count,
                    (SELECT ROUND(AVG(r.score), 2) FROM ratings r WHERE r.station_id = s.id) AS rating_avg,
                    (SELECT COUNT(*) FROM ratings r WHERE r.station_id = s.id) AS rating_count
                  FROM stations s WHERE s.id = ? AND s.published = 1`)
        .get(item.ref_id);
      if (station) {
        out.push({ item_id: item.id, kind: 'station', position: item.position, station: serializeStation(station, user) });
      }
    }
  }
  return out;
}

function ownedPlaylist(id, userId) {
  return db.prepare('SELECT * FROM playlists WHERE id = ? AND user_id = ?').get(id, userId);
}

const touch = (id) => db.prepare(`UPDATE playlists SET updated_at = datetime('now') WHERE id = ?`).run(id);

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
              WHERE p.is_public = 1 ORDER BY p.updated_at DESC LIMIT 60`)
    .all();
  res.json({ playlists: rows.map(shape) });
});

router.post('/playlists', requireUser, (req, res) => {
  const name = str(req.body?.name, 80);
  if (!name) return res.status(400).json({ error: 'Donnez un nom a la playlist.' });

  const info = db
    .prepare('INSERT INTO playlists (user_id, name, description, is_public) VALUES (?, ?, ?, ?)')
    .run(req.user.id, name, str(req.body?.description, 400), bool(req.body?.is_public));

  const row = db
    .prepare(`SELECT ${LIST_COLS} FROM playlists p JOIN users u ON u.id = p.user_id WHERE p.id = ?`)
    .get(info.lastInsertRowid);
  res.status(201).json({ playlist: shape(row) });
});

router.get('/playlists/:id', (req, res) => {
  const id = asInt(req.params.id);
  const row = db
    .prepare(`SELECT ${LIST_COLS} FROM playlists p JOIN users u ON u.id = p.user_id WHERE p.id = ?`)
    .get(id);

  if (!row) return res.status(404).json({ error: 'Playlist introuvable.' });
  const mine = req.user && row.user_id === req.user.id;
  if (!row.is_public && !mine) return res.status(404).json({ error: 'Playlist introuvable.' });

  res.json({ playlist: { ...shape(row), is_mine: Boolean(mine) }, items: hydrate(id, req.user) });
});

router.patch('/playlists/:id', requireUser, (req, res) => {
  const id = asInt(req.params.id);
  const pl = ownedPlaylist(id, req.user.id);
  if (!pl) return res.status(404).json({ error: 'Playlist introuvable.' });

  const name = req.body?.name === undefined ? pl.name : str(req.body.name, 80) || pl.name;
  const description = req.body?.description === undefined ? pl.description : str(req.body.description, 400);
  const isPublic = req.body?.is_public === undefined ? pl.is_public : bool(req.body.is_public);

  db.prepare(`UPDATE playlists SET name = ?, description = ?, is_public = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(name, description, isPublic, id);

  const row = db
    .prepare(`SELECT ${LIST_COLS} FROM playlists p JOIN users u ON u.id = p.user_id WHERE p.id = ?`)
    .get(id);
  res.json({ playlist: shape(row) });
});

router.delete('/playlists/:id', requireUser, (req, res) => {
  const info = db.prepare('DELETE FROM playlists WHERE id = ? AND user_id = ?').run(asInt(req.params.id), req.user.id);
  if (!info.changes) return res.status(404).json({ error: 'Playlist introuvable.' });
  res.json({ ok: true });
});

router.post('/playlists/:id/items', requireUser, (req, res) => {
  const id = asInt(req.params.id);
  if (!ownedPlaylist(id, req.user.id)) return res.status(404).json({ error: 'Playlist introuvable.' });

  const kind = req.body?.kind === 'station' ? 'station' : 'track';
  const refId = asInt(req.body?.ref_id);
  const exists =
    kind === 'track'
      ? db.prepare('SELECT 1 FROM tracks WHERE id = ?').get(refId)
      : db.prepare('SELECT 1 FROM stations WHERE id = ? AND published = 1').get(refId);
  if (!exists) return res.status(404).json({ error: 'Element introuvable.' });

  const dup = db
    .prepare('SELECT 1 FROM playlist_items WHERE playlist_id = ? AND kind = ? AND ref_id = ?')
    .get(id, kind, refId);
  if (dup) return res.status(409).json({ error: 'Deja dans cette playlist.' });

  const { pos } = db
    .prepare('SELECT COALESCE(MAX(position), 0) + 1 AS pos FROM playlist_items WHERE playlist_id = ?')
    .get(id);
  db.prepare('INSERT INTO playlist_items (playlist_id, kind, ref_id, position) VALUES (?, ?, ?, ?)')
    .run(id, kind, refId, pos);
  touch(id);

  res.status(201).json({ items: hydrate(id, req.user) });
});

router.delete('/playlists/:id/items/:itemId', requireUser, (req, res) => {
  const id = asInt(req.params.id);
  if (!ownedPlaylist(id, req.user.id)) return res.status(404).json({ error: 'Playlist introuvable.' });

  db.prepare('DELETE FROM playlist_items WHERE id = ? AND playlist_id = ?').run(asInt(req.params.itemId), id);
  touch(id);
  res.json({ items: hydrate(id, req.user) });
});

router.put('/playlists/:id/order', requireUser, (req, res) => {
  const id = asInt(req.params.id);
  if (!ownedPlaylist(id, req.user.id)) return res.status(404).json({ error: 'Playlist introuvable.' });

  const ids = Array.isArray(req.body?.item_ids) ? req.body.item_ids.map((v) => asInt(v)) : [];
  const stmt = db.prepare('UPDATE playlist_items SET position = ? WHERE id = ? AND playlist_id = ?');
  db.transaction(() => ids.forEach((itemId, i) => stmt.run(i + 1, itemId, id)))();
  touch(id);

  res.json({ items: hydrate(id, req.user) });
});

export default router;
