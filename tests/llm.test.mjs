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
process.env.APPLYPILOT_FAKE_CLAUDE_DIR = path.join(OUT, 'claude-processes');
Object.assign(process.env, { CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 'parent-session', CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDE_EFFORT: 'max', CLAUDE_CODE_OAUTH_TOKEN: 'kept-for-auth' });
process.env.PI_CODING_AGENT_DIR = path.join(OUT, 'fake-agent');
fs.mkdirSync(process.env.PI_CODING_AGENT_DIR, { recursive: true });
fs.writeFileSync(path.join(process.env.PI_CODING_AGENT_DIR, 'settings.json'), JSON.stringify({ defaultProvider: 'fixture', defaultModel: 'default-test', unrelated: 'PRIVATE_SETTINGS_CANARY' }));
const { runPi, askJson, cancelAllPi, cancelAll, generationSettings, resolveProvider, runClaude } = await import('../server/src/llm.js');
const { claudeArgs, claudeEnv, resolveClaude } = await import('../server/src/llm/claude.js');
const { normalizeLlm } = await import('../server/src/config.js');
const cfg = { llm: { provider: 'pi', command: path.join(ROOT, 'tests', 'fixtures', 'fake-pi.mjs'), model: 'fixture/requested', letterThinking: 'medium', answersThinking: 'low' } };
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
  const fallback = generationSettings({ llm: { provider: 'pi', letterThinking: 'medium' } });
  check('blank model resolves only non-secret pi defaults, not unrelated settings', fallback.letter.requestedModel === 'fixture/default-test' && fallback.letter.modelSource === 'pi-default' && !JSON.stringify(fallback).includes('PRIVATE_SETTINGS_CANARY'));
  const scoped = generationSettings({ llm: { provider: 'pi', model: 'fixture/*', letterThinking: 'max' } });
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

  // ---------------------------------------------------------------- Claude CLI provider
  console.log('\nClaude CLI provider');
  const FAKE = path.join(ROOT, 'tests', 'fixtures', 'fake-claude.mjs');
  const ccfg = (extra = {}) => ({ llm: { provider: 'claude', timeoutSeconds: 30, claude: { command: FAKE, model: 'claude-sonnet-5-5', effort: { letter: 'medium', answers: 'low', tailor: 'high' } }, ...extra } });
  const cdir = process.env.APPLYPILOT_FAKE_CLAUDE_DIR;
  const cfiles = () => fs.existsSync(cdir) ? fs.readdirSync(cdir) : [];
  const cinfo = (before) => { const f = cfiles().find((n) => !before.includes(n)); return f ? JSON.parse(fs.readFileSync(path.join(cdir, f), 'utf8')) : null; };
  const flagOf = (info, name) => info.flags[info.flags.indexOf(name) + 1];

  // provider selection
  check('explicit provider wins', resolveProvider(ccfg()) === 'claude' && resolveProvider(cfg) === 'pi');
  check('no provider + resolvable binary selects claude', resolveProvider({ llm: { claude: { command: FAKE } } }) === 'claude');
  const savedPath = process.env.PATH; process.env.PATH = '';
  check('no provider + no binary falls back to pi', resolveProvider({ llm: {} }) === 'pi');
  process.env.PATH = savedPath;
  check('generationSettings follows the provider', generationSettings(ccfg()).letter.requestedThinking === 'medium' && generationSettings(ccfg()).answers.requestedThinking === 'low' && generationSettings(ccfg()).letter.requestedModel === 'claude-sonnet-5-5');

  // config back-compat
  const legacy = normalizeLlm({ command: 'mypi', model: 'a/b', letterThinking: 'high', answersThinking: 'off', timeoutSeconds: 40 });
  check('legacy flat llm.* keys are read as pi settings', legacy.pi.command === 'mypi' && legacy.pi.model === 'a/b' && legacy.pi.letterThinking === 'high' && legacy.pi.answersThinking === 'off' && legacy.timeoutSeconds === 40);
  check('claude defaults: model, medium effort per task, empty command', legacy.claude.model === 'claude-sonnet-5-5' && legacy.claude.effort.tailor === 'medium' && legacy.claude.command === '' && legacy.provider === '');
  check('new pi.* keys override legacy ones and normalization is idempotent', normalizeLlm({ command: 'old', pi: { command: 'new' } }).pi.command === 'new' && JSON.stringify(normalizeLlm(legacy)) === JSON.stringify(legacy));
  check('invalid effort falls back to medium', normalizeLlm({ claude: { effort: { letter: 'bogus' } } }).claude.effort.letter === 'medium');

  // exact flags
  const args = claudeArgs({ model: 'm', effort: 'low', schema: { type: 'object' } });
  check('exact flags: print/json, no tools, no session, safe-mode, strict MCP, system prompt, schema', args[0] === '-p' && args.slice(1, 3).join() === '--output-format,json' && args[args.indexOf('--tools') + 1] === '' && ['--no-session-persistence', '--safe-mode', '--strict-mcp-config', '--system-prompt', '--json-schema'].every((f) => args.includes(f)) && args[args.indexOf('--json-schema') + 1] === '{"type":"object"}');
  check('--bare is never used', !args.includes('--bare'));
  check('no schema, no --json-schema flag', !claudeArgs({ model: 'm', effort: 'low' }).includes('--json-schema'));
  check('resolution honours the configured command; .cmd uses a shell', resolveClaude(ccfg()).desc === FAKE && resolveClaude({ llm: { claude: { command: 'C:/x/claude.cmd' } } }).shell === true);

  // successful structured call + observed provenance + env
  let cbefore = cfiles();
  const ok = await askJson('{"mode":"json","note":"SYNTHETIC_INSTRUCTION_CANARY"}', { cfg: ccfg(), task: 'answers' }).catch((e) => e);
  const info = cinfo(cbefore);
  check('call starts the fixture with the exact flags (prompt via stdin)', info && info.promptSeen && flagOf(info, '--model') === 'claude-sonnet-5-5' && flagOf(info, '--effort') === 'low' && flagOf(info, '--tools') === '' && info.flags.includes('--safe-mode') && !info.flags.includes('--bare'));
  check('answers task passes its JSON schema', JSON.parse(flagOf(info, '--json-schema')).required[0] === 'answers');
  check('tailor task picks its own effort', await (async () => { const b = cfiles(); await askJson('{"mode":"json"}', { cfg: ccfg(), task: 'tailor' }); return flagOf(cinfo(b), '--effort') === 'high'; })());
  check('cwd is the isolated data/claude-workdir', path.basename(info.cwd) === 'claude-workdir');
  check('parent Claude Code session variables are stripped', info.sessionEnvLeft.length === 0 && claudeEnv({ CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 'x', FOO: 'bar' }).FOO === 'bar');
  check('authentication variables are kept', info.authEnvKept.includes('CLAUDE_CODE_OAUTH_TOKEN'));
  check('structured_output is used when present', ok.data && Object.keys(ok.data.answers).length === 0);
  const g = ok.generation;
  check('provenance: provider kind, observed model, requested effort, cost, attempts', g.schema === 1 && g.providerKind === 'claude-cli' && g.provider === 'anthropic' && g.model === 'claude-sonnet-5-5' && g.requestedModel === 'claude-sonnet-5-5' && g.requestedThinking === 'low' && g.observedThinking === null && g.costUsd === 0.005236 && g.attempts === 1 && g.attribution === 'claude-cli-result');
  check('no reasoning or raw usage is stored', !JSON.stringify(ok).includes('PRIVATE_REASONING_CANARY') && !JSON.stringify(ok).includes('session_id'));
  const fallback2 = await askJson('{"mode":"resultonly"}', { cfg: ccfg(), task: 'answers' });
  check('falls back to extractJson(result) without structured_output', Object.keys(fallback2.data.answers).length === 0);
  const fenced = await askJson('{"mode":"fenced"}', { cfg: ccfg(), task: 'answers' });
  check('fenced JSON in result is still parsed', Object.keys(fenced.data.answers).length === 0);

  // retry
  const retried2 = await askJson('{"mode":"retry"}', { cfg: ccfg(), task: 'answers' });
  check('invalid JSON triggers exactly one repair retry with summed cost', retried2.generation.attempts === 2 && Math.abs(retried2.generation.costUsd - 0.010472) < 1e-9);
  const bad = await askJson('{"mode":"invalid"}', { cfg: ccfg(), task: 'answers' }).catch((e) => e);
  check('still-invalid JSON after the retry is a 502', bad.status === 502);

  // provider errors
  const failed = await askJson('{"mode":"error"}', { cfg: ccfg(), task: 'answers' }).catch((e) => e);
  check('is_error / 401 maps to a clear login message', failed.status === 502 && /pas connecté/.test(failed.message));
  const missing = await askJson('{}', { cfg: { llm: { provider: 'claude', claude: { command: path.join(OUT, 'nope.mjs') } } }, task: 'answers' }).catch((e) => e);
  check('missing binary fails cleanly', missing.status === 502);

  // timeout
  cbefore = cfiles();
  const t0 = Date.now();
  const timedOut = await runClaude('{"delay":20000}', { cfg: ccfg(), task: 'answers', timeoutSeconds: 1 }).catch((e) => e);
  check('timeout rejects with 504 quickly', timedOut.status === 504 && Date.now() - t0 < 8000);
  const tinfo = cinfo(cbefore);
  await until(() => !alive(tinfo.pid));
  check('timeout kills the claude process', !alive(tinfo.pid));

  // cancellation + tree kill
  cbefore = cfiles();
  const cc = new AbortController();
  const cpending = runClaude(JSON.stringify({ child: true }), { cfg: ccfg(), task: 'answers', signal: cc.signal }).catch((e) => e);
  const cproc = await until(() => cinfo(cbefore));
  await until(() => cfiles().length >= cbefore.length + 2);
  cc.abort();
  const cerr = await cpending;
  check('abort rejects as AbortError 499', cerr.name === 'AbortError' && cerr.status === 499);
  await until(() => !alive(cproc.pid) && !alive(cproc.child));
  check('abort kills the claude process and its descendant', !alive(cproc.pid) && !alive(cproc.child));
  const pre = new AbortController(); pre.abort();
  cbefore = cfiles();
  const never = await askJson('{}', { cfg: ccfg(), task: 'answers', signal: pre.signal }).catch((e) => e);
  check('already-aborted request never spawns claude', never.name === 'AbortError' && cfiles().length === cbefore.length);
  cbefore = cfiles();
  const sd = runClaude('{}', { cfg: ccfg(), task: 'answers' }).catch((e) => e);
  const sdInfo = await until(() => cinfo(cbefore));
  cancelAll();
  check('cancelAll (and the cancelAllPi alias) stops claude runs', (await sd).name === 'AbortError' && cancelAllPi === cancelAll);
  await until(() => !alive(sdInfo.pid));
} catch (error) {
  console.error(error);
  failures++;
} finally {
  cancelAllPi();
}
console.log(`\n${failures ? `${failures} failure(s)` : 'All pi cancellation checks passed'}.`);
process.exitCode = failures ? 1 : 0;
