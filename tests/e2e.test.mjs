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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tests', 'output', 'e2e');
const FIX = path.join(ROOT, 'tests', 'fixtures');
const API_PORT = 4398;
const FIX_PORT = 4397;
const FIX_URL = `http://127.0.0.1:${FIX_PORT}`;

let failures = 0;
function check(name, cond, extra = '') {
  console.log(`${cond ? '  ✓' : '  ✗'} ${name}${extra !== '' ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function prepareData() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'cvs'), { recursive: true });
  fs.writeFileSync(path.join(OUT, 'cvs', 'Marie_Tremblay_CV_EN.pdf'), '%PDF-1.4\n%test\n%%EOF\n');
  fs.writeFileSync(path.join(OUT, 'cvs', 'Marie_Tremblay_CV_FR.pdf'), '%PDF-1.4\n%test\n%%EOF\n');
  fs.writeFileSync(
    path.join(OUT, 'config.yaml'),
    `cvDir: ${JSON.stringify(path.join(OUT, 'cvs').replace(/\\/g, '/'))}\nstyleDir: ${JSON.stringify(path.join(OUT, 'style').replace(/\\/g, '/'))}\n`,
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
experience: []
education: []
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
    await sw.evaluate((url) => chrome.storage.local.set({ serverUrl: url }), `http://127.0.0.1:${API_PORT}`);

    const site = await browser.newPage();
    await site.setViewport({ width: 1200, height: 900 });
    await site.goto(`${FIX_URL}/posting.html`);
    check('scripts de contenu injectés automatiquement', await site.evaluate(() => typeof document.querySelector === 'function'));

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
    await panel.waitForSelector('[data-action="analyze"]', { timeout: 10000 });
    check('offre détectée dans la page', (await panel.$eval('#pageCard', (e) => e.textContent)).includes('Stagiaire en apprentissage automatique'));
    await panel.click('[data-action="analyze"]');
    await panel.waitForFunction(() => document.querySelector('#appCard h3')?.textContent.includes('Stagiaire'), { timeout: 10000 });
    const appText = await panel.$eval('#appCard', (e) => e.textContent);
    check('candidature créée et active', appText.includes('Nordique Analytique'), appText.replace(/\s+/g, ' ').slice(0, 90));
    const cv = await panel.$eval('#cvSelect', (e) => e.selectedOptions[0]?.textContent || '');
    check('CV recommandé (offre en français → CV FR)', /FR/.test(cv), cv);
    check('section lettre affichée', (await panel.$eval('#letterCard', (e) => e.textContent)).includes('Générer la lettre'));

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
    const todo = await panel.$$eval('#fillCard .results li.todo .lbl', (els) => els.map((e) => e.textContent));
    check('rien à compléter sur cette page (profil de test complet)', todo.length === 0, todo.join(', '));

    // Fichiers : la page « expérience » reçoit le CV choisi.
    await site.goto(`${FIX_URL}/workday-experience.html`);
    await sleep(1200);
    await panel.click('[data-action="fill"]');
    await panel.waitForFunction(() => !document.querySelector('#fillCard .busy') && !!document.querySelector('#fillCard .summary'), { timeout: 60000 });
    const uploaded = await site.$$eval('#uploaded li', (els) => els.map((e) => e.textContent));
    check('CV joint depuis le serveur', uploaded.length === 1 && /Marie_Tremblay_CV_FR\.pdf/.test(uploaded[0]), uploaded.join(' | '));

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

    // Soumission → journal.
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
