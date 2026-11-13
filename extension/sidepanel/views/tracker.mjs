// Onglet Suivi (journal) : liste, statuts et suppression des candidatures.
import { S } from '../state.mjs';
import { $, esc, tr, toast, statusLabel, fmtDate } from '../ui.mjs';
import { api, loadApps } from '../api.mjs';
import { setActiveApp } from './application.mjs';

export function renderJournal() {
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
