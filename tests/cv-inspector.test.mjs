// Real DOM, injected APIs and synthetic CVs; no provider, server or file manager.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { getConfig } from '../server/src/config.js';
import { launchBrowser } from '../server/src/pdf.js';
const moduleUrl = 'data:text/javascript;base64,' + fs.readFileSync(new URL('../extension/sidepanel/cv-inspector.mjs', import.meta.url)).toString('base64');

test('selected CV inspector in isolated Chrome', async t => {
  const browser = await launchBrowser(getConfig());
  const page = await browser.newPage();
  try {
    await page.setContent('<meta charset="utf-8"><div id="inspector"></div>');
    await page.evaluate(async url => {
      const { createCvInspector } = await import(url);
      const escape = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
      globalThis.setup = (options = {}) => {
        globalThis.inspectorController?.reset();
        globalThis.calls = []; globalThis.opened = []; globalThis.copied = []; globalThis.notices = []; globalThis.pending = [];
        globalThis.mode = options.mode || 'ready'; globalThis.allowed = true;
        globalThis.data = {
          A: { id: 'A', file: 'Demo A.pdf', pdfPath: 'C:/CVs/Demo A.pdf', modifiedAt: '2026-10-01T12:34:00Z', size: 2048, revealSupported: true },
          B: { id: 'B', file: 'Demo B.pdf', pdfPath: 'C:/CVs/Demo B.pdf', modifiedAt: '2026-10-02T12:34:00Z', size: 4096, revealSupported: true },
        };
        globalThis.inspectorController = createCvInspector({
          esc: escape, tr: (source, values = {}) => source.replace(/\{(\w+)\}/g, (match, key) => values[key] ?? match),
          toast: (...args) => notices.push(args), canAct: () => allowed,
          openTab: async url => { opened.push(url); }, copyText: async text => { copied.push(text); },
          api: (route, options = {}) => {
            calls.push({ route, method: options.method || 'GET', body: options.body });
            const id = decodeURIComponent(route.split('/')[2]);
            if (mode === 'deferred') return new Promise((resolve, reject) => pending.push({ route, resolve, reject }));
            if (mode === 'missing') return Promise.reject(Object.assign(new Error('Missing'), { status: 404 }));
            return Promise.resolve(route.endsWith('/reveal') ? { requested: true } : structuredClone(data[id]));
          },
        });
        globalThis.mount = (id = 'A', overrides = {}) => inspectorController.mount({ element: document.querySelector('#inspector'), server: 'http://127.0.0.1:9999', applicationId: 'demo', cvId: id, cv: data[id], available: true, disabled: false, ...overrides });
      };
    }, moduleUrl);
    const setup = async options => { await page.evaluate(options => { setup(options); mount(); }, options); if (options?.mode !== 'deferred') await page.waitForFunction(() => !document.querySelector('[data-cv-action="preview"]').disabled); };
    const click = action => page.click(`[data-cv-action="${action}"]`);
    await t.test('metadata and paths are rendered as escaped text, never executable markup', async () => {
      await setup();
      await page.evaluate(() => { data.A.file = '<img src=x onerror="window.injected=true">'; data.A.pdfPath = 'C:/CVs/<img src=x>.pdf'; });
      await page.$eval('details', el => { el.open = true; });
      await click('refresh');
      await page.waitForFunction(() => document.querySelector('.cv-file-path')?.textContent.includes('<img'));
      assert.equal(await page.evaluate(() => !!globalThis.injected || !!document.querySelector('#inspector img')), false);
    });
    await t.test('preview validates the latest selection and opens HTTP PDF, not file://', async () => {
      await setup(); await click('preview');
      await page.waitForFunction(() => opened.length === 1);
      const result = await page.evaluate(() => ({ opened, calls }));
      assert.match(result.opened[0], /^http:\/\/127\.0\.0\.1:9999\/cvs\/A\/pdf\?t=\d+$/);
      assert.equal(result.calls.filter(row => row.method === 'POST').length, 0);
      assert.equal(result.calls.filter(row => row.route.endsWith('/details')).length, 2);
    });
    await t.test('reveal posts only the confirmed CV ID; copy refreshes the current path', async () => {
      await setup(); await click('reveal');
      await page.waitForFunction(() => calls.some(row => row.method === 'POST'));
      const call = await page.evaluate(() => calls.find(row => row.method === 'POST'));
      assert.equal(call.route, '/cvs/A/reveal'); assert.deepEqual(call.body, { confirm: true });
      await page.waitForFunction(() => !document.querySelector('[data-cv-action="preview"]').disabled);
      await page.evaluate(() => { data.A.pdfPath = 'D:/New CV folder/Updated A.pdf'; document.querySelector('details').open = true; });
      await click('copy'); await page.waitForFunction(() => copied.length === 1);
      assert.equal(await page.evaluate(() => copied[0]), 'D:/New CV folder/Updated A.pdf');
    });
    await t.test('late metadata for an old selection cannot replace the new file', async () => {
      await setup({ mode: 'deferred' });
      await page.evaluate(() => { mount('B'); pending[1].resolve(data.B); pending[0].resolve(data.A); });
      await page.waitForFunction(() => document.querySelector('.cv-file-path')?.textContent === 'C:/CVs/Demo B.pdf');
      assert.equal(await page.$eval('.cv-file-name', el => el.textContent), 'Demo B.pdf');
    });
    await t.test('switching while preview validates prevents an old PDF opening, even A→B→A', async () => {
      await setup();
      await page.evaluate(() => { mode = 'deferred'; }); await click('preview');
      await page.waitForFunction(() => pending.length === 1);
      await page.evaluate(() => { mount('B'); mount('A'); pending[2].resolve(data.A); pending[1].resolve(data.B); pending[0].resolve(data.A); });
      await page.waitForFunction(() => !document.querySelector('[data-cv-action="preview"]').disabled);
      assert.equal(await page.evaluate(() => opened.length), 0);
    });
    await t.test('a deleted file clears old path data and never reuses it for an action', async () => {
      await setup(); await page.evaluate(() => { mode = 'missing'; });
      await click('preview');
      await page.waitForFunction(() => document.querySelector('[role="status"]')?.textContent.includes('introuvable'));
      assert.equal(await page.evaluate(() => opened.length), 0);
      assert.equal(await page.$('.cv-file-path'), null);
    });
    await t.test('unavailable selection and locked operations cannot preview or launch a folder', async () => {
      await setup();
      await page.evaluate(() => { allowed = false; });
      await click('reveal'); assert.equal(await page.evaluate(() => calls.length), 1);
      await page.evaluate(() => { mount('A', { available: false }); });
      assert.equal(await page.$eval('[data-cv-action="preview"]', el => el.disabled), true);
      await page.evaluate(() => { mount('B', { disabled: true }); });
      await page.waitForFunction(() => !!document.querySelector('.cv-file-path'));
      assert.equal(await page.$eval('[data-cv-action="reveal"]', el => el.disabled), true);
    });
    await t.test('unsupported OS retains PDF preview and copy without a native action', async () => {
      await setup();
      await page.evaluate(() => { data.A.revealSupported = false; document.querySelector('details').open = true; });
      await click('refresh');
      await page.waitForFunction(() => document.querySelector('[data-cv-action="reveal"]').disabled && !document.querySelector('[data-cv-action="preview"]').disabled);
      await click('copy'); await page.waitForFunction(() => copied.length === 1);
      assert.equal(await page.evaluate(() => calls.filter(row => row.method === 'POST').length), 0);
    });
  } finally { await browser.close(); }
});
