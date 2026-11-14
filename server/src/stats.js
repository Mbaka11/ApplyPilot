// Pure tracker statistics. No I/O, no AI, no personal data in the output (no names, emails or companies).
import { catalogMeta } from '../../extension/search/catalog.mjs';

export const MIN_SAMPLE = 5; // below this many submissions a rate is noise: report null, the UI shows "n = x"
const RESPONSE = new Set(['entrevue', 'offre', 'refusée']);
const SUBMITTED_STATUS = new Set(['soumise', ...RESPONSE]);
const DAY = 86400000;

const isoTime = v => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? Date.parse(v) : null);
const submittedOf = app => isoTime(app.submittedAt) !== null || SUBMITTED_STATUS.has(app.status) || respondedOf(app);
// A dated first response counts even if the application was later abandoned; otherwise the current status decides.
const respondedOf = app => isoTime(app.respondedAt) !== null || isoTime(app.firstResponseAt) !== null || RESPONSE.has(app.status);
const key = (v, fallback) => (typeof v === 'string' && v.trim() ? v.trim().toLowerCase().slice(0, 80) : fallback);
const rate = (responded, submitted) => (submitted < MIN_SAMPLE ? null : Math.round((responded / submitted) * 1000) / 1000);

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), mid = sorted.length >> 1;
  const m = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return Math.round(m * 10) / 10;
}
function breakdown(map) {
  return [...map.entries()]
    .map(([k, v]) => ({ key: k, created: v.created, submitted: v.submitted, responded: v.responded, rate: rate(v.responded, v.submitted) }))
    .sort((a, b) => b.submitted - a.submitted || b.created - a.created || a.key.localeCompare(b.key));
}

/** The first-response date is optional: only an explicit `respondedAt` (or `firstResponseAt`) counts. */
export function computeStats(applications = [], catalogJobs = [], identifiedCount = null) {
  const apps = (Array.isArray(applications) ? applications : []).filter(a => a && typeof a === 'object');
  const jobs = Array.isArray(catalogJobs) ? catalogJobs : [];
  let identified = Number.isInteger(identifiedCount) && identifiedCount >= 0 ? identifiedCount : 0;
  if (identifiedCount === null) for (const job of jobs) { try { if (catalogMeta(job || {}).kind === 'job') identified++; } catch { /* odd legacy row */ } }
  const byPlatform = new Map(), byCv = new Map(), delays = [];
  let submitted = 0, responded = 0;
  const bump = (map, k, isSub, isResp) => {
    const row = map.get(k) || { created: 0, submitted: 0, responded: 0 };
    row.created++; if (isSub) row.submitted++; if (isResp) row.responded++;
    map.set(k, row);
  };
  for (const app of apps) {
    const isResp = respondedOf(app), isSub = submittedOf(app); // a response implies a submission
    if (isSub) submitted++;
    if (isResp) responded++;
    bump(byPlatform, key(app.job?.platform, 'other'), isSub, isResp);
    bump(byCv, key(app.cvId, 'none'), isSub, isResp);
    if (isResp) {
      const from = isoTime(app.submittedAt), to = isoTime(app.respondedAt) ?? isoTime(app.firstResponseAt);
      if (from !== null && to !== null && to >= from) delays.push((to - from) / DAY);
    }
  }
  return {
    minSample: MIN_SAMPLE,
    funnel: { identified, created: apps.length, submitted, responded },
    responses: {
      interview: apps.filter(a => a.status === 'entrevue').length,
      offer: apps.filter(a => a.status === 'offre').length,
      rejection: apps.filter(a => a.status === 'refusée').length,
    },
    rate: rate(responded, submitted),
    byPlatform: breakdown(byPlatform),
    byCv: breakdown(byCv),
    medianResponseDays: median(delays),
    delaySamples: delays.length,
  };
}
