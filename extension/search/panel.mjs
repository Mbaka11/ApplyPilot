import { CATEGORIES, SCOPES, searchDefaults, validateSettings, buildSearchPlan, linkedinSearchUrl, externalJobUrl, isLinkedIn, normal } from './core.mjs';
import { runGoogleSearch } from './runner.mjs';

export function createSearchPanel({ element, stopButton, api, tr, esc, fmtDate, toast, canStart, activateApplication }) {
  const state = { settings: null, jobs: [], loaded: false, dirty: false, loading: false, mutating: false, revision: 0, run: null, progress: null, message: '', tone: '', lastTabId: null, filter: 'visible', text: '', limit: 30,
    draft: { links: '', title: '', company: '', location: '', employerUrl: '', description: '' }, detailsOpen: false, planOpen: false };
  const busy = () => !!state.run || state.mutating || state.loading;
  const $ = selector => element.querySelector(selector);
  const label = source => esc(tr(source));
  const button = (action, title, id = '', extra = '') => `<button type="button" class="btn ${extra}" data-search-action="${action}" ${id ? `data-search-id="${esc(id)}"` : ''} ${busy() && !['stop', 'viewTab'].includes(action) ? 'disabled' : ''}>${label(title)}</button>`;
  function feedback(message, tone = '') { state.message = message; state.tone = tone; renderProgress(); }
  function adopt(data, { settings = false } = {}) {
    state.jobs = data.jobs || [];
    if (!state.settings || settings || !state.dirty) state.settings = data.settings || searchDefaults();
    state.loaded = true;
  }
  function renderProgress() {
    stopButton.classList.toggle('hidden', !state.run);
    stopButton.textContent = tr('Arrêter la recherche');
    if (!$('#searchProgress')) return;
    const p = state.progress;
    $('#searchProgress').innerHTML = `${state.run && p ? `<div class="small"><b>${esc(tr('Recherche {page}/{total} · {found} lien(s) lu(s)', p))}</b><progress max="${p.total}" value="${p.status === 'saved' ? p.page : p.page - 1}"></progress></div>` : ''}
      ${state.message ? `<div class="small ${state.tone === 'error' ? 'search-error' : 'muted'}">${esc(tr(state.message))}</div>` : ''}
      <div class="row">${state.run ? button('stop', 'Arrêter la recherche', '', 'danger') : ''}${state.lastTabId ? button('viewTab', 'Voir l’onglet de recherche') : ''}</div>`;
  }
  function renderPlan() {
    const list = $('#searchPlan');
    if (!list) return;
    try { list.innerHTML = buildSearchPlan(state.settings).map(entry => `<li>${esc(entry.query)}</li>`).join(''); }
    catch { list.innerHTML = `<li>${label('Complète les filtres pour voir les requêtes.')}</li>`; }
  }
  function renderCatalog() {
    const list = $('#searchJobs');
    if (!list) return;
    const needle = normal(state.text);
    const jobs = state.jobs.filter(job => (state.filter === 'all' || (state.filter === 'visible' ? job.status !== 'hidden' : job.status === state.filter)) && (!needle || normal(`${job.title} ${job.company} ${job.location}`).includes(needle)));
    $('#searchCount').textContent = tr('{shown} / {total} offres', { shown: jobs.length, total: state.jobs.length });
    list.innerHTML = jobs.slice(0, state.limit).map(job => {
      const title = job.title || new URL(job.url).hostname;
      const url = job.employerUrl || job.url;
      const sourceLabels = { google: 'Google', manual: tr('Manuel'), 'linkedin-manual': 'LinkedIn · ' + tr('Manuel') };
      return `<article class="card search-job" data-discovery-id="${esc(job.id)}">
        <div class="row"><span class="badge grey" title="${label('Score lexical indicatif, pas une décision d’admissibilité.')}">${job.score}/100</span><span class="small muted">${esc(fmtDate(job.lastSeenAt))}</span>${job.status === 'saved' ? `<span class="badge ok">${label('Enregistrée')}</span>` : ''}${job.status === 'hidden' ? `<span class="badge grey">${label('Masquée')}</span>` : ''}</div>
        <h3>${esc(title)}</h3><div class="small muted">${esc([job.company, job.location].filter(Boolean).join(' · '))}</div>
        <div class="search-url small">${esc(url)}</div>
        <p class="small search-snippet">${esc(job.snippet)}</p>
        ${job.description ? `<details><summary>${label('Texte importé')}</summary><div class="small search-description">${esc(job.description)}</div></details>` : ''}
        <div class="row small muted">${job.sources.map(source => esc(sourceLabels[source] || source)).join(' · ')}</div>
        <div class="row search-actions">${button('open', isLinkedIn(url) ? 'Ouvrir LinkedIn (manuel)' : 'Ouvrir l’offre', job.id)}${button(job.status === 'saved' ? 'unsave' : 'save', job.status === 'saved' ? 'Retirer des favoris' : 'Enregistrer', job.id)}${button(job.status === 'hidden' ? 'restore' : 'hide', job.status === 'hidden' ? 'Rétablir' : 'Masquer', job.id)}${button('delete', 'Supprimer', job.id, 'ghost danger')}${job.applicationId ? button('application', 'Reprendre la candidature', job.id) : ''}</div>
      </article>`;
    }).join('') || `<div class="card small muted">${label(state.jobs.length ? 'Aucune offre ne correspond à ce filtre.' : 'Aucune offre dans le catalogue. Lance Google ou importe des liens.')}</div>`;
    if (jobs.length > state.limit) list.innerHTML += button('more', 'Afficher plus');
  }
  function render() {
    state.detailsOpen = $('#searchImportDetails')?.open ?? state.detailsOpen;
    state.planOpen = $('#searchPlanDetails')?.open ?? state.planOpen;
    stopButton.classList.toggle('hidden', !state.run);
    stopButton.textContent = tr('Arrêter la recherche');
    if (!state.settings) {
      element.innerHTML = `<div class="card"><h2>${label('Recherche de stages')}</h2><p class="small">${label(state.loading ? 'Chargement…' : state.message || 'Charge le catalogue pour commencer.')}</p>${button('reload', 'Recharger')}</div>`;
      return;
    }
    const s = state.settings;
    element.innerHTML = `<div class="card"><h2>${label('Recherche de stages')}</h2>
      <p class="small muted">${label('Google automatique dans un onglet dédié. LinkedIn reste manuel. Aucun formulaire existant n’est rechargé.')}</p>
      <form id="searchForm" class="stack"><fieldset ${busy() ? 'disabled' : ''}>
        <label for="searchKeywords">${label('Mots-clés de stage')}</label><input type="text" id="searchKeywords" data-search-setting="keywords" value="${esc(s.keywords)}" maxlength="200">
        <div class="small muted">${label('Sépare les termes par des virgules.')}</div>
        <div class="search-domains">${Object.entries(CATEGORIES).map(([key, c]) => `<label><input type="checkbox" data-search-category="${key}" ${s.categories.includes(key) ? 'checked' : ''}> ${label(c.label)}</label>`).join('')}</div>
        <label for="searchScope">${label('Zone de recherche')}</label><select id="searchScope" data-search-setting="scope">${Object.entries(SCOPES).map(([key, scope]) => `<option value="${key}" ${s.scope === key ? 'selected' : ''}>${label(scope.label)}</option>`).join('')}</select>
        <label for="searchTerm">${label('Session / période (facultatif)')}</label><input type="text" id="searchTerm" data-search-setting="term" value="${esc(s.term)}" maxlength="80">
        <label for="searchMaxPages">${label('Maximum de requêtes (1–8)')}</label><input type="number" min="1" max="8" id="searchMaxPages" data-search-setting="maxPages" value="${esc(s.maxPages)}">
        <div class="row search-actions">${button('start', 'Chercher sur Google', '', 'primary')}${button('saveSettings', 'Enregistrer les filtres')}</div>
      </fieldset></form>
      <details id="searchPlanDetails" ${state.planOpen ? 'open' : ''}><summary>${label('Voir les requêtes envoyées à Google')}</summary><ol id="searchPlan" class="small search-plan"></ol></details>
      <p class="small muted">${label('Une page par requête, 30 liens maximum par page. Pas de pagination ni de visite automatique des résultats. Garde ce panneau ouvert pendant la recherche.')}</p>
      <div id="searchProgress" role="status" aria-live="polite"></div></div>
      <div class="card"><h2>${label('LinkedIn assisté / Import manuel')}</h2>
        <p class="small muted">${label('Ces boutons ouvrent une recherche à consulter toi-même. Aucun contenu, cookie ou compte LinkedIn n’est lu par ApplyPilot.')}</p>
        <div class="row">${button('linkedin', 'Recherche LinkedIn')}${button('linkedinRemote', 'LinkedIn · Remote Canada')}</div>
        <form id="searchImportForm" class="stack"><fieldset ${busy() ? 'disabled' : ''}>
          <label for="searchLinks">${label('Liens d’offres (un par ligne, 50 maximum)')}</label><textarea id="searchLinks" data-search-draft="links" rows="3" maxlength="20000" placeholder="https://…">${esc(state.draft.links)}</textarea>
          <details id="searchImportDetails" ${state.detailsOpen ? 'open' : ''}><summary>${label('Détails facultatifs pour une seule offre')}</summary>
            ${[['title', 'Intitulé'], ['company', 'Entreprise'], ['location', 'Lieu'], ['employerUrl', 'Lien employeur (facultatif)']].map(([key, title]) => `<label for="searchManual-${key}">${label(title)}</label><input type="${key === 'employerUrl' ? 'url' : 'text'}" id="searchManual-${key}" data-search-draft="${key}" value="${esc(state.draft[key])}" maxlength="${key === 'employerUrl' ? 4096 : key === 'title' ? 300 : 200}">`).join('')}
            <label for="searchManual-description">${label('Description copiée manuellement')}</label><textarea id="searchManual-description" data-search-draft="description" rows="4" maxlength="20000">${esc(state.draft.description)}</textarea>
          </details>${button('import', 'Importer les liens')}
        </fieldset></form>
      </div>
      <div class="card"><h2>${label('Catalogue local')} <span id="searchCount"></span></h2>
        <p class="small muted">${label('Enregistrer une offre ne crée ni ne soumet une candidature. Ouvre le site employeur, puis utilise Candidature → Analyser l’offre lorsque tu le décides.')}</p>
        <p class="small muted">${label('Classement lexical indicatif. Vérifie la date, le lieu, l’admissibilité et la disponibilité sur le site employeur.')}</p>
        <div class="row"><label for="searchState">${label('Afficher')}</label><select id="searchState">${[['visible', 'Non masquées'], ['new', 'Nouvelles'], ['saved', 'Enregistrées'], ['hidden', 'Masquées'], ['all', 'Toutes les offres']].map(([key, title]) => `<option value="${key}" ${state.filter === key ? 'selected' : ''}>${label(title)}</option>`).join('')}</select>${button('reload', 'Actualiser')}</div>
        <label for="searchText">${label('Filtrer titre / entreprise / lieu')}</label><input type="text" id="searchText" value="${esc(state.text)}" maxlength="200">
      </div><div id="searchJobs"></div>`;
    renderPlan(); renderProgress(); renderCatalog();
  }
  async function load() {
    if (busy()) return;
    const revision = ++state.revision;
    state.loading = true;
    render();
    try {
      const data = await api('/search');
      if (revision !== state.revision) return;
      adopt(data);
      if (state.loadError) { state.message = ''; state.tone = ''; }
      state.loadError = false;
    } catch (error) {
      if (revision !== state.revision) return;
      state.loadError = true;
      feedback(error.status === 404 ? 'Redémarre le serveur ApplyPilot pour activer la recherche.' : error.message, 'error');
    } finally { if (revision === state.revision) { state.loading = false; render(); } }
  }
  async function mutate(path, options, { settings = false, message = '' } = {}) {
    const revision = ++state.revision;
    state.mutating = true; render();
    try {
      const data = await api(path, options);
      if (revision !== state.revision) return false;
      adopt(data, { settings });
      if (settings) state.dirty = false;
      if (message) feedback(message);
      return true;
    } finally { if (revision === state.revision) { state.mutating = false; render(); } }
  }
  async function start() {
    if (busy()) return;
    if (!canStart()) throw new Error('Arrête le remplissage avant de lancer une recherche.');
    const settings = validateSettings(state.settings);
    const run = { controller: new AbortController() };
    ++state.revision; state.loading = false; state.run = run; state.progress = null; state.lastTabId = null;
    state.message = 'Préparation de la recherche…'; state.tone = ''; render();
    const current = () => { if (state.run !== run || run.controller.signal.aborted) throw Object.assign(new Error('Recherche arrêtée.'), { name: 'AbortError' }); };
    try {
      const data = await api('/search/settings', { method: 'PUT', body: settings, signal: run.controller.signal });
      current(); adopt(data, { settings: true }); state.dirty = false;
      const result = await runGoogleSearch({ settings, signal: run.controller.signal,
        onProgress: progress => { current(); state.progress = progress; state.lastTabId = progress.tabId; state.message = ''; renderProgress(); },
        onPage: async items => {
          current();
          const saved = await api('/search/results', { method: 'POST', body: { items }, signal: run.controller.signal });
          current(); adopt(saved); renderCatalog();
        },
      });
      current(); state.lastTabId = result.tabId;
      feedback(result.found ? 'Recherche terminée. Vérifie les offres dans le catalogue.' : 'Recherche terminée sans lien importable. Modifie les filtres ou importe des liens.');
    } catch (error) {
      if (state.run !== run) return;
      if (error.searchTabId) state.lastTabId = error.searchTabId;
      feedback(error.name === 'AbortError' ? 'Recherche arrêtée. Les résultats déjà enregistrés sont conservés.' : error.message, error.name === 'AbortError' ? '' : 'error');
    } finally { if (state.run === run) { state.run = null; render(); } }
  }
  function stop({ quiet = false } = {}) {
    if (!state.run) return;
    const run = state.run; state.run = null; run.controller.abort();
    if (!quiet) feedback('Recherche arrêtée. Les résultats déjà enregistrés sont conservés.');
    render();
  }
  function reset() {
    stop({ quiet: true }); ++state.revision; state.jobs = []; state.loaded = false; state.loading = false; state.mutating = false; render();
  }
  const actions = {
    start, stop, reload: load,
    saveSettings: () => mutate('/search/settings', { method: 'PUT', body: validateSettings(state.settings) }, { settings: true, message: 'Filtres enregistrés.' }),
    import: async () => {
      const { links, ...details } = state.draft;
      if (await mutate('/search/import', { method: 'POST', body: { links, details } }, { message: 'Liens importés dans le catalogue, sans candidature.' })) {
        state.draft = Object.fromEntries(Object.keys(state.draft).map(key => [key, ''])); render();
      }
    },
    linkedin: () => chrome.tabs.create({ url: linkedinSearchUrl(state.settings) }),
    linkedinRemote: () => chrome.tabs.create({ url: linkedinSearchUrl(state.settings, true) }),
    viewTab: async () => { const tab = await chrome.tabs.update(state.lastTabId, { active: true }); await chrome.windows.update(tab.windowId, { focused: true }); },
    more: () => { state.limit += 30; renderCatalog(); },
  };
  element.addEventListener('click', async event => {
    const target = event.target.closest('[data-search-action]');
    if (!target || target.disabled) return;
    event.preventDefault();
    const action = target.dataset.searchAction, job = state.jobs.find(row => row.id === target.dataset.searchId);
    try {
      if (actions[action]) return await actions[action]();
      if (!job || busy()) return;
      if (action === 'open') return await chrome.tabs.create({ url: externalJobUrl(job.employerUrl || job.url) });
      if (action === 'application') return await activateApplication(job.applicationId);
      if (action === 'delete') {
        if (confirm(tr('Supprimer cette offre du catalogue ? Une candidature existante sera conservée.'))) await mutate(`/search/jobs/${job.id}`, { method: 'DELETE' });
      } else {
        const status = { save: 'saved', unsave: 'new', hide: 'hidden', restore: 'new' }[action];
        if (status) await mutate(`/search/jobs/${job.id}`, { method: 'PATCH', body: { status } });
      }
    } catch (error) { feedback(error.message, 'error'); toast(error.message, 'error'); }
  });
  function input(event) {
    const el = event.target;
    if (el.dataset.searchSetting) { state.settings[el.dataset.searchSetting] = el.dataset.searchSetting === 'maxPages' ? Number(el.value) : el.value; state.dirty = true; renderPlan(); }
    if (el.dataset.searchCategory) { state.settings.categories = [...element.querySelectorAll('[data-search-category]:checked')].map(e => e.dataset.searchCategory); state.dirty = true; renderPlan(); }
    if (el.dataset.searchDraft) state.draft[el.dataset.searchDraft] = el.value;
    if (el.id === 'searchState') { state.filter = el.value; state.limit = 30; renderCatalog(); }
    if (el.id === 'searchText') { state.text = el.value; state.limit = 30; renderCatalog(); }
  }
  element.addEventListener('input', input);
  element.addEventListener('change', input);
  element.addEventListener('submit', event => { event.preventDefault(); });
  stopButton.addEventListener('click', () => stop());
  return { show: load, render, stop, reset, get running() { return !!state.run; } };
}
