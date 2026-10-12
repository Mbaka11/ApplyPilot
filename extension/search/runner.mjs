import { buildSearchPlan, isExpectedSearch, externalJobUrl, offerKey } from './core.mjs';

const stopped = () => Object.assign(new Error('Recherche arrêtée.'), { name: 'AbortError' });
const checkpoint = signal => { if (signal?.aborted) throw stopped(); };
function bounded(promise, signal, timeout = 15000) {
  return new Promise((resolve, reject) => {
    let timer;
    const finish = (fn, value) => { clearTimeout(timer); signal?.removeEventListener('abort', abort); fn(value); };
    const abort = () => finish(reject, stopped());
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => finish(reject, new Error('Le délai de recherche est dépassé.')), timeout);
    Promise.resolve(promise).then(value => finish(resolve, value), error => finish(reject, error));
    if (signal?.aborted) abort();
  });
}
export function searchDelay(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(stopped()); };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}
const BLOCKS = {
  challenge: 'Google demande une vérification. Recherche interrompue, sans contournement.',
  consent: 'Google demande un consentement ou une connexion. Recherche interrompue.',
  blocked: 'Google refuse ou limite l’accès. Recherche interrompue, sans nouvelle tentative.',
  navigation: 'L’onglet de recherche a changé de page. Recherche interrompue.',
};

/** One run owns one newly-created tab, never an existing tab or browser session.
 * Never closes tabs (including its own), never visits results, never retries a blocker.
 * Each script is top-frame/document bound and checks origin + query before reading DOM.
 */
export async function runGoogleSearch({ settings, chrome: browser = globalThis.chrome, signal, onPage = async () => {}, onProgress = () => {}, wait = searchDelay, pollLimit = 60, pollMs = 500, betweenMs = 1800 }) {
  const plan = buildSearchPlan(settings);
  let tabId, priorUrl = 'about:blank', found = 0, skipped = 0;
  const call = promise => bounded(promise, signal);
  const getTab = async () => {
    checkpoint(signal);
    try { return await call(browser.tabs.get(tabId)); }
    catch (error) { if (error.name === 'AbortError') throw error; throw new Error('L’onglet de recherche est fermé ou inaccessible.'); }
  };
  const progress = (index, status) => { checkpoint(signal); onProgress({ page: index + 1, total: plan.length, query: plan[index].query, status, tabId, found, skipped }); };
  try {
    checkpoint(signal);
    const tab = await call(browser.tabs.create({ url: 'about:blank', active: false }));
    tabId = tab.id;
    if (!Number.isInteger(tabId)) throw new Error('Impossible de créer l’onglet de recherche.');
    for (let index = 0; index < plan.length; index++) {
      checkpoint(signal);
      if (index) await wait(betweenMs, signal);
      const entry = plan[index], before = await getTab();
      const expectedPrior = index ? isExpectedSearch(before.url, plan[index - 1].query) : before.url === 'about:blank' || (!before.url && before.pendingUrl === 'about:blank');
      if (!expectedPrior || (before.pendingUrl && before.pendingUrl !== 'about:blank' && !isExpectedSearch(before.pendingUrl, index ? plan[index - 1].query : entry.query))) throw new Error(BLOCKS.navigation);
      priorUrl = before.url || 'about:blank';
      checkpoint(signal);
      progress(index, 'opening');
      checkpoint(signal);
      await call(browser.tabs.update(tabId, { url: entry.url }));
      let result, stable = '', documentId;
      for (let poll = 0; poll < pollLimit; poll++) {
        const current = await getTab();
        if (current.pendingUrl && !isExpectedSearch(current.pendingUrl, entry.query)) throw new Error(BLOCKS.navigation);
        const expected = isExpectedSearch(current.url, entry.query);
        if (!expected && !(current.status === 'loading' && current.url === priorUrl && isExpectedSearch(current.pendingUrl, entry.query))) throw new Error(BLOCKS.navigation);
        if (!expected || current.status !== 'complete') { await wait(pollMs, signal); continue; }
        progress(index, 'reading');
        checkpoint(signal);
        if (!documentId) {
          const injected = await call(browser.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: ['search/collector.js'] }));
          documentId = injected.find(frame => frame.frameId === 0)?.documentId;
          if (!documentId) throw new Error('Impossible de lier la collecte à la page Google.');
        }
        checkpoint(signal);
        const frames = await call(browser.scripting.executeScript({ target: { tabId, documentIds: [documentId] }, func: query => globalThis.__applyPilotSearch?.collectGoogle(query), args: [entry.query] }));
        checkpoint(signal);
        result = frames.find(frame => frame.frameId === 0 && frame.documentId === documentId)?.result;
        if (!result || !isExpectedSearch(result.href, entry.query)) throw new Error(BLOCKS.navigation);
        if (BLOCKS[result.status]) throw new Error(BLOCKS[result.status]);
        if (result.status === 'empty') break;
        if (result.status === 'ready' && Array.isArray(result.items)) {
          const signature = JSON.stringify(result.items);
          if (stable === signature) break; // two consecutive snapshots, bounded wait
          stable = signature;
        } else stable = '';
        result = null;
        await wait(pollMs, signal);
      }
      checkpoint(signal);
      if (!result || !['ready', 'empty'].includes(result.status)) throw new Error('Google n’a pas fourni de résultats lisibles dans le délai imparti.');
      const items = [], seen = new Set();
      for (const item of (result.items || []).slice(0, 30)) {
        try {
          const url = externalJobUrl(item.url), key = offerKey(url);
          if (seen.has(key)) continue;
          if (typeof item.title !== 'string' || !item.title.trim()) throw new Error();
          seen.add(key);
          items.push({ url, title: item.title.slice(0, 300), snippet: typeof item.snippet === 'string' ? item.snippet.slice(0, 4000) : '', source: 'google', query: entry.query });
        } catch { skipped++; }
      }
      checkpoint(signal);
      if (items.length) await bounded(onPage(items), signal, 30000);
      checkpoint(signal);
      found += items.length;
      progress(index, 'saved');
    }
    return { pages: plan.length, found, skipped, tabId };
  } catch (error) {
    error.searchTabId = tabId;
    throw error;
  }
}
