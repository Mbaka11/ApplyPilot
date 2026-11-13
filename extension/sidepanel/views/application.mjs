// Onglet Candidature : page détectée, candidature active, CV (inspecteur et adaptation).
import { applicationUrl, existingApplicationTab } from '../navigation.mjs';
import { isLinkedIn } from '../../search/core.mjs';
import { createCvInspector } from '../cv-inspector.mjs';
import { createCvTailor } from '../cv-tailor.mjs';
import { S, PLATFORM_LABEL } from '../state.mjs';
import { $, esc, tr, toast, statusLabel } from '../ui.mjs';
import { api, loadApps } from '../api.mjs';
import { activeTab, scriptable, runInTab } from '../tabs.mjs';
import { renderHome } from './home.mjs';
import { renderLetter } from './letter.mjs';
import { renderFill, stopFill } from './fill.mjs';
import { switchTab } from './shell.mjs';

export const otherCvBusy = () => !S.health || S.cvBusy || S.appBusy || S.switching || S.fillBusy || S.letterBusy;
export const cvSelectionLocked = () => otherCvBusy() || cvTailor.busy();
export const cvInspector = createCvInspector({ api, tr, esc, toast, canAct: () => !cvSelectionLocked(), locale: () => S.uiLanguage === 'fr' ? 'fr-CA' : 'en-CA' });
export const cvTailor = createCvTailor({ api, tr, esc, toast, canAct: () => !otherCvBusy() && !S.fillRun, locale: () => S.uiLanguage === 'fr' ? 'fr-CA' : 'en-CA',
  onChange: application => { if (S.app?.id !== application.id) return; S.app = application; renderAppCard(); loadApps().catch(() => {}); } });
export function syncCvControls() {
  const locked = cvSelectionLocked();
  if ($('#cvSelect')) $('#cvSelect').disabled = locked;
  cvInspector.setDisabled(locked);
  cvTailor.setDisabled(otherCvBusy() || !!S.fillRun);
}

let pageTimer = null;
export function schedulePageRefresh(delay = 400) {
  clearTimeout(pageTimer);
  pageTimer = setTimeout(refreshPage, delay);
}

export async function refreshPage() {
  const tab = await activeTab();
  if (!tab || !scriptable(tab.url)) {
    S.page = null;
    S.pageError = isLinkedIn(tab?.url) ? 'Utilise Recherche pour le prototype LinkedIn ou un ajout manuel. L’analyse et le remplissage restent désactivés sur LinkedIn.' : 'Ouvre une offre de stage ou un formulaire de candidature.';
    renderPage(); renderHome();
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
      manualActionCount: frames.reduce((n, f) => n + (f.manualActionCount || 0), 0),
      step: frames.find((f) => f.step)?.step || null,
    };
    S.pageError = '';
    if (S.fillRun && (tab.id !== S.fillRun.tabId || S.fillRun.pages?.some((old) => {
      const current = frames.find((f) => f.frameId === old.frameId);
      return !current || current.pageIdentity !== old.pageIdentity;
    }))) stopFill({ pageChanged: true });
    // Detecting a page only updates context. Resumption always requires a click.
  } catch (e) {
    S.page = null;
    S.pageError = e.message;
  }
  renderPage();
  renderAppCard();
  renderHome();
}

// ---------------------------------------------------------------------------
// Candidatures
// ---------------------------------------------------------------------------
export const hasLetterDraft = () => S.draftDirty || S.letterInstructions !== (S.app?.letter?.instructions || '');
export function confirmApplicationSwitch() {
  if (S.letterBusy || S.appBusy || S.cvBusy || S.switching || S.fillRun?.documents || cvTailor.busy()) throw new Error('Attends la fin de l’opération sur cette candidature.');
  return !hasLetterDraft() || confirm(tr('Changer de candidature et abandonner le brouillon de lettre non enregistré ?'));
}
export async function activateApplication(id) {
  if (id === S.app?.id) return switchTab('app');
  if (!confirmApplicationSwitch()) return;
  S.switching = true; syncCvControls();
  try { await setActiveApp(id); switchTab(id ? 'app' : 'home'); }
  finally { S.switching = false; syncCvControls(); }
}
export async function setActiveApp(id, { quiet = false } = {}) {
  if (S.fillRun) stopFill();
  if (!id) {
    S.app = null;
    S.draft = null;
    S.draftDirty = false;
    S.letterInstructions = '';
    S.fill = null;
    await chrome.storage.local.remove(['activeAppId', 'activeAppCompany']);
    renderApp();
    return;
  }
  const { application, recommendation, requirements } = await api(`/applications/${encodeURIComponent(id)}`);
  S.app = application;
  S.draftDirty = false;
  S.letterInstructions = application.letter?.instructions || '';
  S.recommendation = recommendation;
  S.requirements = requirements || [];
  S.draft = application.letter ? { subject: application.letter.subject, body: application.letter.body } : null;
  S.fill = null;
  await chrome.storage.local.set({ activeAppId: id, activeAppCompany: application.job?.company || '' });
  renderApp();
  if (!quiet) toast(tr('Candidature active : {name}', { name: application.job?.company || application.job?.title }));
}

export async function analyze() {
  if (!confirmApplicationSwitch()) return;
  S.appBusy = true;
  try {
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
  switchTab('app');
  toast(existed ? 'Offre déjà connue : candidature reprise' : 'Offre analysée ✓');
  } finally { S.appBusy = false; syncCvControls(); }
}

export async function patchApp(body) {
  const { application } = await api(`/applications/${encodeURIComponent(S.app.id)}`, { method: 'PATCH', body });
  S.app = application;
  await loadApps();
  return application;
}

export async function selectCv(id) {
  if (!S.app || cvSelectionLocked()) return renderAppCard();
  const appId = S.app.id;
  if (!S.cvs.some(cv => cv.id === id)) throw new Error('Le CV sélectionné est introuvable. Actualise la liste des CV.');
  S.cvBusy = true; syncCvControls();
  try {
    const { application } = await api(`/applications/${encodeURIComponent(appId)}`, { method: 'PATCH', body: { cvId: id } });
    if (S.app?.id !== appId) return;
    S.app = application;
    await loadApps();
    toast('CV choisi ✓');
  } finally { S.cvBusy = false; renderAppCard(); }
}

export function renderPage() {
  const el = $('#pageCard');
  if (!S.page) {
    el.innerHTML = `<div class="muted small">${esc(tr(S.pageError || 'Analyse de la page…'))}</div>`;
    return;
  }
  const p = S.page;
  const known = S.apps.find((a) => a.jobKey && a.jobKey === p.jobKey);
  const step = p.step?.name ? ` · ${tr('étape')} ${p.step.index ? `${p.step.index}/${p.step.total} ` : ''}${esc(p.step.name)}` : '';
  let action = '';
  if (known && known.id !== S.app?.id) {
    action = `<h3>${esc(known.company)} · ${esc(known.title)}</h3><button class="btn primary" data-activate="${esc(known.id)}">${tr('Reprendre cette candidature')}</button>`;
  } else if (p.isPosting && !known) {
    action = `<div class="stack"><div><span class="badge">${tr('Offre détectée')}</span></div>
      <h3>${esc(p.title || tr('Offre sans titre'))}</h3><div class="muted">${esc(p.company || '')}</div>
      <button class="btn primary big" data-action="analyze">${tr('Analyser cette offre')}</button></div>`;
  } else if (p.fieldCount > 0 || p.fileCount > 0 || p.manualActionCount > 0) {
    action = `<div class="small muted">${tr('Formulaire : {count} champ(s)', { count: p.fieldCount })}${p.fileCount ? tr(' + {count} fichier(s)', { count: p.fileCount }) : ''}${p.manualActionCount ? tr(' + {count} action(s) manuelle(s)', { count: p.manualActionCount }) : ''}${step}</div>`;
  } else if (!p.isPosting) {
    action = `<div class="small muted">${tr('Aucune offre ni formulaire détecté ici.')}
      <button class="btn ghost" data-action="analyze">${tr('Analyser quand même')}</button></div>`;
  }
  el.innerHTML = `<h2><span>Page</span><span class="badge grey">${esc(tr(PLATFORM_LABEL[p.platform] || p.platform))}</span></h2>${action}
    ${p.hasPassword ? `<div class="small muted">${tr('🔒 « Remplir cette page » renseigne seulement ton courriel. Utilise Chrome pour le mot de passe ; connexion, CAPTCHA et double authentification restent manuels.')}</div>` : ''}
    <details class="small" style="margin-top:8px"><summary>${tr('Diagnostic local du formulaire')}</summary>
      <p class="muted">${tr('Exporte uniquement la structure, les catégories de libellés et les liens ARIA. Aucune réponse, pièce jointe, URL complète ou donnée de connexion. Aucun clic dans le formulaire, appel IA ou envoi au serveur.')}</p>
      <p class="muted">${tr('Le fichier reste dans tes téléchargements. Les libellés libres et les identifiants sont remplacés par des catégories et références anonymes. Vérifie le rapport avant de le partager.')}</p>
      <button type="button" class="btn" data-action="diagnostic" ${S.fillBusy || S.diagnosticBusy ? 'disabled' : ''}>${tr(S.diagnosticBusy ? 'Lecture de la structure…' : 'Exporter le diagnostic local')}</button>
    </details>`;
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

export function renderAppCard() {
  const el = $('#appCard');
  if (!S.app) {
    cvInspector.reset(); cvTailor.reset();
    const recent = S.apps.filter((a) => a.status === 'en cours').slice(0, 8);
    el.innerHTML = `<h2>${tr('Candidature active')}</h2>
      <div class="muted small">${tr('Aucune. Ouvre l’offre et clique « Analyser cette offre » : la candidature reste active pendant que tu remplis le formulaire.')}</div>
      ${recent.length ? `<label class="field" style="margin-top:8px">${tr('Reprendre une candidature en cours')}</label>
        <select id="pickApp"><option value="">—</option>${recent.map((a) => `<option value="${esc(a.id)}">${esc(a.company || '?')} — ${esc(a.title || '')}</option>`).join('')}</select>` : ''}`;
    return;
  }
  const a = S.app;
  const rec = S.recommendation;
  const selectedCv = S.cvs.find(cv => cv.id === a.cvId);
  const cvOptions = S.cvs
    .map((c) => `<option value="${esc(c.id)}" ${c.id === a.cvId ? 'selected' : ''}>${esc(c.name)}${c.language ? ` (${c.language.toUpperCase()})` : ''}${rec?.cvId === c.id ? ' ★' : ''}</option>`)
    .join('');
  el.innerHTML = `<h2><span>${tr('Candidature active')}</span><span class="badge ${a.status === 'soumise' ? 'ok' : ''}">${esc(statusLabel(a.status))}</span></h2>
    <h3>${esc(a.job?.title || tr('Poste'))}</h3>
    ${requirementsHtml(S.requirements)}
    <div class="muted">${esc(a.job?.company || '')}${a.job?.location ? ` · ${esc(a.job.location)}` : ''}</div>
    <div class="stack" style="margin-top:10px">
      <div><label class="field" for="cvSelect">${tr('CV à joindre')} ${rec?.cvId ? `<span class="muted">${esc(tr('(★ recommandé : {reason})', { reason: tr(rec.reason || '') }))}</span>` : ''}</label>
        <select id="cvSelect" ${cvSelectionLocked() ? 'disabled' : ''}>${!selectedCv && S.cvs.length ? `<option value="" selected disabled>${tr(a.cvId ? 'CV sélectionné introuvable' : 'Choisis un CV')}</option>` : ''}${cvOptions || `<option value="">${tr('Aucun CV trouvé')}</option>`}</select>
        <div id="cvInspector"></div>
        <div id="cvTailor" style="margin-top:10px"></div></div>
      ${a.job?.url && a.status !== 'soumise' ? `<button class="btn primary big" data-action="applyJob">${tr('Postuler / connexion')}</button><div class="small muted">${tr('Ouvre dans ce navigateur : une session Workday valide est réutilisée. Compte propre à chaque entreprise ; mots de passe gérés par Chrome.')}</div>` : ''}
      <div class="row">
        ${a.job?.url ? `<button class="btn ghost" data-action="openJob">${tr('Voir l’offre')}</button>` : ''}
        <span class="grow"></span>
        <button class="btn ghost" data-action="newApp" title="${tr('Désactiver (l’historique reste dans le Journal)')}">${tr('Quitter cette candidature')}</button>
      </div>
    </div>`;
  cvInspector.mount({ element: $('#cvInspector'), server: S.server, applicationId: a.id, cvId: a.cvId || '', cv: selectedCv, available: !!selectedCv, disabled: cvSelectionLocked() });
  cvTailor.mount({ element: $('#cvTailor'), server: S.server, applicationId: a.id, cvId: a.cvId || '', cv: selectedCv, application: a, health: S.health, available: !!selectedCv && !!a.job?.title, disabled: otherCvBusy() || !!S.fillRun });
}

export function renderApp() {
  renderHome();
  renderPage();
  renderAppCard();
  renderLetter();
  renderFill();
}

export function openJob() {
  return chrome.tabs.create({ url: S.app.job.url });
}

export async function applyJob() {
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
}
