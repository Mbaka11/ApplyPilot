// Onglet Accueil : une carte « Contexte », les compteurs et les candidatures récentes.
import { S } from '../state.mjs';
import { $, esc, tr, statusLabel, fmtDate } from '../ui.mjs';
import { searchPanel } from './search.mjs';
import { hasLetterDraft } from './application.mjs';

const BADGE = { soumise: 'ok', entrevue: 'warn', offre: 'ok', refusée: 'bad' };

function contextCard() {
  const current = S.page && S.apps.find(app => app.jobKey && app.jobKey === S.page.jobKey);
  const formOpen = S.page && (S.page.fieldCount > 0 || S.page.fileCount > 0);
  let body;
  if (current) {
    body = `<div class="ctx-title">${esc(current.company)} · ${esc(current.title)}</div><div class="small muted">${tr('Candidature connue pour cette offre.')}</div>
      <button type="button" class="btn primary" data-activate="${esc(current.id)}">${tr('Reprendre cette candidature')}</button>`;
  } else if (S.page?.isPosting) {
    body = `<div class="ctx-title">${esc(S.page.title || tr('Offre sans titre'))}</div><div class="small muted">${esc(S.page.company || '')}</div>
      <button type="button" class="btn primary" data-action="analyze" ${S.health ? '' : 'disabled'}>${tr('Analyser cette offre')}</button>`;
  } else if (formOpen) {
    body = `<div class="ctx-title">${tr('Un formulaire est ouvert')}</div><div class="small muted">${tr('Choisis une candidature, ou remplis la page avec ton profil.')}</div>
      <button type="button" class="btn primary" data-tab="app">${tr('Voir le formulaire')}</button>`;
  } else {
    body = `<div class="small muted">${esc(tr(S.pageError || 'Ouvre une offre pour l’analyser, ou commence par une recherche.'))}</div>
      <button type="button" class="btn primary" data-tab="search">${tr('Trouver des stages')}</button>`;
  }
  const open = S.app && S.app.id !== current?.id
    ? `<div class="ctx-open"><div class="small"><span class="muted">${tr('Ouverte dans ce panneau')}</span> · ${esc(S.app.job.company)} · ${esc(S.app.job.title)}</div>
        ${hasLetterDraft() ? `<div class="small muted">${tr('Ton brouillon est conservé tant que le panneau reste ouvert.')}</div>` : ''}
        <button type="button" class="btn" data-activate="${esc(S.app.id)}">${tr('Reprendre')}</button></div>` : '';
  return `<div class="card context"><h2>${tr('Maintenant')}</h2><div class="stack">${body}</div>${open}</div>`;
}

function newOffersCard() {
  const meta = S.searchMeta;
  if (!meta || !S.health) return '';
  const last = meta.lastRun && ['google', 'linkedin-public'].includes(meta.lastRun.source) && meta.lastRunAt ? meta.lastRun : null;
  const count = meta.newCount || 0;
  if (!last && !count) return '';
  const running = searchPanel.running;
  const source = last ? tr(last.source === 'google' ? 'Google' : 'LinkedIn public') : '';
  return `<div class="card new-offers">
    ${count ? `<button type="button" class="new-count" data-action="showNewOffers">${esc(tr('{count} nouvelle(s) offre(s) depuis ta dernière visite', { count }))}</button>` : ''}
    ${last ? `<div class="row small"><span class="grow muted">${esc(tr('Dernière recherche : {date}', { date: fmtDate(meta.lastRunAt) }))} · ${esc(source)}</span>
      <button type="button" class="btn sm" data-action="rerunSearch" ${running || !S.health ? 'disabled' : ''}>${tr(running ? 'Recherche en cours…' : 'Relancer')}</button></div>` : ''}
  </div>`;
}

export function renderHome() {
  const el = $('#tab-home');
  const ongoing = S.apps.filter(app => app.status === 'en cours').length;
  const sent = S.apps.filter(app => app.status === 'soumise').length;
  const recent = S.apps.slice(0, 5);
  el.innerHTML = `${contextCard()}${newOffersCard()}
    <div class="metrics">
      <button type="button" class="metric" data-tab="search"><b>${S.searchSummary?.identified ?? '—'}</b><span>${tr('Offres identifiées')}</span></button>
      <button type="button" class="metric" data-tab="journal"><b>${ongoing}</b><span>${tr('En cours')}</span></button>
      <button type="button" class="metric" data-tab="journal"><b>${sent}</b><span>${tr('Soumises')}</span></button>
    </div>
    <div class="card"><h2>${tr('Candidatures récentes')}</h2>${recent.length ? `<ul class="list">${recent.map(app => `<li><div class="row"><b class="grow ellipsis">${esc(app.company || '?')}</b><span class="badge ${BADGE[app.status] || 'grey'}">${esc(statusLabel(app.status))}</span></div><div class="small muted ellipsis">${esc(app.title)}</div><button type="button" class="btn ghost sm" data-activate="${esc(app.id)}">${tr(app.status === 'en cours' ? 'Reprendre' : 'Consulter')}</button></li>`).join('')}</ul>` : `<div class="empty small">${tr('Aucune candidature pour l’instant.')}</div>`}</div>
    ${S.health?.warnings?.length ? `<div class="card"><div class="row"><span class="grow small">${esc(tr('{count} point(s) du profil à vérifier avant de postuler.', { count: S.health.warnings.length }))}</span><button type="button" class="btn ghost sm" data-tab="profile">${tr('Vérifier mon profil')}</button></div></div>` : ''}`;
}
