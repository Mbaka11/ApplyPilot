// Adapted answer memory: store flag, legacy files and prompt rules (no server, no provider).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tests', 'output', 'memory-adapt');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'memory'), { recursive: true });
process.env.APPLYPILOT_DATA_DIR = OUT;
const { addToMemory, getMemory, isAdaptable, memoryKey } = await import('../server/src/store.js');
const { buildAnswersPrompt } = await import('../server/src/prompts.js');

let checks = 0;
function check(name, fn) { fn(); checks++; console.log(`  ✓ ${name}`); }

check('addToMemory flags long text, textarea and answers naming the previous company', () => {
  addToMemory([
    { label: 'Why us?', value: 'I like applied machine learning and want to ship models that matter to users.', kind: 'text' },
    { label: 'Comments', value: 'Short', kind: 'textarea' },
    { label: 'Preferred employer?', value: 'ÉCOLE Acme – top choice', kind: 'text' },
    { label: 'How did you hear about us?', value: 'LinkedIn', kind: 'prompt' },
    { label: 'Willing to relocate?', value: true, kind: 'checkbox' },
    { label: 'Languages', value: ['English', 'French'], kind: 'checkboxes' },
  ], { company: 'école acme' });
  const items = getMemory().items;
  assert.equal(items[memoryKey('Why us?')].adaptable, true);
  assert.equal(items[memoryKey('Comments')].adaptable, true);
  assert.equal(items[memoryKey('preferred employer?')].adaptable, true, 'company match ignores case and accents');
  assert.equal(items[memoryKey('how did you hear about us?')].adaptable, false);
  assert.equal(items[memoryKey('willing to relocate?')].adaptable, false);
  assert.equal(items[memoryKey('Languages')].adaptable, false);
  assert.equal(items[memoryKey('Why us?')].lastCompany, 'école acme');
});
check('a long value over the 300 character storage limit is still refused', () => {
  assert.equal(addToMemory([{ label: 'Essay', value: 'x'.repeat(301), kind: 'textarea' }], { company: 'A' }).added, 0);
});
check('legacy memory files without the flag keep working and are not rewritten', () => {
  const file = path.join(OUT, 'memory', 'answers.json');
  const legacy = { items: {
    [memoryKey('Why us?')]: { label: 'Why us?', value: 'A'.repeat(80), kind: 'text', count: 2, lastCompany: 'Acme' },
    [memoryKey('Hear')]: { label: 'Hear', value: 'LinkedIn', kind: 'prompt', count: 1, lastCompany: 'Acme' },
    [memoryKey('Fav')]: { label: 'Fav', value: 'Acme is great', kind: 'text', count: 1, lastCompany: 'Acme' },
  } };
  fs.writeFileSync(file, JSON.stringify(legacy));
  const items = getMemory().items;
  assert.equal(items[memoryKey('Why us?')].adaptable, true);
  assert.equal(items[memoryKey('Hear')].adaptable, false);
  assert.equal(items[memoryKey('Fav')].adaptable, true);
  assert.ok(!('adaptable' in JSON.parse(fs.readFileSync(file, 'utf8')).items[memoryKey('Hear')]), 'reading does not modify the file');
  assert.equal(isAdaptable({ value: 'ok', kind: 'select', adaptable: true }), true, 'an explicit flag wins');
});

const base = {
  fields: [{ id: 'f1', label: 'Anything else?', kind: 'textarea' }],
  job: { company: 'Nordic Analytics', title: 'ML Intern' },
  profile: { identity: { firstName: 'Marie', lastName: 'Tremblay' } },
  cvText: 'CV TEXT',
  letter: null,
  memory: { items: {} },
};
const mem = [{ id: 'm1', label: 'Why us?', kind: 'textarea', maxLength: 400, previous: { value: 'I love Acme Robotics.', company: 'Acme Robotics' } }];
check('prompt without memory answers has no adaptation section', () => {
  assert.ok(!buildAnswersPrompt(base).includes('Réponses mémorisées à adapter'));
});
check('prompt carries every adaptation rule and the previous answer', () => {
  const p = buildAnswersPrompt({ ...base, memoryAnswers: mem });
  assert.ok(p.includes('## Réponses mémorisées à adapter'));
  for (const rule of ['uniquement les faits présents dans le profil ou le CV', 'ancienne entreprise ou de l\'ancien poste', 'longueur maximale', 'N\'invente jamais', '"value": null']) assert.ok(p.includes(rule), rule);
  assert.ok(p.includes('I love Acme Robotics.') && p.includes('"maxLength": 400') && p.includes('"id": "m1"'));
});
check('the section adds nothing but the remembered answers (no extra profile data)', () => {
  const without = buildAnswersPrompt(base);
  const withMem = buildAnswersPrompt({ ...base, memoryAnswers: mem });
  const start = withMem.indexOf('\n## Réponses mémorisées à adapter');
  const end = withMem.indexOf('\n## Offre d\'emploi');
  assert.ok(start > 0 && end > start);
  assert.equal(withMem.slice(0, start) + withMem.slice(end), without);
});
console.log(`\n${checks} adapted-memory checks passed.`);
