export function slugify(input, fallback = 'radio') {
  const base = String(input || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return base || fallback;
}

export function uniqueSlug(db, wanted, ignoreId = 0) {
  const stmt = db.prepare('SELECT id FROM stations WHERE slug = ? AND id <> ?');
  let slug = wanted;
  let n = 2;
  while (stmt.get(slug, ignoreId)) slug = `${wanted}-${n++}`;
  return slug;
}

export const str = (v, max = 500) => String(v ?? '').trim().slice(0, max);

export const bool = (v) => (v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0);

export function isEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || ''));
}

/** Only http(s) stream URLs are accepted, so a station cannot point at file:// or javascript:. */
export function isStreamUrl(v) {
  try {
    const u = new URL(String(v));
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function asInt(v, fallback = 0) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}
