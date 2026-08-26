import { Router } from 'express';
import { db } from '../db.js';
import { requireUser, requireActiveUser, throttle } from '../auth.js';
import { asInt, str } from '../util.js';

const router = Router();

const REASONS = ['spam', 'haine', 'harcelement', 'hors-sujet', 'droits', 'autre'];

const COMMENT_COLS = `
  c.id, c.body, c.status, c.created_at, c.episode_id,
  u.id AS user_id, u.username, u.status AS user_status,
  (SELECT COUNT(*) FROM reports r WHERE r.target_type = 'comment' AND r.target_id = c.id AND r.status = 'open') AS reports
`;

const shape = (row, viewer) => ({
  id: row.id,
  body: row.body,
  status: row.status,
  created_at: row.created_at,
  author: { id: row.user_id, username: row.username },
  reports: row.reports,
  is_mine: Boolean(viewer && viewer.id === row.user_id),
  can_delete: Boolean(viewer && (viewer.id === row.user_id || viewer.role === 'admin')),
});

/* -------------------------------------------------------------- comments */

router.get('/episodes/:slug/comments', (req, res) => {
  const episode = db.prepare('SELECT id, published FROM episodes WHERE slug = ?').get(req.params.slug);
  if (!episode) return res.status(404).json({ error: 'Épisode introuvable.' });

  // A hidden comment stays visible to its author, so moderation is not a silent trap.
  const rows = db
    .prepare(`SELECT ${COMMENT_COLS} FROM comments c JOIN users u ON u.id = c.user_id
              WHERE c.episode_id = ? AND (c.status = 'visible' OR c.user_id = @viewer OR @admin = 1)
              ORDER BY c.created_at DESC LIMIT 200`)
    .all(episode.id, { viewer: req.user?.id ?? 0, admin: req.user?.role === 'admin' ? 1 : 0 });

  res.json({ comments: rows.map((row) => shape(row, req.user)) });
});

router.post('/episodes/:id/comments', requireActiveUser, (req, res) => {
  const id = asInt(req.params.id);
  const body = str(req.body?.body, 1500);

  if (body.length < 2) return res.status(400).json({ error: 'Écrivez quelque chose.' });
  if (!db.prepare('SELECT 1 FROM episodes WHERE id = ? AND published = 1').get(id)) {
    return res.status(404).json({ error: 'Épisode introuvable.' });
  }
  if (!throttle({ key: `comment:${req.user.id}`, limit: 10 })) {
    return res.status(429).json({ error: 'Vous publiez trop vite. Reprenez dans quelques minutes.' });
  }

  const info = db.prepare('INSERT INTO comments (episode_id, user_id, body) VALUES (?, ?, ?)').run(id, req.user.id, body);
  const row = db
    .prepare(`SELECT ${COMMENT_COLS} FROM comments c JOIN users u ON u.id = c.user_id WHERE c.id = ?`)
    .get(info.lastInsertRowid);

  res.status(201).json({ comment: shape(row, req.user) });
});

router.delete('/comments/:id', requireUser, (req, res) => {
  const id = asInt(req.params.id);
  const comment = db.prepare('SELECT * FROM comments WHERE id = ?').get(id);
  if (!comment) return res.status(404).json({ error: 'Message introuvable.' });
  if (comment.user_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Ce message n’est pas le vôtre.' });
  }

  db.prepare('DELETE FROM comments WHERE id = ?').run(id);
  db.prepare(`DELETE FROM reports WHERE target_type = 'comment' AND target_id = ?`).run(id);
  res.json({ ok: true });
});

/* --------------------------------------------------------------- reports */

router.post('/reports', requireActiveUser, (req, res) => {
  const targetType = ['comment', 'playlist', 'user'].includes(req.body?.target_type) ? req.body.target_type : null;
  const targetId = asInt(req.body?.target_id);
  const reason = REASONS.includes(req.body?.reason) ? req.body.reason : 'autre';
  const detail = str(req.body?.detail, 600);

  if (!targetType || !targetId) return res.status(400).json({ error: 'Signalement incomplet.' });

  const exists = {
    comment: () => db.prepare('SELECT 1 FROM comments WHERE id = ?').get(targetId),
    playlist: () => db.prepare('SELECT 1 FROM playlists WHERE id = ? AND is_public = 1').get(targetId),
    user: () => db.prepare('SELECT 1 FROM users WHERE id = ?').get(targetId),
  }[targetType]();
  if (!exists) return res.status(404).json({ error: 'Élément introuvable.' });

  const duplicate = db
    .prepare(`SELECT 1 FROM reports
              WHERE reporter_id = ? AND target_type = ? AND target_id = ? AND status = 'open'`)
    .get(req.user.id, targetType, targetId);
  if (duplicate) return res.status(409).json({ error: 'Vous avez déjà signalé cet élément.' });

  if (!throttle({ key: `report:${req.user.id}`, limit: 12 })) {
    return res.status(429).json({ error: 'Trop de signalements d’un coup.' });
  }

  db.prepare('INSERT INTO reports (reporter_id, target_type, target_id, reason, detail) VALUES (?, ?, ?, ?, ?)')
    .run(req.user.id, targetType, targetId, reason, detail);

  res.status(201).json({ ok: true });
});

export { REASONS };
export default router;
