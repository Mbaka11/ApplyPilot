import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getConfig } from '../server/src/config.js';
import { launchBrowser } from '../server/src/pdf.js';
const manifest = JSON.parse(fs.readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
const scripts = manifest.content_scripts[0].js.map(file => fileURLToPath(new URL('../extension/' + file, import.meta.url)));
const fixture = new URL('./fixtures/successfactors-form.html', import.meta.url).href;
const profile = {
  identity: { firstName: 'Alex', lastName: 'Example', address: { country: 'Canada' } },
  student: { expectedGraduation: '2028-01', creditedInternship: null },
  workAuthorization: { canada: { authorizedToWork: true } },
  preferences: { howDidYouHear: 'LinkedIn' },
  education: [{ degree: 'Maîtrise en informatique', degreeEn: 'Master of Computer Science', fieldOfStudy: 'Informatique', school: 'Université de démonstration' }],
  experience: [{ title: 'Intern' }, { title: 'Intern' }],
};
const payload = { profile, job: { language: 'fr' }, platform: 'successfactors', memory: { items: {} }, options: { addEntries: true } };
const run = (page, cmd, extra = {}) => page.evaluate((cmd, payload) => __applyPilot.run(cmd, payload), cmd, { ...payload, ...extra });
const value = (page, id) => page.$eval('#' + id, element => element.value);

test('SuccessFactors controls — structural patterns with synthetic behavior', async t => {
  const browser = await launchBrowser(getConfig(), { args: ['--allow-file-access-from-files'] });
  const page = await browser.newPage();
  const load = async () => {
    await page.goto(fixture);
    for (const script of scripts) await page.addScriptTag({ path: script });
    await page.evaluate(() => { ApplyPilot.platform = () => 'successfactors'; });
  };
  try {
    await t.test('documents and repeat-section actions are inventoried without being clicked or sent to AI', async () => {
      await load();
      const detected = await run(page, 'detect');
      assert.equal(detected.manualActionCount, 5);
      assert.equal(detected.fileCount, 0);
      const result = await run(page, 'fill');
      assert.ok(!result.error, result.error);
      const actions = result.results.filter(row => row.kind === 'manual-action');
      assert.equal(actions.length, 5);
      assert.ok(actions.every(row => row.status === 'todo'));
      assert.equal(result.unresolved.some(row => row.kind === 'manual-action'), false);
      assert.equal(await page.evaluate(() => sfFixture.clicks.some(id => /^(cv-trigger|letter-trigger|other-trigger|add-education|add-language|save|submit)$/.test(id))), false);
      assert.equal(await page.evaluate(() => sfFixture.submissions), 0);
    });
    await t.test('graduation uses the profile month, not a degree or an old memorized day', async () => {
      await load();
      const memory = { items: { "quelle est votre date prevue d'obtention du diplome": { value: 'Master of Computer Science' } } };
      const result = await run(page, 'fill', { memory });
      assert.equal(await value(page, 'graduation'), '2028-01');
      assert.equal(await value(page, 'program'), 'Maîtrise en informatique');
      assert.equal(await value(page, 'level'), 'Maîtrise en informatique');
      assert.ok(!result.unresolved.some(row => /dipl[oô]me|stages|Suffixe/.test(row.label)));
    });
    await t.test('completed internship count is never inferred from jobs, degree or stale memory', async () => {
      await load();
      const memory = { items: { 'combien de stages avez vous termines dans le cadre de votre diplome': { value: 'Master of Computer Science' } } };
      const result = await run(page, 'fill', { memory });
      assert.equal(await value(page, 'count'), '');
      assert.equal(result.results.find(row => row.label.includes('Combien de stages')).status, 'todo');
      assert.ok(!result.unresolved.some(row => row.label.includes('Combien de stages')));
      const id = await page.$eval('#count', element => element.getAttribute('data-applypilot-id'));
      await run(page, 'fillValues', { answers: { [id]: { value: '2', confidence: 0.9 } } });
      assert.equal(await value(page, 'count'), '');
    });
    await t.test('optional suffix and second names stay blank and are not asked of AI', async () => {
      await load(); const result = await run(page, 'fill');
      assert.equal(await value(page, 'suffix'), 'Aucune sélection');
      assert.equal(await value(page, 'second-name'), '');
      assert.equal(await value(page, 'second-family'), '');
      assert.equal(await value(page, 'first'), 'Alex');
      assert.equal(await value(page, 'last'), 'Example');
      assert.ok(!result.results.some(row => row.label === 'Suffixe'));
      assert.ok(!result.unresolved.some(row => /Suffixe|Deuxième/.test(row.label)));
    });
    await t.test('category source is manual; dependent subtype fills only once enabled', async () => {
      await load(); let result = await run(page, 'fill');
      assert.equal(await value(page, 'source-type'), 'Aucune sélection');
      assert.equal(await value(page, 'source-subtype'), 'Aucune sélection');
      assert.equal(result.results.find(row => row.label === 'Type de source').status, 'todo');
      await page.evaluate(() => sfFixture.enableSubtype());
      result = await run(page, 'fill');
      assert.equal(await value(page, 'source-subtype'), 'LinkedIn');
      assert.ok(['ok', 'check'].includes(result.results.find(row => row.label === 'Sous-type de source').status));
    });
    await t.test('ARIA radio groups count as one field and commit a real choice; unknown facts stay unanswered', async () => {
      await load(); const result = await run(page, 'fill');
      const radios = result.results.filter(row => row.kind === 'radio');
      assert.equal(radios.length, 2);
      assert.equal(await page.$eval('#auth-yes', element => element.getAttribute('aria-checked')), 'true');
      assert.equal(await page.$eval('[aria-labelledby="unknown-label"]', element => !!element.querySelector('[aria-checked="true"]')), false);
      assert.equal(result.results.find(row => /crédité/.test(row.label)).status, 'todo');
    });
    await t.test('rejected radio selection is not reported as successfully filled', async () => {
      await load(); await page.evaluate(() => { sfFixture.mode = 'reject-radio'; });
      const result = await run(page, 'fill');
      assert.equal(result.results.find(row => /autorisé/.test(row.label)).status, 'check');
    });
    await t.test('a combobox opens its sibling button and clicks only an owned option', async () => {
      await load(); const result = await run(page, 'fill');
      assert.equal(await value(page, 'country'), 'Canada');
      assert.equal(await page.evaluate(() => sfFixture.selected.country), 'Canada');
      assert.equal(await page.evaluate(() => sfFixture.clicks.includes('unrelated-option')), false);
      assert.equal(await page.evaluate(() => sfFixture.submissions), 0);
      assert.ok(['ok', 'check'].includes(result.results.find(row => row.label === 'Pays').status));
    });
    await t.test('unowned or nonmatching lists leave the original text untouched and never press Enter', async () => {
      for (const mode of ['unowned', 'no-match']) {
        await load(); await page.evaluate(mode => { sfFixture.mode = mode; }, mode);
        const p = mode === 'no-match' ? { ...profile, identity: { ...profile.identity, address: { country: 'Unknown country' } } } : profile;
        const result = await run(page, 'fill', { profile: p });
        assert.equal(await value(page, 'country'), 'Aucune sélection');
        assert.equal(result.results.find(row => row.label === 'Pays').status, 'check');
        assert.equal(await page.evaluate(() => sfFixture.submissions), 0);
        assert.equal(await page.evaluate(() => sfFixture.clicks.includes('unrelated-option')), false);
      }
    });
    await t.test('site-rejected selections are flagged; replaced controls can be re-identified', async () => {
      for (const mode of ['reject', 'replace']) {
        await load(); await page.evaluate(mode => { sfFixture.mode = mode; }, mode);
        const result = await run(page, 'fill');
        const row = result.results.find(row => row.label === 'Pays');
        assert.ok(row);
        if (mode === 'reject') { assert.equal(row.status, 'check'); assert.equal(await value(page, 'country'), 'Aucune sélection'); }
        else assert.equal(await value(page, 'country'), 'Canada');
      }
    });
    await t.test('existing wrong entries are preserved but flagged; existing manual count is never replaced', async () => {
      await load();
      await page.evaluate(() => { document.getElementById('graduation').value = 'Master of Computer Science'; document.getElementById('count').value = '4'; document.getElementById('country').value = 'Canada'; });
      const result = await run(page, 'fill');
      assert.equal(await value(page, 'graduation'), 'Master of Computer Science');
      assert.equal(await value(page, 'count'), '4');
      assert.equal(await value(page, 'country'), 'Canada');
      assert.equal(result.results.find(row => row.label.includes('obtention du diplôme')).status, 'check');
      assert.equal(result.results.find(row => row.label === 'Pays').status, 'check');
    });
    await t.test('unknown repeated blocks/dialog contents stay manual, including file inputs', async () => {
      await load();
      await page.evaluate(() => {
        const area = document.querySelector('[role="group"][aria-labelledby="education"]');
        area.insertAdjacentHTML('beforeend', '<label for="extra-school">Établissement</label><input id="extra-school">');
        document.body.insertAdjacentHTML('beforeend', '<div role="dialog"><label for="dialog-cv">CV</label><input id="dialog-cv" type="file"></div><label for="inline-cv">CV</label><input id="inline-cv" type="file" hidden>');
      });
      await run(page, 'fill', { files: { cv: { name: 'Example.pdf', base64: 'JVBERi0xLjQ=', type: 'application/pdf' } } });
      assert.equal(await value(page, 'extra-school'), '');
      assert.equal(await page.$eval('#dialog-cv', element => element.files.length), 0);
      assert.equal(await page.$eval('#inline-cv', element => element.files.length), 0);
    });
    await t.test('Stop interrupts a pending linked-list wait before any option click', async () => {
      await load(); await page.evaluate(() => { sfFixture.mode = 'unowned'; });
      const filling = run(page, 'fill', { runId: 'stop-during-list' });
      await page.waitForFunction(() => document.getElementById('country').getAttribute('aria-expanded') === 'true');
      await run(page, 'cancel', { runId: 'stop-during-list' });
      const before = await page.evaluate(() => sfFixture.clicks.length);
      assert.equal((await filling).cancelled, true);
      assert.equal(await page.evaluate(() => sfFixture.clicks.length), before);
      assert.equal(await value(page, 'country'), 'Aucune sélection');
      assert.equal(await page.evaluate(() => sfFixture.submissions), 0);
    });
    await t.test('graduate degree wording is not mistaken for a graduation date', async () => {
      await load();
      const resolved = await page.evaluate(profile => {
        const descriptor = { kind: 'text', label: 'Graduate degree', labelNorm: 'graduate degree', sig: 'graduate degree', isEmpty: true };
        return ApplyPilot.resolve(descriptor, ApplyPilot.makeContext({ profile, job: { language: 'en' } }));
      }, profile);
      assert.equal(resolved.ruleId, 'degree');
      assert.equal(resolved.value, 'Master of Computer Science');
    });
    await t.test('cancelled runs perform no clicks, and unexpected AI answers never overwrite user edits', async () => {
      await load(); await run(page, 'cancel', { runId: 'stopped' });
      assert.equal((await run(page, 'fill', { runId: 'stopped' })).cancelled, true);
      assert.equal(await page.evaluate(() => sfFixture.clicks.length), 0);
      await page.evaluate(() => { document.getElementById('first').value = 'Hand edited'; ApplyPilot.scanFields(); });
      const id = await page.$eval('#first', element => element.getAttribute('data-applypilot-id'));
      await run(page, 'fillValues', { answers: { [id]: { value: 'Replace it', confidence: 0.9 } } });
      assert.equal(await value(page, 'first'), 'Hand edited');
    });
  } finally { await browser.close(); }
});
