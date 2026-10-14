import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseLinkedInJobs, createLinkedInClient, MAX_HTML_BYTES } from '../server/src/linkedin.js';
import { searchDefaults, buildLinkedInPlan } from '../extension/search/core.mjs';
import { classifyJobLink, catalogMeta, filterCatalog } from '../extension/search/catalog.mjs';
const html = fs.readFileSync(new URL('./fixtures/linkedin-public.html', import.meta.url), 'utf8');
const settings = { ...searchDefaults(), term: '', maxPages: 1 };
const input = { settings, acknowledgeExperimental: true };
const response = (body = html, status = 200, type = 'text/html') => new Response(body, { status, headers: { 'content-type': type } });

test('public LinkedIn cards map individual IDs, plain text, company, location and optional dates', () => {
  const out = parseLinkedInJobs(html);
  assert.equal(out.items.length, 3);
  assert.equal(out.items[0].url, 'https://www.linkedin.com/jobs/view/1234567001');
  assert.equal(out.items[0].company, 'Nordic Analytics & Co.');
  assert.equal(out.items[0].location, 'Montréal, Québec, Canada');
  assert.equal(out.items[0].postedAt, '2026-10-12');
  assert.equal(out.items[2].postedAt, '');
  assert.ok(out.items.every(job => job.source === 'linkedin-public'));
});
test('parser does not execute scripts or accept IDs/links from a different origin', () => {
  const bad = html.replaceAll('https://www.linkedin.com/jobs/view/', 'https://evil.example.org/jobs/view/').replace('https://ca.linkedin.com/jobs/view/', 'https://evil.example.org/jobs/view/');
  assert.throws(() => parseLinkedInJobs(bad), /format/);
  const out = parseLinkedInJobs(html + '<script>throw new Error("must not run")</script>');
  assert.equal(out.items.length, 3);
  assert.throws(() => parseLinkedInJobs(html.replaceAll(/urn:li:jobPosting:\d+/g, 'urn:li:jobPosting:55555')), /format/);
});
test('parser distinguishes empty results, changed markup, challenges and oversized bodies', () => {
  assert.equal(parseLinkedInJobs('<ul></ul>').items.length, 0);
  assert.equal(parseLinkedInJobs('<p>No matching jobs</p>').items.length, 0);
  assert.throws(() => parseLinkedInJobs('<h1>Unexpected response</h1>'), /non reconnue/);
  assert.throws(() => parseLinkedInJobs('<p>Security verification</p>'), { code: 'LINKEDIN_BLOCKED' });
  assert.throws(() => parseLinkedInJobs('x'.repeat(MAX_HTML_BYTES + 1)), /volumineuse/);
});
test('query plan is bounded and has a fixed destination, without profile contact information', () => {
  const plan = buildLinkedInPlan({ ...settings, maxPages: 8, term: 'Winter 2027' });
  assert.equal(plan.length, 8);
  assert.equal(new URL(plan[0].url).origin, 'https://www.linkedin.com');
  assert.equal(new URL(plan[0].url).pathname, '/jobs-guest/jobs/api/seeMoreJobPostings/search');
  assert.equal(new URL(plan[1].url).searchParams.get('f_WT'), '2');
  assert.equal(new URL(plan[1].url).searchParams.get('location'), 'Canada');
  assert.ok(plan.every(entry => new URL(entry.url).searchParams.get('start') === '0'));
});
test('client uses one anonymous request and returns data, not raw HTML or cookies', async () => {
  const calls = [];
  const client = createLinkedInClient({ fetchImpl: async (url, options) => { calls.push({ url, options }); return response(); } });
  const out = await client(input);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.redirect, 'manual');
  assert.equal(calls[0].options.credentials, 'omit');
  assert.deepEqual(Object.keys(calls[0].options.headers).sort(), ['accept', 'user-agent']);
  assert.equal(out.items.length, 3);
  assert.equal(out.html, undefined);
  assert.match(out.evidence.sha256, /^[a-f\d]{64}$/);
});
test('validation, cooldown and concurrent-call protections prevent extra upstream requests', async () => {
  let calls = 0, time = 0;
  const client = createLinkedInClient({ now: () => time, fetchImpl: async () => { calls++; return response(); } });
  await assert.rejects(client({ settings }), { status: 400 });
  await assert.rejects(client({ ...input, index: 8 }), { status: 400 });
  assert.equal(calls, 0);
  await client(input);
  await assert.rejects(client(input), { status: 429 });
  assert.equal(calls, 1);
  time = 3000; await client(input); assert.equal(calls, 2);
});
for (const status of [302, 401, 403, 429]) test(`upstream HTTP ${status} ends the operation, no redirect/retry or immediate restart`, async () => {
  let calls = 0;
  const client = createLinkedInClient({ fetchImpl: async () => { calls++; return response('', status); } });
  await assert.rejects(client(input), /Aucune nouvelle tentative/);
  await assert.rejects(client(input), { status: 429 });
  assert.equal(calls, 1);
});
test('Retry-After extends the pause; it never schedules an automatic retry', async () => {
  let time = 0, calls = 0;
  const client = createLinkedInClient({ now: () => time, fetchImpl: async () => { calls++; return new Response('', { status: 429, headers: { 'retry-after': '3600' } }); } });
  await assert.rejects(client(input), { status: 429 });
  time = 300001; await assert.rejects(client(input), { status: 429 });
  assert.equal(calls, 1);
});
test('caller cancellation aborts the upstream request and does not parse or save late data', async () => {
  const controller = new AbortController(); let signal, notify;
  const started = new Promise(resolve => { notify = resolve; });
  const client = createLinkedInClient({ fetchImpl: (_url, options) => new Promise((resolve, reject) => { signal = options.signal; notify(); signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }); }) });
  const pending = client({ ...input, signal: controller.signal });
  await started;
  await assert.rejects(client(input), { status: 409 });
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError', status: 499 });
  assert.ok(signal.aborted);
});
test('deadline, content type, streaming size and pre-aborted calls fail closed', async () => {
  const controller = new AbortController(); controller.abort(); let calls = 0;
  const client = createLinkedInClient({ fetchImpl: async () => { calls++; return response(); } });
  await assert.rejects(client({ ...input, signal: controller.signal }), { name: 'AbortError' }); assert.equal(calls, 0);
  await assert.rejects(createLinkedInClient({ fetchImpl: async () => response('{}', 200, 'application/json') })(input), /non reconnue/);
  await assert.rejects(createLinkedInClient({ fetchImpl: async () => response('x'.repeat(MAX_HTML_BYTES + 1)) })(input), /volumineuse/);
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    const timed = createLinkedInClient({ timeoutMs: 10, fetchImpl: (_url, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('timeout', 'AbortError')))) });
    await assert.rejects(timed(input), { status: 504 });
  } finally { clearTimeout(keepAlive); }
});
test('job URLs are not confused with Indeed/Glassdoor/ATS listings or unrelated content', () => {
  for (const url of ['https://ca.indeed.com/jobs?q=software', 'https://www.glassdoor.ca/Job/montreal-intern-jobs-SRCH.htm', 'https://demo.wd3.myworkdayjobs.com/careers', 'https://jobs.lever.co/demo', 'https://github.com/example/job-list', 'https://jobs.example.org/search']) assert.equal(classifyJobLink(url).kind, 'listing', url);
  for (const url of ['https://ca.indeed.com/viewjob?jk=abcdef1234567890', 'https://www.linkedin.com/jobs/view/1234567001', 'https://demo.wd3.myworkdayjobs.com/en-US/jobs/job/Montreal/Stage_R-55555', 'https://job-boards.greenhouse.io/example/jobs/1234567']) assert.equal(classifyJobLink(url).kind, 'job', url);
  assert.equal(classifyJobLink('https://jobs.example.org/some-page').kind, 'unknown');
});
test('an aggregator alias cannot replace a known individual posting as the opening destination', () => {
  const job = { url: 'https://www.linkedin.com/jobs/view/1234567001', employerUrl: 'https://ca.indeed.com/jobs?q=intern' };
  assert.equal(catalogMeta(job).preferredUrl, job.url);
  assert.equal(classifyJobLink('https://jobs.smartrecruiters.com/Example/744000123456-intern').kind, 'job');
  assert.equal(classifyJobLink('https://jobs.smartrecruiters.com/Example').kind, 'listing');
});
test('platform and discovery method remain separate through manual/employer alias merges', () => {
  const job = { url: 'https://demo.wd3.myworkdayjobs.com/en-US/jobs/job/Montreal/Stage_R-55555', aliases: ['https://www.linkedin.com/jobs/view/1234567001'], status: 'new', title: 'ML intern', sources: ['google', 'linkedin-manual', 'linkedin-public'] };
  const meta = catalogMeta(job);
  assert.deepEqual(meta.platforms, ['employer', 'linkedin']);
  assert.deepEqual(meta.discoveryMethods, ['google', 'manual', 'linkedin-public']);
  assert.equal(filterCatalog([job], { platform: 'linkedin', source: 'manual' }).length, 1);
  assert.equal(filterCatalog([job], { platform: 'indeed' }).length, 0);
  assert.equal(filterCatalog([{ ...job, url: 'https://example.org/about', aliases: [] }]).length, 0, 'unknown links are not shown as identified jobs by default');
});
