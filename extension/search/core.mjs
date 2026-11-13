// Pure discovery helpers shared by the panel and server. No network or credentials.
export const CATEGORIES = {
  ai: { label: 'IA / Machine learning', query: '("machine learning" OR "artificial intelligence" OR "intelligence artificielle")', pattern: /\b(machine learning|artificial intelligence|intelligence artificielle|deep learning|apprentissage automatique|ai|ia|ml)\b/i },
  dev: { label: 'Développement / Programmation', query: '(software OR programming OR developer OR developpeur OR informatique)', pattern: /\b(software|programming|developer|developpeu[rs]|developpement|informatique|logiciel|coding|full.?stack|backend|frontend)\b/i },
  data: { label: 'Data / Analytique', query: '("data science" OR "data analyst" OR "data engineering" OR analytique)', pattern: /\b(data|analytics|analytique|donnees|business intelligence|bi)\b/i },
  consulting: { label: 'Consulting technologique', query: '(consulting OR consultant OR conseil) (technology OR digital OR ai OR logiciel)', pattern: /\b(consulting|consultant|conseil|advisory|transformation|digital)\b/i },
};
// Places, by priority. `secondary` places get one query covering every selected domain,
// placed after the Montréal/Canada queries and only when the budget allows it.
const PLACE = {
  montreal: { google: '(Montreal OR Montréal OR Laval OR Longueuil OR Brossard)', linkedin: 'Montreal, Quebec, Canada' },
  canadaRemote: { google: '(Canada) (remote OR teletravail OR "work from home")', linkedin: 'Canada', remote: true },
  toronto: { google: '(Toronto OR Mississauga OR Markham OR "Richmond Hill")', linkedin: 'Toronto, Ontario, Canada' },
  usa: { google: '("United States" OR USA OR "New York" OR "San Francisco" OR Boston OR Seattle)', linkedin: 'United States' },
};
const scope = (label, linkedin, primary, secondary = []) => ({ label, linkedin, google: primary.map(p => p.google), places: primary, secondary });
export const SCOPES = {
  montreal_remote: scope('Grand Montréal + télétravail Canada', 'Greater Montreal Metropolitan Area', [PLACE.montreal, PLACE.canadaRemote]),
  montreal_plus: scope('Montréal + Canada en priorité, puis Toronto et États-Unis', 'Greater Montreal Metropolitan Area', [PLACE.montreal, PLACE.canadaRemote], [PLACE.toronto, PLACE.usa]),
  quebec: scope('Québec', 'Quebec, Canada', [{ google: '(Quebec OR Québec)', linkedin: 'Quebec, Canada' }]),
  canada: scope('Canada', 'Canada', [{ google: 'Canada', linkedin: 'Canada' }]),
  toronto: scope('Grand Toronto', 'Greater Toronto Area, Canada', [PLACE.toronto]),
  usa: scope('États-Unis', 'United States', [PLACE.usa]),
};
/** Secondary places take at most one slot per 4 queries, always after the priority ones. */
function placePlan(options) {
  const { places, secondary } = SCOPES[options.scope];
  const extra = secondary.slice(0, Math.floor(options.maxPages / 4));
  const primary = options.categories.flatMap(category => places.map(place => ({ category, categories: [category], place })));
  return [...primary.slice(0, options.maxPages - extra.length), ...extra.map(place => ({ category: options.categories[0], categories: options.categories, place }))];
}
const categoryQuery = (keys) => keys.length === 1 ? CATEGORIES[keys[0]].query : `(${keys.map(key => CATEGORIES[key].query).join(' OR ')})`;
export const JOB_STATES = ['new', 'saved', 'hidden'];
export const normal = (text) => String(text ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const fail = (message) => { throw Object.assign(new Error(message), { status: 400 }); };
const clean = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const decode = (text) => { try { return decodeURIComponent(text); } catch { return text; } };
const keywordList = (value) => value.split(/[,;]|\s+OR\s+/i).map((word) => word.replace(/["\\()]/g, '').trim()).filter(Boolean);

export function searchDefaults(profile = {}) {
  // Intentionally never include contact details, education scores, or eligibility.
  return { keywords: 'intern, stagiaire, internship, stage', categories: Object.keys(CATEGORIES), scope: 'montreal_plus', term: clean(profile.availability?.termEn || profile.availability?.term, 80), maxPages: 8 };
}
export function validateSettings(input, base = searchDefaults()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Paramètres de recherche invalides.');
  const out = Object.fromEntries(['keywords', 'term', 'scope', 'categories', 'maxPages'].map(key => [key, input[key] === undefined ? base[key] : input[key]]));
  if (typeof out.keywords !== 'string' || out.keywords.length > 200 || /[\u0000-\u001f\u007f]/.test(out.keywords) || !keywordList(out.keywords).length || keywordList(out.keywords).length > 12) fail('Indique de 1 à 12 mots-clés (200 caractères maximum).');
  if (typeof out.term !== 'string' || out.term.length > 80 || /[\u0000-\u001f\u007f]/.test(out.term)) fail('Session de recherche invalide (80 caractères maximum).');
  if (typeof out.scope !== 'string' || !Object.hasOwn(SCOPES, out.scope)) fail('Zone de recherche inconnue.');
  if (!Array.isArray(out.categories) || !out.categories.length || out.categories.some(key => typeof key !== 'string' || !Object.hasOwn(CATEGORIES, key))) fail('Choisis au moins un domaine de recherche.');
  if (!Number.isInteger(out.maxPages) || out.maxPages < 1 || out.maxPages > 8) fail('La limite de recherche doit être entre 1 et 8 requêtes.');
  return { ...out, keywords: out.keywords.trim(), term: out.term.trim(), categories: [...new Set(out.categories)] };
}
const quoted = (term) => `"${term.replace(/["\\]/g, ' ').trim()}"`;
const keywordQuery = (value) => `(${keywordList(value).map(quoted).join(' OR ')})`;
function termQuery(term) {
  const match = normal(term).match(/^(winter|hiver|summer|ete|fall|automne|spring|printemps)\s+(20\d\d)$/);
  if (!match) return term ? quoted(term) : '';
  const seasons = { winter: ['winter', 'hiver'], hiver: ['winter', 'hiver'], summer: ['summer', 'été'], ete: ['summer', 'été'], fall: ['fall', 'automne'], automne: ['fall', 'automne'], spring: ['spring', 'printemps'], printemps: ['spring', 'printemps'] };
  return `(${seasons[match[1]].map(season => quoted(`${season} ${match[2]}`)).join(' OR ')})`;
}
export function buildSearchPlan(settings) {
  const options = validateSettings(settings);
  // Local/remote pairs: a smaller budget doesn't silently remove all remote queries.
  return placePlan(options).map(({ category, categories, place }) => {
    const query = [keywordQuery(options.keywords), categoryQuery(categories), place.google, termQuery(options.term), '(site:myworkdayjobs.com OR site:jobs.lever.co OR site:job-boards.greenhouse.io OR inurl:viewjob OR inurl:job-listing OR inurl:job)', '-site:linkedin.com/in/ -site:linkedin.com/pub/'].filter(Boolean).join(' ');
    const url = new URL('https://www.google.com/search');
    url.search = new URLSearchParams({ q: query, hl: 'en', gl: 'ca', num: '10' }).toString();
    return { category, query, url: url.href };
  });
}
export function linkedinSearchUrl(settings, remote = false) {
  const options = validateSettings(settings);
  const query = [keywordQuery(options.keywords), `(${options.categories.map(key => CATEGORIES[key].query).join(' OR ')})`, termQuery(options.term)].filter(Boolean).join(' ');
  const url = new URL('https://www.linkedin.com/jobs/search/');
  url.search = new URLSearchParams({ keywords: query, location: remote ? 'Canada' : SCOPES[options.scope].linkedin, f_E: '1', ...(remote ? { f_WT: '2' } : {}) }).toString();
  return url.href; // User opens this link. No LinkedIn collector or API replay exists.
}
// Public, undocumented LinkedIn HTML endpoint. Never accepts a caller-supplied host.
export function buildLinkedInPlan(settings) {
  const options = validateSettings(settings);
  return placePlan(options).map(({ category, categories, place }) => {
    const query = [keywordQuery(options.keywords), categoryQuery(categories), termQuery(options.term)].filter(Boolean).join(' ');
    const url = new URL('https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search');
    url.search = new URLSearchParams({ keywords: query, location: place.linkedin, f_E: '1', start: '0', ...(place.remote ? { f_WT: '2' } : {}) }).toString();
    return { category, query, location: place.linkedin, remote: !!place.remote, url: url.href };
  });
}
export function isGoogleSearch(url) {
  try { const u = new URL(url); return u.protocol === 'https:' && !u.username && !u.password && !u.port && /^(?:www\.)?google\.(?:com|ca|fr|co\.uk)$/.test(u.hostname) && u.pathname === '/search'; } catch { return false; }
}
export function isLinkedIn(url) {
  try { return /(^|\.)linkedin\.com\.?$/i.test(new URL(url).hostname); } catch { return false; }
}
// No general offer extraction/autofill on discovery services, including redirects.
export function isDiscoveryPage(url) {
  try { return isLinkedIn(url) || /(^|\.)google\.(com|ca|fr|co\.uk)\.?$/.test(new URL(url).hostname); } catch { return false; }
}
export function isExpectedSearch(url, query) {
  return isGoogleSearch(url) && new URL(url).searchParams.get('q') === query;
}
export function externalJobUrl(value) {
  if (typeof value !== 'string' || value.length > 4096 || /[\u0000-\u0020\u007f]/.test(value.trim())) fail('URL d’offre invalide.');
  let u;
  try { u = new URL(value.trim()); } catch { fail('URL d’offre invalide.'); }
  if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password || u.port) fail('Utilise une URL HTTP(S) publique, sans identifiants ni port privé.');
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(host) || host.split('.').some(label => !label || label.length > 63 || label.startsWith('-') || label.endsWith('-')) || /(^|\.)(localhost|local|internal|test|invalid|onion|home|lan)$/.test(host) || /(^|\.)(nip\.io|sslip\.io|localtest\.me|lvh\.me)$/.test(host)) fail('Les adresses locales ou privées ne sont pas acceptées.');
  u.hostname = host;
  u.hash = '';
  if (isLinkedIn(u.href)) {
    const id = u.pathname.match(/^\/jobs\/view\/(?:[^/]*?-)?(\d+)(?:\/|$)/)?.[1] || (/^\/jobs(?:\/|$)/.test(u.pathname) && u.searchParams.get('currentJobId'));
    if (!id || !/^\d{3,20}$/.test(id)) fail('Ajoute le lien d’une offre LinkedIn, pas un profil ni une page de recherche.');
    return `https://www.linkedin.com/jobs/view/${id}`;
  }
  for (const key of [...u.searchParams.keys()]) if (/^(utm_.+|gclid|fbclid|trackingId|refId|source|src|ref|trk|tracking|from|gh_src)$/i.test(key)) u.searchParams.delete(key);
  u.searchParams.sort();
  u.pathname = u.pathname.replace(/\/(apply|applyManually|autofillWithResume|useMyLastApplication)(\/.*)?$/i, '').replace(/\/+$/, '') || '/';
  return u.href;
}
export function offerKey(url) {
  const u = new URL(externalJobUrl(url));
  if (isLinkedIn(u.href)) return `linkedin:${u.pathname.split('/').pop()}`;
  if (/(^|\.)myworkday(jobs|site)\.com$/i.test(u.hostname)) {
    const id = u.pathname.match(/_(R[-_]?[\w-]+|JR\d+|\d{5,})(?:-\d+)?$/i)?.[1];
    if (id) return `${u.hostname}:workday:${id.toLowerCase()}`;
  }
  // Generic paths/IDs can be case-sensitive; do not merge merely similar titles.
  return `${u.hostname.replace(/^www\./, '')}${u.pathname}${u.search}`;
}
// Same identity rules as content/extract.js for an explicit future application.
export function applicationJobKey(url) {
  const u = new URL(externalJobUrl(url)), host = u.hostname.replace(/^www\./, '').toLowerCase();
  let p = decode(u.pathname).replace(/\/+$/, '');
  if (/(^|\.)myworkday(jobs|site)\.com$|(^|\.)workday\.com$/i.test(host)) return `${host}/${p.split('/').filter(Boolean).pop() || ''}`.toLowerCase();
  p = p.replace(/\/(apply|application|applications|candidature|postuler|apply-now)(\/.*)?$/i, '');
  const key = ['gh_jid', 'jobId', 'jobid', 'job', 'id', 'jid', 'requisitionId', 'career_job_req_id'].find(k => u.searchParams.get(k));
  return `${host}${p}${key ? `?${key}=${u.searchParams.get(key)}` : ''}`.toLowerCase();
}
export function rankOffer(job, settings) {
  const text = normal(`${job.title || ''} ${job.snippet || ''} ${job.description || ''} ${job.location || ''}`);
  const categories = settings.categories.filter(key => CATEGORIES[key].pattern.test(text));
  const reasons = [];
  let score = 0;
  if (/\b(intern(?:ship)?|stagiaire|stage|co-?op)\b/.test(text)) { score += 45; reasons.push('stage'); }
  if (categories.length) { score += 30; reasons.push(...categories); }
  // Priority: Montréal > rest of Canada (Toronto included) > elsewhere (United States).
  if (/\b(montreal|laval|longueuil|brossard|saint-laurent)\b/.test(text)) { score += 10; reasons.push('montreal'); }
  else if (/\b(canada|quebec|toronto|mississauga|markham|ontario|ottawa|vancouver)\b/.test(text)) { score += 5; reasons.push('canada'); }
  if (/\b(remote|teletravail|hybrid[e]?)\b/.test(text)) { score += 5; reasons.push('flexible'); }
  const year = settings.term?.match(/20\d\d/)?.[0];
  if (year && text.includes(year)) { score += 10; reasons.push('term'); }
  if (/\b(courses?|cours|bootcamp|formation gratuite|comment devenir|how to become)\b/.test(text)) { score -= 40; reasons.push('possibly_not_job'); }
  return { score: Math.max(0, Math.min(100, score)), categories, reasons };
}
export function manualLinks(text) {
  if (typeof text !== 'string' || text.length > 20000) fail('Colle au maximum 50 liens d’offres.');
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!lines.length || lines.length > 50) fail('Colle entre 1 et 50 liens d’offres.');
  return lines.map(line => {
    const matches = [...line.matchAll(/https?:\/\/[^\s|<>]+/gi)];
    if (matches.length !== 1) fail('Chaque ligne doit contenir une seule URL d’offre.');
    const [match] = matches, url = externalJobUrl(match[0]);
    return { url, title: clean(line.slice(0, match.index).replace(/[|\-–]+\s*$/, ''), 300), source: isLinkedIn(url) ? 'linkedin-manual' : 'manual' };
  });
}
