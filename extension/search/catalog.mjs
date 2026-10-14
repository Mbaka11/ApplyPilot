// URL evidence is not proof that a vacancy is still open or that a user is eligible.
import { externalJobUrl, isLinkedIn, normal } from './core.mjs';

export const PLATFORMS = { linkedin: 'LinkedIn', indeed: 'Indeed', glassdoor: 'Glassdoor', ziprecruiter: 'ZipRecruiter', employer: 'Site employeur', other: 'Autre site' };
const domain = (host, root) => host === root || host.endsWith('.' + root);
export function classifyJobLink(value) {
  let u;
  try { u = new URL(externalJobUrl(value)); } catch { return { kind: 'unknown', platform: 'other', evidence: 'unrecognized' }; }
  const host = u.hostname, p = u.pathname;
  const result = (kind, platform, evidence = 'url-pattern') => ({ kind, platform, evidence });
  if (isLinkedIn(u.href)) return result('job', 'linkedin'); // canonicalizer requires a numeric job ID
  if (/^(?:[a-z0-9-]+\.)*indeed\.(com|ca)$/.test(host)) return result(/^\/viewjob\/?$/.test(p) && /^[\w-]{6,80}$/.test(u.searchParams.get('jk') || '') ? 'job' : 'listing', 'indeed');
  if (/^(?:[a-z0-9-]+\.)*glassdoor\.(com|ca|fr)$/.test(host)) return result(/\/job-listing\//i.test(p) || u.searchParams.has('jobListingId') ? 'job' : 'listing', 'glassdoor');
  if (domain(host, 'ziprecruiter.com')) return result(/\/jobs\/[^/]+\/[^/]+/i.test(p) || (/\/c\/[^/]+\/Job\//i.test(p) && u.searchParams.has('jid')) ? 'job' : 'listing', 'ziprecruiter');
  if (/(^|\.)myworkday(jobs|site)\.com$/.test(host)) return result(/\/job\/.+_[\w-]+\/?$/i.test(p) ? 'job' : 'listing', 'employer');
  if (domain(host, 'greenhouse.io')) return result(/\/jobs\/\d+\/?$/.test(p) || /^\d+$/.test(u.searchParams.get('token') || '') ? 'job' : 'listing', 'employer');
  if (domain(host, 'lever.co') || domain(host, 'ashbyhq.com')) return result(/\/[^/]+\/[a-f0-9-]{20,}\/?$/i.test(p) ? 'job' : 'listing', 'employer');
  if (domain(host, 'smartrecruiters.com')) return result(/^\/[^/]+\/\d{6,}(?:-|\/|$)/.test(p) ? 'job' : 'listing', 'employer');
  if (domain(host, 'icims.com')) return result(/\/jobs\/\d+\//i.test(p) ? 'job' : 'listing', 'employer');
  if (domain(host, 'reddit.com') || domain(host, 'github.com') || domain(host, 'wikipedia.org')) return result('listing', 'other');
  if ((/\/jobdetail(?:\.ftl)?\/?$/i.test(p) && u.searchParams.get('job')) || /\/job-details\/[^/]+/i.test(p) || /^\d+$/.test(u.searchParams.get('gh_jid') || '')) return result('job', 'employer');
  if (/^\/(?:jobs?|careers?|search|vacancies|internships?)\/?$/i.test(p) || /\/(?:search-jobs|job-search|jobs-search)(?:\/|$)/i.test(p)) return result('listing', 'other');
  return result('unknown', 'other', 'unrecognized');
}
export function catalogMeta(job) {
  const links = [...new Set([job.url, job.employerUrl, ...(job.aliases || [])].filter(Boolean))];
  const classes = links.map(classifyJobLink);
  const kind = classes.some(c => c.kind === 'job') ? 'job' : classes.some(c => c.kind === 'unknown') ? 'unknown' : 'listing';
  const preferredUrl = job.employerUrl && classifyJobLink(job.employerUrl).kind !== 'listing' ? job.employerUrl : links.find((link, index) => classes[index].kind === 'job') || job.url;
  return { kind, preferredUrl, platforms: [...new Set(classes.map(c => c.platform))], discoveryMethods: [...new Set((job.sources || []).map(s => s === 'google' ? 'google' : s === 'linkedin-public' ? 'linkedin-public' : 'manual'))], evidence: kind === 'job' ? 'url-pattern' : 'unrecognized' };
}
export function filterCatalog(jobs, { status = 'visible', kind = 'job', platform = 'all', source = 'all', text = '' } = {}) {
  const needle = normal(text);
  return jobs.filter(job => {
    const meta = catalogMeta(job);
    return (status === 'all' || (status === 'visible' ? job.status !== 'hidden' : job.status === status)) &&
      (kind === 'all' || meta.kind === kind) && (platform === 'all' || meta.platforms.includes(platform)) &&
      (source === 'all' || meta.discoveryMethods.includes(source)) && (!needle || normal(`${job.title} ${job.company} ${job.location}`).includes(needle));
  });
}
