import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { getConfig } from '../server/src/config.js';
import { launchBrowser } from '../server/src/pdf.js';
import { collectFormStructure, createFormDiagnostic, diagnosticFrameScope } from '../extension/sidepanel/form-diagnostic.mjs';

const fixture = fs.readFileSync(new URL('./fixtures/successfactors-diagnostic.html', import.meta.url), 'utf8');
const hasTerm = (row, term) => row.labels.some(label => label.terms.includes(term));
const listen = async handler => {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return server;
};

test('form diagnostic: real isolated DOM, synthetic data only', async t => {
  const foreign = await listen((req, res) => res.end('<label>PRIVATE_FOREIGN_CANARY<input value="PRIVATE_FOREIGN_VALUE"></label>'));
  const foreignUrl = `http://127.0.0.1:${foreign.address().port}`;
  const server = await listen((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(req.url.startsWith('/frames') ? `<iframe src="/form?token=PRIVATE_FRAME_TOKEN"></iframe><iframe src="${foreignUrl}/?token=PRIVATE_FOREIGN_TOKEN"></iframe>` : fixture);
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  const browser = await launchBrowser(getConfig());
  const page = await browser.newPage();
  try {
    await t.test('upload buttons, hidden file input, empty sections and ARIA relationships are recorded', async () => {
      await page.goto(`${url}/form?token=PRIVATE_TOP_URL_TOKEN#PRIVATE_FRAGMENT`);
      const report = await page.evaluate(collectFormStructure);
      assert.equal(report.scope, 'top');
      assert.equal(report.schema, 1);
      const file = report.nodes.find(node => node.type === 'file');
      assert.ok(file && !file.visible && hasTerm(file, 'resume'));
      const uploads = report.nodes.filter(node => node.tag === 'button' && node.hasPopup === 'dialog');
      assert.equal(uploads.length, 3);
      assert.ok(uploads.some(node => hasTerm(node, 'cover-letter')));
      assert.ok(report.nodes.some(node => node.tag === 'h2' && hasTerm(node, 'excluding-french')));
      assert.equal(report.nodes.filter(node => node.tag === 'button' && hasTerm(node, 'add')).length, 3);
      const combo = report.nodes.find(node => node.role === 'combobox');
      assert.ok(hasTerm(combo, 'source'));
      assert.ok(combo.classes.includes('sapMInputBaseInner'));
      assert.equal(combo.relations['aria-controls'][0].role, 'listbox');
      assert.match(combo.relations['aria-labelledby'][0].ref, /^n\d+$/);
      assert.ok(report.nodes.some(node => hasTerm(node, 'graduation-date')));
      assert.ok(report.nodes.some(node => hasTerm(node, 'internship-count')));
    });
    await t.test('values, names, URLs, labels, arbitrary classes, tokens and passwords never appear in JSON', async () => {
      const json = JSON.stringify(await page.evaluate(collectFormStructure));
      assert.doesNotMatch(json, /PRIVATE_|CANARY|csrf|127\.0\.0\.1|token=|Candidature de/);
      assert.ok(json.includes('hidden-and-password-fields'));
      assert.ok(json.includes('cover-letter'));
    });
    await t.test('collector never reads value/file/selected/cookie/storage properties or calls network APIs', async () => {
      await page.evaluate(() => {
        const deny = () => { throw new Error('A forbidden getter/API was used'); };
        for (const [proto, props] of [
          [HTMLInputElement.prototype, ['value', 'checked', 'files']],
          [HTMLTextAreaElement.prototype, ['value']],
          [HTMLSelectElement.prototype, ['value', 'selectedIndex', 'selectedOptions']],
          [HTMLOptionElement.prototype, ['value', 'selected']],
        ]) for (const prop of props) Object.defineProperty(proto, prop, { get: deny, configurable: true });
        Object.defineProperty(document, 'cookie', { get: deny, configurable: true });
        for (const key of ['localStorage', 'sessionStorage']) Object.defineProperty(window, key, { get: deny, configurable: true });
        window.fetch = deny; window.XMLHttpRequest = deny;
      });
      assert.ok((await page.evaluate(collectFormStructure)).nodes.length > 20);
    });
    await t.test('collection causes no DOM changes, focus/input events, form clicks, requests or navigation', async () => {
      await page.goto(`${url}/form`);
      const before = await page.evaluate(() => ({ html: document.documentElement.outerHTML, events: formEvents, sentinel: unsavedSentinel }));
      let requests = 0; const countRequest = () => requests++;
      page.on('request', countRequest);
      await page.evaluate(collectFormStructure);
      const after = await page.evaluate(() => ({ html: document.documentElement.outerHTML, events: formEvents, sentinel: unsavedSentinel }));
      page.off('request', countRequest);
      assert.deepEqual(after, before);
      assert.equal(requests, 0);
      assert.equal(page.url(), `${url}/form`);
    });
    await t.test('output and traversal limits are explicit and do not dump enormous pages', async () => {
      await page.evaluate(() => { document.body.innerHTML = '<label>' + 'PRIVATE_LABEL_CANARY '.repeat(100) + '</label>' + '<input aria-label="Type de source">'.repeat(7000); });
      const report = await page.evaluate(collectFormStructure);
      assert.equal(report.truncated, true);
      assert.equal(report.nodes.length, 500);
      assert.ok(JSON.stringify(report).length < 500_000);
    });
    await t.test('only top and same-origin frames can be collected; foreign frames fail closed', async () => {
      await page.goto(`${url}/frames`);
      const frames = page.frames();
      const same = frames.find(frame => frame !== page.mainFrame() && frame.url().startsWith(url));
      const other = frames.find(frame => frame.url().startsWith(foreignUrl));
      assert.equal(await same.evaluate(diagnosticFrameScope), 'same-origin-frame');
      assert.equal((await same.evaluate(collectFormStructure)).scope, 'same-origin-frame');
      assert.equal(await other.evaluate(diagnosticFrameScope), null);
      assert.equal(await other.evaluate(collectFormStructure), null);
    });
    await t.test('LinkedIn and Google remain excluded, without any external request', async () => {
      const isolated = await browser.newPage();
      await isolated.setRequestInterception(true);
      isolated.on('request', request => request.respond({ status: 200, contentType: 'text/html', body: fixture }));
      try {
        for (const host of ['www.linkedin.com', 'www.google.ca']) {
          await isolated.goto(`https://${host}/diagnostic-fixture`);
          assert.equal(await isolated.evaluate(diagnosticFrameScope), null);
          assert.equal(await isolated.evaluate(collectFormStructure), null);
        }
      } finally { await isolated.close(); }
    });
  } finally {
    await browser.close();
    await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => foreign.close(resolve))]);
  }
});

const fakeReport = { schema: 1, scope: 'top', nodes: [], truncated: false };
function fakeScripting(overrides = {}) {
  let calls = 0;
  const requests = [];
  return {
    requests,
    async executeScript(request) {
      requests.push(request); calls++;
      if (overrides.rejectAt === calls) throw new Error('PRIVATE_CHROME_ERROR_WITH_URL_AND_TOKEN');
      if (request.func === collectFormStructure) return [{ result: overrides.report || fakeReport }];
      return overrides.probes || [{ result: 'top', documentId: overrides.navigate && calls === 3 ? 'new-document' : 'bound-document' }, { result: null, documentId: 'foreign' }];
    },
  };
}
test('diagnostic orchestration binds document IDs, omits browser metadata and calls no API', async () => {
  const scripting = fakeScripting();
  const report = JSON.parse(await createFormDiagnostic({ tabId: 12, scripting, version: '0.7.0' }));
  assert.deepEqual(scripting.requests[1].target, { tabId: 12, documentIds: ['bound-document'] });
  assert.equal(scripting.requests.length, 3);
  assert.equal(report.skippedFrames, 1);
  assert.doesNotMatch(JSON.stringify(report), /bound-document|foreign|tabId|documentId/);
});
test('changed active tab or autofill activity aborts before collection', async () => {
  const scripting = fakeScripting();
  await assert.rejects(createFormDiagnostic({ tabId: 12, scripting, isCurrent: async () => false, version: '0.7.0' }), /diagnostic annulé/);
  assert.equal(scripting.requests.length, 0);
});
test('navigation during collection discards the report, including same-URL reload', async () => {
  await assert.rejects(createFormDiagnostic({ tabId: 12, scripting: fakeScripting({ navigate: true }), version: '0.7.0' }), /diagnostic annulé/);
});
test('late change or native script errors cannot export stale reports or leak error URLs', async () => {
  let checks = 0;
  await assert.rejects(createFormDiagnostic({ tabId: 12, scripting: fakeScripting(), version: '0.7.0', isCurrent: async () => ++checks < 4 }), /diagnostic annulé/);
  for (const rejectAt of [1, 2]) await assert.rejects(createFormDiagnostic({ tabId: 12, scripting: fakeScripting({ rejectAt }), version: '0.7.0' }), error => /Diagnostic inaccessible/.test(error.message) && !error.message.includes('PRIVATE_'));
});
test('missing top document and excessive report size fail closed', async () => {
  await assert.rejects(createFormDiagnostic({ tabId: 12, scripting: fakeScripting({ probes: [{ result: 'top' }] }), version: '0.7.0' }), /Diagnostic inaccessible/);
  await assert.rejects(createFormDiagnostic({ tabId: 12, scripting: fakeScripting({ report: { ...fakeReport, nodes: ['x'.repeat(2 * 1024 * 1024)] } }), version: '0.7.0' }), /trop volumineux/);
});
test('at most eight accessible documents are collected, with truncation visible', async () => {
  const probes = Array.from({ length: 12 }, (_, index) => ({ result: index ? 'same-origin-frame' : 'top', documentId: `doc${index}` }));
  const scripting = fakeScripting({ probes });
  const report = JSON.parse(await createFormDiagnostic({ tabId: 12, scripting, version: '0.7.0' }));
  assert.equal(scripting.requests[1].target.documentIds.length, 8);
  assert.equal(report.truncated, true);
});
