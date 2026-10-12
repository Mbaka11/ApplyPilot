// Test de bout en bout du serveur local (port et dossier de données isolés).
//   node tests/server.test.mjs              → tests sans IA
//   APPLYPILOT_TEST_LLM=1 node tests/...    → + vraie génération de lettre / réponses via pi
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { applicationUrl, existingApplicationTab } from '../extension/sidepanel/navigation.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4399;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = path.join(ROOT, 'tests', 'output', 'server');
const DATA = path.join(OUT, 'data');
const TEST_PROFILE = path.join(OUT, 'profile.yaml');
const TEST_CONFIG = path.join(OUT, 'config.yaml');
const WITH_LLM = !!process.env.APPLYPILOT_TEST_LLM;
const EXT_ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';

export const SAMPLE_JOB = {
  url: 'https://nordique.wd3.myworkdayjobs.com/fr-CA/Carrieres/job/Montreal-QC/Stagiaire-en-apprentissage-automatique---Ete-2027_R-10432/apply',
  jobKey: 'nordique.wd3.myworkdayjobs.com/stagiaire-en-apprentissage-automatique---ete-2027_r-10432',
  platform: 'workday',
  title: 'Stagiaire en apprentissage automatique – Été 2027',
  company: 'Nordique Analytique',
  location: 'Montréal, QC',
  language: 'fr',
  description: `Nordique Analytique aide les assureurs et les banques canadiennes à mieux évaluer le risque grâce aux données.
Notre équipe Science des données recherche un ou une stagiaire pour l'été 2027 (16 semaines, temps plein, mode hybride à Montréal).

Ce que vous ferez :
- Concevoir et entraîner des modèles d'apprentissage automatique pour la tarification et la détection d'anomalies.
- Industrialiser les modèles avec MLflow et Databricks, en collaboration avec l'équipe MLOps.
- Explorer des approches d'apprentissage par renforcement pour l'optimisation de décisions séquentielles.
- Présenter vos résultats aux équipes d'affaires.

Ce que nous recherchons :
- Étudiant(e) aux cycles supérieurs en informatique, génie logiciel, statistiques ou domaine connexe.
- Maîtrise de Python et de PyTorch ou scikit-learn ; SQL.
- Expérience en mise en production de modèles (atout).
- Bilinguisme français-anglais.`,
};

// Lettre fictive (aucune donnée réelle) pour tester le rendu PDF.
const SAMPLE_BODY = `Madame, Monsieur,

Actuellement étudiante à la maîtrise en informatique, je souhaite poser ma candidature au poste de stagiaire en apprentissage automatique au sein de l’équipe Science des données de Nordique Analytique.

Lors de mon dernier stage dans une compagnie d’assurance, j’ai conçu des modèles de tarification et automatisé leur validation par simulation. J’ai aussi développé des modèles de maintenance prédictive, avec un suivi rigoureux des expériences dans MLflow.

Votre volonté d’industrialiser les modèles avec MLflow et Databricks rejoint directement mon expérience : j’aime transformer des prototypes en pipelines fiables et reproductibles.

Je vous remercie de l’attention portée à ma candidature et serais ravie d’échanger avec vous lors d’un entretien.

Veuillez agréer, Madame, Monsieur, mes salutations distinguées.`;

let failures = 0;
function check(name, cond, extra = '') {
  console.log(`${cond ? '  ✓' : '  ✗'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
}

async function api(method, p, body, headers = {}) {
  const res = await fetch(BASE + p, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
  return { status: res.status, headers: res.headers, data };
}

function pdfPages(buf) {
  const m = buf.toString('latin1').match(/\/Type\s*\/Page(?![a-zA-Z])/g);
  return m ? m.length : null;
}

function prepareFixtures() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'cvs'), { recursive: true });
  // Pièce jointe factice : aucun CV réel n'est lu, même pour les tests IA.
  fs.writeFileSync(path.join(OUT, 'cvs', 'Marie_Tremblay_CV_FR.pdf'), `%PDF-1.4\n${'% test fixture\n'.repeat(120)}%%EOF\n`);
  fs.writeFileSync(path.join(OUT, 'cvs', 'Marie_Tremblay_CV_FR.tex'), '\\begin{document}\nMarie Tremblay — étudiante en informatique, Python, SQL, MLflow et Databricks. Expérience en modèles prédictifs chez Exemple Inc.\n\\end{document}\n');
  fs.writeFileSync(TEST_CONFIG, `cvDir: ${JSON.stringify(path.join(OUT, 'cvs').replace(/\\/g, '/'))}\nstyleDir: ${JSON.stringify(path.join(OUT, 'style').replace(/\\/g, '/'))}\n`);
  fs.writeFileSync(TEST_PROFILE, `# Profil fictif : commentaire à conserver.
identity:
  firstName: Marie
  lastName: Tremblay
  email: marie@example.com
  phone: "514-555-0123"
  address: { line1: "", city: Montréal, province: Québec, provinceCode: QC, postalCode: "", country: Canada }
workAuthorization: { canada: { authorizedToWork: null, needsSponsorship: null } }
student: { currentlyEnrolled: true, expectedGraduation: "2028-01" }
availability: { term: Été 2027, termEn: Summer 2027, startDate: "2027-05-03", endDate: "2027-08-31" }
voluntaryDisclosures: { gender: prefer not }
education: [{ school: Université Exemple, degree: Maîtrise en informatique, start: "2026-01", end: "2028-01", current: true, gpa: "4.0/4.3" }]
experience: [{ title: Stagiaire ML, company: Exemple Inc., start: "2025-05", end: "2025-08" }]
skills: [Python, SQL, MLflow, Databricks]
languages: [{ language: Français, languageEn: French, level: "" }, { language: Anglais, languageEn: English, level: "" }]
customKeepMe: { note: ne pas écraser }
letter: { signatureName: Marie Tremblay }
`);
}

async function main() {
  prepareFixtures();
  const srv = spawn(process.execPath, ['server/src/index.js'], {
    cwd: ROOT,
    env: { ...process.env, APPLYPILOT_PORT: String(PORT), APPLYPILOT_DATA_DIR: DATA, APPLYPILOT_PROFILE: TEST_PROFILE, APPLYPILOT_CONFIG: TEST_CONFIG, APPLYPILOT_CV_DIR: path.join(OUT, 'cvs') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  srv.stdout.on('data', (d) => (logs += d));
  srv.stderr.on('data', (d) => (logs += d));

  try {
    let up = false;
    for (let i = 0; i < 50 && !up; i++) {
      await new Promise((r) => setTimeout(r, 200));
      up = await fetch(`${BASE}/health`).then((r) => r.ok, () => false);
    }
    if (!up) throw new Error(`Le serveur ne démarre pas :\n${logs}`);

    console.log('Serveur');
    const h = await api('GET', '/health');
    check('GET /health', h.status === 200 && h.data.ok, `pi=${h.data.pi} chrome=${!!h.data.chrome}`);

    const evil = await api('GET', '/profile', undefined, { origin: 'https://evil.example.com' });
    check('origine d’un site web refusée', evil.status === 403);
    const ext = await api('GET', '/profile', undefined, { origin: EXT_ORIGIN });
    check('origine extension acceptée + CORS', ext.status === 200 && ext.headers.get('access-control-allow-origin') === EXT_ORIGIN);
    const rebinding = await new Promise((resolve) => {
      const req = http.request({ host: '127.0.0.1', port: PORT, path: '/health', headers: { host: 'evil.example.com' } }, (res) => {
        res.resume();
        resolve(res.statusCode);
      });
      req.on('error', () => resolve(0));
      req.end();
    });
    check('en-tête Host étranger refusé', rebinding === 403);

    console.log('Éditeur du profil (données fictives isolées)');
    const firstProfile = await api('GET', '/profile');
    check('schéma et révision fournis', firstProfile.data.fields?.some((f) => f.path === 'identity.address.line1') && /^[a-f0-9]{64}$/.test(firstProfile.data.revision));
    const before = fs.readFileSync(TEST_PROFILE, 'utf8');
    const savedProfile = await api('PUT', '/profile', { revision: firstProfile.data.revision, values: {
      'identity.address.line1': '456 rue Démonstration', 'identity.address.city': 'Québec', 'identity.address.postalCode': 'g1a 1a1',
      'workAuthorization.canada.needsSponsorship': false,
    } }, { origin: EXT_ORIGIN });
    check('adresse sauvegardée et normalisée', savedProfile.status === 200 && savedProfile.data.profile?.identity.address.postalCode === 'G1A 1A1');
    check('false conservé, non interprété comme inconnu', savedProfile.data.profile?.workAuthorization.canada.needsSponsorship === false);
    check('autres informations préservées', savedProfile.data.profile?.education?.[0].school === 'Université Exemple' && savedProfile.data.profile?.customKeepMe.note === 'ne pas écraser');
    check('commentaires YAML préservés', fs.readFileSync(TEST_PROFILE, 'utf8').includes('# Profil fictif : commentaire à conserver.'));
    const backups = path.join(DATA, 'backups', 'profile');
    check('sauvegarde privée avant modification', fs.readdirSync(backups).some((f) => fs.readFileSync(path.join(backups, f), 'utf8') === before));
    const revision = savedProfile.data.revision;
    const snapshot = fs.readFileSync(TEST_PROFILE, 'utf8');
    for (const [name, values] of [
      ['champ inconnu / mot de passe refusé', { 'identity.password': 'do-not-store' }],
      ['pollution de prototype refusée', { '__proto__.polluted': true }],
      ['courriel invalide refusé', { 'identity.email': 'not-an-email' }],
      ['booléen chaîne refusé', { 'availability.fullTime': 'false' }],
      ['date impossible refusée', { 'availability.startDate': '2027-02-30' }],
      ['fin avant début refusée', { 'availability.endDate': '2027-01-01' }],
      ['URL javascript refusée', { 'links.portfolio': 'javascript:alert(1)' }],
      ['durée invalide refusée', { 'availability.durationMonths': -1 }],
    ]) {
      const bad = await api('PUT', '/profile', { revision, values });
      check(name, bad.status === 400 && fs.readFileSync(TEST_PROFILE, 'utf8') === snapshot);
    }
    const deniedWrite = await api('PUT', '/profile', { revision, values: { 'identity.firstName': 'Intrus' } }, { origin: 'https://evil.example.com' });
    check('écriture depuis un site refusée', deniedWrite.status === 403 && fs.readFileSync(TEST_PROFILE, 'utf8') === snapshot);
    fs.appendFileSync(TEST_PROFILE, '\n# Modification externe à ne pas écraser.\n');
    const external = fs.readFileSync(TEST_PROFILE, 'utf8');
    const stale = await api('PUT', '/profile', { revision, values: { 'identity.firstName': 'Ancienne saisie' } });
    check('modification concurrente protégée (409)', stale.status === 409 && fs.readFileSync(TEST_PROFILE, 'utf8') === external);
    check('pas de fichier temporaire résiduel', !fs.readdirSync(OUT).some((f) => f.endsWith('.tmp')));
    check('pas de pollution de prototype', Object.prototype.polluted === undefined);

    console.log('Profil : stage crédité, langues, relevé de notes');
    const p2 = await api('GET', '/profile');
    const paths = new Set((p2.data.fields || []).map((f) => f.path));
    check('nouveaux champs proposés', ['student.creditedInternship', 'documents.transcript', 'languages.0.level', 'languages.1.level'].every((k) => paths.has(k)));
    const rev2 = p2.data.revision;
    const snap2 = fs.readFileSync(TEST_PROFILE, 'utf8');
    for (const [name, v] of [['chemin relatif refusé', 'releve.pdf'], ['fichier absent refusé', path.join(OUT, 'absent.pdf')], ['autre format refusé', TEST_CONFIG]]) {
      const bad = await api('PUT', '/profile', { revision: rev2, values: { 'documents.transcript': v } });
      check(`relevé : ${name}`, bad.status === 400 && fs.readFileSync(TEST_PROFILE, 'utf8') === snap2, bad.data.error);
    }
    const transcriptFile = path.join(OUT, 'Marie_Tremblay_Releve.pdf');
    fs.writeFileSync(transcriptFile, `%PDF-1.4\n${'% releve fictif\n'.repeat(80)}%%EOF\n`);
    const p3 = await api('PUT', '/profile', { revision: rev2, values: {
      'documents.transcript': `"${transcriptFile}"`, // collé avec guillemets depuis l'Explorateur
      'student.creditedInternship': true,
      'languages.1.level': 'courant',
    } });
    check('relevé, stage crédité et niveau enregistrés', p3.status === 200 && p3.data.profile?.documents?.transcript === transcriptFile && p3.data.profile?.student?.creditedInternship === true, p3.data.error);
    check('niveau de la bonne langue seulement', p3.data.profile?.languages?.[1]?.level === 'courant' && p3.data.profile?.languages?.[0]?.level === '' && p3.data.profile?.languages?.[1]?.languageEn === 'English');
    const h2 = await api('GET', '/health');
    check('relevé signalé au panneau', h2.data.documents?.transcript === true);
    const tr = await api('GET', '/documents/transcript?base64=1');
    check('relevé servi en base64', tr.status === 200 && tr.data.name === 'Marie_Tremblay_Releve.pdf' && tr.data.base64?.length > 100);

    console.log('Exigences repérées dans l’offre');
    const reqJob = {
      ...SAMPLE_JOB,
      url: 'https://exemple.wd3.myworkdayjobs.com/fr-CA/Carrieres/job/Montreal/Stagiaire-IA-Hiver-2027_R-777',
      jobKey: 'exemple.wd3.myworkdayjobs.com/stagiaire-ia-hiver-2027_r-777',
      title: 'Stagiaire IA – Hiver 2027',
      description: `Le poste s’effectue exclusivement en présentiel, du lundi au vendredi.
Ce que nous recherchons : être inscrit dans une université canadienne ; avoir une moyenne cumulative d’au moins 3,50.
Must complete a university-credited internship during the Winter 2027 semester.
Applicants must submit a cover letter, résumé, and transcript as part of their application.
Bilinguisme (français et anglais) requis.
Le candidat devra réussir une vérification des antécédents judiciaires et des marchandises contrôlées.
The typical hiring range for this position is $27,50 to $30,50 CAD per hour.
Posting End Date 2026-10-14`,
    };
    const rq = await api('POST', '/applications', { job: reqJob });
    const R = Object.fromEntries((rq.data.requirements || []).map((r) => [r.id, r]));
    check('relevé exigé → déjà configuré', R.transcript?.status === 'ok', JSON.stringify(R.transcript));
    check('stage crédité → profil : oui', R.credit?.status === 'ok');
    check('GPA minimum 3,50 comparé (4.0/4.3)', R.gpa?.status === 'ok' && /3,50/.test(R.gpa.label), JSON.stringify(R.gpa));
    check('lettre, bilinguisme, présentiel, vérifications', ['letter', 'french', 'onsite', 'checks'].every((k) => R[k]), Object.keys(R).join(','));
    check('rémunération et date limite', /27,50/.test(R.pay?.note || '') && /2026-10-14/.test(R.deadline?.label || ''), `${R.pay?.note} | ${R.deadline?.label}`);
    check('extrait source fourni', /transcript/i.test(R.transcript?.excerpt || ''));
    const rqGet = await api('GET', `/applications/${rq.data.application.id}`);
    check('exigences renvoyées à la reprise', rqGet.data.requirements?.length === rq.data.requirements.length);
    await api('DELETE', `/applications/${rq.data.application.id}`);

    console.log('Navigation et session Workday');
    const offer = 'https://example.wd3.myworkdayjobs.com/en-US/Careers/job/City/ML-Intern_R-123';
    check('lien direct candidature Workday', applicationUrl(offer) === `${offer}/apply`);
    check('pas de double /apply', applicationUrl(`${offer}/apply`) === `${offer}/apply`);
    const draftTabs = [{ id: 3, url: `${offer}/apply/applyManually` }, { id: 4, url: 'https://another.wd3.myworkdayjobs.com/Careers/job/City/ML-Intern_R-123/apply' }];
    check('formulaire existant retrouvé sans rechargement', existingApplicationTab(offer, draftTabs)?.id === 3);
    check('offre ouverte n’est pas confondue avec un formulaire', !existingApplicationTab(offer, [{ id: 5, url: offer }]));
    let refusedUrl = false;
    try { applicationUrl('javascript:alert(1)'); } catch { refusedUrl = true; }
    check('navigation dangereuse refusée', refusedUrl);

    const cvs = await api('GET', '/cvs');
    check('GET /cvs', cvs.status === 200 && Array.isArray(cvs.data.cvs), `${cvs.data.cvs?.length} CV`);
    const cvId = cvs.data.cvs?.[0]?.id;
    if (cvId) {
      const pdf = await api('GET', `/cvs/${encodeURIComponent(cvId)}/pdf?base64=1`);
      check('CV en base64', pdf.status === 200 && pdf.data.base64?.length > 1000, pdf.data.name);
      check('nom de CV neutre à l’envoi (pas celui de la variante)', pdf.data.name === 'Marie_Tremblay_CV.pdf', pdf.data.name);
    }

    console.log('Candidature');
    const created = await api('POST', '/applications', { job: SAMPLE_JOB });
    const app = created.data.application;
    check('création', created.status === 200 && !!app?.id, `${app?.id} · CV recommandé : ${created.data.recommendation?.cvId}`);
    const again = await api('POST', '/applications', { job: SAMPLE_JOB });
    check('dédoublonnage par offre', again.data.existed === true && again.data.application.id === app.id);

    const put = await api('PUT', `/applications/${app.id}/letter`, {
      language: 'fr',
      subject: 'Candidature – Stagiaire en apprentissage automatique – Été 2027',
      body: SAMPLE_BODY,
      recipient: 'Équipe d’acquisition de talents',
      company: 'Nordique Analytique',
    });
    check('rendu PDF de la lettre', put.status === 200 && !!put.data.letter?.fileName, put.data.letter?.fileName || put.data.error);
    const pdfFile = path.join(DATA, 'applications', app.id, put.data.letter?.fileName || 'x');
    const buf = fs.existsSync(pdfFile) ? fs.readFileSync(pdfFile) : Buffer.alloc(0);
    check('fichier PDF valide', buf.subarray(0, 5).toString() === '%PDF-', `${buf.length} octets`);
    const pages = pdfPages(buf);
    check('lettre sur une page', pages === null || pages === 1, `pages=${pages ?? '?'} · police ${put.data.letter?.fit?.fontSizePt}pt`);
    fs.copyFileSync(pdfFile, path.join(ROOT, 'tests', 'output', 'lettre-test.pdf'));

    const b64 = await api('GET', `/applications/${app.id}/letter.pdf?base64=1`);
    check('lettre en base64', b64.status === 200 && b64.data.base64?.length > 1000);

    const patch = await api('PATCH', `/applications/${app.id}`, { status: 'soumise' });
    check('statut « soumise »', patch.data.application?.status === 'soumise' && !!patch.data.application?.submittedAt);
    const csv = await api('GET', '/journal.csv');
    check('journal CSV', csv.status === 200 && csv.data.toString('utf8').includes('Nordique Analytique'));

    const mem = await api('POST', '/memory', {
      items: [{ label: 'How did you hear about us?*', value: 'LinkedIn', kind: 'prompt' }],
      company: 'Nordique Analytique',
    });
    const memGet = await api('GET', '/memory');
    check('mémoire des réponses', mem.data.added === 1 && !!memGet.data.items['how did you hear about us']);

    if (WITH_LLM) {
      console.log('IA (pi) — peut prendre 1 à 2 minutes');
      const t0 = Date.now();
      const gen = await api('POST', `/applications/${app.id}/letter`, { language: 'auto' });
      const L = gen.data.letter;
      check('lettre générée par pi', gen.status === 200 && L?.body?.length > 500, gen.data.error || `${Math.round((Date.now() - t0) / 1000)} s, ${L?.body?.split(/\s+/).length} mots, langue ${L?.language}`);
      if (L) {
        fs.writeFileSync(path.join(ROOT, 'tests', 'output', 'lettre-ia.txt'), `${L.subject}\n\n${L.body}\n\nAvertissements : ${L.warnings.join(' | ')}`, 'utf8');
        const f = path.join(DATA, 'applications', app.id, L.fileName);
        if (fs.existsSync(f)) fs.copyFileSync(f, path.join(ROOT, 'tests', 'output', 'lettre-ia.pdf'));
        check('lettre IA sur une page', pdfPages(fs.readFileSync(f)) <= 1, `police ${L.fit?.fontSizePt}pt`);
      }
      const ans = await api('POST', '/answers', {
        applicationId: app.id,
        fields: [
          { id: 'q1', label: 'Are you legally authorized to work in Canada?', kind: 'dropdown', required: true, options: ['Yes', 'No'] },
          { id: 'q2', label: 'Why are you interested in this internship at Nordique Analytique?', kind: 'textarea', required: true },
          { id: 'q3', label: 'Gender', kind: 'dropdown', options: ['Male', 'Female', 'Non-binary', 'I do not wish to answer'] },
          { id: 'q4', label: 'Quel est votre niveau en anglais ?', kind: 'select', options: ['Débutant', 'Intermédiaire', 'Avancé', 'Bilingue'] },
        ],
      });
      const A = ans.data.answers || {};
      check('réponses IA', ans.status === 200 && Object.keys(A).length >= 3, ans.data.error || `${Math.round(ans.data.ms / 1000)} s`);
      check('pas d’invention (autorisation de travail inconnue → null)', A.q1 && A.q1.value === null, JSON.stringify(A.q1));
      check('déclaration volontaire → « ne souhaite pas répondre »', A.q3?.value === 'I do not wish to answer', JSON.stringify(A.q3?.value));
      check('question ouverte rédigée', typeof A.q2?.value === 'string' && A.q2.value.length > 80);
      fs.writeFileSync(path.join(ROOT, 'tests', 'output', 'reponses-ia.json'), JSON.stringify(A, null, 2), 'utf8');
    } else {
      console.log('(IA non testée — lance avec APPLYPILOT_TEST_LLM=1 pour tester pi)');
    }
  } finally {
    srv.kill();
  }
  console.log(failures ? `\n${failures} échec(s)` : '\nTout est OK');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
