// Cancellation tests use a fake CLI and never consume provider quota.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tests', 'output', 'llm');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
process.env.APPLYPILOT_DATA_DIR = OUT;
process.env.APPLYPILOT_FAKE_PI_DIR = path.join(OUT, 'processes');
process.env.PI_CODING_AGENT_DIR = path.join(OUT, 'fake-agent');
fs.mkdirSync(process.env.PI_CODING_AGENT_DIR, { recursive: true });
fs.writeFileSync(path.join(process.env.PI_CODING_AGENT_DIR, 'settings.json'), JSON.stringify({ defaultProvider: 'fixture', defaultModel: 'default-test', unrelated: 'PRIVATE_SETTINGS_CANARY' }));
const { runPi, askJson, cancelAllPi, generationSettings } = await import('../server/src/llm.js');
const cfg = { llm: { command: path.join(ROOT, 'tests', 'fixtures', 'fake-pi.mjs'), model: 'fixture/requested', letterThinking: 'medium', answersThinking: 'low' } };
let failures = 0;
function check(label, condition) {
  console.log(`  ${condition ? '✓' : '✗'} ${label}`);
  if (!condition) failures++;
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const files = () => fs.existsSync(process.env.APPLYPILOT_FAKE_PI_DIR) ? fs.readdirSync(process.env.APPLYPILOT_FAKE_PI_DIR) : [];
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function until(fn) {
  for (let i = 0; i < 100; i++) { const value = fn(); if (value) return value; await pause(50); }
  throw new Error('Fixture did not reach its expected state');
}
async function started(before) {
  return until(() => {
    for (const name of files().filter((f) => !before.includes(f))) {
      const info = JSON.parse(fs.readFileSync(path.join(process.env.APPLYPILOT_FAKE_PI_DIR, name), 'utf8'));
      if (info.flags.includes('--print')) return info;
    }
    return null;
  });
}
try {
  console.log('\nCancellable pi subprocess');
  let before = files();
  const controller = new AbortController();
  const pending = runPi(JSON.stringify({ child: true }), { cfg, signal: controller.signal }).catch((e) => e);
  const processInfo = await started(before);
  await until(() => files().length >= before.length + 2);
  check('isolated child still disables tools and sessions', processInfo.isolated && processInfo.flags.includes('--no-tools') && processInfo.flags.includes('--no-session'));
  controller.abort();
  const error = await pending;
  check('abort rejects immediately as AbortError, not a provider failure', error.name === 'AbortError' && error.status === 499);
  await until(() => !alive(processInfo.pid) && !alive(processInfo.child));
  check('abort terminates the owned CLI and its descendant', !alive(processInfo.pid) && !alive(processInfo.child));

  before = files();
  const already = new AbortController();
  already.abort();
  const noStart = await askJson('{}', { cfg, signal: already.signal }).catch((e) => e);
  await pause(100);
  check('an already cancelled request never starts pi or a JSON retry', noStart.name === 'AbortError' && files().length === before.length);

  const preview = generationSettings(cfg);
  check('generation preview exposes model and separate letter/answer effort', preview.letter.requestedModel === 'fixture/requested' && preview.letter.requestedThinking === 'medium' && preview.answers.requestedThinking === 'low');
  const fallback = generationSettings({ llm: { letterThinking: 'medium' } });
  check('blank model resolves only non-secret pi defaults, not unrelated settings', fallback.letter.requestedModel === 'fixture/default-test' && fallback.letter.modelSource === 'pi-default' && !JSON.stringify(fallback).includes('PRIVATE_SETTINGS_CANARY'));
  const scoped = generationSettings({ llm: { model: 'fixture/*', letterThinking: 'max' } });
  check('model selectors and the supported max effort are not silently replaced', scoped.letter.requestedModel === 'fixture/*' && scoped.letter.requestedThinking === 'max');
  const badEffort = await runPi('{}', { cfg, thinking: 'misspelled' }).catch(error => error);
  check('invalid effort fails before starting an unrequested provider call', badEffort.status === 500);
  const normal = await askJson(JSON.stringify({ mode: 'json' }), { cfg, thinking: 'medium' });
  check('non-cancelled JSON requests still complete normally', Object.keys(normal.data.answers).length === 0);
  check('actual model comes from the final assistant event, not the requested label', normal.generation.model === 'demo-observed' && normal.generation.provider === 'fixture' && normal.generation.requestedModel === 'fixture/requested');
  check('requested reasoning is explicit; unreported effective reasoning is unknown', normal.generation.requestedThinking === 'medium' && normal.generation.observedThinking === null);
  check('reasoning blocks and signatures are never returned or persisted', !JSON.stringify(normal).includes('PRIVATE_REASONING_CANARY'));
  const retried = await askJson(JSON.stringify({ mode: 'retry' }), { cfg, thinking: 'low' });
  check('JSON repair retains final attribution and the two-attempt count', retried.generation.attempts === 2 && retried.generation.requestedThinking === 'low' && retried.generation.model === 'demo-observed');
  before = files();
  const shuttingDown = runPi('{}', { cfg }).catch((e) => e);
  const shutdownInfo = await started(before);
  cancelAllPi();
  check('server shutdown cancels all owned active requests', (await shuttingDown).name === 'AbortError');
  await until(() => !alive(shutdownInfo.pid));
  check('shutdown does not leave an orphan pi process', !alive(shutdownInfo.pid));
} catch (error) {
  console.error(error);
  failures++;
} finally {
  cancelAllPi();
}
console.log(`\n${failures ? `${failures} failure(s)` : 'All pi cancellation checks passed'}.`);
process.exitCode = failures ? 1 : 0;
