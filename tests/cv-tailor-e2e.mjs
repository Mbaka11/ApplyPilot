// Real-extension test of the per-posting CV copy: fake model, fake LaTeX, fictional CV. No provider quota.
import fs from 'node:fs';
import path from 'node:path';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const ABOUT = 'I like turning machine learning into tools people actually use, especially models that must run reliably on real data. I learn by building, and I enjoy working with business teams. I am looking for an internship where I can own a problem end to end.';

export async function testCvTailor({ panel, sw, apiBase, out, restoreId, check, root }) {
  const api = async (method, url, body) => fetch(apiBase + url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }).then(r => r.json());
  const markersDir = path.join(out, 'fake-pi');
  const markers = () => new Set(fs.existsSync(markersDir) ? fs.readdirSync(markersDir).filter(name => /^\d+\.json$/.test(name)) : []);
  const configFile = path.join(out, 'config.yaml');
  const originalConfig = fs.readFileSync(configFile, 'utf8');
  const cvId = 'Zz_Tailor_CV_EN';
  const texFile = path.join(out, 'cvs', cvId, 'main.tex');
  const sample = fs.readFileSync(path.join(root, 'tests', 'fixtures', 'cv-tailor-sample.tex'), 'utf8');
  fs.mkdirSync(path.dirname(texFile), { recursive: true });
  fs.writeFileSync(texFile, sample);
  fs.writeFileSync(path.join(out, 'cvs', `${cvId}.pdf`), '%PDF-1.4\n%test\n%%EOF\n');
  fs.appendFileSync(configFile, `cvTailor:\n  pdflatex: ${JSON.stringify(path.join(root, 'tests', 'fixtures', 'fake-pdflatex.mjs').replace(/\\/g, '/'))}\n`);
  const proposalFile = markersDir + '-tailor.json';
  fs.writeFileSync(proposalFile, JSON.stringify({ about: ABOUT, skills: [{ label: 'Programming', items: ['SQL', 'Python', 'C++', 'Java', 'Bash', 'R'] }], keywords: ['MLflow'], warnings: ['Check the wording.'] }));
  const { application: app } = await api('POST', '/applications', { cvId, job: { url: 'https://careers.example.com/job/tailor-demo', jobKey: 'fixture-tailor-demo', company: 'Nordic Analytics', title: 'Machine Learning Intern — CV demo', language: 'en', description: 'Build and deploy machine learning models with Python, PyTorch and MLflow. Work closely with business teams on reliable data products. '.repeat(2) } });
  const { application: noTex } = await api('POST', '/applications', { cvId: 'Marie_Tremblay_CV_EN', job: { url: 'https://careers.example.com/job/tailor-no-tex', jobKey: 'fixture-tailor-no-tex', company: 'Nordic Analytics', title: 'Machine Learning Intern — no source', language: 'en', description: 'Build and deploy machine learning models with Python, PyTorch and MLflow. Work closely with business teams on reliable data products. '.repeat(2) } });
  const activate = async id => {
    await panel.click('[data-tab="home"]'); await panel.waitForSelector(`[data-activate="${id}"]`); await sleep(150);
    // Leaving an application with an unsaved letter draft asks for confirmation; this fixture draft is disposable.
    const accept = dialog => dialog.accept();
    panel.on('dialog', accept);
    try {
      await panel.$eval(`[data-activate="${id}"]`, element => setTimeout(() => element.click(), 0));
      await panel.waitForFunction(applicationId => document.querySelector('#cvTailor .cv-tailor') && document.querySelector('#cvInspector')?.textContent.length > 0, {}, id);
    } finally { panel.off('dialog', accept); }
  };
  const text = () => panel.$eval('#cvTailor', element => element.textContent);
  try {
    await panel.bringToFront();
    await panel.setViewport({ width: 420, height: 1000 });
    await panel.select('#uiLanguage', 'en');
    await panel.click('#serverStatus');
    await panel.waitForFunction(() => document.querySelector('#serverStatus')?.title?.length > 0);
    await activate(noTex.id);
    check('a CV without LaTeX source explains why it cannot be tailored', (await text()).includes('no LaTeX source') && !(await panel.$('[data-ct-action="tailor"]')));
    await activate(app.id);
    await panel.waitForSelector('[data-ct-action="tailor"]:not([disabled])');
    check('the Application tab offers the tailoring action with its limits', (await text()).includes('Changes only “About” and the order of skills'));

    const before = markers().size;
    panel.once('dialog', dialog => dialog.dismiss());
    await panel.click('[data-ct-action="tailor"]');
    await sleep(150);
    check('declining the quota confirmation makes no model call and saves nothing', markers().size === before && !(await api('GET', `/applications/${app.id}`)).application.cvTailored);

    let message = '';
    panel.once('dialog', dialog => { message = dialog.message(); dialog.accept(); });
    await panel.click('[data-ct-action="tailor"]');
    await panel.waitForFunction(() => document.querySelector('#cvTailor')?.textContent.includes('Tailored on'), { timeout: 30000 });
    const saved = (await api('GET', `/applications/${app.id}`)).application;
    check('the confirmation names the CV and posting and warns about quota', message.includes('Zz Tailor CV EN') && message.includes('Nordic Analytics') && message.includes('normal pi quota'));
    check('one request saves a one-page copy; status and original CV are unchanged', markers().size === before + 1 && saved.cvTailored?.pages === 1 && saved.cvTailored.useForForms === false && saved.status === 'en cours' && fs.readFileSync(texFile, 'utf8') === sample);
    await panel.$eval('#cvTailor details', element => { element.open = true; });
    const reviewed = await text();
    check('the review shows the before and after About text and the model warning', reviewed.includes('I like turning machine learning into tools people actually use, especially where good ideas') && reviewed.includes('models that must run reliably on real data') && reviewed.includes('Check the wording.'));
    await (await panel.$('#appCard')).screenshot({ path: path.join(out, 'cv-tailor-en.png') });
    check('the tailored copy is not used for forms until the user opts in', !(await panel.$eval('[data-ct-use]', element => element.checked)));

    const tabsBefore = await sw.evaluate(() => chrome.tabs.query({}).then(tabs => tabs.map(tab => tab.id)));
    await panel.click('[data-ct-action="preview"]');
    let tab;
    for (let i = 0; i < 100 && !tab; i++) {
      tab = await sw.evaluate(async ({ ids, base, id }) => (await chrome.tabs.query({})).find(t => !ids.includes(t.id) && t.url?.startsWith(`${base}/applications/${id}/cv-tailored.pdf`)), { ids: tabsBefore, base: apiBase, id: app.id });
      if (!tab) await sleep(30);
    }
    check('preview opens the tailored PDF over HTTP', !!tab);
    if (tab) await sw.evaluate(id => chrome.tabs.remove(id), tab.id);
    await panel.bringToFront();

    await panel.click('[data-ct-use]');
    await panel.waitForFunction(() => document.querySelector('[data-ct-use]')?.checked);
    check('opting in is saved on the application', (await api('GET', `/applications/${app.id}`)).application.cvTailored.useForForms === true);

    // The generic fill uploads the tailored PDF, never the base PDF, once the user opted in.
    const requests = [];
    const watch = request => requests.push(request.url());
    panel.on('request', watch);
    await panel.click('[data-action="fill"]');
    await panel.waitForFunction(() => !document.querySelector('#fillCard .busy'), { timeout: 30000 });
    panel.off('request', watch);
    check('autofill requests the tailored PDF and not the base CV file', requests.some(url => url.includes(`/applications/${app.id}/cv-tailored.pdf?base64=1`)) && !requests.some(url => url.includes(`/cvs/${cvId}/pdf?base64=1`)));

    fs.writeFileSync(texFile, `${sample}% edited after tailoring\n`);
    await panel.click('#serverStatus');
    await activate(app.id);
    await panel.waitForFunction(() => document.querySelector('#cvTailor [role="alert"]'), { timeout: 10000 });
    check('editing the source CV marks the copy as out of date and blocks its use', (await text()).includes('regenerate the copy') && await panel.$eval('[data-ct-use]', element => element.disabled));
    const staleRequests = [];
    const watchStale = request => staleRequests.push(request.url());
    panel.on('request', watchStale);
    await panel.click('[data-action="fill"]');
    await panel.waitForFunction(() => !document.querySelector('#fillCard .busy'), { timeout: 30000 });
    panel.off('request', watchStale);
    check('an out-of-date copy is never uploaded silently', !staleRequests.some(url => url.includes('cv-tailored.pdf?base64=1') || url.includes(`/cvs/${cvId}/pdf?base64=1`)) && (await panel.$eval('#toast', element => element.textContent)).includes('out of date'));
    fs.writeFileSync(texFile, sample);

    panel.once('dialog', dialog => dialog.accept());
    await panel.click('[data-ct-action="discard"]');
    await panel.waitForSelector('[data-ct-action="tailor"]');
    const discarded = (await api('GET', `/applications/${app.id}`)).application;
    check('discarding removes the copy and leaves the original CV', !discarded.cvTailored && !fs.existsSync(path.join(out, 'data', 'applications', app.id, 'cv-tailored')) && fs.readFileSync(texFile, 'utf8') === sample);

    await panel.select('#uiLanguage', 'fr');
    await panel.waitForFunction(() => document.querySelector('#cvTailor')?.textContent.includes('Adapter le CV à cette offre'));
    check('the tailoring card is available in French', (await text()).includes('Adapter le CV à cette offre'));
    await panel.select('#uiLanguage', 'en');
    await panel.setViewport({ width: 320, height: 1000 });
    check('the card fits a narrow side panel', await panel.$eval('#cvTailor', element => element.scrollWidth <= element.clientWidth + 1));
  } finally {
    fs.writeFileSync(configFile, originalConfig);
    fs.rmSync(proposalFile, { force: true });
    await api('DELETE', `/applications/${app.id}`).catch(() => {});
    await api('DELETE', `/applications/${noTex.id}`).catch(() => {});
    fs.rmSync(path.join(out, 'cvs', cvId), { recursive: true, force: true });
    fs.rmSync(path.join(out, 'cvs', `${cvId}.pdf`), { force: true });
    await panel.setViewport({ width: 420, height: 1000 });
    if (restoreId) await activate(restoreId).catch(error => console.log('restore failed:', error.message));
    await panel.waitForSelector('#letterSubject', { visible: true }).catch(async error => console.log('letter card missing:', error.message, await panel.evaluate(() => [document.querySelector('.tab.active, [data-tab].active')?.dataset.tab, document.querySelector('#appCard')?.textContent.slice(0, 120)])));
    await sleep(600);
    await panel.waitForSelector('#letterSubject', { visible: true }).catch(() => {});
    // Later tests start from an application with an unsaved draft, as before this test switched applications.
    await panel.$eval('#letterSubject', element => { element.value += ' — unsaved draft'; element.dispatchEvent(new Event('input', { bubbles: true })); }).catch(() => {});
  }
}
