// HTTP-level test of per-posting CV tailoring: fake model, fake LaTeX, isolated data. No provider, no real CV.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4396;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = path.join(ROOT, 'tests', 'output', 'cv-tailor-server');
const DATA = path.join(OUT, 'data');
const CVS = path.join(OUT, 'cvs');
const MARKERS = path.join(OUT, 'fake-pi');
const SAMPLE = fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'cv-tailor-sample.tex'), 'utf8');
const GOOD_ABOUT = 'I like turning machine learning into tools people actually use, especially models that must run reliably on real data. I learn by building, and I enjoy working with business teams. I am looking for an internship where I can own a problem end to end.';
const proposal = (about = GOOD_ABOUT) => ({ about, skills: [{ label: 'Programming', items: ['SQL', 'Python', 'C++', 'Java', 'Bash', 'R'] }], keywords: ['MLflow'], warnings: ['Check the wording.'] });
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const JOB = {
  url: 'https://example.invalid/jobs/ml-intern', jobKey: 'example-ml-intern', platform: 'workday', title: 'Machine Learning Intern',
  company: 'Nordic Analytics', location: 'Montreal', language: 'en',
  description: 'Build and deploy machine learning models with Python, PyTorch and MLflow. Work with business teams. '.repeat(3),
};

let failures = 0;
const check = (name, cond, extra = '') => { console.log(`${cond ? '  ✓' : '  ✗'} ${name}${extra ? ` — ${extra}` : ''}`); if (!cond) failures++; };
async function api(method, p, body) {
  const res = await fetch(BASE + p, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const type = res.headers.get('content-type') || '';
  return { status: res.status, data: type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(CVS, { recursive: true });
const texFile = path.join(CVS, 'Sample_CV_EN', 'main.tex');
fs.mkdirSync(path.dirname(texFile), { recursive: true });
fs.writeFileSync(texFile, SAMPLE);
fs.writeFileSync(path.join(CVS, 'Sample_CV_EN.pdf'), `%PDF-1.4\n${'% fixture\n'.repeat(100)}%%EOF\n`);
const config = path.join(OUT, 'config.yaml');
const profile = path.join(OUT, 'profile.yaml');
fs.writeFileSync(profile, 'identity:\n  firstName: Alex\n  lastName: Exemple\n');
fs.writeFileSync(config, [
  `cvDir: ${JSON.stringify(CVS.replace(/\\/g, '/'))}`,
  `llm:\n  model: fixture/requested\n  command: ${JSON.stringify(path.join(ROOT, 'tests/fixtures/fake-pi.mjs').replace(/\\/g, '/'))}`,
  `cvTailor:\n  pdflatex: ${JSON.stringify(path.join(ROOT, 'tests/fixtures/fake-pdflatex.mjs').replace(/\\/g, '/'))}`,
].join('\n'));

const server = spawn(process.execPath, ['server/src/index.js'], {
  cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, APPLYPILOT_PORT: String(PORT), APPLYPILOT_DATA_DIR: DATA, APPLYPILOT_PROFILE: profile, APPLYPILOT_CONFIG: config, APPLYPILOT_FAKE_PI_DIR: MARKERS },
});
let logs = '';
server.stdout.on('data', (d) => (logs += d));
server.stderr.on('data', (d) => (logs += d));
const markers = () => new Set(fs.existsSync(MARKERS) ? fs.readdirSync(MARKERS).filter((n) => /^\d+\.json$/.test(n)) : []);

try {
  let up = false;
  for (let i = 0; i < 50 && !up; i++) { await sleep(200); up = await fetch(`${BASE}/health`).then((r) => r.ok, () => false); }
  if (!up) throw new Error(`Server did not start:\n${logs}`);
  console.log('CV tailoring (HTTP)');

  const health = (await api('GET', '/health')).data;
  check('health advertises tailoring and LaTeX availability', health.features.cvTailoring === 1 && health.cvTailor.latexAvailable === true);

  const app = (await api('POST', '/applications', { job: JOB, cvId: 'Sample_CV_EN' })).data.application;
  const original = sha(texFile);
  const propose = (p) => fs.writeFileSync(MARKERS + '-tailor.json', JSON.stringify(p));

  check('unknown request keys are rejected before any model call', (await api('POST', `/applications/${app.id}/cv/tailor`, { cvId: 'Sample_CV_EN', path: 'C:/x' })).status === 400 && markers().size === 0);

  propose(proposal());
  const first = await api('POST', `/applications/${app.id}/cv/tailor`, {});
  const report = first.data.tailoredCv;
  check('tailoring succeeds with a one-page copy and a report', first.status === 200 && report.pages === 1 && report.about.after === GOOD_ABOUT && report.baseCvId === 'Sample_CV_EN', JSON.stringify(first.data).slice(0, 160));
  check('the model call is attributed and its warnings are kept', report.generation?.provider === 'fixture' && report.warnings.includes('Check the wording.'));
  check('the original CV source is untouched', sha(texFile) === original);
  const dir = path.join(DATA, 'applications', app.id, 'cv-tailored');
  check('copy, source and report are written beside the application', ['CV.pdf', 'main.tex', 'report.json'].every((n) => fs.existsSync(path.join(dir, n))) && fs.readFileSync(path.join(dir, 'main.tex'), 'utf8').includes(GOOD_ABOUT));
  check('the application records the tailored copy without changing its status', first.data.application.cvTailored.pages === 1 && first.data.application.status === 'en cours');
  const pdf = await api('GET', `/applications/${app.id}/cv-tailored.pdf`);
  check('the PDF is served', pdf.status === 200 && pdf.data.toString('latin1').startsWith('%PDF-'));
  const b64 = (await api('GET', `/applications/${app.id}/cv-tailored.pdf?base64=1`)).data;
  check('the upload payload is a neutral PDF', b64.type === 'application/pdf' && /_CV\.pdf$|^CV\.pdf$/.test(b64.name) && Buffer.from(b64.base64, 'base64').toString('latin1').startsWith('%PDF-'), b64.name);
  const fresh = (await api('GET', `/applications/${app.id}/cv-tailored`)).data.tailoredCv;
  check('a fresh copy is not stale', !fresh.stale.baseChanged && !fresh.stale.jobChanged && !fresh.stale.cvChanged);

  check('invalid opt-in bodies are rejected', (await api('PUT', `/applications/${app.id}/cv-tailored/use`, { use: 'yes' })).status === 400 && (await api('PUT', `/applications/${app.id}/cv-tailored/use`, { use: true, path: 'x' })).status === 400);
  const optIn = await api('PUT', `/applications/${app.id}/cv-tailored/use`, { use: true });
  check('the user can opt in to the current copy for forms', optIn.status === 200 && optIn.data.application.cvTailored.useForForms === true);
  const before = fs.readFileSync(path.join(dir, 'report.json'), 'utf8');
  propose(proposal(`${GOOD_ABOUT} Led 12 engineers with Kubernetes.`));
  const refused = await api('POST', `/applications/${app.id}/cv/tailor`, {});
  check('an invented claim is refused and the previous copy survives', refused.status === 422 && /Adaptation refusée/.test(refused.data.error) && fs.readFileSync(path.join(dir, 'report.json'), 'utf8') === before);

  fs.writeFileSync(texFile, `${SAMPLE}% edited\n`);
  const stale = (await api('GET', `/applications/${app.id}/cv-tailored`)).data.tailoredCv.stale;
  check('editing the source CV marks the copy as stale', stale.baseChanged === true);
  check('an out-of-date copy cannot be newly opted in', (await api('PUT', `/applications/${app.id}/cv-tailored/use`, { use: false })).status === 200 && (await api('PUT', `/applications/${app.id}/cv-tailored/use`, { use: true })).status === 409);
  fs.writeFileSync(texFile, SAMPLE);

  fs.writeFileSync(texFile, SAMPLE.replace('\\end{document}', '% OVERFLOW_TEST\n\\end{document}'));
  propose(proposal());
  const overflow = await api('POST', `/applications/${app.id}/cv/tailor`, {});
  check('a multi-page result is refused', overflow.status === 422 && /2 pages/.test(overflow.data.error));
  fs.writeFileSync(texFile, SAMPLE);

  const delayFile = MARKERS + '-tailor-delay.json';
  const other = (await api('POST', '/applications', { job: { ...JOB, url: `${JOB.url}-2`, jobKey: 'example-ml-intern-2' }, cvId: 'Sample_CV_EN' })).data.application;
  fs.writeFileSync(delayFile, JSON.stringify({ delay: 4000 }));
  propose(proposal());
  const controller = new AbortController();
  const known = markers();
  const pending = fetch(`${BASE}/applications/${other.id}/cv/tailor`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: controller.signal }).catch((e) => e);
  let pid;
  for (let i = 0; i < 100 && !pid; i++) { const name = [...markers()].find((n) => !known.has(n)); if (name) pid = JSON.parse(fs.readFileSync(path.join(MARKERS, name), 'utf8')).pid; else await sleep(40); }
  check('a concurrent request for the same application is rejected', (await api('POST', `/applications/${other.id}/cv/tailor`, {})).status === 409);
  controller.abort();
  check('client cancellation is accepted', (await pending).name === 'AbortError');
  const alive = () => { try { process.kill(pid, 0); return true; } catch { return false; } };
  for (let i = 0; i < 100 && alive(); i++) await sleep(40);
  check('cancellation kills the model process and saves nothing', !alive() && !fs.existsSync(path.join(DATA, 'applications', other.id, 'cv-tailored')) && !(await api('GET', `/applications/${other.id}`)).data.application.cvTailored);
  fs.rmSync(delayFile, { force: true });

  const short = (await api('POST', '/applications', { job: { ...JOB, url: `${JOB.url}-3`, jobKey: 'example-ml-intern-3', description: 'Too short.' }, cvId: 'Sample_CV_EN' })).data.application;
  const known2 = markers().size;
  check('an incomplete posting is refused before using quota', (await api('POST', `/applications/${short.id}/cv/tailor`, {})).status === 409 && markers().size === known2);
  await api('PATCH', `/applications/${other.id}`, { status: 'soumise' });
  check('a submitted application is not tailored', (await api('POST', `/applications/${other.id}/cv/tailor`, {})).status === 409);

  const removed = await api('DELETE', `/applications/${app.id}/cv-tailored`);
  check('the tailored copy can be discarded', removed.status === 200 && !fs.existsSync(dir) && !removed.data.application.cvTailored && (await api('GET', `/applications/${app.id}/cv-tailored`)).status === 404);
} catch (error) {
  console.error(error);
  failures++;
} finally {
  server.kill();
}
console.log(failures ? `\n${failures} failure(s)` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
