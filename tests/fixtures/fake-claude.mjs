// A local, quota-free `claude -p --output-format json` fixture. The output shape is the one recorded
// from a real Claude Code 2.1.323 call (see FIELDS below). No provider request or candidate data is saved.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
if (argv.includes('--version')) { process.stdout.write('2.1.323 (Claude Code)\n'); process.exit(0); }
let input = '';
if (!argv.includes('--child')) for await (const chunk of process.stdin) input += chunk;
let settings = {};
try { settings = JSON.parse(input.split('\n\nIMPORTANT :')[0]); } catch { /* prompts from the server use the default mode */ }
const flag = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const model = flag('--model') || 'claude-sonnet-5-5';
const hasSchema = argv.includes('--json-schema');

function output(value, { error } = {}) {
  const base = {
    duration_api_ms: 1095, stop_reason: 'tool_use', session_id: '00000000-0000-4000-8000-000000000000', total_cost_usd: 0.005236,
    usage: { input_tokens: 2, cache_creation_input_tokens: 1178, cache_read_input_tokens: 0, output_tokens: 52, service_tier: 'standard' },
    modelUsage: { [model]: { inputTokens: 2, outputTokens: 52, cacheReadInputTokens: 0, cacheCreationInputTokens: 1178, webSearchRequests: 0, costUSD: 0.005236,
      contextWindow: 1000000, maxOutputTokens: 128000, thinkingTokens: 0, canonicalModel: model, provider: 'firstParty', costBasis: 'list' } },
    permission_denials: [], terminal_reason: 'completed', safety_stops: 0, is_error: false, num_turns: 2, subtype: 'success', api_error_status: null,
    ttft_ms: 1361, type: 'result', duration_ms: 1379, uuid: '00000000-0000-4000-8000-000000000001', result_index: 0,
  };
  if (error) return process.stdout.write(JSON.stringify({ ...base, is_error: true, api_error_status: 401, num_turns: 1, result: 'Not logged in · Please run /login' }));
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const out = { ...base, result: text };
  // With --json-schema the real CLI also returns the validated object in structured_output.
  if (hasSchema && settings.mode !== 'resultonly' && typeof value !== 'string') out.structured_output = value;
  // PRIVATE_REASONING_CANARY: a real response may carry thinking blocks elsewhere; they must never be stored.
  out.thinking_canary = 'PRIVATE_REASONING_CANARY_NOT_FOR_STORAGE';
  process.stdout.write(JSON.stringify(out));
}

const child = settings.child ? spawn(process.execPath, [fileURLToPath(import.meta.url), '--child'], { stdio: 'ignore' }) : null;
const dir = process.env.APPLYPILOT_FAKE_CLAUDE_DIR;
if (dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${process.pid}.json`), JSON.stringify({
    pid: process.pid, child: child?.pid || null, cwd: process.cwd(), flags: argv,
    sessionEnvLeft: Object.keys(process.env).filter(k => /^(CLAUDECODE|CLAUDE_PID|CLAUDE_EFFORT|CLAUDE_CODE_(SESSION|ENTRYPOINT|EXECPATH|MESSAGING|CHILD))/i.test(k)),
    authEnvKept: ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY'].filter(k => process.env[k]),
    promptSeen: input.includes('SYNTHETIC_INSTRUCTION_CANARY'),
  }));
}
if (settings.mode === 'error') {
  output(null, { error: true });
  process.exitCode = 1;
} else if (settings.mode === 'json' || (settings.mode === 'retry' && input.includes('\n\nIMPORTANT :'))) {
  output({ answers: {} });
} else if (settings.mode === 'retry-hang' && input.includes('\n\nIMPORTANT :')) {
  // Second attempt never ends: lets a test cancel the retry after the first attempt already spent tokens.
  if (settings.marker) fs.writeFileSync(settings.marker, 'hang');
  setInterval(() => {}, 1000);
} else if (settings.mode === 'invalid' || settings.mode === 'retry' || settings.mode === 'retry-hang') {
  output('not JSON');
} else if (settings.mode === 'fenced') {
  output('```json\n{"answers":{}}\n```');
} else if (settings.mode === 'resultonly') {
  output(JSON.stringify({ answers: {} }), {});
} else if (input.includes('## Réponses mémorisées à adapter')) {
  // Adapts remembered answers: swaps the previous company for the new one. Labels steer edge cases.
  const list = JSON.parse(input.split('## Réponses mémorisées à adapter')[1].match(/\n(\[[\s\S]*?\n\])\n/)[1]);
  const answers = { ghost: { value: 'Invented by the model', confidence: 1, note: 'never requested' } };
  for (const m of list) {
    if (/NULLME/.test(m.question)) answers[m.id] = { value: null, confidence: 0, note: 'Ne s’applique plus' };
    else if (/LONG/.test(m.question)) answers[m.id] = { value: 'x'.repeat(500), confidence: 0.95, note: 'ignored' };
    else if (/STALE/.test(m.question)) answers[m.id] = { value: m.reponsePrecedente, confidence: 0.9, note: 'ignored' };
    else answers[m.id] = { value: m.reponsePrecedente.split(m.entreprisePrecedente).join('Nordic Analytics'), confidence: 0.95, note: 'ignored' };
  }
  output({ answers });
} else if (input.startsWith('Tu adaptes la section')) {
  let delay = 0;
  try { delay = Math.max(0, Math.min(10000, JSON.parse(fs.readFileSync(dir + '-tailor-delay.json', 'utf8')).delay)); } catch { /* no delay */ }
  await new Promise(resolve => setTimeout(resolve, delay));
  output(JSON.parse(fs.readFileSync(dir + '-tailor.json', 'utf8')));
} else if (input.startsWith('Tu es un rédacteur expert')) {
  let delay = 300;
  try { delay = Math.max(0, Math.min(10000, JSON.parse(fs.readFileSync(dir + '-letter-delay.json', 'utf8')).delay)); } catch { /* normal fixture delay */ }
  await new Promise(resolve => setTimeout(resolve, delay));
  output({ language: 'en', company: 'Nordic Analytics', jobTitle: 'Machine Learning Intern', subject: 'Machine Learning Internship',
    body: 'Dear Hiring Team,\n\nI would like to contribute to the machine learning internship at Nordic Analytics. My academic projects and internship experience have given me practical experience with Python, SQL and model evaluation.\n\nI value clear experiments, reliable data and useful documentation. I would welcome the opportunity to discuss the team’s needs and the contributions I could make.\n\nThank you for considering my application.\n\nSincerely,', warnings: [] });
} else {
  await new Promise(resolve => setTimeout(resolve, settings.delay ?? 90_000));
  output({ answers: {} });
}
