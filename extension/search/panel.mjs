import { CATEGORIES, SCOPES, searchDefaults, validateSettings, buildSearchPlan, buildLinkedInPlan, linkedinSearchUrl, externalJobUrl, isLinkedIn } from './core.mjs';
import { PLATFORMS, catalogMeta, filterCatalog } from './catalog.mjs';
import { runGoogleSearch, searchDelay } from './runner.mjs';

export function createSearchPanel({ element, stopButton, api, tr, esc, fmtDate, toast, canStart, activateApplication }) {
  const state = { settings: null, jobs: [], loaded: false, dirty: false, loading: false, mutating: false, revision: 0, run: null, progress: null, message: '', messageValues: {}, tone: '', lastTabId: null,
    filter: 'visible', kind: 'job', platform: 'all', source: 'all', text: '', limit: 30,
    draft: { links: '', title: '', company: '', location: '', employerUrl: '', description: '' }, detailsOpen: false, planOpen: false, settingsOpen: false, manualOpen: false };
  const busy = () => !!state.run || state.mutating || state.loading;
  const $ = selector => element.querySelector(selector);
  const label = source => esc(tr(source));
  const button = (action, title, id = '', extra = '') => `<button type="button" class="btn ${extra}" data-search-action="${action}" ${id ? `data-search-id="${esc(id)}"` : ''} ${busy() && !['stop', 'viewTab'].includes(action) ? 'disabled' : ''}>${label(title)}</button>`;
  function feedback(message, tone = '', values = {}) { state.message = message; state.messageValues = values; state.tone = tone; renderProgress(); }
  function adopt(data, { settings = false } = {}) {
    state.jobs = data.jobs || [];
    if (!state.settings || settings || !state.dirty) state.settings = data.settings || searchDefaults();
    state.loaded = true;
  }
  function renderProgress() {
    stopButton.classList.toggle('hidden', !state.run); stopButton.textContent = tr('Arrêter la recherche');
    if (!$('#searchProgress')) return;
    const p = state.progress;
    $('#searchProgress').innerHTML = `${state.run && p ? `<div class="small"><b>${esc(tr('Recherche {page}/{total} · {found} lien(s) lu(s)', p))}</b><progress max="${p.total}" value="${p.status === 'saved' ? p.page : p.page - 1}"></progress></div>` : ''}
      ${state.message ? `<div class="small ${state.tone === 'error' ? 'search-error' : 'muted'}">${esc(tr(state.message, state.messageValues))}</div>` : ''}
      <div class="row">${state.run ? button('stop', 'Arrêter la recherche', '', 'danger') : ''}${state.lastTabId ? button('viewTab', 'Voir l’onglet de recherche') : ''}</div>`;
  }
  function renderPlan() {
    if (!$('#searchPlan')) return;
    try {
      const entries = [['LinkedIn · prototype', buildLinkedInPlan(state.settings)], ['Google', buildSearchPlan(state.settings)]];
      $('#searchPlan').innerHTML = entries.map(([name, rows]) => `<li><b>${esc(name)}</b><ol>${rows.map(row => `<li>${esc(row.query)}${row.location ? ` · ${esc(row.location)}${row.remote ? ' · Remote' : ''}` : ''}</li>`).join('')}</ol></li>`).join('');
    } catch { $('#searchPlan').innerHTML = `<li>${label('Complète les filtres pour voir les requêtes.')}</li>`; }
  }
  function renderCatalog() {
    if (!$('#searchJobs')) return;
    const jobs = filterCatalog(state.jobs, { status: state.filter, kind: state.kind, platform: state.platform, source: state.source, text: state.text });
    const counts = { job: 0, unknown: 0, listing: 0 };
    state.jobs.forEach(job => counts[catalogMeta(job).kind]++);
    $('#searchCount').textContent = tr('{shown} / {total} liens', { shown: jobs.length, total: state.jobs.length });
    $('#searchQuality').textContent = tr('{jobs} offres identifiées · {unknown} à vérifier · {lists} pages de résultats', { jobs: counts.job, unknown: counts.unknown, lists: counts.listing });
    const methods = { google: 'Google', manual: tr('Ajout manuel'), 'linkedin-public': tr('Accès public · prototype') };
    $('#searchJobs').innerHTML = jobs.slice(0, state.limit).map(job => {
      const meta = catalogMeta(job), title = job.title || new URL(job.url).hostname, url = meta.preferredUrl;
      const platforms = meta.platforms.map(platform => `<span class="platform-badge platform-${platform}"><span aria-hidden="true" class="platform-icon">${platform === 'linkedin' ? 'in' : platform === 'indeed' ? 'i' : platform === 'employer' ? '↗' : '•'}</span>${label(PLATFORMS[platform])}</span>`).join('');
      return `<article class="card search-job" data-discovery-id="${esc(job.id)}">
        <div class="row">${platforms}${job.status === 'saved' ? `<span class="badge ok">${label('Enregistrée')}</span>` : ''}${job.status === 'hidden' ? `<span class="badge grey">${label('Masquée')}</span>` : ''}</div>
        <h3>${esc(title)}</h3><div class="small muted">${esc([job.company, job.location].filter(Boolean).join(' · '))}</div>
        <div class="row small muted search-provenance">${label('Trouvée via')} ${meta.discoveryMethods.map(method => esc(methods[method] || method)).join(' · ')}</div>
        <div class="small muted">${job.postedAt ? esc(tr('Publiée le {date}', { date: fmtDate(job.postedAt + 'T12:00:00Z') })) : esc(tr('Repérée le {date}', { date: fmtDate(job.lastSeenAt) }))} · <span title="${label('Score lexical indicatif, pas une décision d’admissibilité.')}">${job.score}/100</span></div>
        ${meta.kind !== 'job' ? `<div class="badge warn">${label(meta.kind === 'listing' ? 'Page de résultats, pas une offre' : 'Lien à vérifier')}</div>` : ''}
        <div class="search-url small">${esc(url)}</div><p class="small search-snippet">${esc(job.snippet)}</p>
        ${job.description ? `<details><summary>${label('Texte importé')}</summary><div class="small search-description">${esc(job.description)}</div></details>` : ''}
        <div class="row search-actions">${button('open', isLinkedIn(url) ? 'Ouvrir sur LinkedIn' : meta.kind === 'job' ? 'Ouvrir l’offre' : 'Ouvrir le lien', job.id)}${button(job.status === 'saved' ? 'unsave' : 'save', job.status === 'saved' ? 'Retirer des favoris' : 'Enregistrer', job.id)}${button(job.status === 'hidden' ? 'restore' : 'hide', job.status === 'hidden' ? 'Rétablir' : 'Masquer', job.id)}${button('delete', 'Supprimer', job.id, 'ghost danger')}${job.applicationId ? button('application', 'Reprendre la candidature', job.id) : ''}</div>
      </article>`;
    }).join('') || `<div class="card small muted">${label(state.jobs.length ? 'Aucune offre dans cette vue. Consulte aussi les liens à vérifier, sans les confondre avec des offres.' : 'Aucune offre dans le catalogue. Lance une recherche ou ajoute un lien.')}</div>`;
    if (jobs.length > state.limit) $('#searchJobs').innerHTML += button('more', 'Afficher plus');
  }
  function render() {
    for (const [id, key] of [['searchImportDetails', 'detailsOpen'], ['searchPlanDetails', 'planOpen'], ['searchSettingsDetails', 'settingsOpen'], ['searchManualDetails', 'manualOpen']]) state[key] = $('#' + id)?.open ?? state[key];
    stopButton.classList.toggle('hidden', !state.run); stopButton.textContent = tr('Arrêter la recherche');
    if (!state.settings) {
      element.innerHTML = `<div class="card"><h2>${label('Recherche de stages')}</h2><p class="small">${label(state.loading ? 'Chargement…' : state.message || 'Charge le catalogue pour commencer.')}</p>${button('reload', 'Recharger')}</div>`;
      return;
    }
    const s = state.settings;
    const select = (id, title, options, value) => `<label for="${id}">${label(title)}</label><select id="${id}">${options.map(([key, name]) => `<option value="${key}" ${key === value ? 'selected' : ''}>${label(name)}</option>`).join('')}</select>`;
    element.innerHTML = `<div class="card"><h2>${label('Recherche de stages')} <span class="badge warn">${label('LinkedIn expérimental')}</span></h2>
      <p class="small muted">${label('Des liens d’offres individuelles, avec leur plateforme et leur provenance. Aucune candidature créée automatiquement.')}</p>
      <div class="row search-actions">${button('startLinkedIn', 'LinkedIn · prototype', '', 'primary')}${button('start', 'Chercher sur Google')}</div>
      <p class="small muted">${label('LinkedIn public : accès non officiel sans compte ni cookies. Requêtes limitées, arrêt au premier blocage. Les conditions LinkedIn restreignent l’automatisation.')}</p>
      <details id="searchSettingsDetails" ${state.settingsOpen ? 'open' : ''}><summary>${label('Filtres de recherche')}</summary>
        <form id="searchForm" class="stack"><fieldset ${busy() ? 'disabled' : ''}>
          <label for="searchKeywords">${label('Mots-clés de stage')}</label><input type="text" id="searchKeywords" data-search-setting="keywords" value="${esc(s.keywords)}" maxlength="200">
          <div class="small muted">${label('Sépare les termes par des virgules.')}</div>
          <div class="search-domains">${Object.entries(CATEGORIES).map(([key, c]) => `<label><input type="checkbox" data-search-category="${key}" ${s.categories.includes(key) ? 'checked' : ''}> ${label(c.label)}</label>`).join('')}</div>
          <label for="searchScope">${label('Zone de recherche')}</label><select id="searchScope" data-search-setting="scope">${Object.entries(SCOPES).map(([key, scope]) => `<option value="${key}" ${s.scope === key ? 'selected' : ''}>${label(scope.label)}</option>`).join('')}</select>
          <label for="searchTerm">${label('Session / période (facultatif)')}</label><input type="text" id="searchTerm" data-search-setting="term" value="${esc(s.term)}" maxlength="80">
          <label for="searchMaxPages">${label('Maximum de requêtes (1–8)')}</label><input type="number" min="1" max="8" id="searchMaxPages" data-search-setting="maxPages" value="${esc(s.maxPages)}">
          <div class="row search-actions">${button('saveSettings', 'Enregistrer les filtres')}</div>
        </fieldset></form>
      </details>
      <details id="searchPlanDetails" ${state.planOpen ? 'open' : ''}><summary>${label('Voir les requêtes exactes')}</summary><ul id="searchPlan" class="small search-plan"></ul></details>
      <p class="small muted">${label('Pas de navigation dans tes formulaires. Garde le panneau ouvert ; Arrêter interrompt les requêtes suivantes et conserve les résultats déjà reçus.')}</p>
      <div id="searchProgress" role="status" aria-live="polite"></div>
    </div>
    <div class="card"><h2>${label('Catalogue local')} <span id="searchCount"></span></h2>
      <div id="searchQuality" class="small muted"></div>
      ${select('searchKind', 'Type de lien', [['job', 'Offres identifiées'], ['unknown', 'Liens à vérifier'], ['listing', 'Pages de résultats'], ['all', 'Tous les liens']], state.kind)}
      <div class="search-filter-grid"><div>${select('searchPlatform', 'Plateforme', [['all', 'Toutes les plateformes'], ...Object.entries(PLATFORMS)], state.platform)}</div><div>${select('searchSource', 'Découverte', [['all', 'Toutes les provenances'], ['linkedin-public', 'LinkedIn public'], ['google', 'Google'], ['manual', 'Ajout manuel']], state.source)}</div></div>
      <div class="row">${select('searchState', 'État', [['visible', 'Non masquées'], ['new', 'Nouvelles'], ['saved', 'Enregistrées'], ['hidden', 'Masquées'], ['all', 'Toutes les offres']], state.filter)}${button('reload', 'Actualiser')}</div>
      <label for="searchText">${label('Filtrer titre / entreprise / lieu')}</label><input type="text" id="searchText" value="${esc(state.text)}" maxlength="200">
      <p class="small muted">${label('Offre identifiée par son lien, disponibilité et admissibilité à vérifier sur le site. Le score n’est qu’un classement par mots-clés.')}</p>
    </div><div id="searchJobs"></div>
    <details class="card" id="searchManualDetails" ${state.manualOpen ? 'open' : ''}><summary>${label('Ajout manuel / Navigation externe')}</summary>
      <p class="small muted">${label('Les liens ci-dessous ouvrent une recherche dans le navigateur. Ils sont distincts du connecteur public ci-dessus.')}</p>
      <div class="row">${button('linkedin', 'Consulter LinkedIn dans le navigateur')}${button('linkedinRemote', 'LinkedIn · Remote Canada')}</div>
      <form id="searchImportForm" class="stack"><fieldset ${busy() ? 'disabled' : ''}>
        <label for="searchLinks">${label('Liens d’offres (un par ligne, 50 maximum)')}</label><textarea id="searchLinks" data-search-draft="links" rows="3" maxlength="20000" placeholder="https://…">${esc(state.draft.links)}</textarea>
        <details id="searchImportDetails" ${state.detailsOpen ? 'open' : ''}><summary>${label('Détails facultatifs pour une seule offre')}</summary>
          ${[['title', 'Intitulé'], ['company', 'Entreprise'], ['location', 'Lieu'], ['employerUrl', 'Lien employeur (facultatif)']].map(([key, title]) => `<label for="searchManual-${key}">${label(title)}</label><input type="${key === 'employerUrl' ? 'url' : 'text'}" id="searchManual-${key}" data-search-draft="${key}" value="${esc(state.draft[key])}" maxlength="${key === 'employerUrl' ? 4096 : key === 'title' ? 300 : 200}">`).join('')}
          <label for="searchManual-description">${label('Description copiée manuellement')}</label><textarea id="searchManual-description" data-search-draft="description" rows="4" maxlength="20000">${esc(state.draft.description)}</textarea>
        </details>${button('import', 'Importer les liens')}
      </fieldset></form>
    </details>`;
    renderPlan(); renderProgress(); renderCatalog();
  }
  async function load() {
    if (busy()) return;
    const revision = ++state.revision; state.loading = true; render();
    try {
      const data = await api('/search'); if (revision !== state.revision) return;
      adopt(data); if (state.loadError) { state.message = ''; state.tone = ''; } state.loadError = false;
    } catch (error) {
      if (revision !== state.revision) return;
      state.loadError = true; feedback(error.status === 404 ? 'Redémarre le serveur ApplyPilot pour activer la recherche.' : error.message, 'error');
    } finally { if (revision === state.revision) { state.loading = false; render(); } }
  }
  async function mutate(path, options, { settings = false, message = '' } = {}) {
    const revision = ++state.revision; state.mutating = true; render();
    try {
      const data = await api(path, options); if (revision !== state.revision) return false;
      adopt(data, { settings }); if (settings) state.dirty = false;
      if (message) feedback(message); return true;
    } finally { if (revision === state.revision) { state.mutating = false; render(); } }
  }
  async function start(source = 'google') {
    if (busy()) return;
    if (!canStart()) throw new Error('Arrête le remplissage avant de lancer une recherche.');
    const settings = validateSettings(state.settings), run = { controller: new AbortController(), source };
    ++state.revision; state.loading = false; state.run = run; state.progress = null; state.lastTabId = null; state.kind = 'job';
    state.message = 'Préparation de la recherche…'; state.tone = ''; render();
    const current = () => { if (state.run !== run || run.controller.signal.aborted) throw Object.assign(new Error('Recherche arrêtée.'), { name: 'AbortError' }); };
    try {
      const data = await api('/search/settings', { method: 'PUT', body: settings, signal: run.controller.signal });
      current(); adopt(data, { settings: true }); state.dirty = false;
      let result;
      if (source === 'linkedin-public') {
        const plan = buildLinkedInPlan(settings); let found = 0;
        for (let index = 0; index < plan.length; index++) {
          if (index) await searchDelay(2600, run.controller.signal); current();
          state.progress = { page: index + 1, total: plan.length, found, status: 'opening' }; state.message = ''; renderProgress();
          const saved = await api('/search/linkedin', { method: 'POST', body: { settings, index, acknowledgeExperimental: true }, signal: run.controller.signal });
          current(); adopt(saved); found += saved.received || 0; state.progress = { ...state.progress, found, status: 'saved' }; renderProgress(); renderCatalog();
        }
        result = { found };
      } else result = await runGoogleSearch({ settings, signal: run.controller.signal,
        onProgress: progress => { current(); state.progress = progress; state.lastTabId = progress.tabId; state.message = ''; renderProgress(); },
        onPage: async items => { current(); const saved = await api('/search/results', { method: 'POST', body: { items }, signal: run.controller.signal }); current(); adopt(saved); renderCatalog(); },
      });
      current(); state.lastTabId = result.tabId || null;
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
    if (!quiet) feedback('Recherche arrêtée. Les résultats déjà enregistrés sont conservés.'); render();
  }
  function reset() { stop({ quiet: true }); ++state.revision; state.jobs = []; state.loaded = false; state.loading = false; state.mutating = false; render(); }
  const actions = {
    start: () => start('google'), startLinkedIn: () => start('linkedin-public'), stop, reload: load,
    saveSettings: () => mutate('/search/settings', { method: 'PUT', body: validateSettings(state.settings) }, { settings: true, message: 'Filtres enregistrés.' }),
    import: async () => {
      const { links, ...details } = state.draft;
      if (await mutate('/search/import', { method: 'POST', body: { links, details } }, { message: 'Liens importés dans le catalogue, sans candidature.' })) { state.draft = Object.fromEntries(Object.keys(state.draft).map(key => [key, ''])); state.kind = 'all'; render(); }
    },
    linkedin: () => chrome.tabs.create({ url: linkedinSearchUrl(state.settings) }),
    linkedinRemote: () => chrome.tabs.create({ url: linkedinSearchUrl(state.settings, true) }),
    viewTab: async () => { const tab = await chrome.tabs.update(state.lastTabId, { active: true }); await chrome.windows.update(tab.windowId, { focused: true }); },
    more: () => { state.limit += 30; renderCatalog(); },
  };
  element.addEventListener('click', async event => {
    const target = event.target.closest('[data-search-action]'); if (!target || target.disabled) return; event.preventDefault();
    const action = target.dataset.searchAction, job = state.jobs.find(row => row.id === target.dataset.searchId);
    try {
      if (actions[action]) return await actions[action](); if (!job || busy()) return;
      if (action === 'open') return await chrome.tabs.create({ url: externalJobUrl(catalogMeta(job).preferredUrl) });
      if (action === 'application') return await activateApplication(job.applicationId);
      if (action === 'delete') { if (confirm(tr('Supprimer cette offre du catalogue ? Une candidature existante sera conservée.'))) await mutate(`/search/jobs/${job.id}`, { method: 'DELETE' }); }
      else { const status = { save: 'saved', unsave: 'new', hide: 'hidden', restore: 'new' }[action]; if (status) await mutate(`/search/jobs/${job.id}`, { method: 'PATCH', body: { status } }); }
    } catch (error) { feedback(error.message, 'error'); toast(error.message, 'error'); }
  });
  function input(event) {
    const el = event.target;
    if (el.dataset.searchSetting) { state.settings[el.dataset.searchSetting] = el.dataset.searchSetting === 'maxPages' ? Number(el.value) : el.value; state.dirty = true; renderPlan(); }
    if (el.dataset.searchCategory) { state.settings.categories = [...element.querySelectorAll('[data-search-category]:checked')].map(e => e.dataset.searchCategory); state.dirty = true; renderPlan(); }
    if (el.dataset.searchDraft) state.draft[el.dataset.searchDraft] = el.value;
    const field = { searchState: 'filter', searchKind: 'kind', searchPlatform: 'platform', searchSource: 'source', searchText: 'text' }[el.id];
    if (field) { state[field] = el.value; state.limit = 30; renderCatalog(); }
  }
  element.addEventListener('input', input); element.addEventListener('change', input);
  element.addEventListener('submit', event => event.preventDefault()); stopButton.addEventListener('click', () => stop());
  return { show: load, render, stop, reset, get running() { return !!state.run; } };
}
