import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';
import { ensureDir, norm, readJson, shortId, slugify, writeJson, writeText } from './util.js';

const APPS_DIR = () => ensureDir(path.join(DATA_DIR, 'applications'));
const MEMORY_FILE = () => path.join(DATA_DIR, 'memory', 'answers.json');
const JOURNAL_FILE = () => path.join(DATA_DIR, 'candidatures.csv');

export const STATUSES = ['en cours', 'soumise', 'entrevue', 'refusée', 'offre', 'abandonnée'];

const now = () => new Date().toISOString();
/** Date locale AAAA-MM-JJ (et non UTC). */
const localDate = (d = new Date()) => (d ? new Date(d) : new Date()).toLocaleDateString('sv-SE');
const validId = (id) => /^[a-z0-9][a-z0-9_-]{2,120}$/i.test(String(id || ''));

export function appDir(id) {
  if (!validId(id)) throw Object.assign(new Error('Identifiant de candidature invalide'), { status: 400 });
  return path.join(APPS_DIR(), id);
}

export function getApplication(id) {
  const app = readJson(path.join(appDir(id), 'application.json'));
  if (!app) throw Object.assign(new Error(`Candidature introuvable : ${id}`), { status: 404 });
  return app;
}

export function saveApplication(app) {
  app.updatedAt = now();
  writeJson(path.join(appDir(app.id), 'application.json'), app);
  writeJournal();
  return app;
}

export function listApplications() {
  const dir = APPS_DIR();
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => readJson(path.join(dir, e.name, 'application.json')))
    .filter(Boolean)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export function summary(app) {
  return {
    id: app.id,
    createdAt: app.createdAt,
    updatedAt: app.updatedAt,
    status: app.status,
    submittedAt: app.submittedAt,
    title: app.job?.title,
    company: app.job?.company,
    location: app.job?.location,
    platform: app.job?.platform,
    url: app.job?.url,
    jobKey: app.job?.jobKey,
    cvId: app.cvId,
    hasLetter: !!app.letter?.body,
    letterFile: app.letter?.fileName || null,
  };
}

/** Crée une candidature (ou renvoie celle qui existe déjà pour la même offre). */
export function createApplication({ job = {}, cvId = null, force = false }) {
  if (!force && job.jobKey) {
    const existing = listApplications().find((a) => a.job?.jobKey === job.jobKey);
    if (existing) return { app: existing, existed: true };
  }
  const date = localDate();
  const id = `${date}_${slugify(job.company || 'entreprise', 24)}_${slugify(job.title || 'poste', 32)}_${shortId(4)}`;
  const app = {
    id,
    createdAt: now(),
    updatedAt: now(),
    status: 'en cours',
    submittedAt: null,
    job: {
      url: job.url || '',
      jobKey: job.jobKey || '',
      platform: job.platform || '',
      title: job.title || '',
      company: job.company || '',
      location: job.location || '',
      language: job.language || '',
      postedAt: job.postedAt || '',
      requisitionId: job.requisitionId || '',
      description: String(job.description || '').slice(0, 60000),
    },
    cvId,
    letter: null,
    notes: '',
  };
  ensureDir(appDir(id));
  saveApplication(app);
  return { app, existed: false };
}

export function deleteApplication(id) {
  const dir = appDir(id);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  writeJournal();
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Journal CSV (séparateur « ; » + BOM pour Excel en français). */
export function journalCsv() {
  const rows = [['date', 'entreprise', 'poste', 'lieu', 'plateforme', 'statut', 'soumise_le', 'cv', 'lettre', 'url', 'notes']];
  for (const a of listApplications()) {
    rows.push([
      a.createdAt ? localDate(a.createdAt) : '',
      a.job?.company,
      a.job?.title,
      a.job?.location,
      a.job?.platform,
      a.status,
      a.submittedAt ? localDate(a.submittedAt) : '',
      a.cvId,
      a.letter?.fileName ? path.join(appDir(a.id), a.letter.fileName) : '',
      a.job?.url,
      a.notes,
    ]);
  }
  return `\ufeff${rows.map((r) => r.map(csvCell).join(';')).join('\r\n')}\r\n`;
}

function writeJournal() {
  try {
    writeText(JOURNAL_FILE(), journalCsv());
  } catch (e) {
    // Excel peut verrouiller le fichier : on réessaiera au prochain changement.
    console.warn(`[journal] écriture impossible (${e.code || e.message})`);
  }
}

// ---------------------------------------------------------------------------
// Mémoire des réponses (questions récurrentes des formulaires)
// ---------------------------------------------------------------------------

export function memoryKey(label) {
  return norm(label).replace(/\s+/g, ' ').slice(0, 200);
}

export function getMemory() {
  return readJson(MEMORY_FILE(), { items: {} }) || { items: {} };
}

export function addToMemory(items = [], source = {}) {
  const mem = getMemory();
  let added = 0;
  for (const it of items) {
    if (!it || !it.label) continue;
    const value = Array.isArray(it.value) ? it.value.filter(Boolean) : it.value;
    if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)) continue;
    if (typeof value === 'string' && value.length > 300) continue;
    const key = memoryKey(it.label);
    if (!key || key.length < 3) continue;
    const prev = mem.items[key];
    mem.items[key] = {
      label: String(it.label).slice(0, 300),
      value,
      kind: it.kind || prev?.kind || '',
      count: (prev?.count || 0) + 1,
      lastUsedAt: now(),
      lastCompany: source.company || prev?.lastCompany || '',
    };
    added++;
  }
  writeJson(MEMORY_FILE(), mem);
  return { added, total: Object.keys(mem.items).length };
}

export function deleteFromMemory(key) {
  const mem = getMemory();
  delete mem.items[key];
  writeJson(MEMORY_FILE(), mem);
  return { total: Object.keys(mem.items).length };
}
