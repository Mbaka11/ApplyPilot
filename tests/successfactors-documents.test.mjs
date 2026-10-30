import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getConfig } from '../server/src/config.js';
import { launchBrowser } from '../server/src/pdf.js';
const manifest = JSON.parse(fs.readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
const scripts = manifest.content_scripts[0].js.map(file => fileURLToPath(new URL('../extension/' + file, import.meta.url)));
const fixture = new URL('./fixtures/successfactors-form.html', import.meta.url).href;
const file = kind => ({ name: `Example_${kind}.pdf`, type: 'application/pdf', base64: Buffer.from(`%PDF-1.4\nFICTIONAL_${kind.toUpperCase()}\n%%EOF`).toString('base64') });

test('SuccessFactors document upload — fictional behavior, real browser file inputs', async t => {
  const browser = await launchBrowser(getConfig(), { args: ['--allow-file-access-from-files'] });
  const page = await browser.newPage();
  const run = (cmd, payload = {}) => page.evaluate((cmd, payload) => __applyPilot.run(cmd, payload), cmd, { runId: 'documents', ...payload });
  const load = async (mode = 'normal') => {
    await page.goto(fixture); for(const script of scripts) await page.addScriptTag({ path: script });
    await page.evaluate(mode => { ApplyPilot.platform = () => 'successfactors'; sfUploads.enable(); sfUploads.mode = mode; }, mode);
  };
  const prepare = () => run('sfDocumentPlan', { documentNames: { cv: file('cv').name, letter: file('letter').name } });
  const attach = (ticket, kind = 'cv') => run('sfAttachDocument', { ticket, documentKind: kind, file: file(kind) });
  try {
    await t.test('preflight never opens a dialog or selects a file', async () => {
      await load(); const plan = await prepare(); assert.ok(plan.ticket, plan.error);
      assert.deepEqual(plan.present, { cv: 'empty', letter: 'empty' });
      assert.equal(await page.evaluate(() => sfFixture.clicks.length), 0);
    });
    await t.test('sequential CV and letter go to the matching launchers and require visible filenames', async () => {
      await load(); const plan = await prepare();
      for(const kind of ['cv', 'letter']) { const result = await attach(plan.ticket, kind); assert.equal(result.completed, true, JSON.stringify(result)); assert.equal(result.result.status, 'check'); }
      assert.deepEqual(await page.evaluate(() => sfUploads.uploads.map(({kind,name,content}) => ({kind,name,content}))), ['cv','letter'].map(kind => ({kind,name:file(kind).name,content:Buffer.from(file(kind).base64,'base64').toString()})));
      assert.equal(await page.$eval('#unrelated-file', input => input.files.length), 0);
      assert.equal(await page.evaluate(() => sfFixture.submissions + sfUploads.dialogButtons), 0);
      assert.equal(await page.evaluate(() => sfFixture.clicks.filter(id => !['cv-trigger','letter-trigger'].includes(id)).length), 0);
    });
    await t.test('a removed upload launcher does not hide an attachment confirmed in the original zone', async () => {
      await load('replace-trigger'); const plan = await prepare(); assert.equal((await attach(plan.ticket)).completed, true);
      assert.equal((await attach(plan.ticket,'letter')).completed, true);
    });
    await t.test('an already open generic dialog is never guessed to be CV or letter', async () => {
      await load(); await page.click('#cv-trigger'); const plan = await prepare();
      assert.match(plan.error, /Ferme le dialogue/); assert.equal(await page.evaluate(() => sfUploads.uploads.length), 0);
    });
    await t.test('same-name attachments are preserved without replacement or duplicated upload', async () => {
      await load(); let plan = await prepare(); await attach(plan.ticket);
      plan = await prepare(); assert.equal(plan.present.cv, 'same-name');
      const result = await attach(plan.ticket); assert.equal(result.completed, true); assert.equal(result.result.status, 'kept');
      assert.equal(await page.evaluate(() => sfUploads.uploads.length), 1);
    });
    await t.test('other existing files prevent replacement, regardless of overwrite options', async () => {
      await load(); await page.$eval('#cv-label', element => element.parentElement.append(document.createTextNode('Already_there.pdf')));
      const plan = await prepare(); assert.equal(plan.present.cv, 'other');
      const result = await run('sfAttachDocument', { ticket: plan.ticket, documentKind:'cv',file:file('cv'),options:{overwrite:true} });
      assert.equal(result.completed, false); assert.equal(await page.evaluate(() => sfUploads.uploads.length), 0);
    });
    await t.test('filename substrings and file-type hints are not mistaken for the intended attachment', async () => {
      await load(); await page.$eval('#cv-label', element => element.parentElement.append(document.createTextNode('Allowed: .pdf .doc')));
      assert.equal((await prepare()).present.cv, 'empty');
      await page.$eval('#cv-label', element => element.parentElement.append(document.createTextNode(' Old_Example_cv.pdf')));
      assert.equal((await prepare()).present.cv, 'other');
    });
    await t.test('duplicate launchers or scopes fail closed', async () => {
      await load(); await page.$eval('#cv-trigger', element => element.parentElement.append(element.cloneNode(true)));
      assert.match((await prepare()).error, /ambigu/);
    });
    await t.test('a changed zone invalidates a plan before opening the upload dialog', async () => {
      await load(); const plan = await prepare(); await page.$eval('#cv-trigger', element => element.replaceWith(element.cloneNode(true)));
      assert.match((await attach(plan.ticket)).error, /modifi/); assert.equal(await page.evaluate(() => sfFixture.clicks.length), 0);
    });
    await t.test('a new document context cannot replay an old plan', async () => {
      await load(); const plan = await prepare(); await load();
      assert.match((await attach(plan.ticket)).error, /périmée/); assert.equal(await page.evaluate(() => sfUploads.uploads.length), 0);
    });
    await t.test('ambiguous inputs and a non-PDF accept list receive no file', async () => {
      for(const mode of ['ambiguous','non-pdf']) { await load(mode); const plan = await prepare(); assert.equal((await attach(plan.ticket)).completed,false); assert.equal(await page.evaluate(() => sfUploads.uploads.length),0); }
    });
    await t.test('a FileList without site confirmation is never a completed transfer', async () => {
      await load('hold'); const plan = await prepare();
      // Shorten only the fictional test timeout; production keeps its bounded 10-second confirmation wait.
      await page.evaluate(() => { const original=ApplyPilot.waitFor; ApplyPilot.waitFor=(fn,opts)=>original(fn,{...opts,timeout:Math.min(opts.timeout,300)}); });
      const result = await attach(plan.ticket); assert.equal(result.completed,false); assert.match(result.result.note,/non confirmé/);
      assert.equal(await page.evaluate(() => sfUploads.uploads.length),1); assert.equal(await page.evaluate(() => sfUploads.dialogButtons),0);
      assert.ok((await attach(plan.ticket)).error); assert.equal(await page.evaluate(() => sfUploads.uploads.length),1);
    });
    await t.test('a filename in the wrong zone or a rollback is not accepted', async () => {
      for(const mode of ['wrong-zone','rollback']) {
        await load(mode); const plan = await prepare();
        await page.evaluate(() => { const original=ApplyPilot.waitFor; ApplyPilot.waitFor=(fn,opts)=>original(fn,{...opts,timeout:Math.min(opts.timeout,500)}); });
        assert.equal((await attach(plan.ticket)).completed,false);
      }
    });
    await t.test('Stop during dialog opening cannot upload later', async () => {
      await load('delayed'); const plan = await prepare(); const pending=attach(plan.ticket);
      await page.waitForFunction(() => sfFixture.clicks.includes('cv-trigger'));
      await run('cancel'); assert.equal((await pending).cancelled,true);
      await new Promise(resolve=>setTimeout(resolve,800)); assert.equal(await page.evaluate(() => sfUploads.uploads.length),0);
    });
    await t.test('unsafe filenames, missing PDF signature and unknown purposes are rejected', async () => {
      await load(); const unknownPlan = await prepare();
      assert.ok((await run('sfAttachDocument', {ticket: unknownPlan.ticket, documentKind: 'transcript', file: file('cv')})).error);
      assert.equal(await page.evaluate(() => sfFixture.clicks.length), 0);
      for(const change of [{name:'../secret.pdf'},{base64:Buffer.from('not pdf').toString('base64')},{type:'text/plain'}]) {
        await load(); const plan=await prepare(); assert.ok((await run('sfAttachDocument',{ticket:plan.ticket,documentKind:'cv',file:{...file('cv'),...change}})).error);
        assert.equal(await page.evaluate(() => sfFixture.clicks.length),0);
      }
    });
  } finally { await browser.close(); }
});
