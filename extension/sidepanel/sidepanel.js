// ApplyPilot — panneau latéral : candidature active, lettre, remplissage, journal, profil.
import { applicationUrl, existingApplicationTab } from './navigation.mjs';
import { chooseLanguage, translate } from './i18n.mjs';
import { createSearchPanel } from '../search/panel.mjs';
import { isDiscoveryPage, isLinkedIn } from '../search/core.mjs';
const CONTENT_FILES = [
  'i18n.js',
  'content/dom.js',
  'content/extract.js',
  'content/fields.js',
  'content/widgets.js',
  'content/mapping.js',
  'content/workday.js',
  'content/main.js',
];
const VERSION = chrome.runtime.getManifest().version;
const DEFAULT_SERVER = 'http://127.0.0.1:4317';
const STATUS_LABEL = {
  'en cours': 'En cours',
  soumise: 'Soumise',
  entrevue: 'Entrevue',
  refusée: 'Refusée',
  offre: 'Offre 🎉',
  abandonnée: 'Abandonnée',
};
const PLATFORM_LABEL = {
  workday: 'Workday',
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  ashby: 'Ashby',
  smartrecruiters: 'SmartRecruiters',
  icims: 'iCIMS',
  taleo: 'Taleo',
  successfactors: 'SuccessFactors',
  jobvite: 'Jobvite',
  workable: 'Workable',
  bamboohr: 'BambooHR',
  generic: 'Site carrière',
};

const S = {
  server: DEFAULT_SERVER,
  uiLanguage: 'en',
  serverDraft: null,
  letterInstructions: '',
  profileResponse: null,
  health: null,
  serverError: '',
  cvs: [],
  apps: [],
  statuses: Object.keys(STATUS_LABEL),
  app: null,
  recommendation: null,
  draft: null,
  page: null,
  pageError: '',
  prefs: { useAi: true, overwrite: false, addEntries: true, letterLang: 'auto' },
  letterBusy: false,
  letterT0: 0,
  fillBusy: false,
  fillPhase: '',
  fillRun: null,
  fill: null,
  memory: null,
  profile: null,
  profileRevision: null,
  profileFields: [],
  profileDraft: {},
  profileBusy: false,
  tab: 'app',
};

const $ = (sel) => document.querySelector(sel);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const tr = (source, values = {}) => translate(source, S.uiLanguage, values);
const statusLabel = (status) => tr(STATUS_LABEL[status] || status);
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString(S.uiLanguage === 'fr' ? 'fr-CA' : 'en-CA', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

const searchPanel = createSearchPanel({ element: $('#tab-search'), stopButton: $('#headerSearchStop'), api, tr, esc, fmtDate, toast,
  canStart: () => !S.fillBusy,
  activateApplication: async id => {
    if (id === S.app?.id) return switchTab('app'); // resume without reloading its unsaved letter
    if ((S.draftDirty || S.letterInstructions) && !confirm(tr('Changer de candidature et abandonner le brouillon de lettre non enregistré ?'))) return;
    await setActiveApp(id); S.draftDirty = false; switchTab('app');
  },
});

function renderShell() {
  document.documentElement.lang = S.uiLanguage;
  $('#appVersion').textContent = `v${VERSION}`;
  $('#appVersion').title = `${tr('Version de l’extension')} ${VERSION}`;
  $('#uiLanguage').value = S.uiLanguage;
  $('#uiLanguageLabel').textContent = tr('Langue de l’interface');
  $('#serverStatus').title = `${tr('Revérifier la connexion au serveur')} · ${tr('Serveur')} v${S.health?.version || '—'}`;
  for (const [tab, label] of [['app', 'Candidature'], ['search', 'Recherche'], ['journal', 'Journal'], ['profile', 'Profil']]) {
    $(`[data-tab="${tab}"]`).textContent = tr(label);
  }
}

async function setUiLanguage(language) {
  if (!['fr', 'en'].includes(language)) return;
  // A language switch only redraws labels. No API write, navigation or draft reset.
  if ($('#letterInstructions')) S.letterInstructions = $('#letterInstructions').value;
  if ($('#serverUrl')) S.serverDraft = $('#serverUrl').value;
  const details = [...document.querySelectorAll('main details')].map((el) => el.open);
  S.uiLanguage = language;
  await chrome.storage.local.set({ uiLanguage: language });
  renderShell();
  renderStatus();
  renderApp();
  renderJournal();
  searchPanel.render();
  if (S.tab === 'profile') await renderProfile({ refresh: false });
  document.querySelectorAll('main details').forEach((el, i) => { if (i < details.length) el.open = details[i]; });
  $('#toast').className = 'toast';
}

let toastTimer = null;
function toast(msg, type = '') {
  const t = $('#toast');
  t.textContent = tr(msg);
  t.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = 'toast'), type === 'error' ? 6000 : 3000);
}

// ---------------------------------------------------------------------------
// Serveur local
// ---------------------------------------------------------------------------
async function api(path, { method = 'GET', body, signal } = {}) {
  let res;
  try {
    res = await fetch(S.server + path, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (error) {
    if (signal?.aborted || error.name === 'AbortError') throw error;
    S.health = null;
    renderStatus();
    throw new Error('Serveur ApplyPilot injoignable : lance start.cmd');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Erreur ${res.status}`), { status: res.status });
  return data;
}

async function checkServer() {
  try {
    S.health = await api('/health');
    S.serverError = '';
    const [{ cvs }, { applications, statuses }] = await Promise.all([api('/cvs'), api('/applications')]);
    S.cvs = cvs;
    S.apps = applications;
    if (statuses) S.statuses = statuses;
  } catch (e) {
    S.health = null;
    S.serverError = e.message;
  }
  renderShell();
  renderStatus();
}

async function loadApps() {
  const { applications } = await api('/applications');
  S.apps = applications;
}

// ---------------------------------------------------------------------------
// Onglet actif et scripts de contenu
// ---------------------------------------------------------------------------
async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

const scriptable = (url) => /^https?:\/\//.test(url || '') && !isDiscoveryPage(url) && !/^https:\/\/(chrome\.google\.com\/webstore|chromewebstore\.google\.com)/.test(url);

async function exec(tabId, cmd, payload, frameIds) {
  const res = await chrome.scripting.executeScript({
    target: frameIds ? { tabId, frameIds } : { tabId, allFrames: true },
    func: (c, p) => {
      if (/(^|\.)linkedin\.com\.?$|(^|\.)google\.(com|ca|fr|co\.uk)\.?$/.test(location.hostname)) return null;
      return globalThis.__applyPilot ? globalThis.__applyPilot.run(c, p) : null;
    },
    args: [cmd, payload],
  });
  return res.map((r) => (r.result && r.result.__ap ? { frameId: r.frameId, ...r.result } : null)).filter(Boolean);
}

async function runInTab(cmd, payload = {}, { tabId } = {}) {
  const tab = tabId == null ? await activeTab() : await chrome.tabs.get(tabId);
  if (!tab || !scriptable(tab.url)) throw new Error('Ouvre une offre ou un formulaire de candidature (page web).');
  // Filter every frame, not only the top URL. Bind reinjection to the probed
  // document so a navigation cannot turn a permitted frame into LinkedIn/Google.
  const probes = await chrome.scripting.executeScript({
    target: { tabId: tab.id, allFrames: true },
    func: async () => {
      if (/(^|\.)linkedin\.com\.?$|(^|\.)google\.(com|ca|fr|co\.uk)\.?$/.test(location.hostname)) return null;
      return { version: (await globalThis.__applyPilot?.run('ping', {}))?.version || '' };
    },
  });
  const outdated = probes.filter(frame => frame.result && frame.result.version !== VERSION);
  if (outdated.length) {
    const documentIds = outdated.map(frame => frame.documentId);
    if (documentIds.some(id => !id)) throw new Error('Impossible d’accéder à la page : ferme et rouvre le panneau, puis réessaie sans recharger ton formulaire.');
    await chrome.scripting.executeScript({ target: { tabId: tab.id, documentIds }, files: CONTENT_FILES });
  }
  const frames = await exec(tab.id, cmd, payload);
  if (!frames.length) throw new Error('Impossible d’accéder à la page : ferme et rouvre le panneau, puis réessaie sans recharger ton formulaire.');
  const ok = frames.filter((f) => !f.error);
  if (!ok.length) throw new Error(String(frames[0].error).split('\n')[0]);
  return ok;
}

let pageTimer = null;
function schedulePageRefresh(delay = 400) {
  clearTimeout(pageTimer);
  pageTimer = setTimeout(refreshPage, delay);
}

async function refreshPage() {
  const tab = await activeTab();
  if (!tab || !scriptable(tab.url)) {
    S.page = null;
    S.pageError = isLinkedIn(tab?.url) ? 'LinkedIn reste manuel : utilise Recherche pour importer un lien ou ouvrir le site employeur.' : 'Ouvre une offre de stage ou un formulaire de candidature.';
    renderPage();
    return;
  }
  try {
    const frames = await runInTab('detect');
    const top = frames.find((f) => f.isTop) || frames[0];
    const posting = frames.find((f) => f.isPosting);
    S.page = {
      ...top,
      isPosting: !!posting,
      title: posting?.title || top.title,
      company: posting?.company || top.company,
      jobKey: posting?.jobKey || top.jobKey,
      platform: frames.find((f) => f.platform !== 'generic')?.platform || top.platform,
      fieldCount: frames.reduce((n, f) => n + (f.fieldCount || 0), 0),
      fileCount: frames.reduce((n, f) => n + (f.fileCount || 0), 0),
      step: frames.find((f) => f.step)?.step || null,
    };
    S.pageError = '';
    if (S.fillRun && (tab.id !== S.fillRun.tabId || S.fillRun.pages?.some((old) => {
      const current = frames.find((f) => f.frameId === old.frameId);
      return !current || current.pageIdentity !== old.pageIdentity;
    }))) stopFill({ pageChanged: true });
    const match = S.apps.find((a) => a.jobKey && a.jobKey === S.page.jobKey);
    if (match && match.id !== S.app?.id && !S.draftDirty && !S.letterInstructions) await setActiveApp(match.id, { quiet: true });
  } catch (e) {
    S.page = null;
    S.pageError = e.message;
  }
  renderPage();
  renderAppCard();
}

// ---------------------------------------------------------------------------
// Candidatures
// ---------------------------------------------------------------------------
async function setActiveApp(id, { quiet = false } = {}) {
  if (S.fillRun) stopFill();
  S.letterInstructions = '';
  if (!id) {
    S.app = null;
    S.draft = null;
    S.fill = null;
    await chrome.storage.local.remove(['activeAppId', 'activeAppCompany']);
    renderApp();
    return;
  }
  const { application, recommendation, requirements } = await api(`/applications/${encodeURIComponent(id)}`);
  S.app = application;
  S.recommendation = recommendation;
  S.requirements = requirements || [];
  S.draft = application.letter ? { subject: application.letter.subject, body: application.letter.body } : null;
  S.fill = null;
  await chrome.storage.local.set({ activeAppId: id, activeAppCompany: application.job?.company || '' });
  renderApp();
  if (!quiet) toast(tr('Candidature active : {name}', { name: application.job?.company || application.job?.title }));
}

async function analyze() {
  const frames = await runInTab('extractJob');
  const jobs = frames
    .map((f) => f.job)
    .filter(Boolean)
    .sort((a, b) => Number(b.isPosting) - Number(a.isPosting) || (b.description?.length || 0) - (a.description?.length || 0));
  const job = jobs[0];
  if (!job || (!job.title && !job.description)) throw new Error('Aucune offre détectée sur cette page.');
  const { application, existed, recommendation, requirements } = await api('/applications', { method: 'POST', body: { job } });
  await loadApps();
  await setActiveApp(application.id, { quiet: true });
  S.recommendation = recommendation;
  S.requirements = requirements || S.requirements || [];
  renderAppCard();
  toast(existed ? 'Offre déjà connue : candidature reprise' : 'Offre analysée ✓');
}

async function patchApp(body) {
  const { application } = await api(`/applications/${encodeURIComponent(S.app.id)}`, { method: 'PATCH', body });
  S.app = application;
  await loadApps();
  return application;
}

// ---------------------------------------------------------------------------
// Lettre
// ---------------------------------------------------------------------------
let tickTimer = null;
async function generateLetter() {
  if (!S.app) return;
  S.letterBusy = true;
  S.letterT0 = Date.now();
  renderLetter();
  clearInterval(tickTimer);
  tickTimer = setInterval(() => {
    const el = $('#letterTimer');
    if (el) el.textContent = `${Math.round((Date.now() - S.letterT0) / 1000)} s`;
  }, 1000);
  try {
    const instructions = $('#letterInstructions')?.value || '';
    const { application, letter } = await api(`/applications/${encodeURIComponent(S.app.id)}/letter`, {
      method: 'POST',
      body: { language: S.prefs.letterLang, instructions, cvId: S.app.cvId, uiLanguage: S.uiLanguage },
    });
    S.app = application;
    S.draft = { subject: letter.subject, body: letter.body };
    await loadApps();
    toast('Lettre générée ✓ — relis-la avant d’envoyer');
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    clearInterval(tickTimer);
    S.letterBusy = false;
    renderLetter();
  }
}

async function saveLetter() {
  if (!S.app || !S.draft) return;
  const { application } = await api(`/applications/${encodeURIComponent(S.app.id)}/letter`, {
    method: 'PUT',
    body: { subject: S.draft.subject, body: S.draft.body },
  });
  S.app = application;
  S.draftDirty = false;
  renderLetter();
  toast('PDF mis à jour ✓');
}

function letterUrl() {
  return `${S.server}/applications/${encodeURIComponent(S.app.id)}/letter.pdf?t=${Date.now()}`;
}

function signature(profile) {
  const id = profile?.identity || {};
  return profile?.letter?.signatureName || [id.firstName, id.lastName].filter(Boolean).join(' ');
}

// ---------------------------------------------------------------------------
// Remplissage
// ---------------------------------------------------------------------------
const abortFillError = () => Object.assign(new Error('Remplissage arrêté'), { name: 'AbortError' });
function assertFill(run) {
  if (S.fillRun !== run || run.controller.signal.aborted) throw abortFillError();
}

function stopFill({ pageChanged = false, timedOut = false } = {}) {
  const run = S.fillRun;
  if (!run) return;
  S.fillRun = null; // Free the UI immediately, even if an injected script is still unwinding.
  clearTimeout(run.answerTimer);
  run.controller.abort();
  if (run.tabId != null) exec(run.tabId, 'cancel', { runId: run.id }, run.pages?.map((p) => p.frameId)).catch(() => {});
  S.fillBusy = false;
  S.fillPhase = '';
  if (pageChanged) S.fill = null;
  renderFill();
  toast(timedOut ? 'pi met trop de temps : remplissage arrêté. Réessaie ou désactive l’IA.' : pageChanged
    ? 'Étape changée : ancien remplissage arrêté. Tu peux remplir cette page.'
    : 'Remplissage arrêté. Les champs déjà remplis sont conservés.');
}

async function execFill(run, cmd, payload) {
  assertFill(run);
  const batches = await Promise.all(run.pages.map((page) => exec(run.tabId, cmd, {
    ...payload, runId: run.id, expectedPage: page.pageIdentity,
  }, [page.frameId])));
  assertFill(run);
  const frames = batches.flat();
  if (frames.some((f) => f.cancelled)) {
    stopFill({ pageChanged: true });
    throw abortFillError();
  }
  if (!frames.length || frames.some((f) => f.error)) throw new Error(frames.find((f) => f.error)?.error || 'Impossible d’accéder à la page : ferme et rouvre le panneau, puis réessaie sans recharger ton formulaire.');
  return frames;
}

async function fillPage() {
  if (S.fillRun) return;
  if (searchPanel.running) return toast('Arrête la recherche avant de lancer le remplissage.', 'error');
  if (!S.health) return toast('Serveur non connecté : lance start.cmd', 'error');
  const run = { id: crypto.randomUUID(), controller: new AbortController(), tabId: null, pages: null };
  S.fillRun = run;
  S.fillBusy = true;
  S.fillPhase = 'Préparation…';
  renderFill();
  const request = (path, options = {}) => { assertFill(run); return api(path, { ...options, signal: run.controller.signal }); };
  try {
    const tab = await activeTab();
    assertFill(run);
    if (!tab || !scriptable(tab.url)) throw new Error('Ouvre une offre ou un formulaire de candidature (page web).');
    run.tabId = tab.id;
    run.pages = await runInTab('detect', {}, { tabId: run.tabId });
    assertFill(run);
    if (S.draftDirty) await saveLetter();
    assertFill(run);
    const [{ profile }, memory] = await Promise.all([request('/profile'), request('/memory')]);
    const files = {};
    if (S.app?.cvId) files.cv = await request(`/cvs/${encodeURIComponent(S.app.cvId)}/pdf?base64=1`);
    if (S.app?.letter?.fileName) files.letter = await request(`/applications/${encodeURIComponent(S.app.id)}/letter.pdf?base64=1`);
    if (S.health?.documents?.transcript) files.transcript = await request('/documents/transcript?base64=1').catch(() => null);
    assertFill(run);
    const letterText = S.app?.letter?.body ? `${S.app.letter.body}\n\n${signature(profile)}` : '';
    const job = S.app ? { ...S.app.job } : { company: S.page?.company || '', title: S.page?.title || '' };
    const payload = {
      profile,
      memory,
      files,
      letterText,
      job,
      options: {
        overwrite: S.prefs.overwrite,
        addEntries: S.prefs.addEntries,
        uiLanguage: S.uiLanguage,
        attachLetterWithCv: S.health?.fill?.attachLetterWithCv !== false,
      },
    };
    S.fillPhase = 'Remplissage de la page…';
    renderFill();
    const frames = await execFill(run, 'fill', payload);
    let results = frames.flatMap((f) => f.results || []);
    const unresolved = frames.flatMap((f) => f.unresolved || []);
    const step = frames.find((f) => f.step)?.step || null;
    const info = frames.find((f) => f.info?.addedEntries)?.info || {};
    S.fill = { results, step, info, at: Date.now(), noCv: !files.cv };
    if (S.prefs.useAi && unresolved.length) {
      S.fillPhase = `pi répond à ${unresolved.length} question${unresolved.length > 1 ? 's' : ''}…`;
      renderFill();
      try {
        run.answerTimer = setTimeout(() => { if (S.fillRun === run) stopFill({ timedOut: true }); }, 90_000);
        const { answers } = await request('/answers', {
          method: 'POST',
          body: { applicationId: S.app?.id, cvId: S.app?.cvId, job: S.app ? undefined : job, fields: unresolved, uiLanguage: S.uiLanguage },
        });
        clearTimeout(run.answerTimer);
        assertFill(run);
        S.fillPhase = 'Application des réponses…';
        renderFill();
        const filled = await execFill(run, 'fillValues', { ...payload, answers });
        const byId = new Map(filled.flatMap((f) => f.results || []).map((r) => [r.id, r]));
        results = results.map((r) => byId.get(r.id) || r);
      } catch (e) {
        assertFill(run);
        if (e.name === 'AbortError') throw e;
        toast(tr('IA : {error}', { error: tr(e.message) }), 'error');
      }
    }
    assertFill(run);
    S.fill = { results, step, info, at: Date.now(), noCv: !files.cv };
  } catch (e) {
    if (S.fillRun === run && e.name !== 'AbortError') toast(e.message, 'error');
  } finally {
    clearTimeout(run.answerTimer);
    if (S.fillRun === run) {
      S.fillRun = null;
      S.fillBusy = false;
      S.fillPhase = '';
      renderFill();
    }
  }
}

async function captureMemory({ quiet = false } = {}) {
  const frames = await runInTab('capture');
  const items = frames.flatMap((f) => f.items || []);
  if (!items.length) {
    if (!quiet) toast('Rien de nouveau à mémoriser sur cette page');
    return 0;
  }
  const r = await api('/memory', { method: 'POST', body: { items, company: S.app?.job?.company || '' } });
  if (!quiet) toast(tr('{count} réponse(s) mémorisée(s) ✓', { count: r.added }));
  return r.added;
}

async function markSubmitted() {
  if (!S.app || !confirm(tr('As-tu déjà envoyé la candidature sur le site de l’employeur et reçu sa confirmation ?\n\nCe bouton met seulement à jour ton journal : il ne soumet pas le formulaire.'))) return;
  try {
    await captureMemory({ quiet: true });
  } catch {
    /* la page a peut-être déjà changé */
  }
  await patchApp({ status: 'soumise' });
  renderApp();
  toast('Candidature marquée comme soumise 🎉');
}

// ---------------------------------------------------------------------------
// Rendu
// ---------------------------------------------------------------------------
function renderStatus() {
  const el = $('#serverStatus');
  const off = $('#offline');
  if (S.health) {
    const mismatch = S.health.version && S.health.version !== VERSION;
    el.className = `status on${mismatch ? ' mismatch' : ''}`;
    el.textContent = mismatch ? tr('Serveur v{version} : à redémarrer', { version: S.health.version }) : tr('Serveur connecté · {count} CV', { count: S.health.cvCount });
    off.classList.add('hidden');
  } else {
    el.className = 'status off';
    el.textContent = tr('Serveur arrêté');
    off.classList.remove('hidden');
    off.innerHTML = `<b>${tr('Le serveur local ne répond pas.')}</b><div class="small">${tr('Double-clique sur')} <span class="kbd">start.cmd</span> ${tr('dans le dossier ApplyPilot, puis')}
      <button class="btn ghost" data-action="recheck">${tr('réessayer')}</button>.</div>`;
  }
}

function renderPage() {
  const el = $('#pageCard');
  if (!S.page) {
    el.innerHTML = `<div class="muted small">${esc(tr(S.pageError || 'Analyse de la page…'))}</div>`;
    return;
  }
  const p = S.page;
  const known = S.apps.find((a) => a.jobKey && a.jobKey === p.jobKey);
  const step = p.step?.name ? ` · ${tr('étape')} ${p.step.index ? `${p.step.index}/${p.step.total} ` : ''}${esc(p.step.name)}` : '';
  let action = '';
  if (p.isPosting && !known) {
    action = `<div class="stack"><div><span class="badge">${tr('Offre détectée')}</span></div>
      <h3>${esc(p.title || tr('Offre sans titre'))}</h3><div class="muted">${esc(p.company || '')}</div>
      <button class="btn primary big" data-action="analyze">${tr('Analyser cette offre')}</button></div>`;
  } else if (p.fieldCount > 0) {
    action = `<div class="small muted">${tr('Formulaire : {count} champ(s)', { count: p.fieldCount })}${p.fileCount ? tr(' + {count} fichier(s)', { count: p.fileCount }) : ''}${step}</div>`;
  } else if (!p.isPosting) {
    action = `<div class="small muted">${tr('Aucune offre ni formulaire détecté ici.')}
      <button class="btn ghost" data-action="analyze">${tr('Analyser quand même')}</button></div>`;
  }
  el.innerHTML = `<h2><span>Page</span><span class="badge grey">${esc(tr(PLATFORM_LABEL[p.platform] || p.platform))}</span></h2>${action}
    ${p.hasPassword ? `<div class="small muted">${tr('🔒 « Remplir cette page » renseigne seulement ton courriel. Utilise Chrome pour le mot de passe ; connexion, CAPTCHA et double authentification restent manuels.')}</div>` : ''}`;
}

/** Exigences repérées dans l'offre (pièces, conditions), comparées au profil. */
function requirementsHtml(reqs) {
  if (!reqs?.length) return '';
  const icon = { ok: '✓', todo: '!', warn: '⚠', info: 'ℹ' };
  const items = reqs
    .map((r) => `<li class="req ${esc(r.status)}" title="${esc(r.excerpt || '')}"><span class="req-icon">${icon[r.status] || '•'}</span>
      <span><b>${esc(tr(r.label))}</b>${r.note ? ` <span class="muted">— ${esc(tr(r.note))}</span>` : ''}</span></li>`)
    .join('');
  const todo = reqs.filter((r) => r.status === 'todo' || r.status === 'warn').length;
  return `<details class="reqs" ${todo ? 'open' : ''}><summary>${tr('À prévoir pour cette offre')}${todo ? ` <span class="badge warn">${todo}</span>` : ''}</summary><ul class="req-list">${items}</ul></details>`;
}

function renderAppCard() {
  const el = $('#appCard');
  if (!S.app) {
    const recent = S.apps.filter((a) => a.status === 'en cours').slice(0, 8);
    el.innerHTML = `<h2>${tr('Candidature active')}</h2>
      <div class="muted small">${tr('Aucune. Ouvre l’offre et clique « Analyser cette offre » : la candidature reste active pendant que tu remplis le formulaire.')}</div>
      ${recent.length ? `<label class="field" style="margin-top:8px">${tr('Reprendre une candidature en cours')}</label>
        <select id="pickApp"><option value="">—</option>${recent.map((a) => `<option value="${esc(a.id)}">${esc(a.company || '?')} — ${esc(a.title || '')}</option>`).join('')}</select>` : ''}`;
    return;
  }
  const a = S.app;
  const rec = S.recommendation;
  const cvOptions = S.cvs
    .map((c) => `<option value="${esc(c.id)}" ${c.id === a.cvId ? 'selected' : ''}>${esc(c.name)}${c.language ? ` (${c.language.toUpperCase()})` : ''}${rec?.cvId === c.id ? ' ★' : ''}</option>`)
    .join('');
  el.innerHTML = `<h2><span>${tr('Candidature active')}</span><span class="badge ${a.status === 'soumise' ? 'ok' : ''}">${esc(statusLabel(a.status))}</span></h2>
    <h3>${esc(a.job?.title || tr('Poste'))}</h3>
    ${requirementsHtml(S.requirements)}
    <div class="muted">${esc(a.job?.company || '')}${a.job?.location ? ` · ${esc(a.job.location)}` : ''}</div>
    <div class="stack" style="margin-top:10px">
      <div><label class="field" for="cvSelect">${tr('CV à joindre')} ${rec?.cvId ? `<span class="muted">${esc(tr('(★ recommandé : {reason})', { reason: tr(rec.reason || '') }))}</span>` : ''}</label>
        <select id="cvSelect">${cvOptions || `<option value="">${tr('Aucun CV trouvé')}</option>`}</select></div>
      ${a.job?.url && a.status !== 'soumise' ? `<button class="btn primary big" data-action="applyJob">${tr('Postuler / connexion')}</button><div class="small muted">${tr('Ouvre dans ce navigateur : une session Workday valide est réutilisée. Compte propre à chaque entreprise ; mots de passe gérés par Chrome.')}</div>` : ''}
      <div class="row">
        ${a.job?.url ? `<button class="btn ghost" data-action="openJob">${tr('Voir l’offre')}</button>` : ''}
        <span class="grow"></span>
        <button class="btn ghost" data-action="newApp" title="${tr('Désactiver (l’historique reste dans le Journal)')}">${tr('Changer d’offre')}</button>
      </div>
    </div>`;
}

function renderLetter() {
  const el = $('#letterCard');
  if (!S.app) {
    el.innerHTML = '';
    return;
  }
  const L = S.app.letter;
  const langSel = `<select id="letterLang" style="width:auto">
      ${[['auto', tr('Langue de l’offre')], ['fr', 'Français'], ['en', 'English']].map(([v, label]) => `<option value="${v}" ${S.prefs.letterLang === v ? 'selected' : ''}>${label}</option>`).join('')}
    </select>`;
  if (S.letterBusy) {
    el.innerHTML = `<h2>${tr('Lettre de motivation')}</h2><div class="busy"><span class="spinner"></span>${tr('pi rédige ta lettre…')} <span id="letterTimer">0 s</span>
      <div class="small" style="font-weight:400">${tr('Environ 20 à 60 s.')}</div></div>`;
    return;
  }
  const head = `<h2><span>${tr('Lettre de motivation')}</span>${L ? `<span class="badge ok">${esc((L.language || '').toUpperCase())} · ${tr('PDF prêt')}</span>` : ''}</h2>`;
  const gen = `<details ${L ? '' : 'open'}><summary>${tr(L ? 'Régénérer' : 'Générer')} ${tr('avec des consignes (facultatif)')}</summary>
      <textarea id="letterInstructions" rows="2" placeholder="${tr('Ex. : insiste sur mon projet RL, ton plus formel, mentionne ma disponibilité à temps plein…')}">${esc(S.letterInstructions)}</textarea></details>
    <div class="row">${langSel}<span class="grow"></span><button class="btn ${L ? '' : 'primary'}" data-action="generate">${tr(L ? 'Régénérer' : 'Générer la lettre')}</button></div>`;
  if (!L || !S.draft) {
    el.innerHTML = `${head}<div class="stack">${gen}</div>`;
    return;
  }
  el.innerHTML = `${head}<div class="stack">
    <div><label class="field" for="letterSubject">${tr('Objet')}</label><input type="text" id="letterSubject" value="${esc(S.draft.subject)}"></div>
    <div><label class="field" for="letterBody">${tr('Texte (paragraphes séparés par une ligne vide, sans la signature)')}</label>
      <textarea id="letterBody">${esc(S.draft.body)}</textarea></div>
    ${L.warnings?.length ? `<div><b class="small">${tr('À vérifier :')}</b><ul class="warnings">${L.warnings.map((w) => `<li>${esc(tr(w))}</li>`).join('')}</ul></div>` : ''}
    <div class="row">
      <button class="btn ${S.draftDirty ? 'primary' : ''}" data-action="saveLetter">${tr('Mettre à jour le PDF')}</button>
      <button class="btn" data-action="openLetter">${tr('Ouvrir le PDF')}</button>
      <button class="btn ghost" data-action="copyLetter">${tr('Copier le texte')}</button>
    </div>
    <div class="small muted">${esc(L.fileName || '')}${L.fit && !L.fit.fitsOnePage ? tr(' · ⚠️ dépasse une page : raccourcis le texte') : ''}</div>
    ${gen}</div>`;
}

const RES_GROUPS = [
  ['check', 'À vérifier', 'warn'],
  ['todo', 'À compléter', 'bad'],
  ['ok', 'Remplis', 'ok'],
  ['kept', 'Déjà remplis (non modifiés)', 'grey'],
];
const groupOf = (r) => (r.status === 'fail' || r.status === 'unresolved' ? 'todo' : r.status === 'skip' ? 'check' : r.status);

function renderFill() {
  $('#headerStop').classList.toggle('hidden', !S.fillBusy);
  $('#headerStop').textContent = tr('Arrêter');
  const el = $('#fillCard');
  const opts = `<div class="stack small" style="margin-top:8px">
      <label class="check"><input type="checkbox" id="optAi" ${S.prefs.useAi ? 'checked' : ''}> ${tr('Faire répondre pi aux questions restantes')}</label>
      <label class="check"><input type="checkbox" id="optEntries" ${S.prefs.addEntries ? 'checked' : ''}> ${tr('Workday : ajouter mes expériences et formations si la section est vide')}</label>
      <label class="check"><input type="checkbox" id="optOverwrite" ${S.prefs.overwrite ? 'checked' : ''}> ${tr('Remplacer les champs déjà remplis')}</label>
    </div>`;
  if (S.fillBusy) {
    el.innerHTML = `<h2>${tr('Remplissage')}</h2><div class="busy" role="status"><span class="spinner"></span>${esc(tr(S.fillPhase))}</div>
      <button type="button" class="btn danger" style="margin-top:8px" data-action="stopFill">${tr('Arrêter')}</button>
      <div class="small muted" style="margin-top:6px">${tr('Ne touche pas à la page pendant le remplissage.')}</div>`;
    return;
  }
  let body = '';
  if (S.fill) {
    const groups = {};
    for (const r of S.fill.results) (groups[groupOf(r)] ||= []).push(r);
    const added = S.fill.info?.addedEntries;
    body += `<div class="summary">${RES_GROUPS.filter(([k]) => groups[k]?.length)
      .map(([k, t, cls]) => `<span class="badge ${cls}">${groups[k].length} ${tr(t).toLowerCase()}</span>`)
      .join('')}</div>`;
    const addedText = [
      [added?.experience, 'expérience(s)'],
      [added?.education, 'formation(s)'],
      [added?.language, 'langue(s)'],
      [added?.website, 'site(s) Web'],
    ]
      .filter(([n]) => n)
      .map(([n, label]) => `${n} ${tr(label)}`);
    if (addedText.length) body += `<div class="small muted">${esc(tr('Blocs ajoutés : {entries}.', { entries: addedText.join(', ') }))}</div>`;
    if (S.fill.noCv) body += `<div class="small" style="color:var(--warn)">${tr('Aucun CV joint : analyse l’offre d’abord pour choisir un CV.')}</div>`;
    for (const [k, t] of RES_GROUPS) {
      const list = groups[k];
      if (!list?.length) continue;
      const items = list
        .map(
          (r) => `<li class="${k}" data-focus="${esc(r.id)}"><div><span class="lbl">${esc(r.label === '(sans libellé)' ? tr(r.label) : r.label)}</span>${r.required ? ' <span class="muted">*</span>' : ''}</div>
          ${r.value ? `<div class="val">${esc(['checkbox', 'checkboxes'].includes(r.kind) ? tr(r.value) : r.value)}</div>` : ''}${r.note ? `<div class="note">${esc(tr(r.note))}${r.source === 'ia' ? ` · ${tr('IA')}` : ''}</div>` : ''}</li>`,
        )
        .join('');
      const open = k === 'check' || k === 'todo';
      body += `<details ${open ? 'open' : ''}><summary>${tr(t)} (${list.length})</summary><ul class="results">${items}</ul></details>`;
    }
    body += `<div class="legend"><span class="l-ok">${tr('rempli')}</span><span class="l-check">${tr('à vérifier')}</span><span class="l-todo">${tr('à compléter')}</span></div>`;
  }
  const submitted = S.app?.status === 'soumise';
  el.innerHTML = `<h2>${tr('Remplissage')}</h2>
    <button class="btn primary big" data-action="fill">${tr(S.fill ? 'Remplir à nouveau' : 'Remplir cette page')}</button>
    ${opts}${body}
    <div class="row" style="margin-top:10px">
      <button class="btn ghost" data-action="memorize" title="${tr('Retenir tes réponses aux questions de cette page pour les prochaines candidatures')}">${tr('Mémoriser mes réponses')}</button>
      <span class="grow"></span>
      ${S.app ? `<button class="btn ${submitted ? '' : 'primary'}" data-action="submitted" ${submitted ? 'disabled' : ''}>${tr(submitted ? 'Soumise ✓' : 'J’ai soumis ✓')}</button>` : ''}
    </div>
    <div class="small muted" style="margin-top:6px">${tr('ApplyPilot ne clique jamais sur « Soumettre » : vérifie la page, passe à l’étape suivante, puis relance le remplissage.')}</div>`;
}

function renderApp() {
  renderPage();
  renderAppCard();
  renderLetter();
  renderFill();
}

function renderJournal() {
  const el = $('#tab-journal');
  if (!S.health) {
    el.innerHTML = `<div class="card muted">${tr('Serveur non connecté.')}</div>`;
    return;
  }
  const counts = {};
  for (const a of S.apps) counts[a.status] = (counts[a.status] || 0) + 1;
  const items = S.apps
    .map(
      (a) => `<li><div class="row"><b class="grow">${esc(a.company || '?')}</b><span class="small muted">${esc(fmtDate(a.createdAt))}</span></div>
      <div>${esc(a.title || '')}</div>
      <div class="row" style="margin-top:4px">
        <select data-status="${esc(a.id)}" style="width:auto">${S.statuses.map((s) => `<option value="${esc(s)}" ${s === a.status ? 'selected' : ''}>${esc(statusLabel(s))}</option>`).join('')}</select>
        <span class="grow"></span>
        ${a.url ? `<button class="btn ghost" data-open-url="${esc(a.url)}">${tr('Offre')}</button>` : ''}
        ${a.hasLetter ? `<button class="btn ghost" data-open-letter="${esc(a.id)}">${tr('Lettre')}</button>` : ''}
        <button class="btn ghost" data-activate="${esc(a.id)}">${tr('Activer')}</button>
        <button class="btn ghost danger" data-delete="${esc(a.id)}" title="${tr('Supprimer')}">✕</button>
      </div></li>`,
    )
    .join('');
  el.innerHTML = `<div class="card"><h2><span>${tr('Journal')} (${S.apps.length})</span><button class="btn ghost" data-action="exportCsv">${tr('Exporter CSV')}</button></h2>
    <div class="summary">${Object.entries(counts).map(([s, n]) => `<span class="badge ${s === 'soumise' ? 'ok' : s === 'refusée' ? 'bad' : s === 'entrevue' || s === 'offre' ? 'warn' : ''}">${n} ${esc(statusLabel(s).toLowerCase())}</span>`).join('')}</div>
    ${S.apps.length ? `<ul class="list">${items}</ul>` : `<div class="muted">${tr('Aucune candidature pour l’instant.')}</div>`}</div>`;
}

function profileField(f) {
  const saved = f.path.split('.').reduce((o, k) => o?.[k], S.profile);
  const value = String((Object.hasOwn(S.profileDraft, f.path) ? S.profileDraft[f.path] : saved) ?? '');
  const id = `profile-${f.path.replace(/\./g, '-')}`;
  const attrs = `id="${esc(id)}" data-profile-path="${esc(f.path)}"`;
  let input;
  if (f.type === 'boolean') {
    input = `<select ${attrs}>${[['', 'Je réponds moi-même'], ['true', 'Oui'], ['false', 'Non']].map(([v, label]) => `<option value="${v}" ${v === value ? 'selected' : ''}>${tr(label)}</option>`).join('')}</select>`;
  } else {
    const type = f.type === 'integer' ? 'number' : f.type === 'path' ? 'text' : f.type;
    input = `<input ${attrs} type="${esc(type)}" value="${esc(value)}" maxlength="500"
      ${f.autocomplete ? `autocomplete="${esc(f.autocomplete)}"` : 'autocomplete="off"'}
      ${f.placeholder ? `placeholder="${esc(tr(f.placeholder))}"` : ''}
      ${f.type === 'integer' ? `min="${f.min}" max="${f.max}" step="1"` : ''}>`;
  }
  let label = tr(f.label);
  const languageField = f.path.match(/^languages\.(\d+)\.level$/);
  if (languageField) {
    const language = S.profile?.languages?.[+languageField[1]];
    const name = (S.uiLanguage === 'en' ? language?.languageEn : language?.language) || language?.language || String(+languageField[1] + 1);
    label = tr('Niveau — {name}', { name });
  }
  return `<div class="profile-field"><label class="field" for="${esc(id)}">${esc(label)}</label>${input}</div>`;
}

async function saveProfile() {
  if (S.profileBusy || !$('#profileForm')?.reportValidity()) return;
  const values = {};
  for (const [key, raw] of Object.entries(S.profileDraft)) {
    const f = S.profileFields.find((x) => x.path === key);
    if (!f) throw new Error('Champ de profil inconnu.');
    if (f.type === 'boolean') {
      if (!['', 'true', 'false'].includes(raw)) throw new Error('Réponse oui/non invalide.');
      values[key] = raw === '' ? null : raw === 'true';
    } else if (f.type === 'integer') {
      values[key] = raw === '' ? null : Number(raw);
      if (raw !== '' && !Number.isInteger(values[key])) throw new Error('La durée doit être un nombre entier.');
    } else values[key] = raw;
  }
  if (!Object.keys(values).length) return toast('Aucune modification à enregistrer.');
  S.profileBusy = true;
  try {
    const saved = await api('/profile', { method: 'PUT', body: { revision: S.profileRevision, values } });
    S.profile = saved.profile;
    S.profileRevision = saved.revision;
    S.profileFields = saved.fields;
    S.profileDraft = {};
    await checkServer();
    await renderProfile();
    toast('Profil enregistré ✓ — utilisé au prochain remplissage');
  } finally {
    S.profileBusy = false;
  }
}

async function reloadProfile() {
  if (Object.keys(S.profileDraft).length && !confirm(tr('Recharger le profil et abandonner les modifications non enregistrées ?'))) return;
  S.profileDraft = {};
  S.profileRevision = null;
  await renderProfile();
}

async function renderProfile({ refresh = true } = {}) {
  const el = $('#tab-profile');
  if (!S.health) {
    el.innerHTML = `<div class="card"><h2>${tr('Serveur')}</h2>${serverForm()}</div>`;
    return;
  }
  let data;
  try {
    if (refresh || !S.profileResponse) {
      [S.memory, data] = await Promise.all([api('/memory'), api('/profile')]);
      S.profileResponse = data;
    } else data = S.profileResponse;
  } catch (err) {
    el.innerHTML = `<div class="card"><h2>${tr('Profil')}</h2><div class="small" style="color:var(--bad)">${esc(tr(err.message))}</div><button class="btn" data-action="reloadProfile">${tr('Réessayer')}</button></div>`;
    return;
  }
  const dirty = Object.keys(S.profileDraft).length > 0;
  const conflict = dirty && S.profileRevision && S.profileRevision !== data.revision;
  if (!dirty) {
    S.profile = data.profile;
    S.profileRevision = data.revision;
    S.profileFields = data.fields || [];
  }
  const groups = [...new Set(S.profileFields.map((f) => f.group))];
  const editor = S.profileFields.length ? `<form id="profileForm">
    ${groups.map((group, i) => `<details class="profile-group" ${i < 2 ? 'open' : ''}><summary>${esc(tr(group))}</summary>${S.profileFields.filter((f) => f.group === group).map(profileField).join('')}</details>`).join('')}
    <div class="profile-save row"><button type="button" class="btn primary" data-action="saveProfile">${tr('Enregistrer le profil')}</button>
      <button type="button" class="btn" data-action="reloadProfile">${tr('Recharger')}</button></div>
    </form>` : `<div class="small" style="color:var(--warn)">${tr('Redémarre le serveur pour activer l’éditeur de profil.')}</div>`;
  const h = { ...S.health, warnings: data.warnings || S.health.warnings };
  const mem = Object.entries(S.memory.items || {}).sort((a, b) => String(b[1].lastUsedAt).localeCompare(String(a[1].lastUsedAt)));
  el.innerHTML = `
    <div class="card"><h2>${tr('Profil')}</h2>
      <div class="small">${tr('Fichier :')} <span class="kbd">${esc(h.profileFile)}</span></div>
      ${h.profileError ? `<div class="small" style="color:var(--bad)">${esc(tr(h.profileError))}</div>` : ''}
      ${h.warnings?.length ? `<div style="margin-top:8px"><b class="small">${tr('À compléter')}:</b><ul class="warnings">${h.warnings.map((w) => `<li>${esc(tr(w.label))} <span class="muted">(${esc(w.path)})</span></li>`).join('')}</ul></div>` : `<div class="small" style="color:var(--ok);margin-top:6px">${tr('Champs essentiels renseignés ✓')}</div>`}
      <div class="small muted" style="margin-top:6px">${tr('Enregistre ici tes coordonnées, disponibilités et réponses d’admissibilité. Vide / « Je réponds moi-même » = aucune réponse inventée. Sauvegarde privée automatique avant chaque modification.')}</div>
      ${conflict ? `<div class="small" style="color:var(--warn)">${tr('Le fichier a changé ailleurs. Tes saisies sont conservées ; utilise « Recharger » avant de réessayer.')}</div>` : ''}
      ${editor}
      <div class="small muted">${tr('Les expériences et formations détaillées restent dans le YAML. Modifier le profil ne modifie pas les CV PDF ni les lettres déjà générées.')}</div>
    </div>
    <div class="card"><h2>CV (${S.cvs.length})</h2>
      <div class="small">${tr('Dossier :')} <span class="kbd">${esc(h.cvDir || tr('non configuré'))}</span></div>
      ${h.cvError ? `<div class="small" style="color:var(--bad)">${esc(tr(h.cvError))}</div>` : ''}
      <ul class="list">${S.cvs.map((c) => `<li class="small"><b>${esc(c.name)}</b> <span class="badge grey">${esc((c.language || '?').toUpperCase())}</span> ${c.hasTex ? `<span class="badge ok">${tr('.tex lu')}</span>` : `<span class="badge warn">${tr('pas de .tex')}</span>`}${c.tags?.length ? `<div class="muted">${tr('Mots-clés :')} ${esc(c.tags.join(', '))}</div>` : ''}</li>`).join('')}</ul>
    </div>
    <div class="card"><h2>${tr('Réponses mémorisées')} (${mem.length})</h2>
      ${mem.length ? `<ul class="list">${mem.map(([k, m]) => `<li class="small"><div class="row"><b class="grow">${esc(m.label)}</b><button class="btn ghost danger" data-forget="${esc(k)}">✕</button></div><div>${esc(Array.isArray(m.value) ? m.value.join(', ') : String(m.value))}</div></li>`).join('')}</ul>` : `<div class="small muted">${tr('Tes réponses aux questions récurrentes (non couvertes par le profil) seront retenues quand tu passes à l’étape suivante d’un formulaire.')}</div>`}
    </div>
    <div class="card"><h2>${tr('Serveur')}</h2>${serverForm()}
      <div class="small muted" style="margin-top:6px">pi : ${esc(h.pi)} · Chrome (PDF) : ${h.chrome ? 'OK' : tr('introuvable')}</div></div>`;
}

function serverForm() {
  return `<div class="row"><input type="url" id="serverUrl" value="${esc(S.serverDraft ?? S.server)}" class="grow" style="width:auto">
    <button class="btn" data-action="saveServer">${tr('Enregistrer')}</button></div>`;
}

function switchTab(name) {
  S.tab = name;
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.id === `tab-${name}`));
  if (name === 'journal') loadApps().then(renderJournal, () => renderJournal());
  if (name === 'profile') checkServer().then(renderProfile);
  if (name === 'app') renderApp();
  if (name === 'search') searchPanel.show();
}

// ---------------------------------------------------------------------------
// Événements
// ---------------------------------------------------------------------------
async function savePrefs() {
  await chrome.storage.local.set({ prefs: S.prefs });
}

const ACTIONS = {
  recheck: async () => {
    await checkServer();
    if (S.health) {
      const { activeAppId } = await chrome.storage.local.get('activeAppId');
      if (activeAppId && !S.app) await setActiveApp(activeAppId, { quiet: true }).catch(() => {});
      schedulePageRefresh(0);
      toast('Serveur connecté ✓');
    }
    renderApp();
  },
  saveProfile: () => saveProfile(),
  reloadProfile: () => reloadProfile(),
  analyze: () => analyze(),
  generate: () => generateLetter(),
  saveLetter: () => saveLetter(),
  openLetter: () => chrome.tabs.create({ url: letterUrl() }),
  copyLetter: async () => {
    const { profile } = await api('/profile');
    await navigator.clipboard.writeText(`${S.draft.body}\n\n${signature(profile)}`);
    toast('Texte copié ✓');
  },
  openJob: () => chrome.tabs.create({ url: S.app.job.url }),
  applyJob: async () => {
    if (!S.app?.job?.url) throw new Error('Choisis une candidature d’abord.');
    const url = applicationUrl(S.app.job.url);
    const u = new URL(url);
    const tabs = await chrome.tabs.query({ url: `${u.protocol}//${u.hostname}/*` });
    const existing = existingApplicationTab(S.app.job.url, tabs);
    if (existing) {
      await chrome.tabs.update(existing.id, { active: true });
      await chrome.windows.update(existing.windowId, { focused: true });
      toast('Formulaire déjà ouvert — saisies conservées');
    } else await chrome.tabs.create({ url });
  },
  newApp: () => setActiveApp(null),
  fill: () => fillPage(),
  stopFill: () => stopFill(),
  memorize: () => captureMemory(),
  submitted: () => markSubmitted(),
  exportCsv: () => chrome.tabs.create({ url: `${S.server}/journal.csv` }),
  saveServer: async () => {
    searchPanel.reset();
    S.server = ($('#serverUrl').value || DEFAULT_SERVER).replace(/\/+$/, '');
    S.serverDraft = null;
    await chrome.storage.local.set({ serverUrl: S.server });
    await checkServer();
    toast(S.health ? 'Serveur connecté ✓' : 'Serveur injoignable', S.health ? '' : 'error');
    if (S.tab === 'profile') renderProfile();
  },
};

document.addEventListener('click', async (e) => {
  const t = e.target.closest('button, li[data-focus]');
  if (!t) return;
  try {
    if (t.dataset.tab) return switchTab(t.dataset.tab);
    if (t.dataset.action && ACTIONS[t.dataset.action]) {
      if (t.tagName === 'BUTTON') t.disabled = true;
      try {
        await ACTIONS[t.dataset.action]();
      } finally {
        if (t.isConnected && t.tagName === 'BUTTON') t.disabled = false;
      }
      return;
    }
    if (t.dataset.focus) return runInTab('focus', { id: t.dataset.focus });
    if (t.dataset.openUrl) return chrome.tabs.create({ url: t.dataset.openUrl });
    if (t.dataset.openLetter) return chrome.tabs.create({ url: `${S.server}/applications/${encodeURIComponent(t.dataset.openLetter)}/letter.pdf` });
    if (t.dataset.activate) {
      await setActiveApp(t.dataset.activate);
      return switchTab('app');
    }
    if (t.dataset.delete) {
      const a = S.apps.find((x) => x.id === t.dataset.delete);
      if (!confirm(tr('Supprimer la candidature « {name} » et sa lettre ?', { name: `${a?.company || ''} — ${a?.title || ''}` }))) return;
      await api(`/applications/${encodeURIComponent(t.dataset.delete)}`, { method: 'DELETE' });
      if (S.app?.id === t.dataset.delete) await setActiveApp(null);
      await loadApps();
      return renderJournal();
    }
    if (t.dataset.forget) {
      await api(`/memory/${encodeURIComponent(t.dataset.forget)}`, { method: 'DELETE' });
      return renderProfile();
    }
  } catch (err) {
    toast(err.message || String(err), 'error');
  }
});

document.addEventListener('submit', (e) => {
  if (e.target.id !== 'profileForm') return;
  e.preventDefault();
  saveProfile().catch((err) => toast(err.message, 'error'));
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'letterInstructions') S.letterInstructions = e.target.value;
  if (e.target.id === 'serverUrl') S.serverDraft = e.target.value;
  if (e.target.dataset.profilePath) S.profileDraft[e.target.dataset.profilePath] = e.target.value;
  if (e.target.id === 'letterSubject' || e.target.id === 'letterBody') {
    S.draft = S.draft || { subject: '', body: '' };
    S.draft[e.target.id === 'letterSubject' ? 'subject' : 'body'] = e.target.value;
    if (!S.draftDirty) {
      S.draftDirty = true;
      const b = document.querySelector('[data-action="saveLetter"]');
      if (b) b.classList.add('primary');
    }
  }
});

document.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.dataset.profilePath) S.profileDraft[t.dataset.profilePath] = t.value;
  try {
    if (t.id === 'uiLanguage') {
      await setUiLanguage(t.value);
    } else if (t.id === 'cvSelect') {
      await patchApp({ cvId: t.value });
      toast('CV choisi ✓');
    } else if (t.id === 'pickApp' && t.value) {
      await setActiveApp(t.value);
    } else if (t.id === 'letterLang') {
      S.prefs.letterLang = t.value;
      await savePrefs();
    } else if (t.id === 'optAi' || t.id === 'optEntries' || t.id === 'optOverwrite') {
      const key = { optAi: 'useAi', optEntries: 'addEntries', optOverwrite: 'overwrite' }[t.id];
      S.prefs[key] = t.checked;
      await savePrefs();
    } else if (t.dataset.status) {
      const { application } = await api(`/applications/${encodeURIComponent(t.dataset.status)}`, { method: 'PATCH', body: { status: t.value } });
      if (S.app?.id === application.id) S.app = application;
      await loadApps();
      renderJournal();
      toast('Statut mis à jour ✓');
    }
  } catch (err) {
    toast(err.message || String(err), 'error');
  }
});

chrome.tabs.onActivated.addListener(async () => {
  const tab = await activeTab();
  if (S.fillRun && tab?.id !== S.fillRun.tabId) stopFill({ pageChanged: true });
  schedulePageRefresh(150);
});
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (S.fillRun?.tabId === tabId && (info.url || info.status === 'loading')) stopFill({ pageChanged: true });
  const tab = await activeTab();
  if (tab?.id === tabId && (info.status === 'complete' || info.url)) schedulePageRefresh(600);
});
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type === 'ap:fillCancelled' && msg.runId === S.fillRun?.id) stopFill({ pageChanged: true });
  if (msg?.type === 'ap:pageChanged') {
    if (sender?.tab?.id === S.fillRun?.tabId && msg.pageIdentity && S.fillRun.pages?.some((p) => p.frameId === sender.frameId && p.pageIdentity !== msg.pageIdentity)) stopFill({ pageChanged: true });
    schedulePageRefresh(300);
  }
  if (msg?.type === 'ap:memorySaved' && msg.added) toast(tr('{count} réponse(s) mémorisée(s) pour les prochaines fois', { count: msg.added }));
});
window.addEventListener('pagehide', () => {
  searchPanel.stop({ quiet: true });
  if (S.fillRun) {
    const run = S.fillRun;
    run.controller.abort();
    exec(run.tabId, 'cancel', { runId: run.id }, run.pages?.map((p) => p.frameId)).catch(() => {});
  }
});
window.addEventListener('focus', () => {
  if (!S.health) checkServer();
});
setInterval(() => {
  if (!S.health) checkServer().then(() => S.health && ACTIONS.recheck());
}, 10000);

// ---------------------------------------------------------------------------
// Démarrage
// ---------------------------------------------------------------------------
(async function init() {
  const stored = await chrome.storage.local.get(['serverUrl', 'prefs', 'activeAppId', 'uiLanguage']);
  S.uiLanguage = chooseLanguage(stored.uiLanguage, navigator.language);
  renderShell();
  S.server = (stored.serverUrl || DEFAULT_SERVER).replace(/\/+$/, '');
  S.prefs = { ...S.prefs, ...(stored.prefs || {}) };
  renderApp();
  await checkServer();
  if (S.health && stored.activeAppId) await setActiveApp(stored.activeAppId, { quiet: true }).catch(() => chrome.storage.local.remove('activeAppId'));
  if (S.health && !S.app) {
    const ongoing = S.apps.filter((a) => a.status === 'en cours');
    if (ongoing.length === 1) await setActiveApp(ongoing[0].id, { quiet: true });
  }
  renderApp();
  await refreshPage();
})();
