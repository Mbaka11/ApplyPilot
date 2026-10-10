import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/** Minuscules, sans accents, ponctuation simplifiée (même logique que l'extension). */
export function norm(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’`´]/g, "'")
    .replace(/\((required|obligatoire|requis|optional|facultatif)\)/g, ' ')
    .replace(/[*:?!.,;()[\]{}"«»]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const FR_WORDS = [' le ', ' la ', ' les ', ' des ', ' et ', ' vous ', ' pour ', ' avec ', ' une ', ' est ', ' dans ', ' sur ', ' nous ', ' votre ', ' du '];
const EN_WORDS = [' the ', ' and ', ' you ', ' for ', ' with ', ' our ', ' are ', ' will ', ' to ', ' of ', ' in ', ' we ', ' your ', ' is '];

/** Détection grossière fr/en par mots-outils. */
export function detectLanguage(text, fallback = 'en') {
  const t = ` ${norm(text).slice(0, 8000)} `;
  if (t.trim().length < 20) return fallback;
  const count = (words) => words.reduce((n, w) => n + t.split(w).length - 1, 0);
  const fr = count(FR_WORDS);
  const en = count(EN_WORDS);
  if (fr === 0 && en === 0) return fallback;
  return fr > en * 1.1 ? 'fr' : 'en';
}

export function slugify(s, max = 40) {
  return (
    String(s ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, max)
      .replace(/-+$/g, '') || 'x'
  );
}

/** Nom de fichier sûr (garde les majuscules, remplace le reste par _). */
export function safeFileName(s, max = 60) {
  return (
    String(s ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Za-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, max)
      .replace(/_+$/g, '') || 'Entreprise'
  );
}

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function shortId(n = 4) {
  return crypto.randomBytes(n).toString('hex').slice(0, n);
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

/** Écriture atomique (fichier temporaire puis renommage). */
export function writeJson(file, data) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

export function writeText(file, text) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
}

export function truncate(s, max) {
  s = String(s ?? '');
  return s.length > max ? `${s.slice(0, max)}\n[…tronqué…]` : s;
}

export function isPlainObject(x) {
  return x !== null && typeof x === 'object' && !Array.isArray(x);
}

export function deepMerge(base, over) {
  if (!isPlainObject(base)) return over === undefined ? base : over;
  const out = { ...base };
  if (!isPlainObject(over)) return out;
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) continue;
    out[k] = isPlainObject(v) && isPlainObject(base[k]) ? deepMerge(base[k], v) : v;
  }
  return out;
}
