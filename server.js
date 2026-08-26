import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import multer from 'multer';

import { paths } from './src/db.js';
import { attachUser } from './src/auth.js';
import authRoutes from './src/routes/auth.js';
import catalogRoutes from './src/routes/catalog.js';
import playlistRoutes from './src/routes/playlists.js';
import communityRoutes from './src/routes/community.js';
import studioRoutes from './src/routes/studio.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, 'public');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      // Stations point at third-party icecast/shoutcast endpoints.
      "media-src 'self' blob: https: http:",
      "connect-src 'self'",
      "frame-ancestors 'self'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  );
  next();
});

app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));
app.use(attachUser);

app.use('/api/auth', authRoutes);
app.use('/api/studio', studioRoutes);
app.use('/api', catalogRoutes);
app.use('/api', playlistRoutes);
app.use('/api', communityRoutes);

app.use('/media/audio', express.static(paths.audio, { maxAge: '30d', immutable: true, index: false, dotfiles: 'deny' }));
app.use('/media/covers', express.static(paths.covers, { maxAge: '30d', immutable: true, index: false, dotfiles: 'deny' }));

app.use(express.static(publicDir, { index: false, maxAge: '1h' }));

// Two shells, two entry points: the public radio and the private studio.
app.get('/studio{/*rest}', (_req, res) => res.sendFile(path.join(publicDir, 'studio.html')));

app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api/') || req.path.startsWith('/media/')) return next();
  if (!req.accepts('html')) return next();
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.use((req, res) => res.status(404).json({ error: 'Ressource introuvable.' }));

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    const message =
      err.code === 'LIMIT_FILE_SIZE' ? 'Fichier trop lourd (400 Mo maximum).' : `Envoi refuse : ${err.message}`;
    return res.status(400).json({ error: message });
  }
  if (err?.message?.startsWith('Format non accepté')) return res.status(400).json({ error: err.message });

  console.error(err);
  res.status(500).json({ error: 'Erreur interne du serveur.' });
});

const port = Number(process.env.PORT) || 3000;

app.listen(port, () => {
  console.log(`  Onde\n  ecoute      http://localhost:${port}\n  studio      http://localhost:${port}/studio`);
});
