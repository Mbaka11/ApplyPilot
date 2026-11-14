import test from 'node:test';
import assert from 'node:assert/strict';
import { computeStats } from '../server/src/stats.js';

const app = (status, platform, cvId, extra = {}) => ({ id: 'x', status, cvId, submittedAt: ['en cours', 'abandonnée'].includes(status) ? null : '2026-01-01T00:00:00.000Z', job: { platform, company: 'SecretCo', title: 'T' }, ...extra });
const job = n => ({ url: `https://boards.greenhouse.io/acme/jobs/${1000 + n}`, aliases: [`https://boards.greenhouse.io/acme/jobs/${1000 + n}`], sources: ['google'] });

test('n = 0 gives an empty, null-rate result', () => {
  const s = computeStats([], []);
  assert.deepEqual(s.funnel, { identified: 0, created: 0, submitted: 0, responded: 0 });
  assert.equal(s.rate, null); assert.equal(s.medianResponseDays, null);
  assert.deepEqual(s.byPlatform, []); assert.deepEqual(s.byCv, []);
  assert.doesNotThrow(() => computeStats(undefined, null));
});
test('n < 5 submitted gives null rates, counts still shown', () => {
  const s = computeStats([app('soumise', 'indeed', 'cv1'), app('entrevue', 'indeed', 'cv1')], []);
  assert.equal(s.byPlatform[0].submitted, 2); assert.equal(s.byPlatform[0].responded, 1); assert.equal(s.byPlatform[0].rate, null);
  assert.equal(s.rate, null);
});
test('funnel, platforms, CVs, application without CV or platform, legacy junk', () => {
  const apps = [
    ...Array.from({ length: 5 }, (_, i) => app(i < 2 ? 'refusée' : i === 2 ? 'offre' : 'soumise', 'linkedin', 'cvA')),
    app('en cours', '', null), app('abandonnée', undefined, undefined), app('soumise', 'Indeed', 'cvB'),
    null, 'junk', { status: 'entrevue' },
  ];
  const s = computeStats(apps, [job(1), job(2), { url: 'https://www.reddit.com/r/x', aliases: ['https://www.reddit.com/r/x'] }, null]);
  assert.equal(s.funnel.identified, 2);
  assert.equal(s.funnel.created, 9);
  assert.equal(s.funnel.submitted, 5 + 1 + 1); // legacy entrevue without date still implies submitted
  assert.equal(s.funnel.responded, 4);
  assert.deepEqual(s.responses, { interview: 1, offer: 1, rejection: 2 });
  const li = s.byPlatform.find(r => r.key === 'linkedin');
  assert.deepEqual([li.submitted, li.responded, li.rate], [5, 3, 0.6]);
  assert.equal(s.byPlatform.find(r => r.key === 'other').submitted, 1);
  assert.equal(s.byPlatform.find(r => r.key === 'indeed').rate, null);
  assert.equal(s.byCv.find(r => r.key === 'none').created, 3);
  assert.equal(s.byCv.find(r => r.key === 'cva').rate, 0.6);
});
test('median delay only from real dates and output carries no personal data', () => {
  const d = (days, extra) => app('entrevue', 'indeed', 'c', { submittedAt: '2026-01-01T00:00:00.000Z', respondedAt: new Date(Date.parse('2026-01-01') + days * 86400000).toISOString(), ...extra });
  const s = computeStats([d(2), d(4), d(10), app('refusée', 'indeed', 'c'), d(-3)], []);
  assert.equal(s.medianResponseDays, 4); assert.equal(s.delaySamples, 3);
  assert.equal(JSON.stringify(s).includes('SecretCo'), false);
});

test('a response survives a later abandonment; a status-only response still counts; submitted stays consistent', () => {
  const abandoned = app('abandonnée', 'indeed', 'c', { submittedAt: '2026-01-01T00:00:00.000Z', respondedAt: '2026-01-05T00:00:00.000Z' });
  const viaFirst = app('abandonnée', 'indeed', 'c', { submittedAt: '2026-01-01T00:00:00.000Z', firstResponseAt: '2026-01-03T00:00:00.000Z' });
  const noResponse = app('abandonnée', 'indeed', 'c', { submittedAt: '2026-01-01T00:00:00.000Z' });
  const neverSubmitted = app('abandonnée', 'indeed', 'c');
  const badDate = app('soumise', 'indeed', 'c', { respondedAt: 'not a date' });
  const s = computeStats([abandoned, viaFirst, noResponse, neverSubmitted, badDate, app('offre', 'indeed', 'c')], []);
  assert.equal(s.funnel.submitted, 5); // abandoned-with-submittedAt still counts; never-submitted does not
  assert.equal(s.funnel.responded, 3);
  assert.equal(s.rate, 0.6);
  assert.equal(s.delaySamples, 2);
});
test('an identified count can be supplied without the catalog rows', () => {
  assert.equal(computeStats([], [], 7).funnel.identified, 7);
  assert.equal(computeStats([], [job(1)], null).funnel.identified, 1);
});
