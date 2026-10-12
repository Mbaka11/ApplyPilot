// Tests des scripts de contenu sur des pages qui imitent Workday et un formulaire générique.
//   node tests/content.test.mjs        (Chrome headless, aucun serveur requis)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getConfig } from '../server/src/config.js';
import { launchBrowser } from '../server/src/pdf.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = path.join(ROOT, 'tests', 'fixtures');
const OUT = path.join(ROOT, 'tests', 'output');
const CONTENT = ['../i18n.js', 'dom.js', 'extract.js', 'fields.js', 'widgets.js', 'mapping.js', 'workday.js', 'main.js'].map((f) =>
  path.join(ROOT, 'extension', 'content', f),
);

// Profil fictif (le vrai profil n'est jamais utilisé dans les tests).
const PROFILE = {
  identity: {
    firstName: 'Marie',
    lastName: 'Tremblay',
    email: 'marie@example.com',
    phone: '514-555-0123',
    phoneCountryCode: '+1',
    phoneCountry: 'Canada',
    phoneType: 'Mobile',
    address: { line1: '123 rue Exemple', line2: '', city: 'Montréal', province: 'Québec', provinceCode: 'QC', postalCode: 'H2X 1Y4', country: 'Canada' },
  },
  links: { linkedin: 'https://www.linkedin.com/in/marie', github: 'https://github.com/marie', portfolio: 'https://marie.dev' },
  workAuthorization: { canada: { authorizedToWork: true, needsSponsorship: false }, us: { authorizedToWork: null, needsSponsorship: null } },
  student: { currentlyEnrolled: true, expectedGraduation: '2027-04', creditedInternship: true },
  availability: { term: 'Été 2027', termEn: 'Summer 2027', startDate: '2027-05-03' },
  preferences: { howDidYouHear: 'LinkedIn', howDidYouHearAlternatives: ['Job Board'] },
  standardAnswers: { over18: true, relativesAtCompany: false },
  voluntaryDisclosures: { gender: 'prefer not', disability: 'prefer not' },
  education: [
    { school: 'Université de Montréal', schoolSearch: ['Université de Montréal', 'McGill University'], degree: 'Maîtrise en informatique', degreeEn: "Master's in Computer Science", degreeLevel: ["Master's Degree", 'Maîtrise'], fieldOfStudy: 'Machine Learning', start: '2026-01', end: '2027-04', current: true, gpa: '4.0/4.3' },
    { school: 'Polytechnique Montréal', degree: 'Baccalauréat en génie logiciel', degreeEn: 'Bachelor of Software Engineering', degreeLevel: ["Bachelor's Degree"], fieldOfStudy: 'Software Engineering', start: '2021-09', end: '2025-12', gpa: '3.6/4.0' },
  ],
  experience: [
    { title: 'Data Scientist Intern', company: 'Intact Insurance', companyAliases: ['Intact'], location: 'Montréal, QC', start: '2026-01', end: '2026-05', current: false, description: 'Built RL pricing policies.' },
    { title: 'ML Intern', company: 'Pratt & Whitney Canada', location: 'Longueuil, QC', start: '2025-06', end: '2025-09', current: false, description: 'Predictive maintenance models.' },
  ],
  skills: ['Python', 'PyTorch', 'SQL'],
  languages: [{ language: 'Français', languageEn: 'French', level: 'Natif' }, { language: 'Anglais', languageEn: 'English', level: 'Courant' }, { language: 'Russe', languageEn: 'Russian', level: '' }],
};

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n').toString('base64');
const FILES = {
  cv: { name: 'Marie_Tremblay_CV_EN.pdf', base64: PDF, type: 'application/pdf' },
  letter: { name: 'Marie_Tremblay_Cover_Letter_Nordique_Analytique.pdf', base64: PDF, type: 'application/pdf' },
  transcript: { name: 'Marie_Tremblay_Releve.pdf', base64: PDF, type: 'application/pdf' },
};
const PAYLOAD = {
  profile: PROFILE,
  memory: { items: {} },
  files: FILES,
  letterText: 'Dear Hiring Team,\n\nI am applying…\n\nMarie Tremblay',
  job: { company: 'Nordique Analytique', title: 'ML Intern', language: 'en' },
  options: { addEntries: true, attachLetterWithCv: true },
};

let failures = 0;
function check(name, cond, extra = '') {
  console.log(`${cond ? '  ✓' : '  ✗'} ${name}${extra !== '' ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
}

async function load(page, file) {
  await page.goto(pathToFileURL(path.join(FIX, file)).href);
  for (const f of CONTENT) await page.addScriptTag({ path: f });
}
const run = (page, cmd, payload = {}) => page.evaluate((c, p) => window.__applyPilot.run(c, p), cmd, payload);
const val = (page, sel) => page.$eval(sel, (e) => ('value' in e && e.tagName !== 'BUTTON' ? e.value : e.textContent.trim()));
const pills = (page, field) =>
  page.$$eval(`[data-automation-id="formField-${field}"] [data-automation-id="selectedItem"]`, (els) => els.map((e) => e.textContent.trim()));

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await launchBrowser(getConfig(), { args: ['--allow-file-access-from-files'] });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('    [erreur page]', e.message));
  page.on('console', (m) => m.type() === 'error' && console.log('    [console]', m.text()));
  await page.setViewport({ width: 1200, height: 900 });

  try {
    console.log('Offre (JSON-LD + Workday)');
    await load(page, 'posting.html');
    const { job } = await run(page, 'extractJob');
    check('titre', job.title === 'Stagiaire en apprentissage automatique – Été 2027', job.title);
    check('entreprise (JSON-LD)', job.company === 'Nordique Analytique', job.company);
    check('lieu', /Montréal/.test(job.location), job.location);
    check('description complète', job.description.includes('MLflow') && job.description.length > 200, `${job.description.length} car.`);
    check('langue détectée', job.language === 'fr', job.language);
    check('page d’offre reconnue', job.isPosting === true);
    check('identifiant de poste', job.requisitionId === 'R-10432', job.requisitionId);
    const keys = await page.evaluate(() =>
      [
        'https://nordique.wd3.myworkdayjobs.com/en-US/Careers/details/ML-Intern_R-10432?q=ml',
        'https://nordique.wd3.myworkdayjobs.com/fr-CA/Careers/job/Montreal-QC/ML-Intern_R-10432/apply/applyManually',
        'https://jobs.lever.co/acme/123e4567',
        'https://jobs.lever.co/acme/123e4567/apply',
        'https://boards.greenhouse.io/acme/jobs/4567#app',
        'https://boards.greenhouse.io/acme/jobs/4567',
      ].map((u) => window.ApplyPilot.jobKey(u)),
    );
    check('clé Workday : offre = formulaire', keys[0] === keys[1], keys[0]);
    check('clé Lever : offre = /apply', keys[2] === keys[3], keys[2]);
    check('clé Greenhouse', keys[4] === keys[5], keys[4]);
    const owners = await page.evaluate(() => ['Date Posted:\n2026-10-08\n\nÀ propos de Pratt & Whitney Canada\nPratt & Whitney Canada (P&WC) est un leader', 'About the role\nYou will', "À propos de l'équipe\nNous"].map((d) => window.ApplyPilot.companyFromDescription(d)));
    check('employeur lu dans « À propos de … » (portail de groupe RTX)', owners[0] === 'Pratt & Whitney Canada' && !owners[1] && !owners[2], JSON.stringify(owners));

    console.log('Workday — Connexion');
    await load(page, 'workday-login.html');
    const loginDetect = await run(page, 'detect');
    check('page de connexion reconnue', loginDetect.hasPassword === true);
    await run(page, 'fill', PAYLOAD);
    check('courriel de connexion rempli', (await val(page, '#login-email')) === PROFILE.identity.email);
    check('mot de passe laissé vide', (await val(page, '#login-password')) === '');
    await page.$eval('#login-password', (e) => { e.value = 'chrome-test-fixture'; });
    await run(page, 'fill', PAYLOAD);
    check('mot de passe fourni par Chrome non modifié', (await val(page, '#login-password')) === 'chrome-test-fixture');
    const loginCapture = await run(page, 'capture');
    check('mot de passe jamais mémorisé', !JSON.stringify(loginCapture.items).includes('chrome-test-fixture'));
    check('connexion jamais envoyée', (await page.evaluate(() => window.loginAttempts)) === 0);

    // Comme avec le panneau latéral : la page n'a pas le focus, Chrome n'émet alors aucun focus/blur.
    const front = await browser.newPage();
    await front.setContent('<p>Panneau ApplyPilot (premier plan)</p>');

    console.log('Workday — Mes informations (page en arrière-plan)');
    await load(page, 'workday-myinfo.html');
    await front.bringToFront();
    check('page sans focus, comme pendant un clic dans le panneau', !(await page.evaluate(() => document.hasFocus())));
    const r1 = await run(page, 'fill', PAYLOAD);
    await new Promise((r) => setTimeout(r, 150)); // laisse les champs « contrôlés » se resynchroniser
    check('pays réglé en premier (bloc adresse recréé)', (await page.evaluate(() => window.addressRenderedFor)) === 'Canada');
    check('pays', (await val(page, '[data-automation-id="countryDropdown"]')) === 'Canada');
    check('prénom (champ contrôlé React)', (await val(page, '#name--legalName--firstName')) === 'Marie');
    check('nom', (await val(page, '#name--legalName--lastName')) === 'Tremblay');
    check('adresse', (await val(page, '[data-automation-id="addressSection_addressLine1"]')) === '123 rue Exemple');
    check('ville', (await val(page, '[data-automation-id="addressSection_city"]')) === 'Montréal');
    check('province (Québec → Quebec)', (await val(page, '[data-automation-id="addressSection_countryRegion"]')) === 'Quebec');
    check('code postal', (await val(page, '[data-automation-id="addressSection_postalCode"]')) === 'H2X 1Y4');
    check('courriel', (await val(page, '[data-automation-id="email"]')) === 'marie@example.com');
    check('type de téléphone', (await val(page, '[data-automation-id="phone-device-type"]')) === 'Mobile');
    check('indicatif (prompt)', (await pills(page, 'countryPhoneCode')).join() === 'Canada (+1)', (await pills(page, 'countryPhoneCode')).join());
    check('numéro national (Workday)', (await val(page, '[data-automation-id="phone-number"]')) === '514-555-0123');
    check('poste téléphonique vide', (await val(page, '[data-automation-id="phone-extension"]')) === '');
    check('source « LinkedIn » (prompt)', (await pills(page, 'source')).join() === 'LinkedIn', (await pills(page, 'source')).join());
    check('déjà travaillé ici → Non', await page.$eval('#pw-no', (e) => e.checked));
    check('nom préféré non coché', !(await page.$eval('[data-automation-id="preferredNameCheckbox"]', (e) => e.checked)));
    check('menu de langue (en-tête) ignoré', (await val(page, '[data-automation-id="languagePicker"]')) === 'English');
    const notCommitted = await page.evaluate(() => Mock.missingRequired());
    check('Workday a enregistré chaque champ (sans clic manuel)', notCommitted.length === 0, notCommitted.join(', '));
    const fails1 = r1.results.filter((x) => ['fail', 'unresolved'].includes(x.status));
    check('aucun échec', fails1.length === 0, fails1.map((x) => `${x.label}:${x.status}`).join(', '));
    await page.bringToFront(); // capture impossible en arrière-plan
    await page.screenshot({ path: path.join(OUT, 'workday-myinfo.png'), fullPage: true });
    await front.bringToFront();

    console.log('Workday — Mon expérience');
    await load(page, 'workday-experience.html');
    const r2 = await run(page, 'fill', PAYLOAD);
    await new Promise((r) => setTimeout(r, 150));
    check('blocs ajoutés', r2.info?.addedEntries?.experience === 2 && r2.info?.addedEntries?.education === 2, JSON.stringify(r2.info?.addedEntries));
    check('expérience 1 : titre', (await val(page, '#workExperience-41--jobTitle')) === 'Data Scientist Intern');
    check('expérience 1 : entreprise', (await val(page, '#workExperience-41--companyName')) === 'Intact Insurance');
    check('expérience 2 : lieu', (await val(page, '#workExperience-42--location')) === 'Longueuil, QC');
    const dates = await page.$$eval('[aria-labelledby="we-1"] [data-automation-id^="dateSection"]', (els) => els.map((e) => e.value));
    check('expérience 1 : dates (mois/année)', dates.join(' ') === '01 2026 05 2026', dates.join(' '));
    check('expérience 1 : description', (await val(page, '#workExperience-41--roleDescription')) === 'Built RL pricing policies.');
    const edu = await page.$$eval('[aria-labelledby^="ed-"]', (gs) =>
      gs.map((g) => ({
        school: [...g.querySelectorAll('[data-automation-id="formField-schoolName"] [data-automation-id="selectedItem"]')].map((e) => e.textContent).join(),
        degree: g.querySelector('[data-automation-id="degree"]').textContent.trim(),
        field: [...g.querySelectorAll('[data-automation-id="formField-fieldOfStudy"] [data-automation-id="selectedItem"]')].map((e) => e.textContent).join(),
        gpa: g.querySelector('[data-automation-id="formField-gradeAverage"] input').value,
        years: [...g.querySelectorAll('[data-automation-id="dateSectionYear-input"]')].map((e) => e.value).join('-'),
      })),
    );
    check('formation 1 : école (prompt)', edu[0]?.school === 'Université de Montréal', edu[0]?.school);
    check('formation 1 : diplôme', edu[0]?.degree === "Master's Degree", edu[0]?.degree);
    check('formation 1 : domaine', edu[0]?.field === 'Machine Learning', edu[0]?.field);
    check('formation 1 : moyenne + années', edu[0]?.gpa === '4.0/4.3' && edu[0]?.years === '2026-2027', `${edu[0]?.gpa} ${edu[0]?.years}`);
    check('formation 2 : école + diplôme', edu[1]?.school === 'Polytechnique Montréal' && edu[1]?.degree === "Bachelor's Degree", `${edu[1]?.school} / ${edu[1]?.degree}`);
    const uploaded = await page.$$eval('#uploaded li', (els) => els.map((e) => e.textContent));
    check('CV + lettre joints (champ multiple)', uploaded.length === 2 && uploaded[0].startsWith('Marie_Tremblay_CV') && uploaded[1].includes('Cover_Letter'), uploaded.join(' | '));
    check('LinkedIn', (await val(page, '#socialNetworkAccounts--linkedInAccount')) === 'https://www.linkedin.com/in/marie');
    const skills = await pills(page, 'skills');
    check('compétences ajoutées en pastilles (page en arrière-plan)', skills.length === 3 && skills[0].startsWith('Python') && skills[2].startsWith('SQL'), skills.join(' | '));
    await run(page, 'fill', PAYLOAD);
    const uploaded2 = await page.$$eval('#uploaded li', (els) => els.length);
    const groups2 = await page.$$eval('[role="group"]', (els) => els.length);
    check('2e remplissage : pas de doublon (fichiers, blocs)', uploaded2 === 2 && groups2 === 4, `${uploaded2} fichiers, ${groups2} blocs`);
    console.log('Workday — compétences : vraies cibles de clic, options différées et input recréé');
    await load(page, 'workday-skills.html');
    await front.bringToFront();
    const strictPayload = { ...PAYLOAD, profile: {
      ...PROFILE,
      identity: { ...PROFILE.identity, address: { ...PROFILE.identity.address, city: 'Laval' } },
      experience: [{ ...PROFILE.experience[0], location: 'Montréal' }],
      skills: ['Python', 'PyTorch', 'SQL', 'C++'],
    } };
    const strict = await run(page, 'fill', strictPayload);
    const strictSkills = await page.evaluate(() => skillFixture.selected());
    check('Location professionnel = Montréal, ville personnelle = Laval',
      (await val(page, '#workExperience-1--location')) === 'Montréal' && (await val(page, '#home-city')) === 'Laval');
    const locationModel = await page.evaluate(() => Mock.model);
    check('les deux lieux sont enregistrés au blur sans clic manuel', locationModel['experience-location'] === 'Montréal' && locationModel['home-city'] === 'Laval');
    check('4 compétences persistantes après les clics sur les feuilles, pas les wrappers', strictSkills.length === 4 && strictSkills.includes('C++ (Programming Language)'), strictSkills.join(' | '));
    const skillResults = strict.results.filter((r) => /skills/i.test(r.label));
    check('compétences vérifiées malgré les rerenders et les pastilles repliées', skillResults.length === 1 && skillResults.every((r) => r.status === 'check' && !/confirmer|non sélectionn|non trouv|introuvable/i.test(r.note)), JSON.stringify(skillResults));
    check('aucune option prise dans une autre liste ouverte', (await page.evaluate(() => window.unrelatedClicks)) === 0);
    check('C++ ne correspond pas à C ou C#', (await page.evaluate(() => [ApplyPilot.similarity('C++', 'C'), ApplyPilot.similarity('C++', 'C#')])).every((s) => s < 0.6));
    await page.evaluate(() => { skillFixture.seed(['Git', 'Python (Programming Language)']); skillFixture.resetTouches(); document.getElementById('workExperience-1--location').value = 'Toronto'; });
    await run(page, 'fill', strictPayload);
    const added = await page.evaluate(() => ({ selected: skillFixture.selected(), touched: skillFixture.touched() }));
    check('sélections existantes conservées, compétences manquantes ajoutées sans écraser', added.selected.length === 5 && added.selected.includes('Git') && !added.touched.includes('Python (Programming Language)'), JSON.stringify(added));
    check('lieu déjà corrigé par l’utilisateur conservé', (await val(page, '#workExperience-1--location')) === 'Toronto');
    await run(page, 'fill', strictPayload);
    check('3e remplissage : aucune compétence en double', (await page.evaluate(() => skillFixture.selected())).length === 5);
    const ignored = await page.evaluate(async () => {
      const d = ApplyPilot.scanFields().find((f) => /skills/i.test(f.label));
      return ApplyPilot.fillField(d, { value: ['Python', 'Uncommitted'], multi: true }, ApplyPilot.makeContext({}));
    });
    check('un clic sans pastille reste un échec partiel, jamais une réussite annoncée', ignored.status === 'check' && !/Uncommitted/.test(ignored.value || '') && /Uncommitted/.test(ignored.note || ''), JSON.stringify(ignored));
    await page.evaluate(() => {
      skillFixture.seed([]);
      const announcement = document.createElement('span');
      announcement.setAttribute('data-automation-id', 'promptSelectionLabel');
      announcement.setAttribute('aria-live', 'polite');
      announcement.style.display = 'none';
      announcement.textContent = 'Uncommitted';
      document.getElementById('skills-field').appendChild(announcement);
    });
    const onlyIgnored = await run(page, 'fill', { ...strictPayload, profile: { ...strictPayload.profile, skills: ['Uncommitted'] } });
    const ignoredResult = onlyIgnored.results.find((r) => /skills/i.test(r.label));
    check('aucune sélection persistante : échec explicite, pas de faux texte rempli', ignoredResult?.status === 'fail' && !ignoredResult?.value, JSON.stringify(ignoredResult));
    check('annonce ARIA cachée non confondue avec une pastille', (await page.evaluate(() => ApplyPilot.selectedPromptItems(document.getElementById('skills-field')))).length === 0);
    check('un échec de widget skills ne déclenche pas une invention par l’IA', !onlyIgnored.unresolved.some((f) => /skills/i.test(f.label)));
    check('aucun bouton Suivant ou Soumettre cliqué', (await page.evaluate(() => window.navigationClicks)) === 0);

    console.log('Cancellation — stop pending widgets and reject stale AI answers');
    await load(page, 'workday-skills.html');
    await page.evaluate(() => skillFixture.seed(['Git']));
    const scope = await run(page, 'detect');
    await page.evaluate((payload) => { window.stoppingPromise = __applyPilot.run('fill', payload); }, { ...strictPayload, runId: 'cancel-widget', expectedPage: scope.pageIdentity });
    await page.waitForFunction(() => document.querySelector('#skills-input')?.value?.length > 0, { polling: 50, timeout: 5000 });
    await run(page, 'cancel', { runId: 'cancel-widget' });
    const stopped = await page.evaluate(() => window.stoppingPromise);
    check('cancel interrupts a pending Workday skills search', stopped.cancelled === true);
    check('stopping preserves existing skill pills without selecting later options', (await page.evaluate(() => skillFixture.selected())).join('|') === 'Git');
    const cityId = await page.evaluate(() => ApplyPilot.scanFields().find((f) => f.el.id === 'home-city').id);
    const cityBefore = await val(page, '#home-city');
    const staleCancelled = await run(page, 'fillValues', { ...strictPayload, runId: 'cancel-widget', expectedPage: scope.pageIdentity, answers: { [cityId]: { value: 'Wrong city', confidence: 1 } } });
    check('a late response from a cancelled run can never write a field', staleCancelled.cancelled === true && (await val(page, '#home-city')) === cityBefore);
    await page.$eval('[data-automation-id="progressBarActiveStep"]', (e) => { e.textContent = 'current step 3 of 5 Application Questions'; });
    const staleStep = await run(page, 'fillValues', { ...strictPayload, runId: 'late-old-step', expectedPage: scope.pageIdentity, answers: { [cityId]: { value: 'Wrong city', confidence: 1 } } });
    check('same URL, different Workday step rejects old AI answers', staleStep.cancelled === true && (await val(page, '#home-city')) === cityBefore);
    const nextScope = await run(page, 'detect');
    const resumedFill = await run(page, 'fillValues', { ...strictPayload, runId: 'new-step', expectedPage: nextScope.pageIdentity, answers: { [cityId]: { value: 'Ottawa', confidence: 1 } } });
    check('a new run on the next step is not blocked by an earlier cancellation', !resumedFill.cancelled && (await val(page, '#home-city')) === 'Ottawa');

    console.log('Workday — Langues et sites Web (page en arrière-plan, listes Canvas Kit)');
    await load(page, 'workday-langues.html');
    const r5 = await run(page, 'fill', PAYLOAD);
    await new Promise((r) => setTimeout(r, 150));
    const langs = await page.$$eval('#langSection [role="group"]', (gs) =>
      gs.map((g) => ({
        lang: g.querySelector('button[name="language"]').textContent.trim(),
        levels: [...g.querySelectorAll('button[name^="2f49"]')].map((b) => b.textContent.replace(/\s+/g, ' ').trim()),
        fluent: g.querySelector('input[type="checkbox"]').checked,
      })),
    );
    check('langues : un bloc ajouté par langue avec niveau (Russe sans niveau ignoré)', langs.length === 2, JSON.stringify(langs));
    check('langue 1 : Français, natif → 5 - Maîtrise parfaite', langs[0]?.lang === 'Français' && langs[0].levels.every((l) => l === '5 - Maîtrise parfaite'), JSON.stringify(langs[0]));
    check('langue 2 : Anglais, courant → 4 - Avancé', langs[1]?.lang === 'Anglais' && langs[1].levels.every((l) => l === '4 - Avancé'), JSON.stringify(langs[1]));
    check('« Je parle couramment » coché dans chaque bloc (même name)', langs.every((l) => l.fluent));
    const sites = await page.$$eval('input[id^="webAddress-"]', (els) => els.map((e) => e.value));
    check('sites Web : GitHub puis portfolio, sans doublon LinkedIn', sites.join(' | ') === `${PROFILE.links.github} | ${PROFILE.links.portfolio}`, sites.join(' | '));
    const leaked = await page.$$eval('input', (els) => els.filter((e) => /rue Exemple/.test(e.value)).map((e) => e.id));
    check('« webAddress-15 » ne reçoit pas l’adresse postale', leaked.length === 0, leaked.join(', '));
    check('LinkedIn (champ dédié)', (await val(page, '#socialNetworkAccounts--linkedInAccount')) === PROFILE.links.linkedin);
    check('graduation « mois et année » → MM/AAAA', (await val(page, '#primaryQuestionnaire--grad')) === '04/2027', await val(page, '#primaryQuestionnaire--grad'));
    const cote = r5.unresolved.find((u) => /cote de securite|Cote de sécurité/i.test(u.label));
    check('liste inconnue sondée pour l’IA', JSON.stringify(cote?.options) === '["Aucune","Fiabilité","Secret"]', JSON.stringify(cote?.options));
    check('aucune liste laissée ouverte (focus émulé)', (await page.$$eval('.cks', (els) => els.length)) === 0);
    const ids = await page.evaluate(() => {
      // Réinjection après mise à jour : un ancien identifiant se retrouve en double.
      const els = [...document.querySelectorAll('[data-applypilot-id]')];
      els[1].setAttribute('data-applypilot-id', els[0].getAttribute('data-applypilot-id'));
      const f = window.ApplyPilot.scanFields();
      return { n: f.length, unique: new Set(f.map((d) => d.id)).size };
    });
    check('identifiants en double réattribués', ids.n === ids.unique, JSON.stringify(ids));
    check('stage crédité (profil : oui) → Oui', (await val(page, '#primaryQuestionnaire--credit')) === 'Oui', await val(page, '#primaryQuestionnaire--credit'));
    const tfiles = await page.$$eval('#transcriptFiles li', (els) => els.map((e) => e.textContent));
    check('relevé configuré joint au champ « relevé de notes » (et rien d’autre)', tfiles.join() === FILES.transcript.name, tfiles.join());

    await page.bringToFront();
    await page.screenshot({ path: path.join(OUT, 'workday-langues.png'), fullPage: true });

    console.log('Workday — Questions');
    await load(page, 'workday-questions.html');
    const r3 = await run(page, 'fill', PAYLOAD);
    const q = async (id) => val(page, `[data-automation-id="${id}"]`);
    check('autorisé à travailler → Yes', (await q('q1')) === 'Yes');
    check('parrainage → No', (await q('q2')) === 'No');
    check('étudiant inscrit → Yes', (await q('q3')) === 'Yes');
    check('session de stage (EN)', (await q('q4')) === 'Summer 2027', await q('q4'));
    const grad = await page.$$eval('[data-automation-id="formField-q7"] input', (els) => els.map((e) => e.value).join('/'));
    check('date de diplomation', grad === '04/2027', grad);
    check('genre → je ne souhaite pas répondre', (await q('gender')) === 'I do not wish to answer');
    check('conditions NON cochées', !(await page.$eval('[data-automation-id="agreementCheckbox"]', (e) => e.checked)));
    check('conditions signalées à vérifier', r3.results.some((x) => /Terms/.test(x.label) && x.status === 'check'));
    const un = r3.unresolved;
    const lic = un.find((u) => /driver/i.test(u.label));
    const why = un.find((u) => /interested/i.test(u.label));
    check('questions inconnues envoyées à l’IA', !!lic && !!why, un.map((u) => u.label).join(' | '));
    check('options lues pour l’IA', JSON.stringify(lic?.options) === '["Yes","No"]', JSON.stringify(lic?.options));
    const r3b = await run(page, 'fillValues', { ...PAYLOAD, answers: { [lic.id]: { value: 'Yes', confidence: 0.6, note: 'test' }, [why.id]: { value: 'Because I love data.', confidence: 0.8 } } });
    check('réponses IA appliquées', (await q('q5')) === 'Yes' && (await val(page, '[data-automation-id="formField-q6"] textarea')) === 'Because I love data.');
    check('réponses IA marquées « à vérifier »', r3b.results.every((x) => x.status === 'check'));
    const cap = await run(page, 'capture');
    check('mémoire : seule la nouvelle question est retenue', cap.items.length === 1 && /driver/i.test(cap.items[0].label) && cap.items[0].value === 'Yes', JSON.stringify(cap.items));
    await page.screenshot({ path: path.join(OUT, 'workday-questions.png'), fullPage: true });

    console.log('Formulaire générique (type Greenhouse)');
    await load(page, 'generic-form.html');
    const r4 = await run(page, 'fill', { ...PAYLOAD, options: { ...PAYLOAD.options } });
    check('prénom / nom / courriel', (await val(page, '#first_name')) === 'Marie' && (await val(page, '#last_name')) === 'Tremblay' && (await val(page, '#email')) === 'marie@example.com');
    check('téléphone international', (await val(page, '#phone')) === '+1 514-555-0123', await val(page, '#phone'));
    check('CV dans « Resume »', (await page.$eval('#resume', (e) => e.files[0]?.name)) === FILES.cv.name);
    check('lettre dans « Cover Letter »', (await page.$eval('#cover', (e) => e.files[0]?.name)) === FILES.letter.name);
    check('LinkedIn + site web', (await val(page, '#linkedin')) === PROFILE.links.linkedin && (await val(page, '#website')) === PROFILE.links.portfolio);
    check('select « source »', (await page.$eval('#hear', (e) => e.selectedOptions[0].text)) === 'LinkedIn');
    check('radio autorisation → Yes', await page.$eval('input[name="auth"][value="1"]', (e) => e.checked));
    check('proches dans l’entreprise → No', (await page.$eval('#relatives', (e) => e.selectedOptions[0].text)) === 'No');
    check('combobox école', (await page.evaluate(() => window.schoolPicked)) === 'Université de Montréal', await page.evaluate(() => window.schoolPicked));
    check('texte de la lettre collé', (await val(page, '#cl_text')).startsWith('Dear Hiring Team'));
    check('genre → Decline to self-identify', (await page.$eval('#gender', (e) => e.selectedOptions[0].text)) === 'Decline to self-identify');
    check('pot de miel ignoré', (await val(page, '#hp')) === '');
    check('CAPTCHA ignoré', (await page.$eval('[name="g-recaptcha-response"]', (e) => e.value)) === '');
    check('politique de confidentialité non cochée', !(await page.$eval('#privacy', (e) => e.checked)));
    check('« Pourquoi nous ? » laissé à l’IA', r4.unresolved.some((u) => /Why do you want/.test(u.label)));
    check('formulaire jamais soumis', !(await page.evaluate(() => window.submitted)));
    await page.screenshot({ path: path.join(OUT, 'generic-form.png'), fullPage: true });
  } finally {
    await browser.close();
  }
  console.log(failures ? `\n${failures} échec(s)` : '\nTout est OK');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
