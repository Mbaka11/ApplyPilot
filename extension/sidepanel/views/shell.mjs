// Coque du panneau : en-tête, état du serveur, langue et navigation par onglets.
import { S, VERSION } from '../state.mjs';
import { $, tr } from '../ui.mjs';
import { checkServer, loadApps } from '../api.mjs';
import { renderHome } from './home.mjs';
import { renderApp, syncCvControls } from './application.mjs';
import { renderJournal } from './tracker.mjs';
import { renderProfile } from './profile.mjs';
import { searchPanel } from './search.mjs';

export function renderShell() {
  document.documentElement.lang = S.uiLanguage;
  $('#appVersion').textContent = `v${VERSION}`;
  $('#appVersion').title = `${tr('Version de l’extension')} ${VERSION}`;
  $('#uiLanguage').value = S.uiLanguage;
  $('#uiLanguageLabel').textContent = tr('Langue de l’interface');
  $('#serverStatus').title = `${tr('Revérifier la connexion au serveur')} · ${tr('Serveur')} v${S.health?.version || '—'}`;
  for (const [tab, label] of [['home', 'Accueil'], ['app', 'Candidature'], ['search', 'Recherche'], ['journal', 'Journal'], ['profile', 'Profil']]) {
    $(`[data-tab="${tab}"]`).textContent = tr(label);
  }
}

export async function setUiLanguage(language) {
  if (!['fr', 'en'].includes(language)) return;
  // A language switch only redraws labels. No API write, navigation or draft reset.
  if ($('#letterInstructions')) S.letterInstructions = $('#letterInstructions').value;
  if ($('#serverUrl')) S.serverDraft = $('#serverUrl').value;
  const details = [...document.querySelectorAll('main details')].map((el) => el.open);
  S.uiLanguage = language;
  await chrome.storage.local.set({ uiLanguage: language });
  renderShell();
  renderStatus();
  renderHome();
  renderApp();
  renderJournal();
  searchPanel.render();
  if (S.tab === 'profile') await renderProfile({ refresh: false });
  document.querySelectorAll('main details').forEach((el, i) => { if (i < details.length) el.open = details[i]; });
  $('#toast').className = 'toast';
}

export function renderStatus() {
  syncCvControls();
  const el = $('#serverStatus');
  const off = $('#offline');
  if (S.health) {
    const mismatch = S.health.version && S.health.version !== VERSION;
    el.className = `status on${mismatch ? ' mismatch' : ''}`;
    el.textContent = mismatch ? tr('Serveur v{version} : à redémarrer', { version: S.health.version }) : tr('Serveur connecté · {count} CV', { count: S.health.cvCount });
    off.classList.add('hidden');
  } else {
    el.className = 'status off';
    el.textContent = tr('Serveur arrêté');
    off.classList.remove('hidden');
    off.innerHTML = `<b>${tr('Le serveur local ne répond pas.')}</b><div class="small">${tr('Double-clique sur')} <span class="kbd">start.cmd</span> ${tr('dans le dossier ApplyPilot, puis')}
      <button class="btn ghost" data-action="recheck">${tr('réessayer')}</button>.</div>`;
  }
}

export function switchTab(name) {
  S.tab = name;
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.id === `tab-${name}`));
  if (name === 'home') { renderHome(); checkServer(); }
  if (name === 'journal') loadApps().then(renderJournal, () => renderJournal());
  if (name === 'profile') checkServer().then(renderProfile);
  if (name === 'app') renderApp();
  if (name === 'search') searchPanel.show();
}
