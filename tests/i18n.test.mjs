import assert from 'node:assert/strict';
import fs from 'node:fs';
import { EN, chooseLanguage, translate } from '../extension/sidepanel/i18n.mjs';
import { PROFILE_FIELDS } from '../server/src/profile.js';
import { profileWarnings } from '../server/src/config.js';
import { detectRequirements } from '../server/src/requirements.js';
import { buildAnswersPrompt, buildLetterPrompt } from '../server/src/prompts.js';

let checks = 0;
function check(name, fn) { fn(); checks++; console.log(`  ✓ ${name}`); }
check('saved interface choice overrides the browser, without changing document language', () => {
  assert.equal(chooseLanguage('en', 'fr-CA'), 'en');
  assert.equal(chooseLanguage('fr', 'en-US'), 'fr');
  assert.equal(chooseLanguage(null, 'fr-FR'), 'fr');
  assert.equal(chooseLanguage(null, 'es-ES'), 'en');
  assert.equal(chooseLanguage('auto', 'en-CA'), 'en');
});
check('French remains the original display language', () => assert.equal(translate('Candidature', 'fr'), 'Candidature'));
check('English labels and parameterized messages are localized', () => {
  assert.equal(translate('Candidature', 'en'), 'Application');
  assert.equal(translate('pi répond à 1 question…', 'en'), 'pi is answering 1 question…');
  assert.equal(translate('pi répond à 4 questions…', 'en'), 'pi is answering 4 questions…');
  assert.equal(translate('Serveur connecté · {count} CV', 'en', { count: 3 }), 'Server connected · 3 CVs');
  assert.equal(translate('Supprimer la candidature « {name} » et sa lettre ?', 'en', { name: 'Société {count}' }), 'Delete the application “Société {count}” and its cover letter?');
});
check('profile metadata and warnings have complete English coverage', () => {
  for (const field of PROFILE_FIELDS) {
    assert.ok(Object.hasOwn(EN, field.group), `Untranslated group: ${field.group}`);
    assert.ok(Object.hasOwn(EN, field.label) || ['LinkedIn', 'GitHub', 'Portfolio'].includes(field.label), `Untranslated label: ${field.label}`);
  }
  for (const warning of profileWarnings({})) assert.ok(Object.hasOwn(EN, warning.label), warning.label);
});
check('posting checklist translates labels and messages but not excerpts or profile facts', () => {
  const job = { title: 'ML Internship', description: 'French and English required. Credited internship. Must be enrolled. GPA minimum 3.2. Hybrid. Transcript and cover letter required. Security clearance.', endDate: '2027-01-15' };
  const profile = { education: [{ gpa: '4.0/4.3' }], student: { currentlyEnrolled: true, creditedInternship: false } };
  const snapshot = JSON.stringify({ job, profile });
  const requirements = detectRequirements(job, profile);
  for (const item of requirements) {
    assert.notEqual(translate(item.label, 'en'), item.label, item.label);
    if (item.note) assert.notEqual(translate(item.note, 'en'), item.note, item.note);
  }
  assert.equal(JSON.stringify({ job, profile }), snapshot);
});
check('captured field values, names and paths are preserved verbatim', () => {
  assert.equal(translate('À compléter dans profile.yaml → experience[0].location', 'en'), 'Complete profile.yaml → experience[0].location');
  assert.equal(translate('Non sélectionnés : C++, PyTorch', 'en'), 'Not selected: C++, PyTorch');
  assert.equal(translate('Niveau du profil : avancé', 'en'), 'Profile level: avancé');
  assert.equal(translate('CV + lettre (CV.pdf, Lettre_de_motivation.pdf)', 'en'), 'CV + letter (CV.pdf, Lettre_de_motivation.pdf)');
  assert.equal(translate('Langue de l’offre', 'en'), 'Posting language');
  assert.equal(translate('Madame, Monsieur, je souhaite…', 'en'), 'Madame, Monsieur, je souhaite…');
});
check('profile validation messages translate without changing schema paths', () => {
  assert.equal(translate('Courriel : URL invalide.', 'en'), 'Email: invalid URL.');
  assert.equal(translate('Date de fin : date valide au format AAAA-MM-JJ attendue.', 'en'), 'End date: a valid YYYY-MM-DD date is required.');
});
check('AI advisory notes use the UI language without overriding answer or letter language', () => {
  const answers = buildAnswersPrompt({ fields: [], job: {}, profile: {}, uiLanguage: 'en' });
  assert.ok(answers.includes('en anglais. Cette langue'));
  assert.ok(answers.includes('dans la langue de la question'));
  const letter = buildLetterPrompt({ job: {}, profile: {}, cv: null, styleRefs: [], cfg: {}, language: 'fr', uiLanguage: 'en' });
  assert.ok(letter.includes('Langue de la lettre : français'));
  assert.ok(letter.includes('avertissements "warnings" uniquement : anglais'));
});
check('shared translation script is safe to reinject (no top-level lexical collision)', () => {
  const source = fs.readFileSync(new URL('../extension/i18n.js', import.meta.url), 'utf8');
  Function(source)();
  Function(source)();
  assert.equal(globalThis.ApplyPilotI18n.translate('Arrêter', 'en'), 'Stop');
  const keys = [...source.matchAll(/^  '(.*?)':/gm)].map((m) => m[1]);
  assert.equal(new Set(keys).size, keys.length, 'Duplicate dictionary keys');
});
console.log(`\n${checks} localization checks passed.`);
