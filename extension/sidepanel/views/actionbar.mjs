// Barre d’action collante : l’action principale du contexte, et « Arrêter » pendant un remplissage ou une recherche.
import { S } from '../state.mjs';
import { $, esc, tr } from '../ui.mjs';
import { searchPanel } from './search.mjs';

export const pageHasForm = (p = S.page) => !!p && (p.fieldCount > 0 || p.fileCount > 0 || p.manualActionCount > 0);
export const knownApplication = (p = S.page) => (p?.jobKey ? S.apps.find((a) => a.jobKey && a.jobKey === p.jobKey) : null);

/** Une autre offre que celle de la candidature ouverte : la reprendre si elle est connue, sinon l’analyser. */
export function newContext(p = S.page) {
  if (!p) return null;
  const known = knownApplication(p);
  if (known && known.id !== S.app?.id) return { kind: 'resume', id: known.id };
  if (p.isPosting && !known) return { kind: 'analyze' };
  return null;
}

/** L’unique action principale proposée dans la barre, selon l’onglet, la page et la candidature. */
export function primaryAction() {
  if (S.fillBusy) return { kind: 'stopFill' };
  if (searchPanel.running) return { kind: 'stopSearch' };
  if (S.tab !== 'app') return null;
  const p = S.page;
  const next = newContext(p);
  if (next) return next;
  if (!S.app) return p ? (pageHasForm(p) ? { kind: 'fill' } : { kind: 'analyzeAnyway' }) : null;
  if (pageHasForm(p)) return { kind: 'fill' };
  if (S.letterBusy) return null;
  if (!S.app.letter) return { kind: 'generate' };
  if (S.app.job?.url && S.app.status !== 'soumise') return { kind: 'applyJob' };
  return null;
}

export function renderActionBar() {
  const el = $('#actionBar');
  if (!el) return;
  const a = primaryAction();
  document.body.classList.toggle('has-bar', !!a);
  if (!a) {
    el.classList.add('hidden');
    el.dataset.sig = '';
    el.innerHTML = '';
    return;
  }
  const idle = !S.health || S.appBusy || S.cvBusy || S.switching || S.letterBusy || S.diagnosticBusy || searchPanel.running;
  let html;
  if (a.kind === 'stopFill') {
    html = `<div class="bar-status" role="status"><span class="spinner" aria-hidden="true"></span><span>${esc(tr(S.fillPhase || 'Préparation…'))}</span></div>
      <button type="button" class="btn danger lg" data-action="stopFill">${tr('Arrêter')}</button>
      <div class="bar-note">${tr('Ne touche pas à la page pendant le remplissage.')}</div>`;
  } else if (a.kind === 'stopSearch') {
    const p = searchPanel.progress;
    html = `<div class="bar-status" role="status"><span class="spinner" aria-hidden="true"></span><span>${esc(p ? tr('Recherche {page}/{total} · {found} lien(s) lu(s)', p) : tr('Préparation de la recherche…'))}</span></div>
      <button type="button" class="btn danger lg" data-action="stopSearch">${tr('Arrêter la recherche')}</button>`;
  } else if (a.kind === 'resume') {
    html = `<button type="button" class="btn primary lg" data-activate="${esc(a.id)}">${tr('Reprendre cette candidature')}</button>`;
  } else if (a.kind === 'analyze' || a.kind === 'analyzeAnyway') {
    html = `<button type="button" class="btn ${a.kind === 'analyze' ? 'primary' : ''} lg" data-action="analyze" ${idle ? 'disabled' : ''}>${tr(a.kind === 'analyze' ? 'Analyser cette offre' : 'Analyser quand même')}</button>`;
  } else if (a.kind === 'generate') {
    html = `<button type="button" class="btn primary lg" data-action="generate" ${idle || S.fillBusy ? 'disabled' : ''}>${tr('Générer la lettre')}</button>`;
  } else if (a.kind === 'applyJob') {
    html = `<button type="button" class="btn primary lg" data-action="applyJob">${tr('Postuler / connexion')}</button>`;
  } else {
    html = `<button type="button" class="btn primary lg" data-action="fill" ${idle ? 'disabled' : ''}>${tr(S.fill ? 'Remplir à nouveau' : 'Remplir cette page')}</button>
      <div class="bar-note">${tr('Ne clique jamais sur « Soumettre ».')}</div>`;
  }
  if (el.dataset.sig !== html) {
    el.innerHTML = html;
    el.dataset.sig = html;
  }
  el.classList.remove('hidden');
}
