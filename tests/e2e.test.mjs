// Test de bout en bout : vraie extension dans Chrome + vrai serveur ApplyPilot + pages de test servies en HTTP.
// Le panneau latéral est ouvert dans un onglet et piloté comme un utilisateur (sans IA, sans données réelles).
//   node tests/e2e.test.mjs
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getConfig } from '../server/src/config.js';
import { findChrome, puppeteer } from '../server/src/pdf.js';
import { testSearch } from './search-e2e.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tests', 'output', 'e2e');
const FIX = path.join(ROOT, 'tests', 'fixtures');
const API_PORT = 4398;
const FIX_PORT = 4397;
const FIX_URL = `http://127.0.0.1:${FIX_PORT}`;
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension', 'manifest.json'), 'utf8')).version;

let failures = 0;
function check(name, cond, extra = '') {
  console.log(`${cond ? '  ✓' : '  ✗'} ${name}${extra !== '' ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function replaceText(page, selector, text) {
  await page.focus(selector);
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  await page.type(selector, text);
}

function prepareData() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'cvs'), { recursive: true });
  fs.writeFileSync(path.join(OUT, 'cvs', 'Marie_Tremblay_CV_EN.pdf'), '%PDF-1.4\n%test\n%%EOF\n');
  fs.writeFileSync(path.join(OUT, 'cvs', 'Marie_Tremblay_CV_FR.pdf'), '%PDF-1.4\n%test\n%%EOF\n');
  fs.writeFileSync(
    path.join(OUT, 'config.yaml'),
    `cvDir: ${JSON.stringify(path.join(OUT, 'cvs').replace(/\\/g, '/'))}\nstyleDir: ${JSON.stringify(path.join(OUT, 'style').replace(/\\/g, '/'))}\nllm:\n  command: ${JSON.stringify(path.join(ROOT, 'tests', 'fixtures', 'fake-pi.mjs').replace(/\\/g, '/'))}\n`,
  );
  fs.writeFileSync(
    path.join(OUT, 'profile.yaml'),
    `identity:
  firstName: Marie
  lastName: Tremblay
  email: marie@example.com
  phone: "514-555-0123"
  phoneCountryCode: "+1"
  phoneCountry: Canada
  phoneType: Mobile
  address: { line1: 123 rue Exemple, city: Montréal, province: Québec, provinceCode: QC, postalCode: H2X 1Y4, country: Canada }
links: { linkedin: "https://www.linkedin.com/in/marie" }
workAuthorization: { canada: { authorizedToWork: true, needsSponsorship: false } }
preferences: { howDidYouHear: LinkedIn }
experience:
  - { title: ML Intern, company: Nordique Analytique, location: Montréal, start: 2026-01, end: 2026-04, current: false, description: Modèles ML de démonstration. }
education: []
skills: [Python, PyTorch, SQL]
letter: { signatureName: Marie Tremblay }
`,
  );
}

function startFixtureServer() {
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
  const srv = http.createServer((req, res) => {
    const file = path.join(FIX, path.basename(new URL(req.url, FIX_URL).pathname));
    if (!fs.existsSync(file)) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => srv.listen(FIX_PORT, '127.0.0.1', () => resolve(srv)));
}

async function startApi() {
  const env = {
    ...process.env,
    APPLYPILOT_PORT: String(API_PORT),
    APPLYPILOT_DATA_DIR: path.join(OUT, 'data'),
    APPLYPILOT_CONFIG: path.join(OUT, 'config.yaml'),
    APPLYPILOT_PROFILE: path.join(OUT, 'profile.yaml'),
    APPLYPILOT_FAKE_PI_DIR: path.join(OUT, 'fake-pi'),
  };
  const srv = spawn(process.execPath, ['server/src/index.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  srv.stdout.on('data', (d) => (logs += d));
  srv.stderr.on('data', (d) => (logs += d));
  for (let i = 0; i < 50; i++) {
    await sleep(200);
    if (await fetch(`http://127.0.0.1:${API_PORT}/health`).then((r) => r.ok, () => false)) return srv;
  }
  srv.kill();
  throw new Error(`Serveur de test : démarrage impossible\n${logs}`);
}

async function main() {
  prepareData();
  const fixtures = await startFixtureServer();
  const api = await startApi();
  const browser = await puppeteer.launch({
    executablePath: findChrome(getConfig()),
    headless: true,
    pipe: true,
    enableExtensions: [path.join(ROOT, 'extension')],
    args: ['--no-first-run', '--no-default-browser-check'],
  });
  try {
    const worker = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('/background.js'), { timeout: 15000 });
    const extId = new URL(worker.url()).host;
    check('extension chargée', !!extId, extId);
    const sw = await worker.worker();
    await sw.evaluate((url) => chrome.storage.local.set({ serverUrl: url, uiLanguage: 'fr' }), `http://127.0.0.1:${API_PORT}`);

    const site = await browser.newPage();
    await site.setViewport({ width: 1200, height: 900 });
    await site.goto(`${FIX_URL}/posting.html`);
    await sleep(400);
    const ping = await sw.evaluate(async (url) => {
      const tab = (await chrome.tabs.query({})).find((t) => t.url?.startsWith(url));
      const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => globalThis.__applyPilot?.run('ping', {}) });
      return results[0]?.result;
    }, FIX_URL);
    check('scripts de contenu injectés dans le monde isolé', !!ping?.__ap && !!ping?.version);

    // Le panneau dans un onglet : « onglet actif » = la page de test.
    const panel = await browser.newPage();
    panel.on('pageerror', (e) => console.log('    [erreur panneau]', e.message));
    await panel.evaluateOnNewDocument((fixUrl) => {
      const orig = chrome.tabs.query.bind(chrome.tabs);
      chrome.tabs.query = async () => (await orig({})).filter((t) => (t.url || '').startsWith(fixUrl)).slice(0, 1);
    }, FIX_URL);
    await panel.setViewport({ width: 420, height: 1000 });
    await panel.goto(`chrome-extension://${extId}/sidepanel/sidepanel.html`);

    await panel.waitForFunction(() => document.querySelector('#serverStatus')?.classList.contains('on'), { timeout: 10000 });
    check('panneau connecté au serveur', true, await panel.$eval('#serverStatus', (e) => e.textContent));
    check('extension version visible beside ApplyPilot', (await panel.$eval('#appVersion', (e) => e.textContent)) === `v${VERSION}`);
    check('stored French interface preference is respected', (await panel.$eval('html', (e) => e.lang)) === 'fr');
    await panel.waitForSelector('[data-action="analyze"]', { timeout: 10000 });
    check('offre détectée dans la page', (await panel.$eval('#pageCard', (e) => e.textContent)).includes('Stagiaire en apprentissage automatique'));
    await panel.click('[data-action="analyze"]');
    await panel.waitForFunction(() => document.querySelector('#appCard h3')?.textContent.includes('Stagiaire'), { timeout: 10000 });
    const appText = await panel.$eval('#appCard', (e) => e.textContent);
    check('candidature créée et active', appText.includes('Nordique Analytique'), appText.replace(/\s+/g, ' ').slice(0, 90));
    const cv = await panel.$eval('#cvSelect', (e) => e.selectedOptions[0]?.textContent || '');
    check('CV recommandé (offre en français → CV FR)', /FR/.test(cv), cv);
    const reqs = await panel.$eval('#appCard', (e) => e.querySelector('.reqs')?.textContent || '');
    check('exigences de l’offre affichées (bilinguisme)', /À prévoir/.test(reqs) && /bilinguisme/i.test(reqs), reqs.replace(/\s+/g, ' ').slice(0, 120));
    check('section lettre affichée', (await panel.$eval('#letterCard', (e) => e.textContent)).includes('Générer la lettre'));

    // Une installation fraîche reprend la seule candidature en cours, sans en créer une autre.
    await sw.evaluate(() => chrome.storage.local.remove('activeAppId'));
    await panel.reload();
    await panel.waitForFunction(() => document.querySelector('#appCard h3')?.textContent.includes('Stagiaire'), { timeout: 10000 });
    check('candidature en cours reprise sur une installation fraîche', true);
    const tabsBefore = await sw.evaluate(() => chrome.tabs.query({}).then((tabs) => tabs.length));
    await site.evaluate(() => { window.unsavedTrial = 'conserver'; });
    await panel.click('[data-action="applyJob"]');
    await sleep(250);
    const tabsAfter = await sw.evaluate(() => chrome.tabs.query({}).then((tabs) => tabs.length));
    check('bouton candidature : onglet existant activé sans doublon', tabsBefore === tabsAfter);
    check('bouton candidature : saisie non rechargée', (await site.evaluate(() => window.unsavedTrial)) === 'conserver');
    // Le panneau est un onglet dans le test : le réactiver après le changement d’onglet.
    await panel.bringToFront();

    // Éditeur de profil : sauvegarde réelle, rechargement, puis remplissage avec la nouvelle adresse.
    await panel.click('[data-tab="profile"]');
    await panel.waitForSelector('[data-profile-path="identity.address.line1"]');
    await replaceText(panel, '[data-profile-path="identity.address.line1"]', '456 rue Démonstration');
    await replaceText(panel, '[data-profile-path="identity.address.city"]', 'Québec');
    await replaceText(panel, '[data-profile-path="identity.address.postalCode"]', 'g1a 1a1');
    await panel.click('[data-action="saveProfile"]');
    await panel.waitForFunction(() => document.querySelector('#toast')?.textContent.includes('Profil enregistré'), { timeout: 10000 });
    const profileSaved = await fetch(`http://127.0.0.1:${API_PORT}/profile`).then((r) => r.json());
    check('profil modifié depuis le panneau', profileSaved.profile.identity.address.line1 === '456 rue Démonstration' && profileSaved.profile.identity.address.postalCode === 'G1A 1A1');
    check('autres coordonnées conservées', profileSaved.profile.identity.email === 'marie@example.com' && profileSaved.profile.workAuthorization.canada.needsSponsorship === false);
    // Switching UI language preserves drafts without writing or translating profile values.
    const profileBeforeSwitch = fs.readFileSync(path.join(OUT, 'profile.yaml'), 'utf8');
    await replaceText(panel, '[data-profile-path="identity.address.city"]', 'Ville brouillon');
    await replaceText(panel, '#serverUrl', 'http://127.0.0.1:4900');
    await panel.select('#uiLanguage', 'en');
    await panel.waitForFunction(() => document.querySelector('[data-action="saveProfile"]')?.textContent === 'Save profile');
    check('English profile labels and unknown-answer option are localized', (await panel.$eval('#tab-profile', (e) => e.textContent)).includes('Contact details') && (await panel.$eval('[data-profile-path="workAuthorization.canada.needsSponsorship"]', (e) => e.options[0].textContent)) === 'I will answer myself');
    check('profile and server URL drafts survive a language switch', (await panel.$eval('[data-profile-path="identity.address.city"]', (e) => e.value)) === 'Ville brouillon' && (await panel.$eval('#serverUrl', (e) => e.value)) === 'http://127.0.0.1:4900');
    check('switching UI language never writes the profile YAML', fs.readFileSync(path.join(OUT, 'profile.yaml'), 'utf8') === profileBeforeSwitch);
    check('UI language preference saved independently', (await sw.evaluate(() => chrome.storage.local.get('uiLanguage'))).uiLanguage === 'en');
    await panel.reload();
    await panel.waitForFunction(() => document.querySelector('#serverStatus')?.classList.contains('on'));
    check('English interface persists after reopening the panel', (await panel.$eval('html', (e) => e.lang)) === 'en' && (await panel.$eval('[data-tab="journal"]', (e) => e.textContent)) === 'Tracker');
    await panel.select('#uiLanguage', 'fr');
    await panel.click('[data-tab="profile"]');
    await panel.waitForSelector('[data-profile-path="identity.address.line1"]');
    await replaceText(panel, '[data-profile-path="identity.address.line1"]', 'Brouillon non enregistré');
    await fetch(`http://127.0.0.1:${API_PORT}/profile`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ revision: profileSaved.revision, values: { 'availability.workMode': 'Hybride' } }) });
    await panel.click('[data-action="saveProfile"]');
    await panel.waitForFunction(() => document.querySelector('#toast')?.textContent.includes('modifié ailleurs'), { timeout: 10000 });
    check('conflit : brouillon conservé dans le panneau', (await panel.$eval('[data-profile-path="identity.address.line1"]', (e) => e.value)) === 'Brouillon non enregistré');
    panel.once('dialog', (dialog) => dialog.accept());
    await panel.click('[data-action="reloadProfile"]');
    await panel.waitForFunction(() => document.querySelector('[data-profile-path="identity.address.line1"]')?.value === '456 rue Démonstration');
    check('rechargement explicite après conflit', true);
    await panel.reload();
    await panel.waitForFunction(() => document.querySelector('#serverStatus')?.classList.contains('on'));
    await panel.click('[data-tab="profile"]');
    await panel.waitForFunction(() => document.querySelector('[data-profile-path="identity.address.postalCode"]')?.value === 'G1A 1A1');
    check('profil persistant après rechargement', true);
    await panel.screenshot({ path: path.join(OUT, 'panel-profile-editor.png'), fullPage: true });
    await panel.click('[data-tab="app"]');

    // Formulaire Workday sur la même offre → la candidature reste active.
    await site.goto(`${FIX_URL}/workday-myinfo.html`);
    await sleep(1500);
    await panel.click('#optAi'); // pas d'IA pendant le test
    await panel.click('[data-action="fill"]');
    await panel.waitForFunction(() => !!document.querySelector('#fillCard .summary'), { timeout: 60000 });
    const summary = await panel.$eval('#fillCard .summary', (e) => e.textContent.trim());
    check('résumé du remplissage', /rempli/.test(summary), summary);
    const first = await site.$eval('#name--legalName--firstName', (e) => e.value);
    const province = await site.$eval('[data-automation-id="addressSection_countryRegion"]', (e) => e.textContent.trim());
    const source = await site.$$eval('[data-automation-id="formField-source"] [data-automation-id="selectedItem"]', (els) => els.map((e) => e.textContent).join());
    check('page remplie depuis le panneau', first === 'Marie' && province === 'Quebec' && source === 'LinkedIn', `${first} / ${province} / ${source}`);
    const address = await site.$$eval('[data-automation-id="addressSection_addressLine1"], [data-automation-id="addressSection_city"], [data-automation-id="addressSection_postalCode"]', (els) => els.map((e) => e.value));
    check('nouvelle adresse remplie automatiquement', address.join('|') === '456 rue Démonstration|Québec|G1A 1A1', address.join(' / '));
    const todo = await panel.$$eval('#fillCard .results li.todo .lbl', (els) => els.map((e) => e.textContent));
    check('rien à compléter sur cette page (profil de test complet)', todo.length === 0, todo.join(', '));

    await site.goto(`${FIX_URL}/workday-login.html`);
    await sleep(1200);
    await panel.click('[data-action="fill"]');
    await panel.waitForFunction(() => !document.querySelector('#fillCard .busy') && !!document.querySelector('#fillCard .summary'), { timeout: 60000 });
    check('connexion : courriel seul rempli depuis le panneau', (await site.$eval('#login-email', (e) => e.value)) === 'marie@example.com' && (await site.$eval('#login-password', (e) => e.value)) === '');
    check('connexion non envoyée', (await site.evaluate(() => window.loginAttempts)) === 0);
    check('consigne de connexion affichée', (await panel.$eval('#pageCard', (e) => e.textContent)).includes('double authentification'));

    // Fichiers : la page « expérience » reçoit le CV choisi.
    await site.goto(`${FIX_URL}/workday-experience.html`);
    await sleep(1200);
    await panel.click('[data-action="fill"]');
    await panel.waitForFunction(() => !document.querySelector('#fillCard .busy') && !!document.querySelector('#fillCard .summary'), { timeout: 60000 });
    const uploaded = await site.$$eval('#uploaded li', (els) => els.map((e) => e.textContent));
    check('CV joint depuis le serveur, sous un nom neutre', uploaded.length === 1 && /^Marie_Tremblay_CV\.pdf/.test(uploaded[0]), uploaded.join(' | '));

    // Mise à jour des scripts sur une page déjà remplie : aucune navigation ni perte de saisie.
    await site.goto(`${FIX_URL}/workday-skills.html`);
    await sleep(1200);
    await site.evaluate(() => {
      window.unsavedTrial = 'ne pas perdre';
      skillFixture.seed(['Git', 'Python (Programming Language)']);
      document.getElementById('workExperience-1--location').value = 'Toronto';
    });
    await sw.evaluate(async (url) => {
      const tab = (await chrome.tabs.query({})).find((t) => t.url?.startsWith(url));
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => {
        const original = globalThis.__applyPilot.run;
        globalThis.__applyPilot.run = async (cmd, payload) => {
          const answer = await original(cmd, payload);
          if (cmd === 'ping') answer.version = '0.0.1';
          return answer;
        };
      } });
    }, FIX_URL);
    await panel.bringToFront();
    await panel.click('[data-action="fill"]');
    await panel.waitForFunction(() => !document.querySelector('#fillCard .busy') && !!document.querySelector('#fillCard .summary'), { timeout: 60000 });
    const freshVersion = await sw.evaluate(async (url) => {
      const tab = (await chrome.tabs.query({})).find((t) => t.url?.startsWith(url));
      const [reply] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => globalThis.__applyPilot.run('ping') });
      return reply.result.version;
    }, FIX_URL);
    check('ancien script remplacé automatiquement sans recharger Workday', freshVersion === VERSION, freshVersion);
    const savedSkills = await site.evaluate(() => skillFixture.selected());
    check('panneau : compétences déjà choisies conservées et liste complétée', savedSkills.length === 4 && savedSkills.includes('Git') && savedSkills.includes('SQL (Programming Language)'), savedSkills.join(' | '));
    check('mise à jour : lieu saisi manuellement et page non enregistrée conservés', (await site.evaluate(() => window.unsavedTrial)) === 'ne pas perdre' && (await site.$eval('#workExperience-1--location', (e) => e.value)) === 'Toronto');
    check('mise à jour : aucun Suivant/Soumettre ni clic dans une autre liste', (await site.evaluate(() => window.navigationClicks + window.unrelatedClicks)) === 0);
    await site.$eval('#workExperience-1--location', (e) => { e.value = ''; });
    await sw.evaluate(async (url) => {
      const tab = (await chrome.tabs.query({})).find((t) => t.url?.startsWith(url));
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => { delete globalThis.__applyPilot; } });
    }, FIX_URL);
    await panel.click('[data-action="fill"]');
    await panel.waitForFunction(() => !document.querySelector('#fillCard .busy') && !!document.querySelector('#fillCard .summary'), { timeout: 60000 });
    check('contexte absent après rechargement extension : réinjection sans perte', (await site.evaluate(() => window.unsavedTrial)) === 'ne pas perdre' && (await site.evaluate(() => skillFixture.selected())).length === 4);
    check('panneau : Location vide rempli depuis le profil et enregistré', (await site.$eval('#workExperience-1--location', (e) => e.value)) === 'Montréal' && (await site.evaluate(() => Mock.model['experience-location'])) === 'Montréal');

    // Stop a genuinely pending /answers request (fake pi), then fill the next page.
    const fakePids = () => fs.existsSync(path.join(OUT, 'fake-pi')) ? fs.readdirSync(path.join(OUT, 'fake-pi')).map((f) => JSON.parse(fs.readFileSync(path.join(OUT, 'fake-pi', f), 'utf8')).pid) : [];
    const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
    await site.goto(`${FIX_URL}/workday-questions.html`);
    await sleep(1200);
    await panel.click('#optAi');
    const oldPids = fakePids();
    await panel.click('[data-action="fill"]');
    await panel.waitForFunction(() => document.querySelector('#fillCard .busy')?.textContent.includes('pi répond'), { timeout: 30000 });
    for (let i = 0; i < 100 && fakePids().length === oldPids.length; i++) await sleep(50);
    const pendingPid = fakePids().find((pid) => !oldPids.includes(pid));
    check('pending answers really started the fake pi subprocess', !!pendingPid && alive(pendingPid));
    await panel.click('[data-action="stopFill"]');
    await panel.waitForSelector('[data-action="fill"]:not([disabled])', { timeout: 1000 });
    check('Stop immediately frees autofill while pi is waiting', !(await panel.$('#fillCard .busy')) && (await panel.$eval('#toast', (e) => e.textContent)).includes('arrêté'));
    for (let i = 0; i < 100 && pendingPid && alive(pendingPid); i++) await sleep(50);
    check('Stop cancels the underlying request and terminates pi', !!pendingPid && !alive(pendingPid));
    check('cancelling pi does not falsely mark the server offline', (await panel.$eval('#serverStatus', (e) => e.classList.contains('on'))));
    await panel.click('#optAi');
    await site.goto(`${FIX_URL}/workday-myinfo.html?next-after-stop`);
    await sleep(1200);
    await panel.click('[data-action="fill"]');
    await panel.waitForFunction(() => !document.querySelector('#fillCard .busy') && !!document.querySelector('#fillCard .summary'), { timeout: 30000 });
    check('the next page fills normally after stopping a blocked AI request', (await site.$eval('#name--legalName--firstName', (e) => e.value)) === 'Marie');

    // Workday SPA: same URL, next step. The old AI request must be cancelled automatically.
    await site.goto(`${FIX_URL}/workday-questions.html`);
    await sleep(1200);
    await panel.click('#optAi');
    await panel.click('[data-action="fill"]');
    await panel.waitForFunction(() => document.querySelector('#fillCard .busy')?.textContent.includes('pi répond'), { timeout: 30000 });
    await site.$eval('[data-automation-id="progressBarActiveStep"]', (e) => { e.textContent = 'current step 4 of 5 Review'; });
    await panel.waitForSelector('[data-action="fill"]:not([disabled])', { timeout: 5000 });
    check('changing Workday steps without navigation stops the previous AI request', !(await panel.$('#fillCard .busy')));
    await panel.select('#uiLanguage', 'en');
    await panel.waitForFunction(() => document.querySelector('[data-action="fill"]')?.textContent === 'Fill this page');
    await panel.click('[data-action="fill"]');
    await panel.waitForFunction(() => document.querySelector('#fillCard .busy')?.textContent.includes('pi is answering'), { timeout: 30000 });
    check('Stop is also available in English', (await panel.$eval('[data-action="stopFill"]', (e) => e.textContent)) === 'Stop');
    await panel.click('[data-action="stopFill"]');
    await panel.click('#optAi');
    await panel.select('#uiLanguage', 'fr');

    // Lettre : écrite via l'API (sans IA), puis modifiée dans le panneau.
    const apiBase = `http://127.0.0.1:${API_PORT}`;
    const appId = (await fetch(`${apiBase}/applications`).then((r) => r.json())).applications[0].id;
    const body = 'Madame, Monsieur,\n\nPremier paragraphe de test assez long pour la lettre.\n\nVeuillez agréer mes salutations distinguées.';
    await fetch(`${apiBase}/applications/${appId}/letter`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subject: 'Candidature test', body, language: 'fr' }),
    });
    await panel.reload();
    await panel.waitForSelector('#letterBody', { timeout: 10000 });
    check('éditeur de lettre affiché', (await panel.$eval('#letterBody', (e) => e.value)).startsWith('Madame'));
    const letterBeforeSwitch = (await fetch(`${apiBase}/applications/${appId}`).then((r) => r.json())).application.letter;
    await replaceText(panel, '#letterBody', body + '\n\nBrouillon conservé.');
    await panel.click('#letterCard details summary');
    await replaceText(panel, '#letterInstructions', 'Consignes non enregistrées');
    await panel.select('#letterLang', 'en');
    await panel.select('#uiLanguage', 'en');
    await panel.waitForFunction(() => document.querySelector('[data-action="saveLetter"]')?.textContent === 'Update PDF');
    check('letter body and instructions survive UI language changes', (await panel.$eval('#letterBody', (e) => e.value)).endsWith('Brouillon conservé.') && (await panel.$eval('#letterInstructions', (e) => e.value)) === 'Consignes non enregistrées');
    check('UI language stays independent of document language and posting data', (await panel.$eval('#letterLang', (e) => e.value)) === 'en' && (await fetch(`${apiBase}/applications/${appId}`).then((r) => r.json())).application.letter.language === 'fr');
    check('language switch does not save or translate the letter draft', (await fetch(`${apiBase}/applications/${appId}`).then((r) => r.json())).application.letter.body === letterBeforeSwitch.body);
    await panel.select('#uiLanguage', 'fr');
    await panel.select('#letterLang', 'fr');
    await replaceText(panel, '#letterBody', body);
    await panel.focus('#letterSubject');
    await panel.keyboard.down('Control');
    await panel.keyboard.press('KeyA');
    await panel.keyboard.up('Control');
    await panel.type('#letterSubject', 'Candidature modifiée');
    await panel.click('[data-action="saveLetter"]');
    await panel.waitForFunction(() => document.querySelector('#toast')?.textContent.includes('PDF mis'), { timeout: 30000 });
    const saved = (await fetch(`${apiBase}/applications/${appId}`).then((r) => r.json())).application.letter;
    check('modification enregistrée + PDF régénéré', saved.subject === 'Candidature modifiée' && /Lettre_de_motivation/.test(saved.fileName), `${JSON.stringify(saved.subject)} · ${saved.fileName}`);

    await site.goto(`${FIX_URL}/generic-form.html`);
    await sleep(1200);
    await panel.click('[data-action="fill"]');
    await panel.waitForFunction(() => !document.querySelector('#fillCard .busy') && !!document.querySelector('#fillCard .summary'), { timeout: 60000 });
    const coverFile = await site.$eval('#cover', (e) => e.files[0]?.name || '');
    const pasted = await site.$eval('#cl_text', (e) => e.value);
    check('PDF de la lettre joint dans « Cover Letter »', /Lettre_de_motivation_Nordique_Analytique\.pdf$/.test(coverFile), coverFile);
    check('texte de la lettre + signature collés', pasted.includes('Premier paragraphe') && pasted.trim().endsWith('Marie Tremblay'));
    check('formulaire générique jamais soumis', !(await site.evaluate(() => window.submitted)));

    // Ce bouton ne soumet rien : le journal ne change qu'après confirmation explicite.
    panel.once('dialog', (dialog) => dialog.dismiss());
    await panel.click('[data-action="submitted"]');
    await sleep(250);
    const unsubmitted = (await fetch(`${apiBase}/applications/${appId}`).then((r) => r.json())).application;
    check('annuler le marquage garde la candidature en cours', unsubmitted.status === 'en cours' && unsubmitted.submittedAt === null);
    panel.once('dialog', (dialog) => dialog.accept());
    await panel.click('[data-action="submitted"]');
    await sleep(800);
    const { applications } = await fetch(`http://127.0.0.1:${API_PORT}/applications`).then((r) => r.json());
    check('statut « soumise » enregistré', applications[0]?.status === 'soumise', applications[0]?.status);
    await panel.click('[data-tab="journal"]');
    await panel.waitForSelector('#tab-journal .list li', { timeout: 5000 });
    check('journal affiché', (await panel.$eval('#tab-journal', (e) => e.textContent)).includes('Nordique Analytique'));
    await panel.click('[data-tab="profile"]');
    await panel.waitForFunction(() => document.querySelector('#tab-profile')?.textContent.includes('CV (2)'), { timeout: 5000 });
    check('onglet profil', true);
    await panel.screenshot({ path: path.join(OUT, 'panel-profile.png'), fullPage: true });
    await panel.click('[data-tab="app"]');
    await sleep(300);
    await panel.screenshot({ path: path.join(OUT, 'panel.png'), fullPage: true });

    // English public screenshots: only this isolated fictional profile/server is used.
    const demoProfile = await fetch(`${apiBase}/profile`).then((r) => r.json());
    await fetch(`${apiBase}/profile`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ revision: demoProfile.revision, values: {
        'identity.address.line1': '456 Example Street', 'identity.address.city': 'Montréal',
        'identity.address.province': 'Quebec', 'identity.address.postalCode': 'H2X 1Y4',
        'availability.term': 'Été 2027', 'availability.termEn': 'Summer 2027',
        'availability.startDate': '2027-05-03', 'availability.endDate': '2027-08-31',
        'availability.workMode': 'Hybrid', 'student.currentlyEnrolled': true,
        'student.expectedGraduation': '2028-01',
      } }),
    });
    await panel.select('#uiLanguage', 'en');
    await site.goto(`${FIX_URL}/posting-en.html`);
    await panel.waitForFunction(() => document.querySelector('[data-action="analyze"]')?.textContent === 'Analyze this posting', { timeout: 10000 });
    await panel.click('[data-action="analyze"]');
    await panel.waitForFunction(() => document.querySelector('#appCard h3')?.textContent.includes('Machine Learning'), { timeout: 10000 });
    check('English posting recommends English CV independently of the interface', (await panel.$eval('#cvSelect', (e) => e.value)).endsWith('_EN'));
    const englishApp = (await fetch(`${apiBase}/applications`).then((r) => r.json())).applications.find((a) => a.company === 'Nordic Analytics');
    const englishBody = `Dear Hiring Team,\n\nI am interested in the Machine Learning Intern position at Nordic Analytics. Your focus on practical models and clear communication aligns with the kind of work I enjoy.\n\nDuring my recent ML internship, I worked on demonstration models and strengthened my skills in Python, PyTorch and SQL. I would welcome the opportunity to apply those skills to model evaluation and reproducible analysis with your team.\n\nI am available from May 3 to August 31, 2027. The hybrid role in Montréal would let me contribute alongside the data science team while continuing to develop my technical judgment.\n\nThank you for considering my application. I would be pleased to discuss how I could support your projects.\n\nBest regards,`;
    await fetch(`${apiBase}/applications/${englishApp.id}/letter`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ language: 'en', subject: 'Application — Machine Learning Intern', body: englishBody, company: 'Nordic Analytics', recipient: 'Talent Acquisition Team' }),
    });
    await panel.select('#letterLang', 'auto');
    await panel.reload();
    await panel.waitForSelector('#letterBody');
    check('English screenshots use fictional English content, not candidate applications', (await panel.$eval('#letterBody', (e) => e.value)).startsWith('Dear Hiring Team') && (await panel.$eval('#appCard', (e) => e.textContent)).includes('Nordic Analytics'));
    await site.goto(`${FIX_URL}/workday-myinfo-en.html`);
    await sleep(1200);
    await panel.click('[data-action="fill"]');
    await panel.waitForFunction(() => !document.querySelector('#fillCard .busy') && !!document.querySelector('#fillCard .summary'), { timeout: 30000 });
    check('English feedback uses localized review and filled labels', /filled/.test(await panel.$eval('#fillCard .summary', (e) => e.textContent)));
    await panel.evaluate(() => { document.querySelector('#toast').className = 'toast'; window.scrollTo(0, 0); });
    await panel.screenshot({ path: path.join(OUT, 'panel-en.png'), fullPage: true });
    await site.screenshot({ path: path.join(OUT, 'workday-en.png'), fullPage: true });
    await panel.click('[data-tab="profile"]');
    await panel.waitForFunction(() => document.querySelector('[data-profile-path="identity.address.line1"]')?.value === '456 Example Street');
    await panel.evaluate(() => window.scrollTo(0, 0));
    const profileHeight = await panel.$eval('#tab-profile .card', (e) => Math.ceil(e.getBoundingClientRect().bottom + 12));
    await panel.setViewport({ width: 420, height: profileHeight });
    await panel.screenshot({ path: path.join(OUT, 'profile-en.png'), fullPage: false });
    await panel.setViewport({ width: 320, height: 1000 });
    check('version and language selector fit a narrow side panel', await panel.evaluate(() => {
      const version = document.querySelector('#appVersion').getBoundingClientRect();
      const language = document.querySelector('#uiLanguage').getBoundingClientRect();
      return version.left >= 0 && version.right <= innerWidth && language.right <= innerWidth;
    }));
    await testSearch({ browser, panel, site, sw, apiBase, out: OUT, check });

    // Server mismatch is shown, without changing the visible extension version.
    await panel.evaluate(() => {
      const original = globalThis.fetch;
      globalThis.fetch = (url, options) => String(url).endsWith('/health')
        ? Promise.resolve(new Response(JSON.stringify({ ok: true, version: '0.0.1', cvCount: 2 }), { headers: { 'content-type': 'application/json' } }))
        : original(url, options);
    });
    await panel.click('#serverStatus');
    await panel.waitForFunction(() => document.querySelector('#serverStatus')?.textContent.includes('restart needed'));
    check('mismatched backend version is visible while the extension version stays correct', (await panel.$eval('#serverStatus', (e) => e.textContent)).includes('0.0.1') && (await panel.$eval('#appVersion', (e) => e.textContent)) === `v${VERSION}`);
  } finally {
    await browser.close();
    api.kill();
    fixtures.close();
  }
  console.log(failures ? `\n${failures} échec(s)` : '\nTout est OK');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
