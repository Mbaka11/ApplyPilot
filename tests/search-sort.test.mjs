import test from 'node:test';
import assert from 'node:assert/strict';
import { filterCatalog, sortCatalog } from '../extension/search/catalog.mjs';

const jobs = [
  { id: 'unknown', lastSeenAt: '2099-01-01' },
  { id: 'old', postedAt: '2025-12-31' },
  { id: 'new', postedAt: '2026-02-02' },
  { id: 'tie', postedAt: '2026-02-02' },
  { id: 'empty', postedAt: '' },
  { id: 'invalid', postedAt: '2026-02-30' },
  { id: 'malformed', postedAt: 'yesterday' },
];
const ids = rows => rows.map(row => row.id);

test('publication sorting is chronological, stable and puts unknown dates last in both directions', () => {
  assert.deepEqual(ids(sortCatalog(jobs, 'published-desc')), ['new', 'tie', 'old', 'unknown', 'empty', 'invalid', 'malformed']);
  assert.deepEqual(ids(sortCatalog(jobs, 'published-asc')), ['old', 'new', 'tie', 'unknown', 'empty', 'invalid', 'malformed']);
});
test('relevance preserves server order and sorting does not mutate input', () => {
  const before = structuredClone(jobs);
  assert.deepEqual(sortCatalog(jobs), jobs);
  assert.deepEqual(sortCatalog(jobs, 'unrecognized'), jobs);
  assert.notEqual(sortCatalog(jobs), jobs);
  sortCatalog(jobs, 'published-desc');
  assert.deepEqual(jobs, before);
  assert.deepEqual(sortCatalog([], 'published-asc'), []);
});
test('publication sorting composes with catalog filters before pagination', () => {
  const rows = jobs.map(job => ({ ...job, url: 'https://www.linkedin.com/jobs/view/1234567890', status: job.id === 'new' ? 'hidden' : 'saved', sources: ['google'], title: 'Internship' }));
  const filtered = filterCatalog(rows, { status: 'saved', platform: 'linkedin', source: 'google', text: 'intern' });
  assert.deepEqual(ids(sortCatalog(filtered, 'published-desc').slice(0, 2)), ['tie', 'old']);
});
