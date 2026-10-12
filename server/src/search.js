// Private discovery catalog. No network, AI, or application writes happen here.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from './config.js';
import { writeJson } from './util.js';
import { searchDefaults, validateSettings, externalJobUrl, offerKey, rankOffer, JOB_STATES, isLinkedIn, manualLinks } from '../../extension/search/core.mjs';

const file = () => path.join(DATA_DIR, 'search', 'discovery.json');
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const now = () => new Date().toISOString();
const LIMIT = 3000, MAX_BYTES = 32 * 1024 * 1024;
const FIELDS = { title: 300, company: 200, location: 200, snippet: 4000, description: 20000 };
const SOURCES = ['google', 'manual', 'linkedin-manual'];
const union = (...lists) => [...new Set(lists.flat())];
const validId = id => typeof id === 'string' && /^[a-f0-9]{16}$/.test(id);
function text(value, max) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > max) fail(400, 'Texte de recherche invalide ou trop long.');
  return value.trim().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
}
function read() {
  if (!fs.existsSync(file())) return { schema: 1, settings: null, jobs: [] };
  let state;
  try {
    if (fs.statSync(file()).size > MAX_BYTES) throw new Error();
    state = JSON.parse(fs.readFileSync(file(), 'utf8'));
    if (!state || state.schema !== 1 || !Array.isArray(state.jobs) || state.jobs.length > LIMIT) throw new Error();
    if (state.settings !== null) validateSettings(state.settings);
    const ids = new Set();
    for (const job of state.jobs) {
      if (!job || !validId(job.id) || ids.has(job.id) || !JOB_STATES.includes(job.status)) throw new Error();
      ids.add(job.id);
      if (externalJobUrl(job.url) !== job.url || (job.employerUrl && (externalJobUrl(job.employerUrl) !== job.employerUrl || isLinkedIn(job.employerUrl)))) throw new Error();
      if (!Array.isArray(job.aliases) || !job.aliases.length || job.aliases.length > 20 || job.aliases.some(u => externalJobUrl(u) !== u) || !job.aliases.includes(job.url) || (job.employerUrl && !job.aliases.includes(job.employerUrl))) throw new Error();
      if (!Array.isArray(job.sources) || !job.sources.length || job.sources.some(s => !SOURCES.includes(s))) throw new Error();
      if (!Array.isArray(job.manualFields) || job.manualFields.some(k => !Object.hasOwn(FIELDS, k))) throw new Error();
      if (!Array.isArray(job.queries) || job.queries.length > 12 || job.queries.some(q => typeof q !== 'string' || q.length > 700)) throw new Error();
      if (!Number.isFinite(Date.parse(job.firstSeenAt)) || !Number.isFinite(Date.parse(job.lastSeenAt))) throw new Error();
      for (const [key, max] of Object.entries(FIELDS)) if (typeof job[key] !== 'string' || job[key].length > max) throw new Error();
      job.keys = union(job.aliases.map(offerKey)); // never trust arbitrary stored association keys
    }
  } catch { fail(409, 'Le catalogue de recherche est illisible. Il n’a pas été écrasé.'); }
  return state;
}
function write(state) {
  if (Buffer.byteLength(JSON.stringify(state, null, 2)) > MAX_BYTES) fail(400, 'Le catalogue de recherche est trop volumineux. Supprime des offres.');
  writeJson(file(), state);
}
function record(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) fail(400, 'Lien d’offre invalide.');
  const url = externalJobUrl(item.url), employerUrl = item.employerUrl ? externalJobUrl(item.employerUrl) : '';
  if (employerUrl && isLinkedIn(employerUrl)) fail(400, 'Le lien employeur doit être extérieur à LinkedIn.');
  const source = item.source || 'manual';
  if (!SOURCES.includes(source)) fail(400, 'Source de recherche inconnue.');
  if (source === 'linkedin-manual' && !isLinkedIn(url)) fail(400, 'Le lien LinkedIn manuel doit pointer vers une offre LinkedIn.');
  const aliases = union([url, employerUrl].filter(Boolean));
  const fields = Object.fromEntries(Object.entries(FIELDS).map(([key, max]) => [key, text(item[key], max)]));
  return { url, employerUrl, aliases, keys: union(aliases.map(offerKey)), ...fields,
    sources: [source], queries: source === 'google' && item.query ? [text(item.query, 700)] : [],
    manualFields: source === 'google' ? [] : Object.keys(FIELDS).filter(key => fields[key]),
  };
}
export function getSearch(profile = {}, applications = []) {
  const state = read(), settings = validateSettings(state.settings || searchDefaults(profile));
  const appKeys = new Map();
  for (const app of applications) {
    try { if (!appKeys.has(offerKey(app.job?.url))) appKeys.set(offerKey(app.job.url), { applicationId: app.id, applicationStatus: app.status }); } catch { /* legacy/unusual URLs */ }
  }
  const jobs = state.jobs.map(job => ({ ...job, ...rankOffer(job, settings), ...(job.keys.map(key => appKeys.get(key)).find(Boolean) || {}) }));
  jobs.sort((a, b) => b.score - a.score || b.lastSeenAt.localeCompare(a.lastSeenAt));
  return { settings, jobs };
}
export function saveSearchSettings(input, profile = {}) {
  const state = read();
  state.settings = validateSettings(input, state.settings || searchDefaults(profile));
  write(state);
}
function merge(target, incoming) {
  const aliases = union(target.aliases, incoming.aliases);
  if (aliases.length > 20) fail(400, 'Cette offre contient trop de liens associés.');
  for (const key of Object.keys(FIELDS)) {
    if (incoming[key] && (incoming.manualFields.includes(key) || !target.manualFields.includes(key))) target[key] = incoming[key];
  }
  target.aliases = aliases;
  target.keys = union(aliases.map(offerKey));
  target.sources = union(target.sources, incoming.sources);
  target.queries = union(target.queries, incoming.queries).slice(-12);
  target.manualFields = union(target.manualFields, incoming.manualFields);
  if (incoming.employerUrl) target.employerUrl = incoming.employerUrl;
}
export function addDiscoveries(items) {
  if (!Array.isArray(items) || !items.length || items.length > 100) fail(400, 'Ajoute entre 1 et 100 offres à la fois.');
  const incoming = items.map(record), state = read(); // validate whole batch; only one final atomic write
  let added = 0, updated = 0, merged = 0;
  for (const item of incoming) {
    const keys = new Set(item.keys), matches = new Set();
    // A manual LinkedIn/employer pair may bridge several previously separate rows.
    let changed;
    do {
      changed = false;
      for (const job of state.jobs) if (!matches.has(job) && job.keys.some(key => keys.has(key))) {
        matches.add(job); job.keys.forEach(key => keys.add(key)); changed = true;
      }
    } while (changed);
    if (matches.size) {
      const rows = [...matches].sort((a, b) => a.firstSeenAt.localeCompare(b.firstSeenAt));
      const target = rows[0];
      for (const row of rows.slice(1)) {
        merge(target, row);
        if (JOB_STATES.indexOf(row.status) > JOB_STATES.indexOf(target.status)) target.status = row.status; // hidden > saved > new
        target.firstSeenAt = [target.firstSeenAt, row.firstSeenAt].sort()[0];
        merged++;
      }
      merge(target, item);
      target.lastSeenAt = now();
      state.jobs = state.jobs.filter(job => job === target || !matches.has(job));
      updated++;
    } else {
      if (state.jobs.length >= LIMIT) fail(400, 'Le catalogue contient 3000 offres : supprime des offres avant de continuer.');
      let id = crypto.createHash('sha256').update(item.keys[0]).digest('hex').slice(0, 16);
      while (state.jobs.some(job => job.id === id)) id = crypto.randomBytes(8).toString('hex');
      const stamp = now();
      state.jobs.push({ id, ...item, status: 'new', firstSeenAt: stamp, lastSeenAt: stamp });
      added++;
    }
  }
  write(state);
  return { added, updated, merged };
}
export function importDiscoveries(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'Import de recherche invalide.');
  const items = manualLinks(body.links);
  const details = body.details || {};
  if (typeof details !== 'object' || Array.isArray(details)) fail(400, 'Import de recherche invalide.');
  if (Object.values(details).some(Boolean) && items.length !== 1) fail(400, 'Les détails manuels nécessitent une seule offre.');
  if (items.length === 1) for (const key of [...Object.keys(FIELDS), 'employerUrl']) if (details[key] !== undefined && details[key] !== '') items[0][key] = details[key];
  return addDiscoveries(items);
}
export function updateDiscovery(id, values) {
  if (!validId(id)) fail(400, 'Identifiant d’offre invalide.');
  if (!values || typeof values !== 'object' || Array.isArray(values) || Object.keys(values).some(k => k !== 'status') || !JOB_STATES.includes(values.status)) fail(400, 'Statut de recherche invalide.');
  const state = read(), job = state.jobs.find(item => item.id === id);
  if (!job) fail(404, 'Offre du catalogue introuvable.');
  job.status = values.status;
  write(state);
}
export function deleteDiscovery(id) {
  if (!validId(id)) fail(400, 'Identifiant d’offre invalide.');
  const state = read(), length = state.jobs.length;
  state.jobs = state.jobs.filter(item => item.id !== id);
  if (state.jobs.length === length) fail(404, 'Offre du catalogue introuvable.');
  write(state);
}
