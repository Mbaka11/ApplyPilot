// Serveur local : requêtes, état de connexion et liste des candidatures.
import { catalogMeta } from '../search/catalog.mjs';
import { S } from './state.mjs';
import { renderShell, renderStatus } from './views/shell.mjs';
import { renderHome } from './views/home.mjs';
import { cvTailor } from './views/application.mjs';

export async function api(path, { method = 'GET', body, signal } = {}) {
  let res;
  try {
    res = await fetch(S.server + path, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (error) {
    if (signal?.aborted || error.name === 'AbortError') throw error;
    S.health = null;
    renderStatus();
    throw new Error('Serveur ApplyPilot injoignable : lance start.cmd');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Erreur ${res.status}`), { status: res.status });
  return data;
}

export async function checkServer() {
  try {
    S.health = await api('/health');
    S.serverError = '';
    const [{ cvs }, { applications, statuses }] = await Promise.all([api('/cvs'), api('/applications')]);
    S.cvs = cvs;
    S.apps = applications;
    if (statuses) S.statuses = statuses;
    try {
      const { jobs, meta } = await api('/search');
      S.searchMeta = meta || null;
      S.searchSummary = { total: jobs.length, identified: jobs.filter(job => catalogMeta(job).kind === 'job').length, saved: jobs.filter(job => job.status === 'saved').length };
    } catch { S.searchSummary = null; }
  } catch (e) {
    S.health = null;
    S.serverError = e.message;
  }
  renderShell();
  renderStatus();
  renderHome();
  cvTailor.refresh();
}

export async function loadApps() {
  const { applications } = await api('/applications');
  S.apps = applications;
  renderHome();
}
