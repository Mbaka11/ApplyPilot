// Onglet actif et scripts de contenu.
import { isDiscoveryPage } from '../search/core.mjs';
import { VERSION } from './state.mjs';

const CONTENT_FILES = [
  'i18n.js',
  'content/dom.js',
  'content/extract.js',
  'content/fields.js',
  'content/widgets.js',
  'content/mapping.js',
  'content/workday.js',
  'content/successfactors.js',
  'content/successfactors-documents.js',
  'content/main.js',
];

export async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

export const scriptable = (url) => /^https?:\/\//.test(url || '') && !isDiscoveryPage(url) && !/^https:\/\/(chrome\.google\.com\/webstore|chromewebstore\.google\.com)/.test(url);

export async function exec(tabId, cmd, payload, frameIds) {
  const res = await chrome.scripting.executeScript({
    target: frameIds ? { tabId, frameIds } : { tabId, allFrames: true },
    func: (c, p) => {
      if (/(^|\.)linkedin\.com\.?$|(^|\.)google\.(com|ca|fr|co\.uk)\.?$/.test(location.hostname)) return null;
      return globalThis.__applyPilot ? globalThis.__applyPilot.run(c, p) : null;
    },
    args: [cmd, payload],
  });
  return res.map((r) => (r.result && r.result.__ap ? { frameId: r.frameId, ...r.result } : null)).filter(Boolean);
}

export async function runInTab(cmd, payload = {}, { tabId } = {}) {
  const tab = tabId == null ? await activeTab() : await chrome.tabs.get(tabId);
  if (!tab || !scriptable(tab.url)) throw new Error('Ouvre une offre ou un formulaire de candidature (page web).');
  // Filter every frame, not only the top URL. Bind reinjection to the probed
  // document so a navigation cannot turn a permitted frame into LinkedIn/Google.
  const probes = await chrome.scripting.executeScript({
    target: { tabId: tab.id, allFrames: true },
    func: async () => {
      if (/(^|\.)linkedin\.com\.?$|(^|\.)google\.(com|ca|fr|co\.uk)\.?$/.test(location.hostname)) return null;
      const reply = await globalThis.__applyPilot?.run('ping', {});
      return { version: reply?.version || '', successfactorsRevision: reply?.successfactorsRevision || 0 };
    },
  });
  const outdated = probes.filter(frame => frame.result && (frame.result.version !== VERSION || frame.result.successfactorsRevision !== 2));
  if (outdated.length) {
    const documentIds = outdated.map(frame => frame.documentId);
    if (documentIds.some(id => !id)) throw new Error('Impossible d’accéder à la page : ferme et rouvre le panneau, puis réessaie sans recharger ton formulaire.');
    await chrome.scripting.executeScript({ target: { tabId: tab.id, documentIds }, files: CONTENT_FILES });
  }
  const frames = await exec(tab.id, cmd, payload);
  if (!frames.length) throw new Error('Impossible d’accéder à la page : ferme et rouvre le panneau, puis réessaie sans recharger ton formulaire.');
  const ok = frames.filter((f) => !f.error);
  if (!ok.length) throw new Error(String(frames[0].error).split('\n')[0]);
  return ok;
}
