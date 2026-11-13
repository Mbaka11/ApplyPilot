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

test('location filter groups saved listings by Montréal, Toronto, Canada, United States, remote and unknown', async () => {
  const { filterCatalog, jobLocations } = await import('../extension/search/catalog.mjs');
  const url = id => `https://boards.greenhouse.io/acme/jobs/${id}`;
  const rows = [
    { id: 'a', url: url(1001), title: 'ML intern', location: 'Montréal, QC', status: 'saved' },
    { id: 'b', url: url(1002), title: 'Dev intern', location: 'Toronto, ON', status: 'saved' },
    { id: 'c', url: url(1003), title: 'Data intern', location: 'New York, NY', status: 'saved' },
    { id: 'd', url: url(1004), title: 'Software intern (remote, Canada)', status: 'saved' },
    { id: 'e', url: url(1005), title: 'Analyst intern', status: 'saved' },
    { id: 'f', url: url(1006), title: 'Quant intern', location: 'Ottawa, Ontario', status: 'saved' },
  ];
  const ids = location => filterCatalog(rows, { status: 'saved', location }).map(job => job.id).sort().join('');
  assert.equal(ids('all'), 'abcdef');
  assert.equal(ids('montreal'), 'a');
  assert.equal(ids('toronto'), 'b');
  assert.equal(ids('canada'), 'abdf', 'Canada includes Montréal and Toronto');
  assert.equal(ids('usa'), 'c');
  assert.equal(ids('remote'), 'd');
  assert.equal(ids('unknown'), 'e');
  assert.deepEqual(jobLocations({ location: 'Montréal (hybride)' }).sort(), ['canada', 'montreal', 'remote']);
});
