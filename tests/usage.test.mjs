// AI usage log: aggregation, rotation, opt-out, no content, corruption tolerance, billing flag. Uses the fake claude CLI (no quota).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tests', 'output', 'usage');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
process.env.APPLYPILOT_DATA_DIR = OUT;
delete process.env.ANTHROPIC_API_KEY;
const { askJson } = await import('../server/src/llm.js');
const { recordUsage, usageSummary, clearUsage, rotateUsage, usageView, USAGE_FILE } = await import('../server/src/usage.js');

let failures = 0;
function check(label, condition) {
  console.log(`  ${condition ? '✓' : '✗'} ${label}`);
  if (!condition) failures++;
}
const FAKE = path.join(ROOT, 'tests', 'fixtures', 'fake-claude.mjs');
const ccfg = (extra = {}) => ({ llm: { provider: 'claude', timeoutSeconds: 30, claude: { command: FAKE, model: 'claude-sonnet-5-5', effort: { letter: 'medium', answers: 'low', tailor: 'high' } } }, ...extra });
const lines = () => (fs.existsSync(USAGE_FILE) ? fs.readFileSync(USAGE_FILE, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const DAY = 86_400_000;

try {
  console.log('Provider hook');
  const CANARY = 'USAGE_CANARY_COMPANY_ZXQ';
  const ok = await askJson(JSON.stringify({ mode: 'json', note: CANARY }), { cfg: ccfg(), task: 'answers' });
  let rows = lines();
  check('one successful call writes one line', rows.length === 1 && rows[0].ok === true && rows[0].attempts === 1);
  check('fields from the CLI result: model, effort, tokens (input incl. cache), cost, task, provider', rows[0].task === 'answers' && rows[0].provider === 'claude' && rows[0].model === 'claude-sonnet-5-5' && rows[0].effort === 'low'
    && rows[0].inputTokens === 1180 && rows[0].outputTokens === 52 && rows[0].costUsd === 0.005236 && rows[0].ms >= 0);
  check('subscription billing without ANTHROPIC_API_KEY', rows[0].billing === 'subscription');
  check('the generation object and return contract are unchanged', ok.generation.attempts === 1 && ok.generation.costUsd === 0.005236 && ok.generation.usage === undefined && ok.usage === undefined);

  process.env.ANTHROPIC_API_KEY = 'sk-test-not-real';
  await askJson('{"mode":"json"}', { cfg: ccfg(), task: 'letter' });
  delete process.env.ANTHROPIC_API_KEY;
  rows = lines();
  check('api billing when ANTHROPIC_API_KEY is set', rows[1].billing === 'api' && rows[1].task === 'letter' && rows[1].effort === 'medium');

  await askJson('{"mode":"retry"}', { cfg: ccfg(), task: 'answers' });
  rows = lines();
  check('a repaired retry is one line with attempts 2 and summed tokens/cost', rows.length === 3 && rows[2].attempts === 2 && rows[2].ok === true && rows[2].outputTokens === 104 && Math.abs(rows[2].costUsd - 0.010472) < 1e-9);

  await askJson('{"mode":"invalid"}', { cfg: ccfg(), task: 'answers' }).catch(() => {});
  rows = lines();
  check('still-invalid JSON after the retry is logged ok:false, attempts 2', rows.length === 4 && rows[3].ok === false && rows[3].attempts === 2);

  await askJson('{"mode":"error"}', { cfg: ccfg(), task: 'tailor' }).catch(() => {});
  rows = lines();
  check('a provider failure is logged ok:false without tokens or message', rows.length === 5 && rows[4].ok === false && rows[4].attempts === 1 && rows[4].inputTokens === null && rows[4].task === 'tailor' && !('error' in rows[4]));

  const ac = new AbortController(); ac.abort();
  await askJson('{}', { cfg: ccfg(), signal: ac.signal }).catch(() => {});
  check('a cancelled request is not logged', lines().length === 5);

  const raw = fs.readFileSync(USAGE_FILE, 'utf8');
  check('no prompt, answer, error text or reasoning in the file', !raw.includes(CANARY) && !raw.includes('Not logged in') && !raw.includes('PRIVATE_REASONING') && !raw.includes('Nordic') && !raw.includes('session'));

  console.log('Summary');
  const s = usageSummary({ days: 30 });
  check('totals: count, ok/failed, tokens, ms', s.totals.count === 5 && s.totals.ok === 3 && s.totals.failed === 2 && s.totals.outputTokens === 312 && s.totals.inputTokens === 7080);
  check('per-task, per-model and per-day aggregates', s.byTask.find(t => t.task === 'answers').count === 3 && s.byTask.length === 3 && s.byModel[0].model === 'claude-sonnet-5-5' && s.byDay.length === 1 && s.byDay[0].count === 5);
  check('billing counts', s.billing.api === 1 && s.billing.subscription === 4);
  check('usageView exposes enabled + summary; days param parsed', usageView(new URLSearchParams('days=7'), { usage: { enabled: false } }).enabled === false && usageView(new URLSearchParams('days=7'), {}).days === 7);

  console.log('Opt-out');
  clearUsage();
  check('clearUsage removes the file', !fs.existsSync(USAGE_FILE) && usageSummary().totals.count === 0);
  await askJson('{"mode":"json"}', { cfg: ccfg({ usage: { enabled: false } }), task: 'answers' });
  check('usage.enabled=false writes nothing', !fs.existsSync(USAGE_FILE));

  console.log('Aggregation windows');
  const now = Date.now();
  const mk = (daysAgo, extra = {}) => ({ at: new Date(now - daysAgo * DAY).toISOString(), task: 'letter', provider: 'claude', model: 'm1', ms: 1000, ok: true, costUsd: 0.5, inputTokens: 10, outputTokens: 5, billing: 'api', ...extra });
  [mk(1), mk(2, { model: 'm2' }), mk(10), mk(40), mk(400)].forEach(e => recordUsage(e));
  check('days window excludes older entries', usageSummary({ days: 30 }).totals.count === 3 && usageSummary({ days: 5 }).totals.count === 2 && usageSummary({ days: 90 }).totals.count === 4);
  check('cost sums', Math.abs(usageSummary({ days: 30 }).totals.costUsd - 1.5) < 1e-9);

  console.log('Rotation');
  const r1 = rotateUsage({ now });
  check('entries older than 180 days are dropped', r1.dropped === 1 && lines().length === 4);
  const big = [];
  for (let i = 0; i < 200; i++) big.push(JSON.stringify({ ...mk(100 - i * 0.4), pad: 'x'.repeat(100) }));
  fs.writeFileSync(USAGE_FILE, `${big.join('\n')}\n`);
  const r2 = rotateUsage({ now, maxBytes: 10_000 });
  const after = lines();
  check('size cap drops the oldest lines first', r2.dropped > 0 && fs.statSync(USAGE_FILE).size <= 10_000 && Date.parse(after[0].at) < Date.parse(after.at(-1).at));
  check('the newest entry survives the size cap', Math.abs(Date.parse(after.at(-1).at) - (now - (100 - 199 * 0.4) * DAY)) < 5);

  console.log('Corruption');
  fs.writeFileSync(USAGE_FILE, `${JSON.stringify(mk(1))}\n{"at": broken\nnot json at all\n${JSON.stringify(mk(2))}\n{"at":"2026-01-01T00:00:00.000Z","task":"x"`);
  check('summary skips bad and partial lines without throwing', usageSummary({ days: 30 }).totals.count === 2);
  check('recording after a partial last line starts a fresh line', recordUsage(mk(0)) && usageSummary({ days: 30 }).totals.count === 3);
  fs.writeFileSync(USAGE_FILE, Buffer.from([0xff, 0xfe, 0x00, 0x01]));
  check('binary garbage does not crash summary, record or rotation', usageSummary().totals.count === 0 && recordUsage(mk(0)) && (rotateUsage(), true) && usageSummary().totals.count === 1);
  fs.rmSync(USAGE_FILE, { force: true });
  check('missing file gives an empty summary', usageSummary().totals.count === 0 && usageSummary().byDay.length === 0);
  fs.writeFileSync(USAGE_FILE, 'x');
  check('recordUsage never throws on an unwritable path', recordUsage(mk(0), { file: path.join(USAGE_FILE, 'nested', 'x.jsonl') }) === false);
  fs.rmSync(USAGE_FILE, { force: true });
  check('only whitelisted fields are stored', (() => { recordUsage({ ...mk(0), prompt: CANARY, answer: CANARY, company: CANARY, error: CANARY }); return !fs.readFileSync(USAGE_FILE, 'utf8').includes(CANARY); })());
} catch (error) {
  console.error(error);
  failures++;
}
console.log(`\n${failures ? `${failures} failure(s)` : 'All usage checks passed'}.`);
process.exitCode = failures ? 1 : 0;
