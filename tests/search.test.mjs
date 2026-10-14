import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { searchDefaults, validateSettings, buildSearchPlan, linkedinSearchUrl, externalJobUrl, offerKey, applicationJobKey, manualLinks, rankOffer, isGoogleSearch, isExpectedSearch } from '../extension/search/core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tests/output/search-unit');
fs.mkdirSync(OUT, { recursive: true });
const DATA = fs.mkdtempSync(path.join(OUT, 'catalog-'));
process.env.APPLYPILOT_DATA_DIR = DATA;
const { getSearch, addDiscoveries, importDiscoveries, saveSearchSettings, updateDiscovery, deleteDiscovery } = await import('../server/src/search.js');
const file = path.join(DATA, 'search/discovery.json');
const defaults = searchDefaults({ availability: { termEn: 'Winter 2027' } });
const employer = 'https://careers.example.org/jobs/software-intern';
const linked = 'https://www.linkedin.com/jobs/view/1234567890';
const sample = { url: employer, title: 'Software intern — Winter 2027', location: 'Montréal', snippet: 'Hybrid software development internship.', source: 'google', query: 'software intern' };
const reset = () => fs.rmSync(path.join(DATA, 'search'), { recursive: true, force: true });
test.after(() => fs.rmSync(DATA, { recursive: true, force: true }));

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
