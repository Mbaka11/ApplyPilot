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

function killTree(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  } else {
    child.kill('SIGTERM');
  }
}

/**
 * Lance `pi --print` (sans outils, sans session, sans extensions) avec le prompt sur stdin.
 * Retourne le texte final de l'assistant.
 */
export function runPi(prompt, { cfg, thinking, model, timeoutSeconds } = {}) {
  const runner = resolvePi(cfg);
  const args = [
    ...runner.args,
    '--print',
    '--no-tools',
    '--no-session',
    '--no-extensions',
    '--no-skills',
    '--no-prompt-templates',
    '--no-context-files',
    '--no-themes',
  ];
  const m = model ?? cfg.llm?.model;
  if (m) args.push('--model', m);
  if (thinking) args.push('--thinking', thinking);
  args.push('Suis les instructions ci-dessus et réponds uniquement avec le JSON demandé.');

  const env = { ...process.env, ...runner.env, PI_SKIP_VERSION_CHECK: '1' };
  for (const k of SESSION_ENV) delete env[k];

  const cwd = ensureDir(path.join(DATA_DIR, 'pi-workdir'));
  const timeoutMs = Math.max(30, Number(timeoutSeconds ?? cfg.llm?.timeoutSeconds ?? 300)) * 1000;

  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(runner.file, args, { cwd, env, shell: runner.shell, windowsHide: true });
    let out = '';
    let err = '';
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      killTree(child);
      reject(Object.assign(new Error(`pi n’a pas répondu après ${timeoutMs / 1000} s`), { status: 504 }));
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(Object.assign(new Error(`Impossible de lancer pi (${runner.desc}) : ${e.message}`), { status: 502 }));
    });
    child.on('close', (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const ms = Date.now() - started;
      if (code !== 0) {
        const tail = (err || out).trim().split('\n').slice(-8).join('\n');
        reject(Object.assign(new Error(`pi a échoué (code ${code}) : ${tail || 'aucun détail'}`), { status: 502 }));
        return;
      }
      resolve({ text: out.trim(), ms, runner: runner.desc });
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
    return { data: extractJson(first.text), ms: first.ms, runner: first.runner };
  } catch {
    const retry = await runPi(
      `${prompt}\n\nIMPORTANT : ta réponse précédente n'était pas un JSON valide. Réponds UNIQUEMENT avec l'objet JSON, sans aucun texte autour.`,
      opts,
    );
    return { data: extractJson(retry.text), ms: first.ms + retry.ms, runner: retry.runner };
  }
}
