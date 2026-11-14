// ApplyPilot — panneau latéral : initialisation, table ACTIONS et câblage des événements.
// Le rendu et la logique de chaque onglet vivent dans views/*.mjs.
import { chooseLanguage } from './i18n.mjs';
import { S, DEFAULT_SERVER, savePrefs, markSeen } from './state.mjs';
import { $, toast, tr, toggleInfo } from './ui.mjs';
import { checkServer } from './api.mjs';
import { activeTab, exec, runInTab } from './tabs.mjs';
import { renderShell, setUiLanguage, switchTab } from './views/shell.mjs';
import { analyze, activateApplication, applyJob, cvInspector, openJob, refreshPage, renderApp, schedulePageRefresh, selectCv } from './views/application.mjs';
import { copyLetter, generateLetter, letterUrl, saveLetter } from './views/letter.mjs';
import { captureMemory, exportFormDiagnostic, fillPage, markSubmitted, prepareAndAttachDocuments, stopFill } from './views/fill.mjs';
import { changeStatus, deleteApplication, setJournalView } from './views/tracker.mjs';
import { clearUsage } from './views/settings.mjs';
import { forgetMemory, reloadProfile, saveProfile, saveServer } from './views/profile.mjs';
import { searchPanel } from './views/search.mjs';
import { renderHome } from './views/home.mjs';
import { toggleStep } from './views/stepper.mjs';

const ACTIONS = {
  recheck: async () => {
    await checkServer();
    if (S.health) {
      schedulePageRefresh(0);
      toast('Serveur connecté ✓');
    }
    renderApp();
  },
  saveProfile: () => saveProfile(),
  reloadProfile: () => reloadProfile(),
  analyze: () => analyze(),
  generate: () => generateLetter(),
  saveLetter: () => saveLetter(),
  openLetter: () => chrome.tabs.create({ url: letterUrl() }),
  copyLetter: () => copyLetter(),
  openJob: () => openJob(),
  applyJob: () => applyJob(),
  newApp: () => activateApplication(null),
  fill: () => fillPage(),
  prepareDocuments: () => prepareAndAttachDocuments(),
  diagnostic: () => exportFormDiagnostic(),
  stopFill: () => stopFill(),
  stopSearch: () => searchPanel.stop(),
  memorize: () => captureMemory(),
  submitted: () => markSubmitted(),
  exportCsv: () => chrome.tabs.create({ url: `${S.server}/journal.csv` }),
  saveServer: () => saveServer(),
  showNewOffers: () => { searchPanel.showNew(); switchTab('search'); },
  rerunSearch: () => searchPanel.rerunLast(),
  clearUsage: () => clearUsage(),
};

document.addEventListener('click', async (e) => {
  const t = e.target.closest('button, li[data-focus]');
  if (!t) return;
  t.closest('.more-menu')?.removeAttribute('open');
  try {
    if (t.dataset.tab) return switchTab(t.dataset.tab);
    if (t.dataset.journalView) return await setJournalView(t.dataset.journalView);
    if (t.dataset.stepToggle) return toggleStep(t.dataset.stepToggle);
    if (t.dataset.info) return toggleInfo(t);
    if (t.dataset.seen) { await markSeen(t.dataset.seen); return renderApp(); }
    if (t.dataset.action && ACTIONS[t.dataset.action]) {
      if (t.tagName === 'BUTTON') t.disabled = true;
      try {
        await ACTIONS[t.dataset.action]();
      } finally {
        if (t.isConnected && t.tagName === 'BUTTON') t.disabled = false;
      }
      return;
    }
    if (t.dataset.focus) return runInTab('focus', { id: t.dataset.focus });
    if (t.dataset.openUrl) return chrome.tabs.create({ url: t.dataset.openUrl });
    if (t.dataset.openLetter) return chrome.tabs.create({ url: `${S.server}/applications/${encodeURIComponent(t.dataset.openLetter)}/letter.pdf` });
    if (t.dataset.activate) return activateApplication(t.dataset.activate);
    if (t.dataset.delete) return await deleteApplication(t.dataset.delete);
    if (t.dataset.forget) return await forgetMemory(t.dataset.forget);
  } catch (err) {
    toast(err.message || String(err), 'error');
  }
});

document.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('li[data-focus]')) { e.preventDefault(); e.target.click(); }
});
document.addEventListener('toggle', (e) => { if (e.target.id === 'fillOptions') S.optionsOpen = e.target.open; }, true);

document.addEventListener('submit', (e) => {
  if (e.target.id !== 'profileForm') return;
  e.preventDefault();
  saveProfile().catch((err) => toast(err.message, 'error'));
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'letterInstructions') S.letterInstructions = e.target.value;
  if (e.target.id === 'serverUrl') S.serverDraft = e.target.value;
  if (e.target.dataset.profilePath) S.profileDraft[e.target.dataset.profilePath] = e.target.value;
  if (e.target.id === 'letterSubject' || e.target.id === 'letterBody') {
    S.draft = S.draft || { subject: '', body: '' };
    S.draft[e.target.id === 'letterSubject' ? 'subject' : 'body'] = e.target.value;
    if (!S.draftDirty) {
      S.draftDirty = true;
      const b = document.querySelector('[data-action="saveLetter"]');
      if (b) b.classList.add('primary');
    }
  }
});

document.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.dataset.profilePath) S.profileDraft[t.dataset.profilePath] = t.value;
  try {
    if (t.id === 'uiLanguage') {
      await setUiLanguage(t.value);
    } else if (t.id === 'cvSelect') {
      await selectCv(t.value);
    } else if (t.id === 'pickApp' && t.value) {
      await activateApplication(t.value);
    } else if (t.id === 'letterLang') {
      S.prefs.letterLang = t.value;
      await savePrefs();
    } else if (t.id === 'optAi' || t.id === 'optEntries' || t.id === 'optOverwrite') {
      const key = { optAi: 'useAi', optEntries: 'addEntries', optOverwrite: 'overwrite' }[t.id];
      S.prefs[key] = t.checked;
      await savePrefs();
    } else if (t.dataset.status) {
      await changeStatus(t.dataset.status, t.value);
    }
  } catch (err) {
    toast(err.message || String(err), 'error');
  }
});

chrome.tabs.onActivated.addListener(async () => {
  const tab = await activeTab();
  if (S.fillRun && tab?.id !== S.fillRun.tabId) stopFill({ pageChanged: true });
  schedulePageRefresh(150);
});
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (S.fillRun?.tabId === tabId && (info.url || info.status === 'loading')) stopFill({ pageChanged: true });
  const tab = await activeTab();
  if (tab?.id === tabId && (info.status === 'complete' || info.url)) schedulePageRefresh(600);
});
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type === 'ap:fillCancelled' && msg.runId === S.fillRun?.id) stopFill({ pageChanged: true });
  if (msg?.type === 'ap:pageChanged') {
    if (sender?.tab?.id === S.fillRun?.tabId && msg.pageIdentity && S.fillRun.pages?.some((p) => p.frameId === sender.frameId && p.pageIdentity !== msg.pageIdentity)) stopFill({ pageChanged: true });
    schedulePageRefresh(300);
  }
  if (msg?.type === 'ap:memorySaved' && msg.added) toast(tr('{count} réponse(s) mémorisée(s) pour les prochaines fois', { count: msg.added }));
});
window.addEventListener('pagehide', () => {
  cvInspector.reset();
  searchPanel.stop({ quiet: true });
  if (S.fillRun) {
    const run = S.fillRun;
    run.controller.abort();
    exec(run.tabId, 'cancel', { runId: run.id }, run.pages?.map((p) => p.frameId)).catch(() => {});
  }
});
window.addEventListener('focus', () => {
  if (!S.health) checkServer();
});
setInterval(() => {
  if (!S.health) checkServer().then(() => S.health && ACTIONS.recheck());
}, 10000);

// ---------------------------------------------------------------------------
// Démarrage
// ---------------------------------------------------------------------------
(async function init() {
  const stored = await chrome.storage.local.get(['serverUrl', 'prefs', 'uiLanguage', 'seenNotices']);
  S.seen = stored.seenNotices && typeof stored.seenNotices === 'object' ? stored.seenNotices : {};
  S.uiLanguage = chooseLanguage(stored.uiLanguage, navigator.language);
  renderShell();
  S.server = (stored.serverUrl || DEFAULT_SERVER).replace(/\/+$/, '');
  S.prefs = { ...S.prefs, ...(stored.prefs || {}) };
  renderApp();
  await checkServer();
  // Do not restore an old or sole ongoing application automatically.
  renderHome();
  renderApp();
  await refreshPage();
})();
