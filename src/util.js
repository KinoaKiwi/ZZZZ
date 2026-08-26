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

export function uniqueSlug(db, table, wanted, ignoreId = 0) {
  const stmt = db.prepare(`SELECT id FROM ${table} WHERE slug = ? AND id <> ?`);
  let slug = wanted;
  let n = 2;
  while (stmt.get(slug, ignoreId)) slug = `${wanted}-${n++}`;
  return slug;
}

/** Tags travel as "a,b,c" so a filter can match a whole tag, never a fragment. */
export function normalizeTags(input) {
  const source = Array.isArray(input) ? input : String(input ?? '').split(',');
  const seen = [];
  for (const raw of source) {
    const tag = slugify(raw, '');
    if (tag && !seen.includes(tag)) seen.push(tag);
  }
  return seen.slice(0, 12).join(',');
}

export const str = (v, max = 500) => String(v ?? '').trim().slice(0, max);

export const bool = (v) => (v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0);

export function isEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || ''));
}

export function asInt(v, fallback = 0) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}
