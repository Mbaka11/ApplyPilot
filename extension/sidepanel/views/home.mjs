// Onglet Accueil.
import { S } from '../state.mjs';
import { $, esc, tr, statusLabel } from '../ui.mjs';
import { hasLetterDraft } from './application.mjs';

export function renderHome() {
  const el = $('#tab-home');
  const ongoing = S.apps.filter(app => app.status === 'en cours').length;
  const sent = S.apps.filter(app => app.status === 'soumise').length;
  const recent = S.apps.slice(0, 5);
  const current = S.page && S.apps.find(app => app.jobKey && app.jobKey === S.page.jobKey);
  const context = current
    ? `<h3>${esc(current.company)} · ${esc(current.title)}</h3><button class="btn" data-activate="${esc(current.id)}">${tr('Reprendre cette candidature')}</button>`
    : S.page?.isPosting
      ? `<h3>${esc(S.page.title)}</h3><div class="muted small">${esc(S.page.company)}</div><button class="btn primary" data-action="analyze" ${S.health ? '' : 'disabled'}>${tr('Analyser cette offre')}</button>`
      : `<div class="small muted">${esc(tr(S.page?.fieldCount ? 'Un formulaire est ouvert. Choisis une candidature ou utilise le remplissage du profil.' : S.pageError || 'Ouvre une offre pour l’analyser, ou commence par une recherche.'))}</div>${S.page?.fieldCount ? `<button class="btn" data-tab="app">${tr('Voir le formulaire')}</button>` : ''}`;
  el.innerHTML = `<div class="card home-hero"><h2>${tr('Ta prochaine candidature')}</h2><p>${tr('Trouve une offre, examine-la, puis choisis quand commencer ou reprendre une candidature.')}</p>
      <div class="row"><button class="btn primary" data-tab="search">${tr('Trouver des stages')}</button><button class="btn" data-tab="journal">${tr('Voir le suivi')}</button></div>
      <p class="small muted">${tr('Aucune reprise automatique. Quitter une candidature ne la marque pas comme soumise.')}</p></div>
    <div class="home-metrics">
      <button class="card" data-tab="search"><b>${S.searchSummary?.identified ?? '—'}</b><span>${tr('Offres identifiées')}</span></button>
      <button class="card" data-tab="journal"><b>${ongoing}</b><span>${tr('En cours')}</span></button>
      <button class="card" data-tab="journal"><b>${sent}</b><span>${tr('Soumises')}</span></button>
    </div>
    <div class="card"><h2>${tr('Onglet actuel')}</h2><div class="stack">${context}</div></div>
    ${S.app ? `<div class="card"><h2>${tr('Candidature ouverte dans ce panneau')}</h2><div>${esc(S.app.job.company)} · ${esc(S.app.job.title)}</div>${hasLetterDraft() ? `<div class="small muted">${tr('Ton brouillon est conservé tant que le panneau reste ouvert.')}</div>` : ''}<button class="btn" data-activate="${esc(S.app.id)}">${tr('Reprendre')}</button></div>` : ''}
    <div class="card"><h2>${tr('Candidatures récentes')}</h2>${recent.length ? `<ul class="list">${recent.map(app => `<li><div class="row"><b class="grow">${esc(app.company || '?')}</b><span class="badge grey">${esc(statusLabel(app.status))}</span></div><div>${esc(app.title)}</div><button class="btn ghost" data-activate="${esc(app.id)}">${tr(app.status === 'en cours' ? 'Reprendre' : 'Consulter')}</button></li>`).join('')}</ul>` : `<div class="small muted">${tr('Aucune candidature pour l’instant.')}</div>`}</div>
    ${S.health?.warnings?.length ? `<div class="card small"><b>${tr('Profil à compléter')}</b><p>${esc(tr('{count} point(s) du profil à vérifier avant de postuler.', { count: S.health.warnings.length }))}</p><button class="btn ghost" data-tab="profile">${tr('Vérifier mon profil')}</button></div>` : ''}`;
}
