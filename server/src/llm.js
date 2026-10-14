import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DATA_DIR } from './config.js';
import { ensureDir } from './util.js';

// Variables qui décrivent la session pi *parente* : à ne pas transmettre au pi enfant.
const SESSION_ENV = ['PI_SESSION_ID', 'PI_SESSION_FILE', 'PI_PROVIDER', 'PI_MODEL', 'PI_REASONING_LEVEL', 'PI_CODING_AGENT'];

/** Trouve comment lancer pi sans passer par un .cmd (évite les soucis de shell sous Windows). */
export function resolvePi(cfg) {
  const cmd = (cfg.llm?.command || 'pi').trim();
  if (cmd && cmd !== 'pi') {
    const p = path.resolve(cmd);
    if (/\.(c|m)?js$/i.test(p)) return { file: process.execPath, args: [p], env: {}, shell: false, desc: p };
    return { file: p, args: [], env: {}, shell: /\.(cmd|bat)$/i.test(p), desc: p };
  }
  const agentDir = process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), '.pi', 'agent');
  const installRoot = path.join(agentDir, 'install');
  try {
    const version = fs.readFileSync(path.join(installRoot, 'current-version'), 'utf8').trim();
    const pkgDir = path.join(installRoot, 'releases', version, 'node_modules', '@earendil-works', 'pi-coding-agent');
    const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
    const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.pi;
    const cli = path.resolve(pkgDir, bin);
    if (fs.statSync(cli).isFile()) {
      return {
        file: process.execPath,
        args: [cli],
        env: { PI_MANAGED_INSTALL_ROOT: installRoot },
        shell: false,
        desc: `pi ${version}`,
      };
    }
  } catch {
    /* pas d'installation gérée : on tente le PATH */
  }
  return { file: 'pi', args: [], env: {}, shell: process.platform === 'win32', desc: 'pi (PATH)' };
}

const THINKING = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
const identifier = value => typeof value === 'string' && value.trim() && value.length <= 512 && !/[\u0000-\u001f\u007f]/.test(value) ? value.trim() : null;

/** Read only two non-secret defaults. Never load auth.json, provider headers or tools. */
function selection(cfg, { model, thinking } = {}) {
  const configured = model ?? cfg.llm?.model;
  if (configured && !identifier(configured)) throw Object.assign(new Error('Sélection de modèle pi invalide.'), { status: 500 });
  let requestedModel = identifier(configured), modelSource = 'applypilot';
  if (!requestedModel) {
    modelSource = 'pi-auto';
    try {
      const dir = process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), '.pi', 'agent');
      const defaults = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
      const provider = identifier(defaults.defaultProvider), id = identifier(defaults.defaultModel);
      if (id) { requestedModel = provider ? `${provider}/${id}` : id; modelSource = 'pi-default'; }
    } catch { /* A missing/unreadable default is not observed generation metadata. */ }
  }
  const requestedThinking = THINKING.has(thinking) ? thinking : null;
  return { requestedModel, modelSource, requestedThinking };
}
export function generationSettings(cfg) {
  return { letter: selection(cfg, { thinking: cfg.llm?.letterThinking }), answers: selection(cfg, { thinking: cfg.llm?.answersThinking }) };
}

/** Retain only final text and public attribution, never reasoning blocks or signatures. */
function assistantResult(event) {
  const message = event?.type === 'message_end' ? event.message : event?.type === 'agent_end' ? [...(event.messages || [])].reverse().find(m => m.role === 'assistant') : null;
  if (message?.role !== 'assistant') return null;
  if (['error', 'aborted'].includes(message.stopReason)) throw Object.assign(new Error('Pi a interrompu la génération.'), { status: 502 });
  const text = (Array.isArray(message.content) ? message.content : []).filter(block => block.type === 'text' && typeof block.text === 'string').map(block => block.text).join('');
  return { text, provider: identifier(message.provider), model: identifier(message.model) };
}

const activeRuns = new Set();
const cancelledError = () => Object.assign(new Error('Remplissage arrêté'), { name: 'AbortError', status: 499 });
export function cancelAllPi() {
  for (const cancel of [...activeRuns]) cancel();
}

function killTree(child) {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  } else {
    try { process.kill(-child.pid, 'SIGTERM'); } // owned process group, including launchers
    catch { child.kill('SIGTERM'); }
  }
}

/** One-shot, tool-free JSON events; only assistant text and attribution survive. */
export function runPi(prompt, { cfg, thinking, model, timeoutSeconds, signal } = {}) {
  if (signal?.aborted) return Promise.reject(cancelledError());
  if (thinking && !THINKING.has(thinking)) return Promise.reject(Object.assign(new Error('Niveau d’effort pi invalide.'), { status: 500 }));
  const runner = resolvePi(cfg);
  const args = [
    ...runner.args,
    '--print', '--mode', 'json',
    '--no-tools',
    '--no-session',
    '--no-extensions',
    '--no-skills',
    '--no-prompt-templates',
    '--no-context-files',
    '--no-themes',
  ];
  const requested = selection(cfg, { model, thinking });
  // Freeze the displayed default for this call; later defaults do not rewrite history.
  if (requested.requestedModel) args.push('--model', requested.requestedModel);
  if (requested.requestedThinking) args.push('--thinking', requested.requestedThinking);
  args.push('Suis les instructions ci-dessus et réponds uniquement avec le JSON demandé.');

  const env = { ...process.env, ...runner.env, PI_SKIP_VERSION_CHECK: '1' };
  for (const k of SESSION_ENV) delete env[k];

  const cwd = ensureDir(path.join(DATA_DIR, 'pi-workdir'));
  const timeoutMs = Math.max(30, Number(timeoutSeconds ?? cfg.llm?.timeoutSeconds ?? 300)) * 1000;

  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(runner.file, args, { cwd, env, shell: runner.shell, windowsHide: true, detached: process.platform !== 'win32' });
    let pending = '', result = null, outputBytes = 0;
    let err = '';
    let done = false;
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      activeRuns.delete(cancel);
    };
    const cancel = () => {
      if (done) return;
      done = true;
      cleanup();
      killTree(child);
      reject(cancelledError());
    };
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      cleanup();
      killTree(child);
      reject(Object.assign(new Error(`pi n’a pas répondu après ${timeoutMs / 1000} s`), { status: 504 }));
    }, timeoutMs);
    activeRuns.add(cancel);
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    const consume = line => {
      if (!line.trim()) return;
      const event = JSON.parse(line);
      const next = assistantResult(event);
      if (next) result = next;
    };
    child.stdout.on('data', chunk => {
      if (done) return;
      try {
        outputBytes += Buffer.byteLength(chunk);
        if (outputBytes > 32 * 1024 * 1024 || pending.length + chunk.length > 4 * 1024 * 1024) throw new Error('Flux pi trop volumineux.');
        pending += chunk;
        let end;
        while ((end = pending.indexOf('\n')) >= 0) { consume(pending.slice(0, end)); pending = pending.slice(end + 1); }
      } catch {
        done = true; cleanup(); killTree(child);
        reject(Object.assign(new Error('Flux JSON de pi invalide ou interrompu.'), { status: 502 }));
      }
    });
    child.stderr.on('data', chunk => { err = (err + chunk).slice(-8000); });
    child.on('error', (e) => {
      if (done) return;
      done = true;
      cleanup();
      reject(Object.assign(new Error(`Impossible de lancer pi (${runner.desc}) : ${e.message}`), { status: 502 }));
    });
    child.on('close', (code) => {
      if (done) return;
      done = true;
      cleanup();
      const ms = Date.now() - started;
      if (code !== 0) {
        const tail = err.trim().split('\n').slice(-8).join('\n');
        reject(Object.assign(new Error(`pi a échoué (code ${code}) : ${tail || 'aucun détail'}`), { status: 502 }));
        return;
      }
      try {
        consume(pending);
        if (!result?.text) throw new Error();
        resolve({ text: result.text.trim(), ms, runner: runner.desc, generation: { schema: 1, ...requested, provider: result.provider, model: result.model,
          observedThinking: null, attribution: result.model ? 'pi-assistant-message' : 'unknown', attempts: 1 } });
      } catch { reject(Object.assign(new Error('Pi n’a pas renvoyé de réponse finale exploitable.'), { status: 502 })); }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(prompt, 'utf8');
  });
}

/** Extrait le premier objet JSON d'une réponse (tolère ```json … ``` et du texte autour). */
export function extractJson(text) {
  const t = String(text ?? '').trim();
  const tries = [t];
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) tries.push(fence[1].trim());
  const first = t.indexOf('{');
  const last = t.lastIndexOf('}');
  if (first >= 0 && last > first) tries.push(t.slice(first, last + 1));
  for (const c of tries) {
    try {
      return JSON.parse(c);
    } catch {
      /* essai suivant */
    }
  }
  const err = new Error(`Réponse de pi illisible (JSON attendu) : ${t.slice(0, 300)}`);
  err.status = 502;
  throw err;
}

/** Appelle pi et parse le JSON ; un second essai est fait si le premier n'est pas du JSON valide. */
export async function askJson(prompt, opts) {
  const first = await runPi(prompt, opts);
  try {
    return { data: extractJson(first.text), ms: first.ms, runner: first.runner, generation: first.generation };
  } catch {
    const retry = await runPi(
      `${prompt}\n\nIMPORTANT : ta réponse précédente n'était pas un JSON valide. Réponds UNIQUEMENT avec l'objet JSON, sans aucun texte autour.`,
      opts,
    );
    return { data: extractJson(retry.text), ms: first.ms + retry.ms, runner: retry.runner, generation: { ...retry.generation, attempts: 2 } };
  }
}
