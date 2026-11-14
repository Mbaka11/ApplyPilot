// Remplissage du formulaire : exécution annulable, documents SuccessFactors, mémoire, diagnostic.
import { createFormDiagnostic, downloadFormDiagnostic } from '../form-diagnostic.mjs';
import { S, VERSION } from '../state.mjs';
import { $, esc, tr, toast, paint, infoButton, infoBody } from '../ui.mjs';
import { api, loadApps } from '../api.mjs';
import { activeTab, scriptable, exec, runInTab } from '../tabs.mjs';
import { renderPage, renderAppCard, renderApp, patchApp, syncCvControls } from './application.mjs';
import { renderLetter, saveLetter, signature } from './letter.mjs';
import { searchPanel } from './search.mjs';
import { pageHasForm, primaryAction } from './actionbar.mjs';
import { renderStepper } from './stepper.mjs';

// Explicit local export; no server, provider, answer memory or content-script reinjection.
export async function exportFormDiagnostic() {
  if (S.diagnosticBusy || S.fillBusy) throw new Error('Attends la fin du remplissage ou du diagnostic.');
  const tab = await activeTab();
  if (!tab || !scriptable(tab.url)) throw new Error('Ouvre une offre ou un formulaire de candidature (page web).');
  S.diagnosticBusy = true;
  renderPage(); renderFill();
  try {
    const json = await createFormDiagnostic({ tabId: tab.id, version: VERSION, isCurrent: async () => {
      const current = await activeTab();
      return !S.fillBusy && current?.id === tab.id && current?.url === tab.url;
    } });
    downloadFormDiagnostic(json);
    toast('Téléchargement du diagnostic demandé. Vérifie le fichier avant de le partager.');
  } finally {
    S.diagnosticBusy = false;
    renderPage(); renderFill();
  }
}

// ---------------------------------------------------------------------------
// Remplissage
// ---------------------------------------------------------------------------
const abortFillError = () => Object.assign(new Error('Remplissage arrêté'), { name: 'AbortError' });
function assertFill(run) {
  if (S.fillRun !== run || run.controller.signal.aborted) throw abortFillError();
}

export function stopFill({ pageChanged = false, timedOut = false } = {}) {
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
  if (run.documents) renderLetter();
  toast(timedOut ? 'L’IA met trop de temps : remplissage arrêté. Réessaie ou désactive l’IA.' : pageChanged
    ? 'Étape changée : ancien remplissage arrêté. Tu peux remplir cette page.'
    : run.documents ? 'Préparation arrêtée. Les fichiers déjà transmis restent sur le site.' : 'Remplissage arrêté. Les champs déjà remplis sont conservés.');
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

// A separate explicit action: preparing documents may consume provider quota and send PDFs to the employer.
/** The adapted copy replaces the base PDF only when the user opted in for this application and it is still current. */
async function cvFile(app, request) {
  if (!app.cvTailored?.useForForms) return request(`/cvs/${encodeURIComponent(app.cvId)}/pdf?base64=1`);
  const { tailoredCv } = await request(`/applications/${encodeURIComponent(app.id)}/cv-tailored`);
  if (tailoredCv.stale.baseChanged || tailoredCv.stale.jobChanged || tailoredCv.stale.cvChanged) throw new Error('Le CV adapté est périmé : régénère-le ou désactive son utilisation.');
  return request(`/applications/${encodeURIComponent(app.id)}/cv-tailored.pdf?base64=1`);
}

export async function prepareAndAttachDocuments() {
  if (S.fillRun || S.diagnosticBusy || S.cvBusy || S.appBusy || S.switching || S.letterBusy || searchPanel.running) return toast('Attends la fin de l’opération sur cette candidature.', 'error');
  if (S.health?.features?.documentPreparation !== 1) return toast('Redémarre le serveur ApplyPilot pour activer les documents automatiques.', 'error');
  const selected = S.cvs.find(cv => cv.id === S.app?.cvId);
  if (!S.app || !selected || !S.app.job?.title || !S.app.job?.company || !(Number(S.app.job.descriptionLength) >= 100) || S.app.status === 'soumise') return toast('Analyse l’offre et sélectionne son CV avant la préparation automatique.', 'error');
  if (S.draftDirty) return toast('Enregistre ton brouillon de lettre avant de joindre les documents.', 'error');
  const appId = S.app.id, cvId = S.app.cvId, server = S.server, instructions = S.letterInstructions;
  const tab = await activeTab();
  if (S.fillRun || S.diagnosticBusy || S.app?.id !== appId || S.app?.cvId !== cvId || S.server !== server || S.draftDirty) return;
  if (!tab || !scriptable(tab.url) || S.page?.platform !== 'successfactors') return toast('Documents automatiques disponibles uniquement sur la page principale SuccessFactors.', 'error');
  if (!confirm(tr('Joindre le CV « {cv} » et la lettre pour « {title} » — {company} à la page {host} ?\nUne lettre absente sera générée avec l’IA (quota habituel). La lettre existante sera conservée. Rien ne sera soumis. Arrêter ne retire pas les fichiers déjà transmis.', { cv: S.app.cvTailored?.useForForms ? tr('{name} (adapté à l’offre)', { name: selected.name }) : selected.name, title: S.app.job.title, company: S.app.job.company, host: new URL(tab.url).hostname }))) return;
  const run = { id: crypto.randomUUID(), controller: new AbortController(), tabId: tab.id, pages: null, documents: true };
  let draftState = JSON.stringify(S.draft);
  const guard = () => {
    assertFill(run);
    if (S.server !== server || S.app?.id !== appId || S.app?.cvId !== cvId || S.app?.status === 'soumise' || JSON.stringify(S.draft) !== draftState || S.letterInstructions !== instructions) throw new Error('Candidature ou brouillon modifié : documents arrêtés.');
  };
  const request = (path, options = {}) => { guard(); return api(path, { ...options, signal: run.controller.signal }); };
  const phase = text => { guard(); S.fillPhase = text; renderFill(); };
  S.fillRun = run; S.fillBusy = true; S.fillPhase = 'Vérification des zones CV et lettre…';
  S.fill = { results: [], info: {}, at: Date.now(), noCv: false };
  renderFill(); renderLetter();
  try {
    const pages = await runInTab('detect', {}, { tabId: tab.id }); guard();
    const top = pages.find(page => page.isTop && page.platform === 'successfactors');
    if (!top || top.url !== tab.url) throw new Error('Documents automatiques disponibles uniquement sur la page principale SuccessFactors.');
    run.pages = [top];
    const { application: fresh } = await request(`/applications/${encodeURIComponent(appId)}`); guard();
    if (fresh.cvId !== cvId || fresh.status === 'soumise' || fresh.job.title !== S.app.job.title || fresh.job.company !== S.app.job.company || JSON.stringify(fresh.letter) !== JSON.stringify(S.app.letter) || !!fresh.cvTailored?.useForForms !== !!S.app.cvTailored?.useForForms || fresh.cvTailored?.createdAt !== S.app.cvTailored?.createdAt) throw new Error('Candidature ou brouillon modifié : documents arrêtés.');
    if (fresh.letter?.cvId && fresh.letter.cvId !== cvId) throw new Error('La lettre correspond à un autre CV : révise-la avant de la joindre.');
    const cvSource = await request(`/cvs/${encodeURIComponent(cvId)}/details`); guard();
    const files = { cv: await cvFile(fresh, request) }; guard();
    const checkCvSource = async () => {
      const current = await request(`/cvs/${encodeURIComponent(cvId)}/details`); guard();
      if (current.modifiedAt !== cvSource.modifiedAt || current.size !== cvSource.size || current.pdfPath !== cvSource.pdfPath) throw new Error('Le fichier CV a changé pendant la préparation : aucun autre document envoyé.');
    };
    const [plan] = await execFill(run, 'sfDocumentPlan', { documentNames: { cv: files.cv.name, letter: fresh.letter?.fileName || '' } }); guard();
    if (Object.values(plan.present).includes('other')) throw new Error('Une pièce est déjà présente dans cette zone : aucun remplacement automatique.');
    if (!fresh.letter?.fileName) {
      const settings = await request('/generation'); guard();
      S.health.generation = settings; renderLetter();
      phase('Génération de la lettre et du PDF…');
      const { application } = await request(`/applications/${encodeURIComponent(appId)}/letter`, { method: 'POST', body: { onlyIfMissing: true, cvId, language: S.prefs.letterLang, instructions, uiLanguage: S.uiLanguage } }); guard();
      if (application.cvId !== cvId || application.letter?.cvId && application.letter.cvId !== cvId) throw new Error('La lettre correspond à un autre CV : révise-la avant de la joindre.');
      S.app = application;
      S.draft = { subject: application.letter.subject, body: application.letter.body }; S.draftDirty = false;
      draftState = JSON.stringify(S.draft);
      await loadApps(); guard();
    }
    files.letter = await request(`/applications/${encodeURIComponent(appId)}/letter.pdf?base64=1`); guard();
    const expectedLetter = JSON.stringify(S.app.letter);
    for (const documentKind of ['cv', 'letter']) {
      await checkCvSource(); guard();
      const { application } = await request(`/applications/${encodeURIComponent(appId)}`); guard();
      if (application.cvId !== cvId || application.status === 'soumise' || JSON.stringify(application.letter) !== expectedLetter) throw new Error('Candidature ou brouillon modifié : documents arrêtés.');
      if (!!application.cvTailored?.useForForms !== !!fresh.cvTailored?.useForForms || application.cvTailored?.createdAt !== fresh.cvTailored?.createdAt) throw new Error('Le CV adapté a changé pendant la préparation : aucun autre document envoyé.');
      phase(documentKind === 'cv' ? 'Téléversement du CV…' : 'Téléversement de la lettre PDF…');
      const [outcome] = await execFill(run, 'sfAttachDocument', { ticket: plan.ticket, documentKind, file: files[documentKind] }); guard();
      S.fill.results.push(outcome.result);
      if (!outcome.completed) {
        if (documentKind === 'cv') S.fill.results.push({ id: '', label: 'Lettre d’accompagnement', kind: 'manual-action', status: 'todo', note: 'Lettre non envoyée : vérifie le transfert du CV avant de relancer.' });
        break;
      }
    }
  } catch (error) {
    if (S.fillRun === run && error.name !== 'AbortError') {
      S.fill.results.push({ id: '', label: 'CV / lettre', kind: 'manual-action', status: 'todo', note: error.message });
      toast(error.message, 'error');
    }
  } finally {
    if (S.fillRun === run) { S.fillRun = null; S.fillBusy = false; S.fillPhase = ''; renderFill(); renderLetter(); renderAppCard(); }
  }
}

export async function fillPage() {
  if (S.fillRun) return;
  if (S.diagnosticBusy) return toast('Attends la fin du remplissage ou du diagnostic.', 'error');
  if (S.cvBusy || S.appBusy || S.switching || S.letterBusy) return toast('Attends la fin de l’opération sur cette candidature.', 'error');
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
    if (S.app?.cvId) files.cv = await cvFile(S.app, request);
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
    const memoryFields = frames.flatMap((f) => f.memoryFields || []);
    const step = frames.find((f) => f.step)?.step || null;
    const info = frames.find((f) => f.info?.addedEntries)?.info || {};
    S.fill = { results, step, info, at: Date.now(), noCv: !files.cv };
    if (S.prefs.useAi && (unresolved.length || memoryFields.length)) {
      const asked = unresolved.length + memoryFields.length;
      S.fillPhase = `L’IA répond à ${asked} question${asked > 1 ? 's' : ''}…`;
      renderFill();
      try {
        run.answerTimer = setTimeout(() => { if (S.fillRun === run) stopFill({ timedOut: true }); }, 90_000);
        const { answers, memoryAnswers } = await request('/answers', {
          method: 'POST',
          body: { applicationId: S.app?.id, cvId: S.app?.cvId, job: S.app ? undefined : job, fields: unresolved, memoryAnswers: memoryFields, uiLanguage: S.uiLanguage },
        });
        clearTimeout(run.answerTimer);
        assertFill(run);
        S.fillPhase = 'Application des réponses…';
        renderFill();
        const filled = await execFill(run, 'fillValues', { ...payload, answers, memoryAnswers });
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

export async function captureMemory({ quiet = false } = {}) {
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

export async function markSubmitted() {
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

const RES_GROUPS = [
  ['check', 'À vérifier', 'warn'],
  ['todo', 'À compléter', 'bad'],
  ['ok', 'Remplis', 'ok'],
  ['kept', 'Déjà remplis (non modifiés)', 'grey'],
];
const groupOf = (r) => (r.status === 'fail' || r.status === 'unresolved' ? 'todo' : r.status === 'skip' ? 'check' : r.status);

export function renderFill() {
  syncCvControls();
  if ($('[data-action="diagnostic"]')) $('[data-action="diagnostic"]').disabled = S.fillBusy || S.diagnosticBusy;
  const el = $('#fillCard');
  if (S.fillBusy) {
    // « Arrêter » vit dans la barre d’action ; ici seulement la progression.
    paint(el, `<div class="block"><div class="busy" role="status"><span class="spinner" aria-hidden="true"></span><span>${esc(tr(S.fillPhase))}</span></div></div>`);
    renderStepper();
    renderSubmit();
    return;
  }
  const options = `<details class="options" id="fillOptions" ${S.optionsOpen ? 'open' : ''}><summary>${tr('Options')}</summary>
      <div class="stack small">
        <label class="check"><input type="checkbox" id="optAi" ${S.prefs.useAi ? 'checked' : ''}> ${tr('Faire répondre l’IA aux questions restantes')}</label>
        <label class="check"><input type="checkbox" id="optEntries" ${S.prefs.addEntries ? 'checked' : ''}> ${tr('Workday : ajouter mes expériences et formations si la section est vide')}</label>
        <label class="check"><input type="checkbox" id="optOverwrite" ${S.prefs.overwrite ? 'checked' : ''}> ${tr('Remplacer les champs déjà remplis')}</label>
      </div></details>`;
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
    if (S.fill.noCv) body += `<div class="small text-warn">${tr('Aucun CV joint : analyse l’offre d’abord pour choisir un CV.')}</div>`;
    for (const [k, t] of RES_GROUPS) {
      const list = groups[k];
      if (!list?.length) continue;
      const items = list
        .map(
          (r) => `<li class="${k}" data-focus="${esc(r.id)}" tabindex="0"><div><span class="lbl">${esc(r.label === '(sans libellé)' ? tr(r.label) : r.label)}</span>${r.required ? ' <span class="muted">*</span>' : ''}</div>
          ${r.value ? `<div class="val">${esc(['checkbox', 'checkboxes'].includes(r.kind) ? tr(r.value) : r.value)}</div>` : ''}${r.note ? `<div class="note">${esc(tr(r.note))}${r.source === 'ia' ? ` · ${tr('IA')}` : ''}</div>` : ''}</li>`,
        )
        .join('');
      const open = k === 'check' || k === 'todo';
      body += `<details ${open ? 'open' : ''}><summary>${tr(t)} (${list.length})</summary><ul class="results">${items}</ul></details>`;
    }
  } else if (!pageHasForm()) {
    const canOpen = S.app?.job?.url && S.app.status !== 'soumise' && primaryAction()?.kind !== 'applyJob';
    body += `<div class="empty small">${tr('Ouvre le formulaire de candidature, puis lance le remplissage.')}</div>
      ${canOpen ? `<div class="row"><button type="button" class="btn" data-action="applyJob">${tr('Postuler / connexion')}</button>${infoButton('info-apply')}</div>${infoBody('info-apply', tr('Ouvre dans ce navigateur : une session Workday valide est réutilisée. Compte propre à chaque entreprise ; mots de passe gérés par Chrome.'))}` : ''}`;
  } else {
    body += `<div class="small muted">${tr('Prêt : relis le résultat, puis passe à l’étape suivante du formulaire.')}</div>`;
  }
  const documents = S.page?.platform === 'successfactors'
    ? `<div class="row"><button type="button" class="btn" data-action="prepareDocuments" ${S.diagnosticBusy ? 'disabled' : ''}>${tr('Préparer et joindre CV + lettre')}</button>${infoButton('info-documents')}</div>
      ${infoBody('info-documents', tr('Génère la lettre manquante et son PDF, puis joint les documents sans soumettre. Aucun remplacement automatique.'))}`
    : '';
  paint(el, `<div class="block">${body}${documents}${options}</div>`);
  renderStepper();
  renderSubmit();
}

export function renderSubmit() {
  const el = $('#submitCard');
  if (!el) return;
  if (!S.app) {
    el.innerHTML = `<div class="empty small">${tr('Analyse d’abord une offre pour suivre sa soumission.')}</div>
      <div class="row"><button type="button" class="btn ghost" data-action="memorize">${tr('Mémoriser mes réponses')}</button></div>`;
    return;
  }
  const submitted = S.app.status === 'soumise';
  el.innerHTML = `<div class="block"><div class="rule"><span aria-hidden="true">🔒</span><span>${tr('ApplyPilot ne clique jamais sur « Soumettre » : tu envoies toi-même le formulaire.')}</span>${infoButton('info-submit')}</div>
    ${infoBody('info-submit', tr('ApplyPilot ne clique jamais sur « Soumettre » : vérifie la page, passe à l’étape suivante, puis relance le remplissage.'))}
    <div class="row block-actions">
      <button type="button" class="btn ${submitted ? '' : 'primary'}" data-action="submitted" ${submitted ? 'disabled' : ''}>${tr(submitted ? 'Soumise ✓' : 'J’ai soumis ✓')}</button>
      <button type="button" class="btn ghost" data-action="memorize" title="${tr('Retenir tes réponses aux questions de cette page pour les prochaines candidatures')}">${tr('Mémoriser mes réponses')}</button>
    </div></div>`;
}
