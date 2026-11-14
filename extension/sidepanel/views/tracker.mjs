// Onglet Suivi (journal) : liste, statuts et suppression des candidatures.
import { S } from '../state.mjs';
import { $, esc, tr, toast, statusLabel, fmtDate } from '../ui.mjs';
import { api, loadApps } from '../api.mjs';
import { setActiveApp } from './application.mjs';
import { statsHtml } from './stats.mjs';

export async function loadStats() {
  try { S.stats = await api('/stats'); } catch { S.stats = null; }
}

export async function setJournalView(view) {
  S.journalView = view === 'stats' ? 'stats' : 'list';
  renderJournal();
  if (S.journalView === 'stats') { await loadStats(); if (S.journalView === 'stats') renderJournal(); }
}

const viewSwitch = () => `<div class="seg" role="group" aria-label="${esc(tr('Affichage du suivi'))}">${[['list', 'Liste'], ['stats', 'Statistiques']].map(([key, label]) => `<button type="button" data-journal-view="${key}" aria-pressed="${S.journalView === key}">${esc(tr(label))}</button>`).join('')}</div>`;

export function renderJournal() {
  const el = $('#tab-journal');
  if (!S.health) {
    el.innerHTML = `<div class="card muted">${tr('Serveur non connecté.')}</div>`;
    return;
  }
  if (S.journalView === 'stats') {
    el.innerHTML = `<div class="card"><div class="card-head"><h2>${tr('Statistiques')}</h2></div>${viewSwitch()}${statsHtml(S.stats)}</div>`;
    return;
  }
  const counts = {};
  for (const a of S.apps) counts[a.status] = (counts[a.status] || 0) + 1;
  const items = S.apps
    .map(
      (a) => `<li><div class="row"><b class="grow ellipsis">${esc(a.company || '?')}</b><span class="small muted">${esc(fmtDate(a.createdAt))}</span></div>
      <div class="small ellipsis">${esc(a.title || '')}</div>
      <div class="row item-actions">
        <select data-status="${esc(a.id)}" aria-label="${esc(tr('Statut'))}">${S.statuses.map((s) => `<option value="${esc(s)}" ${s === a.status ? 'selected' : ''}>${esc(statusLabel(s))}</option>`).join('')}</select>
        <span class="grow"></span>
        <button type="button" class="btn sm" data-activate="${esc(a.id)}">${tr('Activer')}</button>
        <details class="more more-menu"><summary aria-label="${esc(tr('Plus d’actions'))}">⋯</summary><div class="more-body stack">
          ${a.url ? `<button type="button" class="btn ghost sm" data-open-url="${esc(a.url)}">${tr('Offre')}</button>` : ''}
          ${a.hasLetter ? `<button type="button" class="btn ghost sm" data-open-letter="${esc(a.id)}">${tr('Lettre')}</button>` : ''}
          <button type="button" class="btn ghost sm danger" data-delete="${esc(a.id)}">${tr('Supprimer')}</button>
        </div></details>
      </div></li>`,
    )
    .join('');
  el.innerHTML = `<div class="card"><div class="card-head"><h2>${tr('Journal')} (${S.apps.length})</h2>
      <details class="more more-menu"><summary aria-label="${esc(tr('Plus d’actions'))}">⋯</summary><div class="more-body"><button type="button" class="btn" data-action="exportCsv">${tr('Exporter CSV')}</button></div></details></div>
    ${viewSwitch()}
    <div class="summary">${Object.entries(counts).map(([s, n]) => `<span class="badge ${s === 'soumise' ? 'ok' : s === 'refusée' ? 'bad' : s === 'entrevue' || s === 'offre' ? 'warn' : ''}">${n} ${esc(statusLabel(s).toLowerCase())}</span>`).join('')}</div>
    ${S.apps.length ? `<ul class="list">${items}</ul>` : `<div class="empty small">${tr('Aucune candidature pour l’instant.')}</div>`}</div>`;
}

export async function deleteApplication(id) {
  if (id === S.app?.id && (S.letterBusy || S.appBusy)) throw new Error('Attends la fin de l’opération sur cette candidature.');
  const a = S.apps.find((x) => x.id === id);
  if (!confirm(tr('Supprimer la candidature « {name} » et sa lettre ?', { name: `${a?.company || ''} — ${a?.title || ''}` }))) return;
  await api(`/applications/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (S.app?.id === id) await setActiveApp(null);
  await loadApps();
  return renderJournal();
}

export async function changeStatus(id, status) {
  const { application } = await api(`/applications/${encodeURIComponent(id)}`, { method: 'PATCH', body: { status } });
  if (S.app?.id === application.id) S.app = application;
  await loadApps();
  renderJournal();
  toast('Statut mis à jour ✓');
}
