// Lettre de motivation : génération, brouillon, PDF et provenance.
import { S } from '../state.mjs';
import { $, esc, tr, toast } from '../ui.mjs';
import { api, loadApps } from '../api.mjs';
import { syncCvControls } from './application.mjs';

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

function generationHtml(generation, observed = false) {
  if (!generation) return `<div class="small muted generation-info">${tr(observed ? 'Ancienne lettre : modèle et effort non enregistrés.' : 'Paramètres de génération indisponibles.')}</div>`;
  const model = observed ? (generation.model ? [generation.provider, generation.model].filter(Boolean).join('/') : tr('Modèle non rapporté par pi')) : generation.requestedModel || tr('Automatique — choisi par pi');
  return `<div class="small generation-info"><b>${tr(observed ? 'Dernière génération · rapportée par pi' : 'Prochaine génération')}</b><div>${tr('Modèle')} : <span class="generation-model">${esc(model)}</span></div><div>${tr('Effort demandé')} : <b>${esc(generation.requestedThinking || tr('Valeur par défaut de pi'))}</b></div><div class="muted">${tr('Le niveau réellement appliqué n’est pas rapporté par pi. Aucun raisonnement interne n’est affiché.')}</div></div>`;
}

export function renderLetter() {
  syncCvControls();
  const el = $('#letterCard');
  if (S.fillRun?.documents) {
    el.innerHTML = `<h2>${tr('Lettre')}</h2><div class="small muted">${tr('Préparation des documents en cours. Le brouillon existant est conservé.')}</div>${generationHtml(S.health?.generation?.letter)}`;
    return;
  }
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
      <div class="small" style="font-weight:400">${tr('Environ 20 à 60 s.')}</div></div>${generationHtml(S.letterGeneration)}`;
    return;
  }
  const head = `<h2><span>${tr('Lettre de motivation')}</span>${L ? `<span class="badge ok">${esc((L.language || '').toUpperCase())} · ${tr('PDF prêt')}</span>` : ''}</h2>`;
  const gen = `${generationHtml(S.health?.generation?.letter)}<details ${L ? '' : 'open'}><summary>${tr(L ? 'Régénérer' : 'Générer')} ${tr('avec des consignes (facultatif)')}</summary>
      <textarea id="letterInstructions" rows="2" placeholder="${tr('Ex. : insiste sur mon projet RL, ton plus formel, mentionne ma disponibilité à temps plein…')}">${esc(S.letterInstructions)}</textarea></details>
    <div class="row">${langSel}<span class="grow"></span><button class="btn ${L ? '' : 'primary'}" data-action="generate">${tr(L ? 'Régénérer' : 'Générer la lettre')}</button></div>`;
  if (!L || !S.draft) {
    el.innerHTML = `${head}<div class="stack">${gen}</div>`;
    return;
  }
  el.innerHTML = `${head}<div class="stack">
    ${generationHtml(L.generation, true)}${L.editedAfterGeneration ? `<div class="small muted">${tr('Lettre modifiée manuellement après la génération.')}</div>` : ''}
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

export async function copyLetter() {
  const { profile } = await api('/profile');
  await navigator.clipboard.writeText(`${S.draft.body}\n\n${signature(profile)}`);
  toast('Texte copié ✓');
}
