// Local experimental connector for the public, undocumented jobs-guest HTML surface.
// No browser attachment, cookies, authentication, redirects, retries or detail crawling.
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { parseFragment } from 'parse5';
import { buildLinkedInPlan, externalJobUrl } from '../../extension/search/core.mjs';

const VERSION = createRequire(import.meta.url)('../package.json').version;
export const MAX_HTML_BYTES = 512 * 1024;
export const LINKEDIN_INTERVAL_MS = 2500;
const fail = (status, message, code = 'LINKEDIN') => Object.assign(new Error(message), { status, code });
const aborted = () => Object.assign(new Error('Recherche arrêtée.'), { name: 'AbortError', status: 499 });
const attr = (node, key) => node?.attrs?.find(a => a.name === key)?.value || '';
const hasClass = (node, value) => attr(node, 'class').split(/\s+/).includes(value);
function* nodes(root) {
  const pending = [root];
  while (pending.length) {
    const node = pending.pop(); yield node;
    if (['script', 'style', 'noscript', 'template'].includes(node.tagName)) continue;
    if (node.childNodes) for (let i = node.childNodes.length - 1; i >= 0; i--) pending.push(node.childNodes[i]);
  }
}
const text = node => [...nodes(node)].filter(n => n.nodeName === '#text').map(n => n.value).join(' ').replace(/\s+/g, ' ').trim();
const byClass = (node, value) => [...nodes(node)].find(n => hasClass(n, value));
const date = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().startsWith(value) ? value : '';
export function parseLinkedInJobs(html) {
  if (typeof html !== 'string' || Buffer.byteLength(html) > MAX_HTML_BYTES) throw fail(502, 'Réponse LinkedIn trop volumineuse.');
  if (/captcha|authwall|unusual traffic|access denied|too many requests|security verification|checkpoint\/challenge/i.test(html)) throw fail(502, 'LinkedIn demande une vérification ou refuse l’accès. Prototype arrêté.', 'LINKEDIN_BLOCKED');
  const root = parseFragment(html), jobs = [], seen = new Set();
  let cards = 0, invalid = 0;
  for (const card of nodes(root)) {
    const id = attr(card, 'data-entity-urn').match(/^urn:li:jobPosting:(\d{3,20})$/)?.[1];
    if (!id) continue;
    cards++;
    const title = text(byClass(card, 'base-search-card__title') || {}).slice(0, 300);
    const link = [...nodes(card)].find(n => n.tagName === 'a' && hasClass(n, 'base-card__full-link'));
    let url;
    try { url = externalJobUrl(attr(link, 'href')); } catch { invalid++; continue; }
    if (url !== `https://www.linkedin.com/jobs/view/${id}` || !title) { invalid++; continue; }
    if (seen.has(id)) continue;
    seen.add(id);
    if (jobs.length >= 25) continue;
    const time = [...nodes(card)].find(n => n.tagName === 'time');
    jobs.push({ url, title, company: text(byClass(card, 'base-search-card__subtitle') || {}).slice(0, 200), location: text(byClass(card, 'job-search-card__location') || {}).slice(0, 200), postedAt: date(attr(time, 'datetime')), source: 'linkedin-public' });
  }
  if (cards && !jobs.length) throw fail(502, 'Les cartes LinkedIn ont changé de format. Aucune offre enregistrée.');
  if (!cards && text(root) && !/no (?:matching )?(?:jobs|results)|aucun(?:e)? (?:offre|résultat)|0 (?:jobs|offres)/i.test(text(root))) throw fail(502, 'Réponse LinkedIn non reconnue. Aucune offre enregistrée.');
  return { items: jobs, cards, invalid, truncated: seen.size > jobs.length };
}
async function readBody(response, signal) {
  const reader = response.body?.getReader();
  if (!reader) return { html: '', bytes: 0 };
  let bytes = 0; const chunks = [];
  const cancel = () => { reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    while (!signal.aborted) {
      const { value, done } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_HTML_BYTES) { await reader.cancel(); throw fail(502, 'Réponse LinkedIn trop volumineuse.'); }
      chunks.push(value);
    }
    if (signal.aborted) throw aborted();
    return { html: Buffer.concat(chunks).toString('utf8'), bytes };
  } finally { signal.removeEventListener('abort', cancel); reader.releaseLock(); }
}
export function createLinkedInClient({ fetchImpl = globalThis.fetch, now = Date.now, intervalMs = LINKEDIN_INTERVAL_MS, timeoutMs = 15000 } = {}) {
  let busy = false, nextAllowedAt = 0;
  return async function searchPage({ settings, index = 0, acknowledgeExperimental = false, signal } = {}) {
    if (!acknowledgeExperimental) throw fail(400, 'Confirme le mode LinkedIn public expérimental.');
    const plan = buildLinkedInPlan(settings);
    if (!Number.isInteger(index) || index < 0 || index >= plan.length) throw fail(400, 'Index de requête LinkedIn invalide.');
    if (signal?.aborted) throw aborted();
    if (busy) throw fail(409, 'Une requête LinkedIn est déjà en cours.');
    if (now() < nextAllowedAt) throw fail(429, 'Accès LinkedIn en pause. Attends avant de réessayer.');
    busy = true; nextAllowedAt = now() + intervalMs;
    const deadline = AbortSignal.timeout(timeoutMs), combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
    const entry = plan[index];
    try {
      const response = await fetchImpl(entry.url, { method: 'GET', redirect: 'manual', credentials: 'omit', headers: { accept: 'text/html', 'user-agent': `ApplyPilot/${VERSION} (+https://github.com/Mbaka11/ApplyPilot; public-read-only-prototype)` }, signal: combined });
      if (response.status !== 200) {
        await response.body?.cancel().catch(() => {});
        if ([401, 403, 429, 999].includes(response.status) || (response.status >= 300 && response.status < 400)) {
          const retry = response.headers.get('retry-after') || '';
          const seconds = /^\d+$/.test(retry) ? Number(retry) : NaN;
          const retryAt = Number.isFinite(seconds) ? now() + seconds * 1000 : Date.parse(retry);
          nextAllowedAt = Math.max(now() + 5 * 60 * 1000, Number.isFinite(retryAt) ? retryAt : 0);
        }
        throw fail(response.status === 429 ? 429 : 502, `LinkedIn a interrompu l’accès (HTTP ${response.status}). Aucune nouvelle tentative automatique.`, 'LINKEDIN_HTTP');
      }
      if (!/^text\/html(?:;|$)/i.test(response.headers.get('content-type') || '')) { await response.body?.cancel().catch(() => {}); throw fail(502, 'Réponse LinkedIn non reconnue. Aucune offre enregistrée.'); }
      const { html, bytes } = await readBody(response, combined);
      const result = parseLinkedInJobs(html);
      if (combined.aborted) throw aborted();
      return { ...result, items: result.items.map(item => ({ ...item, query: entry.query })), evidence: { endpoint: 'jobs-guest/search', fetchedAt: new Date(now()).toISOString(), status: 200, bytes, sha256: crypto.createHash('sha256').update(html).digest('hex') } };
    } catch (error) {
      if (signal?.aborted) throw aborted();
      if (deadline.aborted) throw fail(504, 'Le délai LinkedIn est dépassé. Prototype arrêté.');
      if (error.code === 'LINKEDIN_BLOCKED') nextAllowedAt = now() + 5 * 60 * 1000;
      if (error.status) throw error;
      throw fail(502, 'Connexion LinkedIn indisponible. Aucune nouvelle tentative automatique.');
    } finally { busy = false; }
  };
}
export const searchLinkedInPage = createLinkedInClient();
