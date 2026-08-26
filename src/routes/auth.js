import { Router } from 'express';
import { db } from '../db.js';
import { hashPassword, checkPassword, startSession, endSession, requireUser, throttle } from '../auth.js';
import { str, isEmail } from '../util.js';

const router = Router();

const publicUser = (u) => ({
  id: u.id, email: u.email, username: u.username,
  role: u.role, bio: u.bio, status: u.status ?? 'active', created_at: u.created_at,
});

router.get('/me', (req, res) => {
  res.json({ user: req.user ? publicUser(req.user) : null });
});

router.post('/register', (req, res) => {
  if (!throttle({ key: `reg:${req.ip}`, limit: 8 })) {
    return res.status(429).json({ error: 'Trop de tentatives. Reessayez dans quelques minutes.' });
  }

  const email = str(req.body?.email, 190).toLowerCase();
  const username = str(req.body?.username, 32);
  const password = String(req.body?.password ?? '');

  if (!isEmail(email)) return res.status(400).json({ error: 'Adresse e-mail invalide.' });
  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) {
    return res.status(400).json({ error: 'Pseudo : 3 a 32 caracteres (lettres, chiffres, . _ -).' });
  }
  if (password.length < 8) return res.status(400).json({ error: 'Mot de passe : 8 caracteres minimum.' });

  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
    return res.status(409).json({ error: 'Cette adresse est deja utilisee.' });
  }
  if (db.prepare('SELECT 1 FROM users WHERE username = ? COLLATE NOCASE').get(username)) {
    return res.status(409).json({ error: 'Ce pseudo est deja pris.' });
  }

  // The very first account owns the studio; everyone after is a listener.
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM users').get();
  const role = n === 0 || email === String(process.env.ADMIN_EMAIL || '').toLowerCase() ? 'admin' : 'listener';

  const info = db
    .prepare('INSERT INTO users (email, username, password, role) VALUES (?, ?, ?, ?)')
    .run(email, username, hashPassword(password), role);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  startSession(res, user.id, req.secure);
  res.status(201).json({ user: publicUser(user) });
});

router.post('/login', (req, res) => {
  if (!throttle({ key: `log:${req.ip}`, limit: 15 })) {
    return res.status(429).json({ error: 'Trop de tentatives. Reessayez dans quelques minutes.' });
  }

  const identifier = str(req.body?.identifier, 190);
  const password = String(req.body?.password ?? '');

  const user = db
    .prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE OR username = ? COLLATE NOCASE')
    .get(identifier.toLowerCase(), identifier);

  if (!user || !checkPassword(password, user.password)) {
    return res.status(401).json({ error: 'Identifiants incorrects.' });
  }
  if (user.status === 'banned') return res.status(403).json({ error: 'Ce compte a été fermé.' });

  startSession(res, user.id, req.secure);
  res.json({ user: publicUser(user) });
});

router.post('/logout', (req, res) => {
  endSession(req, res);
  res.json({ ok: true });
});

router.patch('/me', requireUser, (req, res) => {
  const bio = str(req.body?.bio, 280);
  db.prepare('UPDATE users SET bio = ? WHERE id = ?').run(bio, req.user.id);
  res.json({ user: { ...publicUser(req.user), bio } });
});

router.post('/me/password', requireUser, (req, res) => {
  const current = String(req.body?.current ?? '');
  const next = String(req.body?.next ?? '');
  const row = db.prepare('SELECT password FROM users WHERE id = ?').get(req.user.id);

  if (!checkPassword(current, row.password)) {
    return res.status(403).json({ error: 'Mot de passe actuel incorrect.' });
  }
  if (next.length < 8) return res.status(400).json({ error: 'Nouveau mot de passe : 8 caracteres minimum.' });

  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashPassword(next), req.user.id);
  // Log every other device out; the current cookie is re-issued below.
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(req.user.id);
  startSession(res, req.user.id, req.secure);
  res.json({ ok: true });
});

export default router;
