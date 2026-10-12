import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  CONFIG_FILE,
  DATA_DIR,
  PROFILE_FILE,
  ROOT,
  ensureUserFiles,
  getConfig,
  getProfile,
  profileWarnings,
} from './config.js';
import { getCvText, listCvs, publicCv, recommendCv } from './cvs.js';
import { askJson, cancelAllPi, resolvePi } from './llm.js';
import { translate } from '../../extension/sidepanel/i18n.mjs';
import { editableProfile, updateProfile } from './profile.js';
import { detectRequirements, transcriptPath } from './requirements.js';
import { letterFileName, letterPlainText, renderLetterHtml } from './letter.js';
import { closeBrowser, findChrome, htmlToPdf } from './pdf.js';
import { buildAnswersPrompt, buildLetterPrompt } from './prompts.js';
import {
  STATUSES,
  addToMemory,
  appDir,
  createApplication,
  deleteApplication,
  deleteFromMemory,
  getApplication,
  getMemory,
  journalCsv,
  listApplications,
  saveApplication,
  summary,
} from './store.js';
import { detectLanguage, ensureDir, escapeHtml, safeFileName, writeText } from './util.js';

const require = createRequire(import.meta.url);
const VERSION = require('../package.json').version;
const en = (source) => translate(source, 'en');

// ---------------------------------------------------------------------------
// Mini-routeur
// ---------------------------------------------------------------------------
const routes = [];
function route(method, pattern, handler) {
  const re = new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`);
  routes.push({ method, re, handler });
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const MAX_BODY = 12 * 1024 * 1024;

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'Requête trop volumineuse'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new HttpError(400, 'JSON invalide'));
      }
    });
    req.on('error', reject);
  });
}

/** Protection : seulement localhost, et seulement l'extension (pas les sites web). */
function securityError(req) {
  const host = String(req.headers.host || '').toLowerCase();
  if (!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host)) return 'Hôte refusé';
  const origin = req.headers.origin;
  if (origin && !/^chrome-extension:\/\/[a-p]{32}$/.test(origin) && !/^moz-extension:\/\//.test(origin)) {
    return `Origine refusée (${origin})`;
  }
  return null;
}

function setCors(req, res) {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    res.setHeader('Access-Control-Max-Age', '600');
  }
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function sendFile(res, file, { type, downloadName, inline = true }) {
  if (!fs.existsSync(file)) throw new HttpError(404, 'Fichier introuvable');
  const name = downloadName || path.basename(file);
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${name.replace(/[^\w.-]/g, '_')}"`,
    'Cache-Control': 'no-store',
  });
  fs.createReadStream(file).pipe(res);
}

function fileAsBase64(file, name) {
  if (!fs.existsSync(file)) throw new HttpError(404, 'Fichier introuvable');
  const buf = fs.readFileSync(file);
  return { name: name || path.basename(file), size: buf.length, type: 'application/pdf', base64: buf.toString('base64') };
}

// ---------------------------------------------------------------------------
// Helpers métier
// ---------------------------------------------------------------------------
function loadStyleRefs(cfg) {
  const dir = cfg.styleDir;
  if (!dir || !fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /\.(txt|md)$/i.test(f))
    .sort()
    .slice(0, 3)
    .map((f) => ({ name: f, text: fs.readFileSync(path.join(dir, f), 'utf8').trim() }))
    .filter((r) => r.text);
}

/** Nom neutre du CV joint aux formulaires (fill.cvFileName), pour ne pas exposer le nom d'une variante. */
function cvUploadName(cv) {
  const pattern = getConfig().fill?.cvFileName;
  if (!pattern) return cv.file;
  let id = {};
  try {
    id = getProfile().identity || {};
  } catch {
    /* profil illisible : nom d'origine */
  }
  if (!id.firstName && !id.lastName) return cv.file;
  const name = String(pattern)
    .replace(/\{first\}/g, safeFileName(id.firstName || '', 30))
    .replace(/\{last\}/g, safeFileName(id.lastName || '', 30))
    .replace(/\{lang\}/g, String(cv.language || '').toUpperCase())
    .replace(/_+/g, '_')
    .replace(/^_|_(?=\.pdf$)/gi, '');
  return /\.pdf$/i.test(name) ? name : `${name}.pdf`;
}

function requirementsFor(app) {
  try {
    return detectRequirements(app.job, getProfile());
  } catch {
    return [];
  }
}

function appForClient(app) {
  const { job, ...rest } = app;
  return { ...rest, job: { ...job, descriptionLength: (job?.description || '').length, description: undefined } };
}

async function renderLetterFiles(app, letter, profile, cfg) {
  const dir = ensureDir(appDir(app.id));
  const fileName = letterFileName({
    profile,
    cfg,
    language: letter.language,
    company: letter.company || app.job.company,
    title: app.job.title,
  });
  const html = renderLetterHtml({ letter, profile, cfg, job: app.job });
  writeText(path.join(dir, 'letter.html'), html);
  const tmp = path.join(dir, `.rendu-${Date.now()}.pdf`);
  const fit = await htmlToPdf(html, tmp, { cfg });
  const target = path.join(dir, fileName);
  try {
    fs.rmSync(target, { force: true });
    fs.renameSync(tmp, target);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw new HttpError(409, `Impossible d’écrire ${fileName} (${e.code}). Ferme le PDF s’il est ouvert dans un lecteur.`);
  }
  if (app.letter?.fileName && app.letter.fileName !== fileName) {
    fs.rmSync(path.join(dir, app.letter.fileName), { force: true });
  }
  writeText(path.join(dir, 'letter.txt'), letterPlainText({ letter, profile }));
  letter.fileName = fileName;
  letter.fit = fit;
  app.letter = letter;
  return letter;
}

function cleanList(x, max = 8) {
  return (Array.isArray(x) ? x : [])
    .map((s) => String(s ?? '').trim())
    .filter(Boolean)
    .slice(0, max);
}

function sanitizeFields(fields) {
  return (Array.isArray(fields) ? fields : []).slice(0, 80).map((f) => ({
    id: String(f.id || '').slice(0, 80),
    label: String(f.label || '').slice(0, 400),
    kind: String(f.kind || '').slice(0, 30),
    required: !!f.required,
    multiple: !!f.multiple,
    section: f.section ? String(f.section).slice(0, 200) : undefined,
    hint: f.hint ? String(f.hint).slice(0, 200) : undefined,
    maxLength: Number(f.maxLength) > 0 ? Number(f.maxLength) : undefined,
    options: Array.isArray(f.options) && f.options.length ? f.options.slice(0, 80).map((o) => String(o).slice(0, 200)) : undefined,
  }));
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
route('GET', '/health', () => {
  const cfg = getConfig();
  let profile = null;
  let profileError = null;
  try {
    profile = getProfile();
  } catch (e) {
    profileError = e.message;
  }
  const { cvs, error: cvError } = listCvs(cfg);
  return {
    ok: true,
    version: VERSION,
    root: ROOT,
    dataDir: DATA_DIR,
    configFile: CONFIG_FILE,
    profileFile: PROFILE_FILE,
    profileLoaded: !!profile && Object.keys(profile).length > 0,
    profileError,
    warnings: profile ? profileWarnings(profile) : [],
    cvDir: cfg.cvDir,
    cvCount: cvs.length,
    cvError: cvError || null,
    pi: resolvePi(cfg).desc,
    chrome: findChrome(cfg),
    fill: cfg.fill,
    documents: { transcript: !!(profile && transcriptPath(profile)) },
  };
});

/** Relevé de notes configuré dans le profil (documents.transcript) : joint aux champs « relevé ». */
route('GET', '/documents/transcript', ({ query, res }) => {
  const file = transcriptPath(getProfile());
  if (!file) throw new HttpError(404, 'Aucun relevé de notes configuré : Profil → Documents');
  if (query.get('base64')) return fileAsBase64(file, path.basename(file));
  sendFile(res, file, { type: 'application/pdf', downloadName: path.basename(file) });
  return undefined;
});

route('GET', '/profile', () => editableProfile());
route('PUT', '/profile', ({ body }) => updateProfile(body));

route('GET', '/cvs', () => {
  const { cvs, error } = listCvs(getConfig());
  return { cvs: cvs.map(publicCv), error: error || null };
});

route('GET', '/cvs/:id/pdf', ({ params, query, res }) => {
  const { cvs } = listCvs(getConfig());
  const cv = cvs.find((c) => c.id === params.id);
  if (!cv) throw new HttpError(404, `CV introuvable : ${params.id}`);
  if (query.get('base64')) return fileAsBase64(cv.pdfPath, cvUploadName(cv));
  sendFile(res, cv.pdfPath, { type: 'application/pdf', downloadName: cv.file });
  return undefined;
});

route('GET', '/applications', () => ({ applications: listApplications().map(summary), statuses: STATUSES }));

route('POST', '/applications', ({ body }) => {
  const job = body.job || {};
  if (!job.title && !job.description) throw new HttpError(400, 'Offre vide : rien à analyser sur cette page');
  if (!job.language) job.language = detectLanguage(job.description || job.title || '');
  const { cvs } = listCvs(getConfig());
  const rec = recommendCv(cvs, job);
  const { app, existed } = createApplication({ job, cvId: body.cvId || rec?.cvId || null, force: !!body.force });
  return { application: appForClient(app), existed, recommendation: rec, requirements: requirementsFor(app) };
});

route('GET', '/applications/:id', ({ params }) => {
  const app = getApplication(params.id);
  const { cvs } = listCvs(getConfig());
  return { application: appForClient(app), recommendation: recommendCv(cvs, app.job), requirements: requirementsFor(app) };
});

route('PATCH', '/applications/:id', ({ params, body }) => {
  const app = getApplication(params.id);
  if (body.cvId !== undefined) app.cvId = body.cvId || null;
  if (body.notes !== undefined) app.notes = String(body.notes).slice(0, 5000);
  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status)) throw new HttpError(400, `Statut inconnu : ${body.status}`);
    app.status = body.status;
    if (body.status === 'en cours') app.submittedAt = null; // annuler un marquage erroné, pas une soumission au site
    if (body.status === 'soumise' && !app.submittedAt) app.submittedAt = new Date().toISOString();
  }
  if (body.job && typeof body.job === 'object') {
    for (const k of ['title', 'company', 'location', 'language', 'url']) {
      if (typeof body.job[k] === 'string') app.job[k] = body.job[k];
    }
  }
  saveApplication(app);
  return { application: appForClient(app) };
});

route('DELETE', '/applications/:id', ({ params }) => {
  deleteApplication(params.id);
  return { ok: true };
});

route('POST', '/applications/:id/letter', async ({ params, body }) => {
  const cfg = getConfig();
  const profile = getProfile();
  const app = getApplication(params.id);
  const { cvs } = listCvs(cfg);
  const cvId = body.cvId || app.cvId || recommendCv(cvs, app.job)?.cvId;
  const cv = cvs.find((c) => c.id === cvId) || null;
  const prompt = buildLetterPrompt({
    job: app.job,
    profile,
    cv,
    cvText: cv ? getCvText(cv) : '',
    styleRefs: loadStyleRefs(cfg),
    language: body.language,
    uiLanguage: body.uiLanguage,
    instructions: String(body.instructions || '').slice(0, 2000),
    cfg,
  });
  const { data, ms, runner } = await askJson(prompt, { cfg, thinking: cfg.llm.letterThinking });
  if (!data || typeof data.body !== 'string' || data.body.trim().length < 200) {
    throw new HttpError(502, 'pi a renvoyé une lettre vide ou incomplète, réessaie');
  }
  const language = ['fr', 'en'].includes(body.language) ? body.language : data.language === 'en' ? 'en' : 'fr';
  const letter = {
    language,
    subject: String(data.subject || '').replace(/^\s*(objet|subject|re)\s*:\s*/i, '').trim(),
    body: data.body.trim(),
    recipient: String(data.recipient || '').trim(),
    company: String(data.company || app.job.company || '').trim(),
    jobTitle: String(data.jobTitle || app.job.title || '').trim(),
    location: String(data.location || app.job.location || '').trim(),
    highlights: cleanList(data.highlights),
    warnings: cleanList(data.warnings),
    cvId,
    instructions: body.instructions || '',
    generatedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    generationMs: ms,
    generator: runner,
  };
  if (!app.job.company && letter.company) app.job.company = letter.company;
  if (!app.job.title && letter.jobTitle) app.job.title = letter.jobTitle;
  app.cvId = cvId;
  await renderLetterFiles(app, letter, profile, cfg);
  saveApplication(app);
  return { application: appForClient(app), letter: app.letter };
});

route('PUT', '/applications/:id/letter', async ({ params, body }) => {
  const cfg = getConfig();
  const profile = getProfile();
  const app = getApplication(params.id);
  const prev = app.letter || {};
  const text = typeof body.body === 'string' ? body.body : prev.body;
  if (!text || !text.trim()) throw new HttpError(400, 'Le corps de la lettre est vide');
  const letter = {
    ...prev,
    language: ['fr', 'en'].includes(body.language) ? body.language : prev.language || 'fr',
    subject: typeof body.subject === 'string' ? body.subject.trim() : prev.subject || '',
    body: text.trim(),
    recipient: typeof body.recipient === 'string' ? body.recipient.trim() : prev.recipient || '',
    company: typeof body.company === 'string' ? body.company.trim() : prev.company || app.job.company,
    updatedAt: new Date().toISOString(),
  };
  await renderLetterFiles(app, letter, profile, cfg);
  saveApplication(app);
  return { application: appForClient(app), letter: app.letter };
});

route('GET', '/applications/:id/letter.pdf', ({ params, query, res }) => {
  const app = getApplication(params.id);
  if (!app.letter?.fileName) throw new HttpError(404, 'Aucune lettre générée pour cette candidature');
  const file = path.join(appDir(app.id), app.letter.fileName);
  if (query.get('base64')) return fileAsBase64(file, app.letter.fileName);
  sendFile(res, file, { type: 'application/pdf', downloadName: app.letter.fileName, inline: !query.get('download') });
  return undefined;
});

route('GET', '/applications/:id/letter.txt', ({ params, res }) => {
  const app = getApplication(params.id);
  sendFile(res, path.join(appDir(app.id), 'letter.txt'), { type: 'text/plain; charset=utf-8' });
  return undefined;
});

route('POST', '/answers', async ({ body, res }) => {
  const cfg = getConfig();
  const profile = getProfile();
  const fields = sanitizeFields(body.fields).filter((f) => f.id && f.label);
  if (!fields.length) return { answers: {}, ms: 0 };
  let app = null;
  if (body.applicationId) {
    try {
      app = getApplication(body.applicationId);
    } catch {
      app = null;
    }
  }
  const job = app?.job || body.job || {};
  const { cvs } = listCvs(cfg);
  const cv = cvs.find((c) => c.id === (app?.cvId || body.cvId)) || null;
  const prompt = buildAnswersPrompt({
    fields,
    job,
    profile,
    cvText: cv ? getCvText(cv) : '',
    letter: app?.letter,
    memory: getMemory(),
    uiLanguage: body.uiLanguage,
  });
  // Closing the panel or aborting fetch must also stop the owned pi process.
  const controller = new AbortController();
  const disconnect = () => { if (!res.writableEnded) controller.abort(); };
  res.once('close', disconnect);
  if (res.destroyed) controller.abort();
  let reply;
  try {
    reply = await askJson(prompt, { cfg, thinking: cfg.llm.answersThinking, signal: controller.signal });
  } finally {
    res.off('close', disconnect);
  }
  const { data, ms } = reply;
  const ids = new Set(fields.map((f) => f.id));
  const answers = {};
  for (const [id, a] of Object.entries(data?.answers || {})) {
    if (!ids.has(id) || !a || typeof a !== 'object') continue;
    answers[id] = {
      value: a.value ?? null,
      confidence: Math.max(0, Math.min(1, Number(a.confidence) || 0)),
      note: String(a.note || '').slice(0, 300),
    };
  }
  return { answers, ms };
});

route('GET', '/memory', () => getMemory());

route('POST', '/memory', ({ body }) => addToMemory(Array.isArray(body.items) ? body.items.slice(0, 200) : [], { company: body.company }));

route('DELETE', '/memory/:key', ({ params }) => deleteFromMemory(decodeURIComponent(params.key)));

route('GET', '/journal.csv', ({ res }) => {
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': 'attachment; filename="candidatures.csv"',
    'Cache-Control': 'no-store',
  });
  res.end(journalCsv());
  return undefined;
});

route('GET', '/', ({ res }) => {
  const cfg = getConfig();
  const { cvs, error } = listCvs(cfg);
  const apps = listApplications();
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>ApplyPilot v${VERSION}</title>
<style>body{font:14px/1.5 'Segoe UI',system-ui,sans-serif;max-width:760px;margin:40px auto;padding:0 16px;color:#1f2328}code{background:#f3f4f6;padding:1px 5px;border-radius:4px}li{margin:2px 0}</style></head>
<body><h1>ApplyPilot <small>v${VERSION}</small> ✓</h1><p>The local server is running. Use the Chrome extension to apply.</p>
<ul><li>Profile: <code>${escapeHtml(PROFILE_FILE)}</code></li>
<li>CVs (${cvs.length}): <code>${escapeHtml(cfg.cvDir || 'not configured')}</code>${error ? ` — ⚠️ ${escapeHtml(en(error))}` : ''}</li>
<li>Applications: ${apps.length} — <a href="/journal.csv">export tracker (CSV)</a></li>
<li>pi: <code>${escapeHtml(resolvePi(cfg).desc)}</code></li>
<li>Chrome (PDF): <code>${escapeHtml(findChrome(cfg) || 'not found')}</code></li></ul>
<h2>Install or reload the extension in your usual browser</h2>
<ol><li>Open <code>chrome://extensions</code> and enable Developer mode.</li>
<li>Click <b>Load unpacked</b> and select <code>${escapeHtml(path.join(ROOT, 'extension'))}</code>, not the project root. If already installed, click its reload button.</li>
<li>Pin <b>ApplyPilot</b> in the <b>Extensions (🧩)</b> menu, then click its icon.</li>
<li>Edit contact details and availability in <b>Profile</b>. Choose <b>English / Français</b> below the header; this never changes the language of your letters or form answers.</li></ol>
<p><b>Apply / sign in</b> reuses valid Workday sessions and already open forms. Chrome manages passwords; CAPTCHA, MFA and submission remain manual.</p>
<p><b>Stop</b> cancels pending autofill and pi answers. Existing entries are preserved. After an update, reload ApplyPilot and reopen its panel — <b>do not reload an unsaved Workday form</b>.</p>
</body></html>`;
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
  return undefined;
});

// ---------------------------------------------------------------------------
// Serveur
// ---------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const started = Date.now();
  const url = new URL(req.url, 'http://127.0.0.1');
  let status = 200;
  try {
    const denied = securityError(req);
    if (denied) throw new HttpError(403, denied);
    setCors(req, res);
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    const match = routes.find((r) => r.method === req.method && r.re.test(url.pathname));
    if (!match) throw new HttpError(404, `Route inconnue : ${req.method} ${url.pathname}`);
    const params = Object.fromEntries(
      Object.entries(url.pathname.match(match.re).groups || {}).map(([k, v]) => [k, decodeURIComponent(v)]),
    );
    const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};
    const result = await match.handler({ req, res, params, query: url.searchParams, body });
    if (result !== undefined && !res.headersSent && !res.destroyed) sendJson(res, 200, result);
  } catch (e) {
    status = e.status || 500;
    if (status >= 500) console.error(`[error] ${req.method} ${url.pathname}:`, en(e.message));
    if (!res.headersSent && !res.destroyed) sendJson(res, status, { error: e.message || String(e) });
    else if (!res.destroyed) res.end();
  } finally {
    if (url.pathname !== '/health') {
      console.log(`${new Date().toLocaleTimeString('en-CA')} ${req.method} ${url.pathname} → ${status} (${Date.now() - started} ms)`);
    }
  }
});
server.requestTimeout = 15 * 60 * 1000;
server.headersTimeout = 60 * 1000;

const created = ensureUserFiles();
const cfg = getConfig();
ensureDir(DATA_DIR);

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`Port ${cfg.server.port} is already in use. ApplyPilot may already be running (http://127.0.0.1:${cfg.server.port}).`);
  } else {
    console.error(e);
  }
  process.exit(1);
});

server.listen(cfg.server.port, cfg.server.host, () => {
  const { cvs, error } = listCvs(cfg);
  let warnings = [];
  try {
    warnings = profileWarnings(getProfile());
  } catch (e) {
    warnings = [{ label: e.message }];
  }
  console.log(`\n  ApplyPilot ${VERSION} — http://${cfg.server.host}:${cfg.server.port}`);
  for (const f of created) console.log(`  + created: ${f} (complete your details)`);
  console.log(`  Profile : ${PROFILE_FILE}`);
  console.log(`  CVs     : ${cvs.length} found in ${cfg.cvDir || '(not configured)'}${error ? `  ⚠️  ${en(error)}` : ''}`);
  console.log(`  pi      : ${resolvePi(cfg).desc}`);
  console.log(`  Chrome  : ${findChrome(cfg) || 'not found (PDF unavailable)'}`);
  if (warnings.length) console.log(`  Complete your profile: ${warnings.map((w) => en(w.label)).join(', ')}`);
  console.log('\n  Keep this window open while applying. Ctrl+C to stop.\n');
});

async function shutdown() {
  cancelAllPi();
  await closeBrowser();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
