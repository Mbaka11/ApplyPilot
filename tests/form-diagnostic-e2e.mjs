// Genuine extension download, isolated Chrome and fictional page/data. No user's browser.
import fs from 'node:fs';
import path from 'node:path';

export async function testFormDiagnostic({ browser, panel, site, apiBase, out, check }) {
  const downloads = path.join(out, 'diagnostic-downloads');
  fs.mkdirSync(downloads, { recursive: true });
  const cdp = await panel.createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
  const beforeApps = JSON.stringify(await fetch(`${apiBase}/applications`).then(response => response.json()));
  const beforeProfile = fs.readFileSync(path.join(out, 'profile.yaml'), 'utf8');
  const subject = await panel.$eval('#letterSubject', element => element.value);
  const instructions = await panel.$eval('#letterInstructions', element => element.value);
  await site.goto(new URL('/successfactors-diagnostic.html?token=PRIVATE_PAGE_TOKEN', site.url()).href);
  await panel.waitForFunction(() => document.querySelector('#pageCard')?.textContent.includes('Form:') && document.querySelector('#pageCard')?.textContent.includes('Careers website'));
  await panel.select('#uiLanguage', 'fr');
  await panel.$eval('#pageCard details', element => { element.open = true; });
  check('local diagnostic is explicit and translated', (await panel.$eval('[data-action="diagnostic"]', element => element.textContent)) === 'Exporter le diagnostic local');
  await panel.select('#uiLanguage', 'en');
  await panel.$eval('#pageCard details', element => { element.open = true; });
  check('English diagnostic describes local-only export and redacted labels', (await panel.$eval('#pageCard details', element => element.textContent)).includes('No answers') && (await panel.$eval('[data-action="diagnostic"]', element => element.textContent)) === 'Export local diagnostic');
  await panel.setViewport({ width: 320, height: 1000 });
  check('diagnostic controls fit a 320px panel', await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await panel.setViewport({ width: 420, height: 1000 });
  const beforeForm = await site.evaluate(() => ({ sentinel: unsavedSentinel, fields: [...document.querySelectorAll('input, textarea, select')].map(element => [element.id, element.value, element.checked]), events: formEvents }));
  const beforeTabs = browser.targets().length;
  // Prohibit even local fetch/storage writes during the action. Normal initialization is already done.
  await panel.evaluate(() => {
    globalThis.__diagnosticFetch = globalThis.fetch;
    globalThis.__diagnosticStorageSet = chrome.storage.local.set;
    globalThis.__diagnosticCalls = [];
    globalThis.fetch = (...args) => { __diagnosticCalls.push('fetch'); throw new Error('No diagnostic API call is allowed'); };
    chrome.storage.local.set = async () => { __diagnosticCalls.push('storage'); throw new Error('No diagnostic storage write is allowed'); };
  });
  try {
    await panel.click('[data-action="diagnostic"]');
    await panel.waitForFunction(() => document.querySelector('#toast')?.textContent.includes('Diagnostic download requested'));
    const file = path.join(downloads, 'applypilot-form-diagnostic.json');
    for (let attempt = 0; attempt < 100 && !fs.existsSync(file); attempt++) await new Promise(resolve => setTimeout(resolve, 50));
    check('the explicit action downloads an actual local JSON file', fs.existsSync(file));
    const json = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '{}';
    const report = JSON.parse(json);
    check('download contains useful upload and ARIA structure but no candidate/token/value canaries', report.frames?.some(frame => frame.nodes.some(node => node.type === 'file')) && report.frames?.some(frame => frame.nodes.some(node => node.role === 'combobox')) && !/PRIVATE_|CANARY|token=|127\.0\.0\.1|fixture/.test(json));
    check('the action makes no fetch/model request or storage write', (await panel.evaluate(() => __diagnosticCalls)).length === 0);
  } finally {
    await panel.evaluate(() => { globalThis.fetch = __diagnosticFetch; chrome.storage.local.set = __diagnosticStorageSet; });
    await cdp.detach();
  }
  const afterForm = await site.evaluate(() => ({ sentinel: unsavedSentinel, fields: [...document.querySelectorAll('input, textarea, select')].map(element => [element.id, element.value, element.checked]), events: formEvents }));
  check('diagnostic never clicks or changes the form, opens a tab or reloads its document', JSON.stringify(afterForm) === JSON.stringify(beforeForm) && browser.targets().length === beforeTabs && site.url().includes('PRIVATE_PAGE_TOKEN'));
  check('diagnostic preserves unsaved letter subject and instructions', (await panel.$eval('#letterSubject', element => element.value)) === subject && (await panel.$eval('#letterInstructions', element => element.value)) === instructions);
  check('diagnostic does not create an application or edit the structured profile', JSON.stringify(await fetch(`${apiBase}/applications`).then(response => response.json())) === beforeApps && fs.readFileSync(path.join(out, 'profile.yaml'), 'utf8') === beforeProfile);
}
