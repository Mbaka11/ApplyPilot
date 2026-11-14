// Coque du panneau : en-tête compact, état du serveur et navigation par onglets.
import { S, VERSION } from '../state.mjs';
import { $, tr } from '../ui.mjs';
import { checkServer, loadApps } from '../api.mjs';
import { renderHome } from './home.mjs';
import { renderApp, syncCvControls } from './application.mjs';
import { renderJournal, loadStats } from './tracker.mjs';
import { renderProfile } from './profile.mjs';
import { renderSettings, loadUsage } from './settings.mjs';
import { renderActionBar } from './actionbar.mjs';
import { searchPanel } from './search.mjs';

export function renderShell() {
  document.documentElement.lang = S.uiLanguage;
  $('#appVersion').textContent = `v${VERSION}`;
  $('#appVersion').title = `${tr('Version de l’extension')} ${VERSION}`;
  for (const [tab, label] of [['home', 'Accueil'], ['app', 'Candidature'], ['search', 'Recherche'], ['journal', 'Suivi']]) {
    $(`.tabs [data-tab="${tab}"]`).textContent = tr(label);
  }
  for (const [id, label] of [['profileButton', 'Profil'], ['settingsButton', 'Réglages']]) {
    $(`#${id}`).setAttribute('aria-label', tr(label));
    $(`#${id}`).title = tr(label);
  }
  $('nav.tabs').setAttribute('aria-label', tr('Sections'));
  $('#actionBar').setAttribute('aria-label', tr('Action principale'));
  renderSettings();
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
  let text;
  if (S.health) {
    const mismatch = S.health.version && S.health.version !== VERSION;
    const llmDown = S.health.llm && !S.health.llm.available;
    el.className = `status on${mismatch || llmDown ? ' mismatch' : ''}`;
    text = mismatch ? tr('Serveur v{version} : à redémarrer', { version: S.health.version }) : tr('Serveur connecté · {count} CV', { count: S.health.cvCount });
    el.title = [tr('Revérifier la connexion au serveur'), text, llmDown ? tr('IA introuvable : voir Réglages') : '', `${tr('Serveur')} v${S.health.version || '—'}`].filter(Boolean).join(' · ');
    off.classList.add('hidden');
  } else {
    el.className = 'status off';
    text = tr('Serveur arrêté');
    el.title = `${tr('Revérifier la connexion au serveur')} · ${text}`;
    off.classList.remove('hidden');
    off.innerHTML = `<b>${tr('Le serveur local ne répond pas.')}</b><div class="small">${tr('Double-clique sur')} <span class="kbd">start.cmd</span> ${tr('dans le dossier ApplyPilot, puis')}
      <button type="button" class="btn ghost sm" data-action="recheck">${tr('réessayer')}</button>.</div>`;
  }
  $('#serverStatusText').textContent = text;
  renderSettings();
  renderActionBar();
}

export function switchTab(name) {
  if (S.tab === 'search' && name !== 'search') searchPanel.leave(); // marque les offres comme vues en quittant, pas à l’ouverture
  S.tab = name;
  document.querySelectorAll('.tabs [data-tab], .top-actions [data-tab]').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === name);
    if (b.dataset.tab === name) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.id === `tab-${name}`));
  if (name === 'home') { renderHome(); checkServer(); }
  if (name === 'journal') loadApps().then(() => (S.journalView === 'stats' ? loadStats() : null)).then(renderJournal, () => renderJournal());
  if (name === 'profile') checkServer().then(renderProfile);
  if (name === 'settings') checkServer().then(loadUsage).then(renderSettings, renderSettings);
  if (name === 'app') renderApp();
  if (name === 'search') searchPanel.show();
  renderActionBar();
  if ($('main')) $('main').scrollTop = 0;
}
