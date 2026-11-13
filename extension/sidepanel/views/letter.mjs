// Lettre de motivation : génération, brouillon, PDF et provenance.
import { S } from '../state.mjs';
import { $, esc, tr, toast, infoButton, infoBody, modelLabel, fmtCost } from '../ui.mjs';
import { api, loadApps } from '../api.mjs';
import { syncCvControls } from './application.mjs';
import { primaryAction } from './actionbar.mjs';
import { renderStepper } from './stepper.mjs';

let tickTimer = null;
export async function generateLetter() {
  if (!S.app || S.letterBusy || S.appBusy || S.cvBusy || S.switching || S.fillBusy) return;
  if (S.draftDirty && !confirm(tr('Régénérer la lettre et remplacer le brouillon non enregistré ?'))) return;
  const appId = S.app.id, instructions = S.letterInstructions;
  S.letterGeneration = S.health?.generation?.letter || null;
  S.letterBusy = true;
  S.letterT0 = Date.now();
  renderLetter();
  clearInterval(tickTimer);
  tickTimer = setInterval(() => {
    const el = $('#letterTimer');
    if (el) el.textContent = `${Math.round((Date.now() - S.letterT0) / 1000)} s`;
  }, 1000);
  try {
    const settings = await api('/generation');
    if (S.health) S.health.generation = settings;
    S.letterGeneration = settings.letter;
    renderLetter();
    const { application, letter } = await api(`/applications/${encodeURIComponent(appId)}/letter`, {
      method: 'POST',
      body: { language: S.prefs.letterLang, instructions, cvId: S.app.cvId, uiLanguage: S.uiLanguage },
    });
    if (S.app?.id === appId) { S.app = application; S.draft = { subject: letter.subject, body: letter.body }; S.draftDirty = false; }
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

export async function saveLetter() {
  if (!S.app || !S.draft || S.appBusy || S.letterBusy || S.cvBusy || S.switching || S.fillRun?.documents) return;
  S.appBusy = true; syncCvControls();
  const savedDraft = { ...S.draft };
  try {
  const { application } = await api(`/applications/${encodeURIComponent(S.app.id)}/letter`, {
    method: 'PUT',
    body: { subject: savedDraft.subject, body: savedDraft.body },
  });
  S.app = application;
  S.draftDirty = S.draft.subject !== savedDraft.subject || S.draft.body !== savedDraft.body;
  renderLetter();
  toast('PDF mis à jour ✓');
  } finally { S.appBusy = false; syncCvControls(); }
}

export function letterUrl() {
  return `${S.server}/applications/${encodeURIComponent(S.app.id)}/letter.pdf?t=${Date.now()}`;
}

export function signature(profile) {
  const id = profile?.identity || {};
  return profile?.letter?.signatureName || [id.firstName, id.lastName].filter(Boolean).join(' ');
}

/** « Sonnet 5.5 · effort medium · 0,02 $ » ou « pi · modèle · effort » : une seule ligne, le détail est derrière ⓘ. */
export function provenanceLine(generation, { observed = false } = {}) {
  const claude = observed ? generation?.providerKind === 'claude-cli' : S.health?.llm?.provider === 'claude';
  const effort = generation?.requestedThinking ? tr('effort {level}', { level: generation.requestedThinking }) : tr('effort par défaut');
  if (claude) {
    const cost = observed && Number.isFinite(generation?.costUsd) ? fmtCost(generation.costUsd) : '';
    return [modelLabel(generation?.model || generation?.requestedModel) || tr('modèle automatique'), effort, cost].filter(Boolean).join(' · ');
  }
  const model = observed ? (generation?.model ? [generation.provider, generation.model].filter(Boolean).join('/') : tr('modèle non rapporté')) : generation?.requestedModel || tr('modèle automatique');
  return ['pi', model, effort].join(' · ');
}

function provenanceHtml(generation, { observed = false, id }) {
  if (!generation) return `<div class="provenance small muted">${tr(observed ? 'Ancienne lettre : modèle et effort non enregistrés.' : 'Paramètres de génération indisponibles.')}</div>`;
  const detail = observed
    ? `${tr('Dernière génération · rapportée par le fournisseur')}${generation.attempts > 1 ? ` · ${esc(tr('{count} essais', { count: generation.attempts }))}` : ''}`
    : tr('Prochaine génération');
  return `<div class="provenance small"><span class="provenance-line" title="${esc(detail)}">${esc(provenanceLine(generation, { observed }))}</span>${infoButton(id)}</div>
    ${infoBody(id, `<div>${esc(detail)}</div><div class="muted">${esc(tr('Le niveau d’effort réellement appliqué n’est pas toujours rapporté par le fournisseur. Aucun raisonnement interne n’est affiché.'))}</div>`)}`;
}

export function renderLetter() {
  syncCvControls();
  const el = $('#letterCard');
  const next = S.health?.generation?.letter;
  if (S.fillRun?.documents) {
    el.innerHTML = `<div class="block"><h3 class="block-title">${tr('Lettre de motivation')}</h3><div class="small muted">${tr('Préparation des documents en cours. Le brouillon existant est conservé.')}</div>${provenanceHtml(next, { id: 'info-letter-next' })}</div>`;
    renderStepper();
    return;
  }
  if (!S.app) {
    el.innerHTML = '';
    renderStepper();
    return;
  }
  const L = S.app.letter;
  const langSel = `<select id="letterLang" aria-label="${esc(tr('Langue de la lettre'))}">
      ${[['auto', tr('Langue de l’offre')], ['fr', 'Français'], ['en', 'English']].map(([v, label]) => `<option value="${v}" ${S.prefs.letterLang === v ? 'selected' : ''}>${label}</option>`).join('')}
    </select>`;
  if (S.letterBusy) {
    el.innerHTML = `<div class="block"><h3 class="block-title">${tr('Lettre de motivation')}</h3><div class="busy" role="status"><span class="spinner" aria-hidden="true"></span><span>${tr('L’IA rédige ta lettre…')} <span id="letterTimer">0 s</span></span></div>
      <div class="small muted">${tr('Environ 20 à 60 s.')}</div>${provenanceHtml(S.letterGeneration, { id: 'info-letter-next' })}</div>`;
    renderStepper();
    return;
  }
  const head = `<div class="row"><h3 class="block-title grow">${tr('Lettre de motivation')}</h3>${L ? `<span class="badge ok">${esc((L.language || '').toUpperCase())} · ${tr('PDF prêt')}</span>` : ''}</div>`;
  const generateButton = primaryAction()?.kind === 'generate' ? '' : `<button type="button" class="btn ${L ? '' : 'primary'}" data-action="generate">${tr(L ? 'Régénérer' : 'Générer la lettre')}</button>`;
  const gen = `<details class="instructions" ${L ? '' : 'open'}><summary>${tr('Consignes pour l’IA (facultatif)')}</summary>
      <textarea id="letterInstructions" rows="2" placeholder="${tr('Ex. : insiste sur mon projet RL, ton plus formel, mentionne ma disponibilité à temps plein…')}">${esc(S.letterInstructions)}</textarea></details>
    <div class="row">${langSel}<span class="grow"></span>${generateButton}</div>
    ${provenanceHtml(next, { id: 'info-letter-next' })}`;
  if (!L || !S.draft) {
    el.innerHTML = `<div class="block">${head}<div class="stack">${gen}</div></div>`;
    renderStepper();
    return;
  }
  const warnings = L.warnings?.length
    ? `<div class="hint"><span>${tr('À vérifier : {count} point(s) dans la lettre.', { count: L.warnings.length })}</span>${infoButton('info-letter-warnings')}</div>
      ${infoBody('info-letter-warnings', `<ul class="warnings">${L.warnings.map((w) => `<li>${esc(tr(w))}</li>`).join('')}</ul>`)}`
    : '';
  el.innerHTML = `<div class="block">${head}<div class="stack">
    ${provenanceHtml(L.generation, { observed: true, id: 'info-letter-last' })}${L.editedAfterGeneration ? `<div class="small muted">${tr('Lettre modifiée manuellement après la génération.')}</div>` : ''}
    <div><label class="field" for="letterSubject">${tr('Objet')}</label><input type="text" id="letterSubject" value="${esc(S.draft.subject)}"></div>
    <div><label class="field" for="letterBody">${tr('Texte (paragraphes séparés par une ligne vide, sans la signature)')}</label>
      <textarea id="letterBody">${esc(S.draft.body)}</textarea></div>
    ${warnings}
    <div class="row">
      <button type="button" class="btn ${S.draftDirty ? 'primary' : ''}" data-action="saveLetter">${tr('Mettre à jour le PDF')}</button>
      <button type="button" class="btn" data-action="openLetter">${tr('Ouvrir le PDF')}</button>
      <button type="button" class="btn ghost" data-action="copyLetter">${tr('Copier le texte')}</button>
    </div>
    <div class="small muted">${esc(L.fileName || '')}${L.fit && !L.fit.fitsOnePage ? tr(' · ⚠️ dépasse une page : raccourcis le texte') : ''}</div>
    ${gen}</div></div>`;
  renderStepper();
}

export async function copyLetter() {
  const { profile } = await api('/profile');
  await navigator.clipboard.writeText(`${S.draft.body}\n\n${signature(profile)}`);
  toast('Texte copié ✓');
}
