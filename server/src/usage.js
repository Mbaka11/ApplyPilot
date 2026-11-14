import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';
import { ensureDir } from './util.js';

// Journal d'usage de l'IA : une ligne JSON par appel, sans aucun contenu (ni prompt, ni réponse, ni message d'erreur,
// ni donnée de profil). Seuls des identifiants courts et des compteurs sont conservés.
export const USAGE_DIR = path.join(DATA_DIR, 'usage');
export const USAGE_FILE = path.join(USAGE_DIR, 'usage.jsonl');
export const RETENTION_DAYS = 180;
export const MAX_BYTES = 5 * 1024 * 1024;
const DAY = 86_400_000;

const word = (v, max = 80) => (typeof v === 'string' && v.trim() && !/[\u0000-\u001f\u007f]/.test(v) ? v.trim().slice(0, max) : null);
const count = v => (Number.isFinite(v) && v >= 0 ? Math.round(v) : null);
const money = v => (Number.isFinite(v) && v >= 0 ? v : null);

/** `api` si ANTHROPIC_API_KEY est défini dans l'environnement (le CLI facture alors l'API), sinon `subscription`. */
export const billingMode = (env = process.env) => (env.ANTHROPIC_API_KEY ? 'api' : 'subscription');

/** Liste blanche des champs : tout le reste est ignoré. */
export function sanitizeEntry(entry = {}) {
  const at = new Date(entry.at ?? Date.now());
  return {
    at: (Number.isNaN(at.getTime()) ? new Date() : at).toISOString(),
    task: word(entry.task, 40), provider: word(entry.provider, 40), model: word(entry.model, 120), effort: word(entry.effort, 20),
    ms: count(entry.ms), attempts: count(entry.attempts) ?? 1, ok: entry.ok !== false,
    costUsd: money(entry.costUsd), inputTokens: count(entry.inputTokens), outputTokens: count(entry.outputTokens),
    billing: entry.billing === 'api' ? 'api' : 'subscription',
  };
}

function parseLines(raw) {
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (e && typeof e === 'object' && !Array.isArray(e) && Number.isFinite(Date.parse(e.at))) out.push(e);
    } catch { /* ligne corrompue ou partielle : ignorée */ }
  }
  return out;
}
const readRaw = file => { try { return fs.readFileSync(file, 'utf8'); } catch { return ''; } };

/** Rotation : au plus `days` jours et `maxBytes` octets (les plus anciennes lignes partent d'abord). Réécriture atomique. */
export function rotateUsage({ file = USAGE_FILE, days = RETENTION_DAYS, maxBytes = MAX_BYTES, now = Date.now() } = {}) {
  if (!fs.existsSync(file)) return { kept: 0, dropped: 0 };
  const all = parseLines(readRaw(file));
  const entries = all.filter(e => Date.parse(e.at) >= now - days * DAY).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const lines = entries.map(e => JSON.stringify(e));
  let size = lines.reduce((n, l) => n + Buffer.byteLength(l) + 1, 0), start = 0;
  while (size > maxBytes && start < lines.length) size -= Buffer.byteLength(lines[start++]) + 1;
  const kept = lines.slice(start);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, kept.length ? `${kept.join('\n')}\n` : '', 'utf8');
  fs.renameSync(tmp, file);
  return { kept: kept.length, dropped: all.length - kept.length };
}

let rotatedOnce = false;
/** Ajoute une ligne. Ne lève jamais d'exception (un journal ne doit pas casser une génération). */
export function recordUsage(entry, { file = USAGE_FILE } = {}) {
  try {
    ensureDir(path.dirname(file));
    let prefix = '';
    let size = 0;
    try {
      size = fs.statSync(file).size;
      if (size) { const fd = fs.openSync(file, 'r'); const b = Buffer.alloc(1); fs.readSync(fd, b, 0, 1, size - 1); fs.closeSync(fd); if (b[0] !== 10) prefix = '\n'; }
    } catch { /* fichier absent */ }
    fs.appendFileSync(file, `${prefix}${JSON.stringify(sanitizeEntry(entry))}\n`, 'utf8');
    if (size > MAX_BYTES * 0.9 || (!rotatedOnce && size)) { rotatedOnce = true; rotateUsage({ file }); }
    return true;
  } catch { return false; }
}

const blank = () => ({ count: 0, ok: 0, failed: 0, inputTokens: 0, outputTokens: 0, ms: 0, costUsd: 0 });
function add(a, e) {
  a.count++;
  if (e.ok === false) a.failed++; else a.ok++;
  a.inputTokens += Number(e.inputTokens) || 0;
  a.outputTokens += Number(e.outputTokens) || 0;
  a.ms += Number(e.ms) || 0;
  a.costUsd += Number(e.costUsd) || 0;
}
const finish = a => ({ ...a, costUsd: Math.round(a.costUsd * 1e6) / 1e6 });

/** Agrège les `days` derniers jours (jours en UTC). */
export function usageSummary({ days = 30, file = USAGE_FILE, now = Date.now() } = {}) {
  const span = Math.min(Math.max(Math.round(Number(days)) || 30, 1), 3650);
  const since = now - span * DAY;
  const totals = blank(), byDay = new Map(), byTask = new Map(), byModel = new Map(), billing = { api: 0, subscription: 0 };
  const group = (map, key) => { if (!map.has(key)) map.set(key, blank()); return map.get(key); };
  for (const e of parseLines(readRaw(file))) {
    const t = Date.parse(e.at);
    if (t < since || t > now + DAY) continue;
    add(totals, e);
    add(group(byDay, new Date(t).toISOString().slice(0, 10)), e);
    add(group(byTask, typeof e.task === 'string' && e.task ? e.task : 'unknown'), e);
    add(group(byModel, typeof e.model === 'string' && e.model ? e.model : 'unknown'), e);
    billing[e.billing === 'api' ? 'api' : 'subscription']++;
  }
  const list = (map, key) => [...map].map(([k, v]) => ({ [key]: k, ...finish(v) }));
  return { days: span, since: new Date(since).toISOString(), totals: finish(totals), billing,
    byDay: list(byDay, 'day').sort((a, b) => a.day.localeCompare(b.day)),
    byTask: list(byTask, 'task').sort((a, b) => b.count - a.count),
    byModel: list(byModel, 'model').sort((a, b) => b.count - a.count) };
}

/** Efface le journal. */
export function clearUsage({ file = USAGE_FILE } = {}) {
  try { fs.rmSync(file, { force: true }); return { cleared: true }; } catch { return { cleared: false }; }
}

/** Corps de GET /usage (query = URLSearchParams). */
export const usageView = (query, cfg) => ({ enabled: cfg?.usage?.enabled !== false, ...usageSummary({ days: Number(query?.get?.('days')) || 30 }) });
