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
const { runPi, askJson, cancelAllPi } = await import('../server/src/llm.js');
const cfg = { llm: { command: path.join(ROOT, 'tests', 'fixtures', 'fake-pi.mjs') } };
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

  const normal = await askJson(JSON.stringify({ mode: 'json' }), { cfg });
  check('non-cancelled JSON requests still complete normally', Object.keys(normal.data.answers).length === 0);
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
