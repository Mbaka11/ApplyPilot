import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { searchDefaults, validateSettings, buildSearchPlan, buildLinkedInPlan, linkedinSearchUrl, externalJobUrl, offerKey, applicationJobKey, manualLinks, rankOffer, isGoogleSearch, isExpectedSearch } from '../extension/search/core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tests/output/search-unit');
fs.mkdirSync(OUT, { recursive: true });
const DATA = fs.mkdtempSync(path.join(OUT, 'catalog-'));
process.env.APPLYPILOT_DATA_DIR = DATA;
const { countIdentifiedJobs, recordSearchRun, getSearch, markSearchSeen, addDiscoveries, importDiscoveries, saveSearchSettings, updateDiscovery, deleteDiscovery, clearDiscoveries } = await import('../server/src/search.js');
const file = path.join(DATA, 'search/discovery.json');
const defaults = searchDefaults({ availability: { termEn: 'Winter 2027' } });
const employer = 'https://careers.example.org/job-details/software-intern';
const linked = 'https://www.linkedin.com/jobs/view/1234567890';
const sample = { url: employer, title: 'Software intern — Winter 2027', location: 'Montréal', snippet: 'Hybrid software development internship.', source: 'google', query: 'software intern' };
const reset = () => fs.rmSync(path.join(DATA, 'search'), { recursive: true, force: true });
test.after(() => fs.rmSync(DATA, { recursive: true, force: true }));

test('clear requires exact confirmation and current IDs, backs up bytes and keeps settings/applications', () => {
  reset();
  saveSearchSettings(defaults);
  addDiscoveries([sample, { ...sample, url: employer + '-2' }]);
  const jobs = getSearch().jobs;
  updateDiscovery(jobs[0].id, { status: 'saved' });
  updateDiscovery(jobs[1].id, { status: 'hidden' });
  const before = fs.readFileSync(file);
  const ids = jobs.map(job => job.id);
  const sentinel = path.join(DATA, 'applications', 'fictional', 'application.json');
  fs.mkdirSync(path.dirname(sentinel), { recursive: true });
  fs.writeFileSync(sentinel, 'application preserved');
  for (const input of [null, {}, { confirm: false, ids }, { confirm: true, ids, extra: true }, { confirm: true, ids: [ids[0], ids[0]] }]) {
    assert.throws(() => clearDiscoveries(input), { status: 400 });
    assert.deepEqual(fs.readFileSync(file), before);
  }
  assert.throws(() => clearDiscoveries({ confirm: true, ids: [ids[0]] }), { status: 409 });
  assert.deepEqual(clearDiscoveries({ confirm: true, ids: [...ids].reverse() }), { removed: 2 });
  assert.deepEqual(getSearch().jobs, []);
  assert.deepEqual(getSearch().settings, defaults);
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'application preserved');
  const backups = fs.readdirSync(path.join(DATA, 'backups', 'search')).filter(name => name.startsWith('discovery-before-clear-'));
  assert.equal(backups.length, 1);
  assert.deepEqual(fs.readFileSync(path.join(DATA, 'backups', 'search', backups[0])), before);
  assert.deepEqual(clearDiscoveries({ confirm: true, ids: [] }), { removed: 0 });
  fs.writeFileSync(file, '{broken');
  assert.throws(() => clearDiscoveries({ confirm: true, ids: [] }), { status: 409 });
  assert.equal(fs.readFileSync(file, 'utf8'), '{broken');
  fs.rmSync(path.join(DATA, 'applications'), { recursive: true, force: true });
  reset();
});

test('defaults broaden domains but never leak profile contact/eligibility data into search', () => {
  const settings = searchDefaults({ identity: { email: 'PRIVATE_CANARY', address: { line1: 'PRIVATE_CANARY' } }, languages: [{ level: 'PRIVATE_CANARY' }], availability: { termEn: 'Winter 2027' } });
  assert.deepEqual(settings.categories, ['ai', 'dev', 'data', 'consulting']);
  const plan = buildSearchPlan(settings);
  assert.equal(plan.length, 8);
  assert.ok(!JSON.stringify(plan).includes('PRIVATE_CANARY'));
  assert.ok(plan.every(p => isExpectedSearch(p.url, p.query)));
  assert.match(plan[0].query, /winter 2027.*hiver 2027/i);
  assert.match(plan[1].query, /Canada.*remote/);
  assert.equal(buildSearchPlan({ ...settings, maxPages: 2 }).length, 2);
});
test('Montréal/Canada queries come first; Toronto and US only use spare budget', () => {
  const settings = { ...defaults, scope: 'montreal_plus' };
  const plan = buildSearchPlan(settings);
  assert.equal(plan.length, 8);
  assert.ok(plan.slice(0, 6).every(p => /Montreal|Canada\) \(remote/.test(p.query)));
  assert.match(plan[6].query, /Toronto/);
  assert.match(plan[7].query, /United States/);
  assert.match(plan[6].query, /machine learning.*software.*data science.*consulting/);
  const small = buildSearchPlan({ ...settings, maxPages: 3 });
  assert.ok(small.every(p => !/Toronto|United States/.test(p.query)));
  assert.deepEqual(buildLinkedInPlan(settings).slice(-2).map(p => p.location), ['Toronto, Ontario, Canada', 'United States']);
  assert.ok(buildSearchPlan({ ...defaults, scope: 'toronto' }).every(p => /Toronto/.test(p.query)));
  assert.ok(buildSearchPlan({ ...defaults, scope: 'usa' }).every(p => /United States/.test(p.query)));
});
test('ranking prefers Montréal, then the rest of Canada, then the United States', () => {
  const job = location => rankOffer({ title: 'Software intern', location }, defaults).score;
  assert.ok(job('Montréal, QC') > job('Toronto, ON'));
  assert.ok(job('Toronto, ON') > job('New York, NY'));
});
test('settings are bounded, reject invalid values, and do not mutate the caller', () => {
  const original = JSON.stringify(defaults);
  for (const input of [null, [], { keywords: ' , () ' }, { keywords: 'x'.repeat(201) }, { keywords: 'a\nb' }, { categories: [] }, { categories: ['__proto__'] }, { categories: null }, { scope: '__proto__' }, { maxPages: 9 }, { maxPages: 0 }, { maxPages: 2.5 }, { term: null }, { term: 'a'.repeat(81) }]) assert.throws(() => validateSettings(input), { status: 400 });
  assert.equal(validateSettings({ term: '' }, defaults).term, '');
  assert.equal(JSON.stringify(defaults), original);
});
test('prepared LinkedIn links include location/term and remain ordinary user-opened URLs', () => {
  const local = new URL(linkedinSearchUrl(defaults));
  const remote = new URL(linkedinSearchUrl(defaults, true));
  assert.equal(local.hostname, 'www.linkedin.com');
  assert.equal(local.searchParams.get('location'), 'Greater Montreal Metropolitan Area');
  assert.match(local.searchParams.get('keywords'), /2027/);
  assert.equal(remote.searchParams.get('f_WT'), '2');
  assert.equal(remote.searchParams.get('location'), 'Canada');
});
test('URLs remove trackers and LinkedIn slug variants share a numeric identity', () => {
  assert.equal(externalJobUrl(employer + '/apply?utm_source=web&jobId=AB#section'), employer + '?jobId=AB');
  assert.equal(externalJobUrl('https://ca.linkedin.com/jobs/view/software-intern-1234567890/?trackingId=abc'), linked);
  assert.equal(externalJobUrl('https://www.linkedin.com/jobs/search/?currentJobId=1234567890'), linked);
  assert.equal(offerKey(linked), 'linkedin:1234567890');
  assert.notEqual(offerKey(employer + '?jobId=AB'), offerKey(employer + '?jobId=ab'));
});
test('non-public, malformed, credential, profile and unsafe port URLs are rejected', () => {
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'http://localhost/jobs', 'http://127.0.0.1/a', 'http://2130706433/a', 'http://[::1]/', 'https://x.local/a', 'https://127.0.0.1.nip.io/a', 'https://localtest.me/a', 'https://u:p@example.org/a', 'https://example.org:8000/a', 'https://example.org/a b', 'https://www.linkedin.com/in/fictional', 'https://www.linkedin.com/jobs/search/', 'https://www.linkedin.com/in/x?currentJobId=12345']) assert.throws(() => externalJobUrl(url), { status: 400 }, url);
  assert.equal(isGoogleSearch('https://www.google.com.evil.org/search?q=x'), false);
  assert.equal(isGoogleSearch('https://u:p@www.google.com/search?q=x'), false);
  assert.equal(isExpectedSearch('https://www.google.com/search?q=other', 'x'), false);
});
test('Workday language/application variants match without conflating requisitions', () => {
  const first = 'https://demo.wd3.myworkdayjobs.com/en-US/careers/job/Montreal/Intern_123477-1/apply';
  const second = 'https://demo.wd3.myworkdayjobs.com/fr-CA/carrieres/job/Montreal/Stage_123477';
  assert.equal(offerKey(first), offerKey(second));
  assert.notEqual(offerKey(first), offerKey(second.replace('123477', '123478')));
  assert.equal(applicationJobKey(first), 'demo.wd3.myworkdayjobs.com/intern_123477-1');
  assert.equal(applicationJobKey('https://www.example.org/jobs/ABC/apply?utm_source=x&jobId=42'), 'example.org/jobs/abc?jobid=42');
  assert.doesNotThrow(() => offerKey('https://example.org/jobs/%broken'));
});
test('manual imports support optional titles, bound batches and reject multi-URL ambiguity', () => {
  assert.deepEqual(manualLinks('Software intern | ' + employer)[0], { url: employer, title: 'Software intern', source: 'manual' });
  assert.equal(manualLinks(linked)[0].source, 'linkedin-manual');
  for (const value of ['', 'no URL', employer + ' ' + linked, Array(51).fill(employer).join('\n')]) assert.throws(() => manualLinks(value), { status: 400 });
});
test('ranking is lexical/indicative, supports non-ML work and preserves job text', () => {
  const before = JSON.stringify(sample), ranked = rankOffer(sample, defaults);
  assert.ok(ranked.categories.includes('dev'));
  assert.equal(ranked.score, 100);
  assert.ok(rankOffer({ title: 'Free data science course' }, defaults).score < 30);
  assert.equal(JSON.stringify(sample), before);
});
test('empty catalog and reads do not create applications, files or saved settings', () => {
  reset();
  assert.deepEqual(getSearch({ availability: { termEn: 'Winter 2027' } }).settings, defaults);
  assert.equal(getSearch().jobs.length, 0);
  assert.equal(fs.existsSync(file), false);
  assert.equal(fs.existsSync(path.join(DATA, 'applications')), false);
});
test('catalog persists validated settings and merges tracked URL variants', () => {
  reset(); saveSearchSettings(defaults);
  assert.equal(addDiscoveries([sample]).added, 1);
  assert.equal(addDiscoveries([{ ...sample, url: employer + '?utm_source=again' }]).updated, 1);
  assert.equal(getSearch().jobs.length, 1);
  assert.equal(getSearch().settings.term, 'Winter 2027');
});
test('invalid batches and patches do not partially change disk state', () => {
  const before = fs.readFileSync(file, 'utf8'), id = getSearch().jobs[0].id;
  assert.throws(() => addDiscoveries([{ ...sample, title: 'Changed' }, { url: 'file:///bad' }]), { status: 400 });
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.throws(() => updateDiscovery(id, { status: 'saved', title: 'injected' }), { status: 400 });
  assert.throws(() => updateDiscovery(id, { status: 'soumise' }), { status: 400 });
  assert.throws(() => deleteDiscovery('../outside'), { status: 400 });
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});
test('manual details have per-field precedence while Google can enrich other fields', () => {
  importDiscoveries({ links: employer, details: { title: 'Titre manuel' } });
  addDiscoveries([{ ...sample, title: 'Overwritten?', company: 'Fictional employer', location: 'Laval' }]);
  const job = getSearch().jobs[0];
  assert.equal(job.title, 'Titre manuel');
  assert.equal(job.company, 'Fictional employer');
  assert.equal(job.location, 'Laval');
  assert.ok(job.sources.includes('manual'));
});
test('manual employer aliases bridge existing rows, preserve hidden state, and associate an application', () => {
  const old = getSearch().jobs[0]; updateDiscovery(old.id, { status: 'saved' });
  importDiscoveries({ links: linked, details: { title: 'LinkedIn manual title' } });
  const linkedRow = getSearch().jobs.find(j => j.url === linked); updateDiscovery(linkedRow.id, { status: 'hidden' });
  const counts = importDiscoveries({ links: linked, details: { employerUrl: employer, description: 'Manual reviewed description' } });
  assert.equal(counts.merged, 1);
  const [job] = getSearch({}, [{ id: 'existing-app', status: 'en cours', job: { url: employer } }]).jobs;
  assert.equal(getSearch().jobs.length, 1);
  assert.equal(job.status, 'hidden');
  assert.equal(job.applicationId, 'existing-app');
  assert.ok(job.keys.includes('linkedin:1234567890'));
  assert.equal(job.description, 'Manual reviewed description');
  addDiscoveries([sample]);
  assert.equal(getSearch().jobs[0].status, 'hidden');
});
test('manual detail ambiguity is rejected and deleting discovery leaves applications alone', () => {
  assert.throws(() => importDiscoveries({ links: employer + '\n' + linked, details: { title: 'One title' } }), { status: 400 });
  const id = getSearch().jobs[0].id;
  deleteDiscovery(id);
  assert.equal(getSearch().jobs.length, 0);
  assert.equal(fs.existsSync(path.join(DATA, 'applications')), false);
  assert.equal(fs.existsSync(path.join(DATA, 'candidatures.csv')), false);
});
test('malformed catalogs fail closed instead of silently overwriting valuable data', () => {
  for (const bad of ['{broken', 'null', JSON.stringify({ schema: 7, settings: null, jobs: [] }), JSON.stringify({ schema: 1, settings: null, jobs: [null] })]) {
    fs.writeFileSync(file, bad);
    assert.throws(() => getSearch(), { status: 409 });
    assert.throws(() => addDiscoveries([sample]), { status: 409 });
    assert.equal(fs.readFileSync(file, 'utf8'), bad);
  }
});
test('legacy catalog upgrades only on a write, with an exact private backup', () => {
  reset(); addDiscoveries([sample]);
  const state = JSON.parse(fs.readFileSync(file, 'utf8')); state.schema = 1; delete state.jobs[0].postedAt;
  const legacy = JSON.stringify(state); fs.writeFileSync(file, legacy);
  assert.equal(getSearch().jobs.length, 1);
  assert.equal(fs.readFileSync(file, 'utf8'), legacy, 'GET must not migrate data');
  addDiscoveries([{ url: linked, source: 'linkedin-public', title: 'Public LinkedIn title', company: 'Example', postedAt: '2026-10-12' }]);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).schema, 2);
  const dir = path.join(DATA, 'backups/search');
  assert.ok(fs.readdirSync(dir).some(name => fs.readFileSync(path.join(dir, name), 'utf8') === legacy));
  const item = getSearch().jobs.find(job => job.url === linked);
  assert.deepEqual(item.manualFields, []);
  assert.equal(item.postedAt, '2026-10-12');
  importDiscoveries({ links: linked, details: { title: 'Reviewed manual title' } });
  addDiscoveries([{ url: linked, source: 'linkedin-public', title: 'Later automated title' }]);
  assert.equal(getSearch().jobs.find(job => job.url === linked).title, 'Reviewed manual title');
});
test('catalog capacity is enforced atomically but rediscovery of existing jobs still works', () => {
  reset(); addDiscoveries([sample]);
  const state = JSON.parse(fs.readFileSync(file, 'utf8')), base = state.jobs[0];
  state.jobs = Array.from({ length: 3000 }, (_, i) => ({ ...base, id: i.toString(16).padStart(16, '0'), url: `${employer}/${i}`, aliases: [`${employer}/${i}`] }));
  fs.writeFileSync(file, JSON.stringify(state));
  const before = fs.readFileSync(file, 'utf8');
  assert.throws(() => addDiscoveries([sample]), { status: 400 });
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.equal(addDiscoveries([{ ...sample, url: employer + '/0' }]).updated, 1);
  assert.equal(getSearch().jobs.length, 3000);
});

// --- 0.9.0 new-offer meta (data/search/meta.json) ---
const metaFile = path.join(DATA, 'search/meta.json');
const sleep = ms => new Promise(r => setTimeout(r, ms));
test('first read initialises lastSeenAt so the existing catalog is not flagged new', () => {
  reset();
  assert.equal(getSearch().meta.newCount, 0);
  const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
  assert.ok(Number.isFinite(Date.parse(meta.lastSeenAt)));
  assert.equal(meta.lastRunAt, null);
  assert.equal(meta.lastRun, null);
});
test('a batch updates lastRunAt/lastRun, counts as new until seen, and leaves discovery.json free of meta', async () => {
  reset(); saveSearchSettings(defaults);
  getSearch();
  await sleep(5);
  addDiscoveries([sample], { source: 'google' });
  let view = getSearch();
  assert.equal(view.meta.lastRun.source, 'google');
  assert.equal(view.meta.lastRun.scope, defaults.scope);
  assert.ok(view.meta.lastRunAt);
  assert.equal(view.meta.newCount, 1);
  const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal('lastRunAt' in stored || 'lastSeenAt' in stored || 'meta' in stored, false);
  await sleep(5);
  markSearchSeen();
  assert.equal(getSearch().meta.newCount, 0);
  await sleep(5);
  addDiscoveries([{ ...sample, url: employer + '-2' }], { source: 'linkedin-public', scope: 'canada' });
  view = getSearch();
  assert.equal(view.meta.newCount, 1);
  assert.deepEqual(view.meta.lastRun, { source: 'linkedin-public', scope: 'canada' });
  updateDiscovery(view.jobs.find(j => j.url.endsWith('-2')).id, { status: 'saved' });
  assert.equal(getSearch().meta.newCount, 0);
});
test('a manual import counts as new but never replaces the re-runnable last search', async () => {
  reset(); saveSearchSettings(defaults);
  getSearch();
  addDiscoveries([sample], { source: 'google' });
  const before = getSearch().meta;
  await sleep(5);
  addDiscoveries([{ ...sample, url: employer + '-manual' }], { source: 'manual' });
  const after = getSearch().meta;
  assert.deepEqual(after.lastRun, before.lastRun);
  assert.equal(after.lastRunAt, before.lastRunAt);
  assert.equal(after.newCount, 2);
});
test('the very first batch without any meta is still new; corrupt meta restarts safely; import is not a re-runnable search', () => {
  reset();
  addDiscoveries([sample]);
  assert.equal(getSearch().meta.newCount, 1);
  assert.equal(getSearch().meta.lastRun.source, 'google');
  fs.writeFileSync(metaFile, '{not json');
  assert.equal(getSearch().meta.newCount, 0);
  assert.ok(Number.isFinite(Date.parse(JSON.parse(fs.readFileSync(metaFile, 'utf8')).lastSeenAt)));
  importDiscoveries({ links: employer + '-3' });
  assert.equal(getSearch().meta.lastRun, null); // a manual import is not a re-runnable search
});
test('meta writes are atomic (no temp file left, valid JSON after many runs)', () => {
  reset();
  for (let i = 0; i < 20; i++) { addDiscoveries([{ ...sample, url: `${employer}-${i}` }]); markSearchSeen(); }
  assert.ok(JSON.parse(fs.readFileSync(metaFile, 'utf8')).lastSeenAt);
  assert.deepEqual(fs.readdirSync(path.dirname(metaFile)).filter(n => n.endsWith('.tmp')), []);
});

test('newCount only counts offers of kind job (the view forces kind job), not listings or unknown links', async () => {
  reset(); saveSearchSettings(defaults); getSearch(); await sleep(5);
  addDiscoveries([sample, { ...sample, url: 'https://careers.example.org/careers/' }, { ...sample, url: 'https://careers.example.org/some/page' }], { source: 'google' });
  const view = getSearch();
  assert.deepEqual(view.jobs.map(j => j.kind).sort(), ['job', 'listing', 'unknown']);
  assert.equal(view.meta.newCount, 1);
});
test('countIdentifiedJobs is read-only (no meta.json write) and counts kind job only', () => {
  reset(); saveSearchSettings(defaults);
  addDiscoveries([sample, { ...sample, url: 'https://careers.example.org/careers/' }], { source: 'google' });
  fs.rmSync(metaFile, { force: true });
  assert.equal(countIdentifiedJobs(), 1);
  assert.equal(fs.existsSync(metaFile), false);
});
test('recordSearchRun records an empty run and the scope; manual sources and bad scopes are refused', () => {
  reset(); saveSearchSettings(defaults); getSearch();
  assert.equal(getSearch().meta.lastRun, null);
  const meta = recordSearchRun({ source: 'linkedin-public', scope: 'canada' });
  assert.deepEqual(meta.lastRun, { source: 'linkedin-public', scope: 'canada' });
  assert.ok(getSearch().meta.lastRunAt);
  recordSearchRun({ source: 'google', scope: 'quebec_only' });
  assert.deepEqual(getSearch().meta.lastRun, { source: 'google', scope: 'quebec_only' });
  assert.throws(() => recordSearchRun({ source: 'manual' }), { status: 400 });
  assert.throws(() => recordSearchRun({ source: 'google', scope: '../x' }), { status: 400 });
  assert.throws(() => recordSearchRun(null), { status: 400 });
});
