// Called from real-extension E2E; the test server simulates all native launches.
import fs from 'node:fs';
import path from 'node:path';
export async function testSelectedCv({ panel, site, sw, apiBase, out, check }) {
  const request = route => fetch(apiBase + route).then(response => response.json());
  const set = (selector, value) => panel.$eval(selector, (element, value) => { element.value = value; element.dispatchEvent(new Event('input', { bubbles: true })); }, value);
  await panel.setViewport({ width: 420, height: 1000 });
  await panel.click('[data-tab="app"]');
  await panel.waitForFunction(() => !!document.querySelector('#cvInspector .cv-file-path') && !document.querySelector('[data-cv-action="preview"]').disabled);
  const initialId = await panel.$eval('#cvSelect', element => element.value);
  const { applications } = await request('/applications');
  const appId = applications.find(app => app.cvId === initialId && app.company === 'Nordic Analytics').id;
  const before = (await request(`/applications/${appId}`)).application;
  const initialPath = await panel.$eval('.cv-file-path', element => element.textContent);
  const initialSubject = await panel.$eval('#letterSubject', element => element.value);
  await set('#letterSubject', initialSubject + ' — unsaved CV preview draft');
  await panel.$eval('#letterCard details', element => { element.open = true; });
  await set('#letterInstructions', 'Unsaved CV inspection instructions');
  await site.evaluate(() => { globalThis.cvPreviewSentinel = 'preserve form'; });
  const fieldsBefore = await site.$$eval('input, textarea, select', elements => elements.map(element => [element.id, element.value]));
  check('selected CV filename, modification date and local source path are visible', (await panel.$eval('#cvInspector', element => element.textContent)).includes('Modified') && initialPath.endsWith(initialId + '.pdf'));
  await panel.select('#uiLanguage', 'fr');
  check('CV preview actions are available in French', (await panel.$eval('[data-cv-action="preview"]', element => element.textContent)) === 'Aperçu du CV');
  await panel.select('#uiLanguage', 'en');
  await panel.$eval('#cvInspector details', element => { element.open = true; });
  await panel.evaluate(() => {
    globalThis.__cvOriginalClipboard = navigator.clipboard.writeText;
    navigator.clipboard.writeText = async value => { globalThis.__cvCopiedPath = value; };
  });
  await panel.click('[data-cv-action="copy"]');
  await panel.waitForFunction(() => !!globalThis.__cvCopiedPath);
  check('copy path copies the selected original file rather than an upload alias', (await panel.evaluate(() => globalThis.__cvCopiedPath)) === initialPath);
  const tabIdsBefore = await sw.evaluate(() => chrome.tabs.query({}).then(tabs => tabs.map(tab => tab.id)));
  await panel.click('[data-cv-action="preview"]');
  let previewTab;
  for (let i = 0; i < 100 && !previewTab; i++) {
    previewTab = await sw.evaluate(async ({ ids, base, id }) => (await chrome.tabs.query({})).find(tab => !ids.includes(tab.id) && tab.url?.startsWith(`${base}/cvs/${encodeURIComponent(id)}/pdf?`)), { ids: tabIdsBefore, base: apiBase, id: initialId });
    if (!previewTab) await new Promise(resolve => setTimeout(resolve, 30));
  }
  check('preview opens the selected CV in a separate HTTP PDF tab', !!previewTab && !previewTab.url.startsWith('file:'));
  if (previewTab) await sw.evaluate(id => chrome.tabs.remove(id), previewTab.id);
  await panel.bringToFront();
  const nativeLog = path.join(out, 'data', 'native-reveal-log.jsonl');
  await panel.click('[data-cv-action="reveal"]');
  await panel.waitForFunction(() => document.querySelector('#toast')?.textContent === 'Folder opening requested.');
  const reveals = fs.readFileSync(nativeLog, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  check('Show in folder sends the exact selected path to the simulated native file manager', reveals.length === 1 && reveals[0].shell === false && reveals[0].args.includes(process.platform === 'linux' ? path.dirname(initialPath) : initialPath));
  await panel.evaluate(() => {
    globalThis.__cvOriginalFetch = globalThis.fetch;
    globalThis.__cvSaveMode = 'delay';
    globalThis.fetch = (url, options = {}) => {
      const isCvSave = options.method === 'PATCH' && /\/applications\//.test(String(url)) && Object.hasOwn(JSON.parse(options.body || '{}'), 'cvId');
      if (isCvSave && globalThis.__cvSaveMode === 'reject') return Promise.resolve(new Response(JSON.stringify({ error: 'Synthetic CV selection refused.' }), { status: 409, headers: { 'content-type': 'application/json' } }));
      if (isCvSave && globalThis.__cvSaveMode === 'delay') return new Promise((resolve, reject) => { globalThis.__finishCvSave = () => globalThis.__cvOriginalFetch(url, options).then(resolve, reject); });
      return globalThis.__cvOriginalFetch(url, options);
    };
  });
  const otherId = await panel.$eval('#cvSelect', (element, current) => [...element.options].find(option => option.value && option.value !== current).value, initialId);
  await panel.select('#cvSelect', otherId);
  await panel.waitForFunction(() => !!globalThis.__finishCvSave);
  check('preview and native actions are disabled until a new CV selection is saved', await panel.$eval('#cvInspector', element => [...element.querySelectorAll('[data-cv-action]')].every(button => button.disabled)));
  await panel.evaluate(() => globalThis.__finishCvSave());
  await panel.waitForFunction(id => document.querySelector('.cv-file-path')?.textContent.endsWith(id + '.pdf') && !document.querySelector('#cvSelect').disabled, {}, otherId);
  check('saved CV changes update both the displayed source and application selection', (await request(`/applications/${appId}`)).application.cvId === otherId);
  await panel.evaluate(() => { globalThis.__cvSaveMode = 'reject'; });
  await panel.select('#cvSelect', initialId);
  await panel.waitForFunction(id => document.querySelector('#cvSelect')?.value === id && !document.querySelector('#cvSelect').disabled, {}, otherId);
  check('failed CV changes restore the actual stored selection instead of previewing a different file', (await panel.$eval('.cv-file-path', element => element.textContent)).endsWith(otherId + '.pdf') && (await request(`/applications/${appId}`)).application.cvId === otherId);
  await panel.evaluate(() => { globalThis.__cvSaveMode = 'ready'; });
  await panel.select('#cvSelect', initialId);
  await panel.waitForFunction(id => document.querySelector('.cv-file-path')?.textContent.endsWith(id + '.pdf') && !document.querySelector('#cvSelect').disabled, {}, initialId);
  // A missing saved file must not silently choose the first remaining variant.
  const file = path.join(out, 'cvs', initialId + '.pdf');
  fs.renameSync(file, file + '.test-backup');
  try {
    await panel.click('#serverStatus');
    await panel.waitForFunction(() => document.querySelector('#cvSelect')?.value === '' && !!document.querySelector('#cvInspector [data-cv-action="preview"]')?.disabled);
    check('a missing selected PDF has an explicit empty placeholder, never a first-file fallback', (await panel.$eval('#cvSelect', element => element.selectedOptions[0].textContent)) === 'Selected CV not found');
  } finally { fs.renameSync(file + '.test-backup', file); }
  await panel.click('#serverStatus');
  await panel.waitForFunction(id => document.querySelector('.cv-file-path')?.textContent.endsWith(id + '.pdf') && !document.querySelector('[data-cv-action="preview"]').disabled, {}, initialId);
  await panel.$eval('#cvInspector details', element => { element.open = true; });
  await panel.setViewport({ width: 320, height: 1000 });
  check('long CV filenames and full paths fit the 320px side panel', await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await panel.setViewport({ width: 420, height: 1000 });
  await panel.evaluate(() => { window.scrollTo(0, 0); document.querySelector('#toast').className = 'toast'; });
  const height = await panel.$eval('#appCard', element => Math.ceil(element.getBoundingClientRect().bottom + scrollY + 15));
  await panel.screenshot({ path: path.join(out, 'cv-preview-en.png'), clip: { x: 0, y: 0, width: 420, height }, captureBeyondViewport: true });
  const after = (await request(`/applications/${appId}`)).application;
  check('CV inspection preserves unsaved letter subject and instructions', (await panel.$eval('#letterSubject', element => element.value)) === initialSubject + ' — unsaved CV preview draft' && (await panel.$eval('#letterInstructions', element => element.value)) === 'Unsaved CV inspection instructions');
  check('CV actions preserve stored letter, status and the existing employer form', JSON.stringify(after.letter) === JSON.stringify(before.letter) && after.status === before.status && await site.evaluate(() => globalThis.cvPreviewSentinel === 'preserve form') && JSON.stringify(await site.$$eval('input, textarea, select', elements => elements.map(element => [element.id, element.value]))) === JSON.stringify(fieldsBefore));
  await panel.evaluate(() => { globalThis.fetch = globalThis.__cvOriginalFetch; navigator.clipboard.writeText = globalThis.__cvOriginalClipboard; });
}
