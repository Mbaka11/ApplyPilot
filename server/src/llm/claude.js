import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { DATA_DIR, EFFORTS, normalizeLlm } from '../config.js';
import { ensureDir } from '../util.js';
import { activeRuns, cancelledError, findOnPath, identifier, killTree } from './common.js';
import { schemaFor } from './schemas.js';

// Claude Code CLI en mode headless (`claude -p`) : utilise la connexion de l'utilisateur (abonnement).
// Jamais `--bare` : il force ANTHROPIC_API_KEY et ignore la connexion OAuth. Si ANTHROPIC_API_KEY est défini
// dans l'environnement, le CLI facture l'API au lieu de l'abonnement.
const SYSTEM_PROMPT = 'Tu es un assistant de redaction de candidatures. Reponds uniquement avec l\'objet JSON demande, sans texte autour, sans outil.';

// Variables qui décrivent la session Claude Code *parente* : à ne pas transmettre au CLI enfant
// (CLAUDE_CODE_OAUTH_TOKEN, CLAUDE_CONFIG_DIR, ANTHROPIC_*, CLAUDE_CODE_USE_* restent : ils servent à l'authentification).
const SESSION_ENV = /^(CLAUDECODE|CLAUDE_PID|CLAUDE_EFFORT|CLAUDE_CODE_(SESSION\w*|ENTRYPOINT|EXECPATH|MESSAGING\w*|CHILD_SESSION|SSE_PORT|PARENT\w*|AGENT\w*|REMOTE\w*|IPC\w*|WORKTREE\w*))$/i;
export function claudeEnv(base = process.env) {
  const env = { ...base };
  for (const key of Object.keys(env)) if (SESSION_ENV.test(key)) delete env[key];
  return env;
}

/** Trouve comment lancer claude : commande configurée, sinon claude.exe puis claude.cmd (shell seulement pour .cmd). */
export function resolveClaude(cfg) {
  const configured = normalizeLlm(cfg.llm).claude.command;
  // Un nom nu (« claude », « claude.exe ») se cherche dans le PATH ; seul un chemin est résolu depuis le dossier courant.
  const bare = !configured || !/[\\/]/.test(configured);
  const win = process.platform === 'win32';
  const names = !configured ? (win ? ['claude.exe', 'claude.cmd'] : ['claude']) : win && !/\.\w+$/.test(configured) ? [`${configured}.exe`, `${configured}.cmd`] : [configured];
  let file = bare ? findOnPath(names) : path.resolve(configured);
  if (!file) return { found: false, file: 'claude', args: [], shell: false, desc: 'claude (introuvable)' };
  if (/\.(c|m)?js$/i.test(file)) return { found: true, file: process.execPath, args: [file], shell: false, desc: file };
  if (/\.(cmd|bat)$/i.test(file) && bare) {
    // Le wrapper npm lance claude.exe : on l'appelle directement (pas de shell, pas de souci de guillemets).
    const exe = path.join(path.dirname(file), 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
    if (fs.existsSync(exe)) file = exe;
  }
  return { found: true, file, args: [], shell: /\.(cmd|bat)$/i.test(file), desc: bare ? path.basename(file) : file };
}

const quoteForCmd = arg => `"${String(arg).replace(/"/g, '\\"')}"`;
function spawnArgs(runner, args) {
  if (!runner.shell) return [runner.file, [...runner.args, ...args]];
  const bad = args.find(a => /[&|<>^%\r\n]/.test(a));
  if (bad !== undefined) throw Object.assign(new Error('Argument incompatible avec claude.cmd : indique le chemin de claude.exe dans llm.claude.command.'), { status: 500 });
  return [[runner.file, ...runner.args, ...args].map(quoteForCmd).join(' '), []]; // one command line: no DEP0190 warning
}

export function claudeSettings(cfg, task = 'letter') {
  const c = normalizeLlm(cfg.llm).claude;
  const model = identifier(c.model);
  if (!model) throw Object.assign(new Error('Sélection de modèle Claude invalide.'), { status: 500 });
  return { requestedModel: model, modelSource: 'applypilot', requestedThinking: c.effort[task] || c.effort.letter };
}

/** Arguments exacts (hors commande) d'un appel one-shot, sans outil, sans session, sans personnalisation. */
export function claudeArgs({ model, effort, schema }) {
  const args = ['-p', '--output-format', 'json', '--model', model, '--effort', effort, '--tools', '', '--no-session-persistence', '--safe-mode', '--strict-mcp-config', '--system-prompt', SYSTEM_PROMPT];
  if (schema) args.push('--json-schema', JSON.stringify(schema));
  return args;
}

const failure = (message, status = 502) => Object.assign(new Error(message), { status });
function apiError(out) {
  const status = Number(out.api_error_status) || 0;
  const detail = String(out.result || out.subtype || 'erreur inconnue').replace(/\s+/g, ' ').slice(0, 200);
  if (status === 401 || status === 403 || /not logged in|\/login|invalid api key|authentication/i.test(detail)) return failure(`Claude n’est pas connecté : lance « claude » puis /login (${detail})`);
  if (status === 429 || /usage limit|rate limit|quota/i.test(detail)) return failure(`Limite d’utilisation Claude atteinte : ${detail}`, 429);
  return failure(`Claude a échoué : ${detail}`);
}

/** One-shot, tool-free JSON result; only final text, structured output and public attribution survive. */
export function run(prompt, { cfg, task = 'letter', schema, model, effort, timeoutSeconds, signal } = {}) {
  if (signal?.aborted) return Promise.reject(cancelledError());
  const requested = claudeSettings(cfg, task);
  if (model) requested.requestedModel = identifier(model) || requested.requestedModel;
  if (effort) requested.requestedThinking = effort;
  if (!EFFORTS.includes(requested.requestedThinking)) return Promise.reject(failure('Niveau d’effort Claude invalide.', 500));
  const runner = resolveClaude(cfg);
  if (!runner.found) return Promise.reject(failure('Claude Code est introuvable : installe-le et connecte-toi (« claude »), ou indique llm.claude.command / llm.provider: pi dans config.yaml.'));
  const [file, args] = spawnArgs(runner, claudeArgs({ model: requested.requestedModel, effort: requested.requestedThinking, schema: schemaFor(task, schema) }));
  const cwd = ensureDir(path.join(DATA_DIR, 'claude-workdir'));
  const timeoutMs = Math.max(1, Number(timeoutSeconds ?? normalizeLlm(cfg.llm).timeoutSeconds)) * 1000;

  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(file, args, { cwd, env: claudeEnv(), shell: runner.shell, windowsHide: true, detached: process.platform !== 'win32' });
    const chunks = [];
    let bytes = 0, err = '', done = false;
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); activeRuns.delete(cancel); };
    const finish = (fn, value) => { if (done) return; done = true; cleanup(); fn(value); };
    const cancel = () => { if (done) return; killTree(child); finish(reject, cancelledError()); };
    const timer = setTimeout(() => { if (done) return; killTree(child); finish(reject, failure(`claude n’a pas répondu après ${timeoutMs / 1000} s`, 504)); }, timeoutMs);
    activeRuns.add(cancel);
    signal?.addEventListener('abort', cancel, { once: true });

    child.stdout.on('data', chunk => {
      if (done) return;
      bytes += chunk.length;
      if (bytes > 32 * 1024 * 1024) { killTree(child); finish(reject, failure('Flux claude trop volumineux.')); return; }
      chunks.push(chunk);
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => { err = (err + chunk).slice(-8000); });
    child.on('error', e => finish(reject, failure(`Impossible de lancer claude (${runner.desc}) : ${e.message}`)));
    child.on('close', code => {
      if (done) return;
      let out = null;
      try { out = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* traité ci-dessous */ }
      if (!out || typeof out !== 'object' || Array.isArray(out)) {
        const tail = err.trim().split('\n').slice(-8).join('\n');
        return finish(reject, failure(code === 0 ? 'Réponse JSON de claude invalide ou interrompue.' : `claude a échoué (code ${code}) : ${tail || 'aucun détail'}`));
      }
      if (out.is_error || (out.subtype && out.subtype !== 'success')) return finish(reject, apiError(out));
      const text = typeof out.result === 'string' ? out.result.trim() : '';
      const data = out.structured_output && typeof out.structured_output === 'object' ? out.structured_output : undefined;
      if (!text && !data) return finish(reject, failure('Claude n’a pas renvoyé de réponse finale exploitable.'));
      const usage = out.modelUsage && typeof out.modelUsage === 'object' ? out.modelUsage : {};
      const observed = identifier(Object.keys(usage).sort((a, b) => (usage[b]?.outputTokens || 0) - (usage[a]?.outputTokens || 0))[0]);
      const costUsd = Number.isFinite(out.total_cost_usd) ? out.total_cost_usd : null;
      // Provider-neutral token counts (input = input + cache write + cache read); never any content.
      const u = out.usage && typeof out.usage === 'object' ? out.usage : null, n = v => (Number.isFinite(v) && v >= 0 ? v : 0);
      const tokens = u ? { inputTokens: n(u.input_tokens) + n(u.cache_creation_input_tokens) + n(u.cache_read_input_tokens), outputTokens: n(u.output_tokens) } : { inputTokens: null, outputTokens: null };
      finish(resolve, { text, data, ms: Date.now() - started, runner: runner.desc, usage: tokens, generation: { schema: 1, providerKind: 'claude-cli', ...requested,
        observedThinking: null, provider: 'anthropic', model: observed, costUsd, attribution: observed ? 'claude-cli-result' : 'unknown', attempts: 1 } });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(prompt, 'utf8');
  });
}

// `claude --version` lance un processus : jamais sur le chemin d'une requête quand une valeur (même ancienne) existe.
let versionCache = null; // { key, at, value, refreshing }
const VERSION_TTL = 10 * 60_000, VERSION_RETRY = 30_000; // l'échec est revérifié plus vite (installation, connexion)
function probeVersion(runner) {
  return new Promise(resolve => {
    if (!runner.found) return resolve({ available: false, version: null });
    try {
      const [file, args] = spawnArgs(runner, ['--version']);
      execFile(file, args, { shell: runner.shell, timeout: 10_000, windowsHide: true, env: claudeEnv() }, (error, stdout) => {
        const version = String(stdout || '').trim().split('\n')[0] || null;
        resolve(error || !version ? { available: false, version: null } : { available: true, version });
      });
    } catch { resolve({ available: false, version: null }); }
  });
}
/** Dernière version connue ; rafraîchie en arrière-plan quand elle a plus de 10 min, ou dès que le binaire change. */
export async function claudeVersion(cfg, runner = resolveClaude(cfg)) {
  const key = `${runner.file}|${runner.args.join(' ')}`;
  const hit = versionCache?.key === key ? versionCache : null;
  if (!hit) {
    const entry = versionCache = { key, at: Date.now(), value: null, refreshing: null };
    entry.value = await probeVersion(runner);
    entry.at = Date.now();
    return entry.value;
  }
  if (!hit.refreshing && Date.now() - hit.at >= (hit.value?.available ? VERSION_TTL : VERSION_RETRY)) {
    hit.refreshing = probeVersion(runner).then(value => { hit.value = value; hit.at = Date.now(); }).finally(() => { hit.refreshing = null; });
  }
  return hit.value ?? probeVersion(runner);
}
export const resetClaudeVersionCache = () => { versionCache = null; };
