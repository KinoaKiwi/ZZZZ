import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { db } from './db.js';

const COOKIE = 'onde_session';
const TTL_DAYS = 30;

const insertSession = db.prepare(`
  INSERT INTO sessions (token, user_id, expires_at)
  VALUES (?, ?, datetime('now', '+${TTL_DAYS} days'))
`);

const findSession = db.prepare(`
  SELECT u.id, u.email, u.username, u.role, u.bio, u.status, u.created_at
  FROM sessions s JOIN users u ON u.id = s.user_id
  WHERE s.token = ? AND s.expires_at > datetime('now')
`);

export const hashPassword = (plain) => bcrypt.hashSync(plain, 12);
export const checkPassword = (plain, hash) => bcrypt.compareSync(plain, hash);

export function startSession(res, userId, secure) {
  const token = crypto.randomBytes(32).toString('hex');
  insertSession.run(token, userId);
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: Boolean(secure),
    maxAge: TTL_DAYS * 24 * 60 * 60 * 1000,
    path: '/',
  });
  return token;
}

export function endSession(req, res) {
  const token = req.cookies?.[COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.clearCookie(COOKIE, { path: '/' });
}

/** Attaches req.user (or null) on every request. */
export function attachUser(req, _res, next) {
  const token = req.cookies?.[COOKIE];
  req.user = token ? (findSession.get(token) ?? null) : null;
  next();
}

export function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Connexion requise.' });
  next();
}

/** Posting anything public also requires an account in good standing. */
export function requireActiveUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Connexion requise.' });
  if (req.user.status === 'banned') return res.status(403).json({ error: 'Ce compte a été fermé.' });
  if (req.user.status === 'suspended') {
    return res.status(403).json({ error: 'Votre compte est suspendu : vous pouvez écouter, mais plus publier.' });
  }
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Connexion requise.' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Reserve au studio.' });
  next();
}

/** Naive per-key throttle, enough to blunt credential stuffing on a small install. */
const hits = new Map();
export function throttle({ key, limit = 10, windowMs = 10 * 60 * 1000 }) {
  const now = Date.now();
  const entry = hits.get(key);
  if (!entry || now > entry.reset) {
    hits.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  entry.count += 1;
  return entry.count <= limit;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of hits) if (now > entry.reset) hits.delete(key);
}, 60_000).unref();
