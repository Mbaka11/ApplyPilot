// État partagé du panneau : constantes, objet S et préférences persistées.

export const VERSION = chrome.runtime.getManifest().version;
export const DEFAULT_SERVER = 'http://127.0.0.1:4317';
export const STATUS_LABEL = {
  'en cours': 'En cours',
  soumise: 'Soumise',
  entrevue: 'Entrevue',
  refusée: 'Refusée',
  offre: 'Offre 🎉',
  abandonnée: 'Abandonnée',
};
export const PLATFORM_LABEL = {
  workday: 'Workday',
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  ashby: 'Ashby',
  smartrecruiters: 'SmartRecruiters',
  icims: 'iCIMS',
  taleo: 'Taleo',
  successfactors: 'SuccessFactors',
  jobvite: 'Jobvite',
  workable: 'Workable',
  bamboohr: 'BambooHR',
  generic: 'Site carrière',
};

export const S = {
  server: DEFAULT_SERVER,
  uiLanguage: 'en',
  serverDraft: null,
  letterInstructions: '',
  profileResponse: null,
  health: null,
  serverError: '',
  cvs: [],
  apps: [],
  statuses: Object.keys(STATUS_LABEL),
  app: null,
  recommendation: null,
  draft: null,
  draftDirty: false,
  appBusy: false,
  cvBusy: false,
  switching: false,
  searchSummary: null,
  searchMeta: null, // { lastRunAt, lastSeenAt, lastRun, newCount } du catalogue de recherche
  journalView: 'list', // 'list' | 'stats'
  stats: null,
  usage: null, // { day, week, month } : résumés de /usage
  letterGeneration: null,
  page: null,
  pageError: '',
  diagnosticBusy: false,
  prefs: { useAi: true, overwrite: false, addEntries: true, letterLang: 'auto' },
  letterBusy: false,
  letterT0: 0,
  fillBusy: false,
  fillPhase: '',
  fillRun: null,
  fill: null,
  memory: null,
  profile: null,
  profileRevision: null,
  profileFields: [],
  profileDraft: {},
  profileBusy: false,
  tab: 'home',
  step: null, // étape ouverte choisie par l’utilisateur (null = suggestion automatique)
  seen: {}, // avis déjà lus (chrome.storage.local.seenNotices)
  infoOpen: new Set(),
  optionsOpen: false,
  pageContext: '',
};

export async function markSeen(key) {
  S.seen[key] = true;
  try { await chrome.storage.local.set({ seenNotices: S.seen }); } catch { /* préférence facultative */ }
}

export async function savePrefs() {
  await chrome.storage.local.set({ prefs: S.prefs });
}
