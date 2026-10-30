import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  TailorError, applyTailoring, buildFactBank, buildTailorPrompt, compileTex, escapeLatexText, findLatex,
  parseTailorable, tailorCv, validateProposal,
} from '../server/src/cv-tailor.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = fs.readFileSync(path.join(here, 'fixtures', 'cv-tailor-sample.tex'), 'utf8');
const FAKE_LATEX = path.join(here, 'fixtures', 'fake-pdflatex.mjs');
const cfg = { cvTailor: { pdflatex: FAKE_LATEX }, llm: { letterThinking: 'medium' } };
const job = {
  title: 'Machine Learning Intern', company: 'Nordic Analytics', location: 'Montreal',
  description: 'Build and deploy machine learning models with Python, PyTorch and MLflow. Work with business teams. '.repeat(3),
};
const profile = { experience: [{ company: 'Example Corp', description: 'Developed AI agents' }], skills: ['Python'] };
const GOOD_ABOUT = 'I like turning machine learning into tools people actually use, especially models that must run reliably on real data. I learn by building, and I enjoy working with business teams. I am looking for an internship where I can own a problem end to end.';
const goodProposal = () => ({
  about: GOOD_ABOUT,
  skills: [
    { label: 'Programming', items: ['SQL', 'Python', 'C++', 'Java', 'Bash', 'R'] },
    { label: 'ML / Data', items: ['PyTorch', 'MLflow', 'Scikit-learn', 'TensorFlow', '\\mbox{Hugging Face}', 'RL'] },
  ],
  keywords: ['MLflow', 'deployment'],
  warnings: [],
});
const prepare = () => {
  const parsed = parseTailorable(SAMPLE);
  return { parsed, bank: buildFactBank({ tex: SAMPLE, profile, job }) };
};

test('parses the About paragraph and only the editable skill rows', () => {
  const { parsed } = prepare();
  assert.match(parsed.about.text, /^I like turning machine learning/);
  assert.deepEqual(parsed.skills.map((row) => row.label), ['Programming', 'ML / Data', 'Tools']);
  assert.ok(parsed.skills[1].items.includes('\\mbox{Hugging Face}'));
  assert.equal(parsed.skills.some((row) => /language/i.test(row.label)), false);
});

test('unrecognised CV layouts are refused instead of guessed', () => {
  assert.throws(() => parseTailorable('\\begin{document}Hello\\end{document}'), (e) => e instanceof TailorError && e.status === 422);
  assert.throws(() => parseTailorable(SAMPLE.replace('I like turning machine learning', 'I like \\textbf{turning} machine learning')), TailorError);
});

test('a faithful proposal is accepted and applied without touching anything else', () => {
  const { parsed, bank } = prepare();
  const verdict = validateProposal({ parsed, proposal: goodProposal(), bank });
  assert.deepEqual(verdict.errors, []);
  const out = applyTailoring(parsed, verdict);
  assert.ok(out.includes(GOOD_ABOUT));
  assert.match(out, /\\textbf\{Programming:\} & SQL, Python, C\+\+, Java, Bash, R \\\\\[0\.2em\]/);
  assert.match(out, /MLflow, Scikit-learn, TensorFlow, \\mbox\{Hugging Face\}, RL/);
  const before = SAMPLE.split('\n');
  const after = out.split('\n');
  const changed = after.map((line, i) => (line === before[i] ? null : i)).filter((i) => i !== null);
  assert.equal(after.length, before.length, 'About stays a single paragraph line');
  assert.equal(changed.length, 3, 'only About and the two reordered rows differ');
  assert.ok(out.includes('\\textbf{Languages:} & English, French, Spanish'));
});

test('line endings are preserved', () => {
  const crlf = SAMPLE.replace(/\n/g, '\r\n');
  const parsed = parseTailorable(crlf);
  const verdict = validateProposal({ parsed, proposal: goodProposal(), bank: buildFactBank({ tex: crlf, profile, job }) });
  const out = applyTailoring(parsed, verdict);
  assert.equal(out.includes('\r\n'), true);
  assert.equal(/[^\r]\n/.test(out), false);
});

test('invented facts are rejected: numbers, technologies and skills', () => {
  const { parsed, bank } = prepare();
  const attempt = (patch) => validateProposal({ parsed, proposal: { ...goodProposal(), ...patch }, bank });
  assert.match(attempt({ about: `${GOOD_ABOUT} I improved latency by 40%.` }).errors.join(), /chiffres interdits/);
  assert.match(attempt({ about: GOOD_ABOUT.replace('real data', 'Kubernetes clusters') }).errors.join(), /Kubernetes/);
  assert.match(attempt({ about: GOOD_ABOUT.replace('real data', 'PySpark pipelines') }).errors.join(), /PySpark/);
  const skills = goodProposal().skills;
  skills[0].items.push('Rust');
  assert.match(attempt({ skills }).errors.join(), /compétence inventée « Rust »/);
  assert.equal(attempt({ skills: [{ label: 'Tools', items: ['Azure'] }] }).ok, false, 'dropping most of a row is refused');
});

test('formatting, length and empty proposals are rejected', () => {
  const { parsed, bank } = prepare();
  const attempt = (about) => validateProposal({ parsed, proposal: { about, skills: [] }, bank });
  assert.equal(attempt('').ok, false);
  assert.match(attempt(`${GOOD_ABOUT} \\input{secret}`).errors.join(), /formatage/);
  assert.match(attempt(`${GOOD_ABOUT} ${GOOD_ABOUT} ${GOOD_ABOUT}`).errors.join(), /trop long/);
  assert.match(attempt('Short.').errors.join(), /trop court/);
});

test('plain text is escaped for LaTeX', () => {
  assert.equal(escapeLatexText('R&D 50% #1 a_b ~ ^'), 'R\\&D 50\\% \\#1 a\\_b \\textasciitilde{} \\^{}');
});

test('the prompt carries the posting and the strict rules but no profile secrets', () => {
  const { parsed, bank } = prepare();
  const prompt = buildTailorPrompt({ job, cv: { name: 'Sample' }, parsed, bank, language: 'en' });
  assert.match(prompt, /UNIQUEMENT des faits présents dans le CV/);
  assert.match(prompt, /Nordic Analytics/);
  assert.match(prompt, /Programming : Python, SQL/);
  assert.equal(/languages?\s*:\s*English/i.test(prompt.split('## Faits')[0]), false, 'spoken-language row is not offered for editing');
});

test('tailorCv returns a one-page copy, a report and never writes the source', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailor-test-'));
  const texPath = path.join(dir, 'main.tex');
  fs.writeFileSync(texPath, SAMPLE);
  const before = fs.readFileSync(texPath, 'utf8');
  let prompts = 0;
  const ask = async (prompt) => { prompts++; assert.match(prompt, /Tu adaptes la section/); return { data: goodProposal(), ms: 5, generation: { model: 'fixture' } }; };
  const result = await tailorCv({ job, cv: { id: 'sample', name: 'Sample', texPath, language: 'en' }, profile, cfg, ask });
  assert.equal(prompts, 1);
  assert.equal(result.report.pages, 1);
  assert.equal(result.report.baseCvId, 'sample');
  assert.equal(result.report.about.before.startsWith('I like turning'), true);
  assert.equal(result.report.about.after, GOOD_ABOUT);
  assert.deepEqual(result.report.skills[0].after.slice(0, 2), ['SQL', 'Python']);
  assert.match(result.pdf.toString('latin1'), /^%PDF-/);
  assert.equal(fs.readFileSync(texPath, 'utf8'), before, 'the original CV source is untouched');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('multi-page or non-compiling results are refused, with a clear message', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailor-test-'));
  const texPath = path.join(dir, 'main.tex');
  fs.writeFileSync(texPath, SAMPLE);
  const run = (about) => tailorCv({ job, cv: { id: 's', texPath, language: 'en' }, profile, cfg, ask: async () => ({ data: { ...goodProposal(), about }, ms: 1, generation: {} }) });
  // The fake LaTeX reads markers from the source; this one is accepted by validation because the marker words exist in the CV text.
  const overflow = SAMPLE.replace('\\end{document}', '% OVERFLOW_TEST\n\\end{document}');
  fs.writeFileSync(texPath, overflow);
  await assert.rejects(run(GOOD_ABOUT), /2 pages/);
  fs.writeFileSync(texPath, SAMPLE.replace('\\end{document}', '% COMPILE_FAIL\n\\end{document}'));
  await assert.rejects(run(GOOD_ABOUT), /ne compile pas/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('validation failures never reach LaTeX', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailor-test-'));
  const texPath = path.join(dir, 'main.tex');
  fs.writeFileSync(texPath, SAMPLE);
  let compiled = 0;
  await assert.rejects(tailorCv({
    job, cv: { id: 's', texPath, language: 'en' }, profile, cfg,
    ask: async () => ({ data: { about: `${GOOD_ABOUT} Led 12 engineers.`, skills: [] }, ms: 1, generation: {} }),
    compile: async () => { compiled++; throw new Error('must not compile'); },
  }), (e) => e.status === 422 && /Adaptation refusée/.test(e.message) && /chiffres interdits/.test(e.message));
  assert.equal(compiled, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('cancellation stops the model call result and the compiler', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailor-test-'));
  const texPath = path.join(dir, 'main.tex');
  fs.writeFileSync(texPath, SAMPLE);
  const controller = new AbortController();
  await assert.rejects(tailorCv({
    job, cv: { id: 's', texPath, language: 'en' }, profile, cfg, signal: controller.signal,
    ask: async () => { controller.abort(); return { data: goodProposal(), ms: 1, generation: {} }; },
  }), (e) => e.status === 499);
  await assert.rejects(compileTex('x', { cfg, signal: AbortSignal.abort() }), (e) => e.status === 499);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('missing LaTeX or source is reported without calling the model', async () => {
  let asked = 0;
  const ask = async () => { asked++; return { data: goodProposal() }; };
  await assert.rejects(tailorCv({ job, cv: { id: 's', texPath: null }, profile, cfg, ask }), /source LaTeX/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailor-test-'));
  const texPath = path.join(dir, 'main.tex');
  fs.writeFileSync(texPath, SAMPLE);
  assert.equal(findLatex({ cvTailor: { pdflatex: path.join(dir, 'missing.exe') } }), null);
  await assert.rejects(tailorCv({ job, cv: { id: 's', texPath }, profile, cfg: { ...cfg, cvTailor: { pdflatex: path.join(dir, 'missing.exe') } }, ask }), /pdflatex/);
  assert.equal(asked, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});
