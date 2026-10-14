import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runGoogleSearch, searchDelay } from '../extension/search/runner.mjs';
import { searchDefaults } from '../extension/search/core.mjs';
import { getConfig } from '../server/src/config.js';
import { findChrome, puppeteer } from '../server/src/pdf.js';

const settings = { ...searchDefaults(), maxPages: 2 };
const row = { url: 'https://jobs.example.org/jobs/fixture-internship?utm_source=google', title: 'Software internship', snippet: 'Fictional results' };
const fast = { wait: async () => {}, pollMs: 0, betweenMs: 0, pollLimit: 5 };
function mock({ status = 'ready', onRead, onGet, onUpdate } = {}) {
  const calls = { create: [], update: [], inject: [], pages: [], reads: 0, gets: 0 };
  let tab, documentId;
  const browser = {
    tabs: {
      create: async options => { calls.create.push(options); tab = { id: 900, url: options.url, status: 'complete' }; return { ...tab }; },
      get: async id => { assert.equal(id, 900, 'must not inspect unrelated tabs'); await onGet?.(tab, ++calls.gets); return { ...tab }; },
      update: async (id, options) => { assert.equal(id, 900, 'must not navigate unrelated tabs'); calls.update.push(options); tab.url = options.url; tab.status = 'complete'; documentId = `doc-${calls.update.length}`; await onUpdate?.(tab); return { ...tab }; },
      remove: () => { throw new Error('No tab, including a reused search tab, may be closed'); },
      query: () => { throw new Error('Never obtain an existing tab to use for collection'); },
    },
    scripting: { executeScript: async options => {
      calls.inject.push(options);
      if (options.files) return [{ frameId: 0, documentId }];
      assert.deepEqual(options.target.documentIds, [documentId]);
      calls.reads++;
      const data = await onRead?.(tab, calls.reads) || { status, items: status === 'ready' ? [row] : [], href: tab.url };
      return [{ frameId: 0, documentId, result: data }];
    } },
  };
  return { browser, calls, run: (options = {}) => runGoogleSearch({ settings, chrome: browser, onPage: async items => calls.pages.push(items), ...fast, ...options }) };
}

test('Google runner owns one inactive new tab and uses only top-frame/document-bound reads', async () => {
  const m = mock(); const result = await m.run();
  assert.deepEqual(m.calls.create, [{ url: 'about:blank', active: false }]);
  assert.equal(m.calls.update.length, 2);
  assert.ok(m.calls.update.every(call => new URL(call.url).hostname === 'www.google.com'));
  assert.ok(m.calls.inject.filter(call => call.files).every(call => call.target.frameIds.join() === '0'));
  assert.equal(result.found, 2); assert.equal(m.calls.pages.length, 2);
  assert.equal(m.calls.pages[0][0].url, 'https://jobs.example.org/jobs/fixture-internship');
});
test('runner bounds results, validates destinations, deduplicates and never visits them', async () => {
  const m = mock({ onRead: tab => ({ status: 'ready', href: tab.url, items: [row, { ...row, url: row.url + '&ref=duplicate' }, { ...row, url: 'http://localhost/private' }, { ...row, url: 'https://ca.indeed.com/jobs?q=software' }] }) });
  const result = await m.run({ settings: { ...settings, maxPages: 1 } });
  assert.equal(result.found, 1); assert.equal(result.skipped, 2);
  assert.equal(m.calls.update.length, 1);
});
for (const status of ['challenge', 'consent', 'blocked', 'navigation']) test(`runner stops on ${status}, no retry, result save or next query`, async () => {
  const m = mock({ status });
  await assert.rejects(m.run());
  assert.equal(m.calls.update.length, 1); assert.equal(m.calls.pages.length, 0);
});
test('redirect to LinkedIn is stopped before collector injection', async () => {
  const m = mock({ onUpdate: tab => { tab.url = 'https://www.linkedin.com/jobs/view/1234567890'; } });
  await assert.rejects(m.run(), /changé de page/);
  assert.equal(m.calls.inject.length, 0);
});
test('changing the owned search tab prevents the next navigation and preserves earlier batches', async () => {
  const m = mock();
  await assert.rejects(m.run({ onPage: async items => { m.calls.pages.push(items); await m.browser.tabs.update(900, { url: 'https://example.org/user-form' }); } }), /changé de page/);
  assert.equal(m.calls.pages.length, 1);
  assert.equal(m.calls.update.length, 2, 'one search navigation plus the simulated user navigation only');
});
test('closing the owned tab and changed document evidence stop safely', async () => {
  const closed = mock({ onGet: (_tab, count) => { if (count > 1) throw new Error('closed'); } });
  await assert.rejects(closed.run(), /fermé ou inaccessible/);
  const stale = mock({ onRead: () => ({ status: 'ready', href: 'https://www.google.com/search?q=unrelated', items: [row] }) });
  await assert.rejects(stale.run(), /changé de page/);
  assert.equal(stale.calls.pages.length, 0);
});
test('Stop cancels waits immediately and rejects late reads without saving or further navigation', async () => {
  const controller = new AbortController();
  let resolveRead, notify;
  const started = new Promise(resolve => { notify = resolve; });
  const m = mock({ onRead: tab => new Promise(resolve => { resolveRead = () => resolve({ status: 'ready', href: tab.url, items: [row] }); notify(); }) });
  const pending = m.run({ signal: controller.signal });
  await started; controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  resolveRead(); await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(m.calls.pages.length, 0); assert.equal(m.calls.update.length, 1);
  await assert.rejects(searchDelay(60000, controller.signal), { name: 'AbortError' });
});
test('pre-aborted runs never open tabs; empty or unreadable pages terminate within bounds', async () => {
  const controller = new AbortController(); controller.abort();
  const m = mock(); await assert.rejects(m.run({ signal: controller.signal }), { name: 'AbortError' }); assert.equal(m.calls.create.length, 0);
  const empty = mock({ status: 'empty' }); assert.equal((await empty.run()).found, 0);
  const loading = mock({ status: 'loading' }); await assert.rejects(loading.run(), /délai imparti/); assert.equal(loading.calls.reads, 5);
});
test('failed catalog writes stop the search instead of continuing unsaved', async () => {
  const m = mock(); await assert.rejects(m.run({ onPage: async () => { throw new Error('offline'); } }), /offline/);
  assert.equal(m.calls.update.length, 1);
});

// Actual Chrome DOM parsing, with every request intercepted. No Google/LinkedIn request leaves this browser.
const source = fs.readFileSync(new URL('../extension/search/collector.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('./fixtures/google-results.html', import.meta.url), 'utf8');
test('collector DOM fixtures in isolated Chrome (all traffic fulfilled locally)', async t => {
  const browser = await puppeteer.launch({ executablePath: findChrome(getConfig()), headless: true, args: ['--disable-background-networking'] });
  try {
    const page = await browser.newPage();
    let body = html;
    await page.setRequestInterception(true);
    page.on('request', request => {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) request.respond({ status: 200, contentType: 'text/html; charset=utf-8', body }).catch(() => {});
      else request.abort().catch(() => {});
    });
    const collect = async (text, url = 'https://www.google.com/search?q=fixture', query = 'fixture') => {
      body = text; await page.goto(url); await page.evaluate(source => Function(source)(), source);
      return page.evaluate(query => globalThis.__applyPilotSearch.collectGoogle(query), query);
    };
    await t.test('cards include snippets/redirect URLs but not ads, Google links or unsafe schemes', async () => {
      const result = await collect(html);
      assert.equal(result.status, 'ready'); assert.equal(result.items.length, 6);
      assert.equal(result.items[1].url, 'https://jobs.example.org/software-intern');
      assert.ok(result.items[0].snippet.includes('Montréal'));
      assert.ok(result.items.every(item => !/Sponsored|Invalid scheme|Internal Google/.test(item.title)));
    });
    await t.test('challenge detection', async () => assert.equal((await collect('<form action="/sorry/"><p>Verify you are human</p></form>')).status, 'challenge'));
    await t.test('accented French consent', async () => assert.equal((await collect('<p>Avant d’accéder à Google</p>')).status, 'consent'));
    await t.test('access denial', async () => assert.equal((await collect('<h1>429 Too many requests</h1>')).status, 'blocked'));
    await t.test('empty and unknown markup are different states', async () => {
      assert.equal((await collect('<p>Aucun résultat</p>')).status, 'empty');
      assert.equal((await collect('<main>Changed markup without recognizable cards</main>')).status, 'loading');
    });
    await t.test('LinkedIn/query navigation guard returns before reading any document content', async () => {
      assert.equal((await collect(html, 'https://www.linkedin.com/jobs/view/1234567890')).status, 'navigation');
      await page.evaluate(() => Object.defineProperty(document, 'body', { get() { throw new Error('DOM access forbidden'); } }));
      assert.equal((await page.evaluate(() => globalThis.__applyPilotSearch.collectGoogle('fixture'))).status, 'navigation');
      assert.equal((await collect(html, 'https://www.google.com/search?q=changed')).status, 'navigation');
    });
    await t.test('collector is safely reinjectable and capped at 30 cards', async () => {
      const many = '<main>' + Array.from({ length: 50 }, (_, i) => `<div><a href="https://jobs.example.org/job/${i}"><h3>Job ${i}</h3></a></div>`).join('') + '</main>';
      const result = await collect(many); await page.evaluate(source => Function(source)(), source);
      assert.equal(result.items.length, 30);
      assert.equal((await page.evaluate(() => globalThis.__applyPilotSearch.collectGoogle('fixture'))).items.length, 30);
    });
  } finally { await browser.close(); }
});
