import { normalizeLlm } from './config.js';
import { cancelAll, killTree } from './llm/common.js';
import * as pi from './llm/pi.js';
import * as claude from './llm/claude.js';
import { billingMode, recordUsage } from './usage.js';

export { killTree, cancelAll };
export const cancelAllPi = cancelAll; // ancien nom
export const { runPi, resolvePi } = pi;
export const runClaude = claude.run;

/** Fournisseur actif : llm.provider explicite ; sinon pi si l'utilisateur a réglé pi (anciennes clés plates, llm.pi.*) ; sinon claude si le binaire est trouvé, sinon pi. */
export function resolveProvider(cfg) {
  const llm = normalizeLlm(cfg.llm);
  if (llm.provider) return llm.provider;
  if (llm.piConfigured) return 'pi';
  return claude.resolveClaude(cfg).found ? 'claude' : 'pi';
}

/** Réglages affichables (modèle demandé + effort) pour la lettre et les réponses, selon le fournisseur. */
export function generationSettings(cfg, provider = resolveProvider(cfg)) {
  if (provider === 'pi') return pi.generationSettings(cfg);
  return { letter: claude.claudeSettings(cfg, 'letter'), answers: claude.claudeSettings(cfg, 'answers') };
}

/** Infos pour /health : { provider, runner, available, version, model, effort, apiKeyInEnv }. Résout le fournisseur et le binaire une seule fois. */
export async function llmHealth(cfg) {
  const provider = resolveProvider(cfg);
  const settings = normalizeLlm(cfg.llm);
  if (provider === 'pi') {
    const runner = pi.resolvePi(cfg), g = pi.generationSettings(cfg);
    return { provider, runner: runner.desc, available: pi.piAvailable(cfg, runner), version: null, model: g.letter.requestedModel, effort: { letter: g.letter.requestedThinking, answers: g.answers.requestedThinking, tailor: g.letter.requestedThinking },
      apiKeyInEnv: false };
  }
  const runner = claude.resolveClaude(cfg);
  const v = await claude.claudeVersion(cfg, runner);
  return { provider, runner: runner.desc, available: v.available, version: v.version, model: settings.claude.model, effort: settings.claude.effort, apiKeyInEnv: !!process.env.ANTHROPIC_API_KEY };
}

/** Une ligne lisible du fournisseur actif, pour le journal de démarrage et la page d'accueil : « claude (claude.exe) · claude-sonnet-5-5 » ou « pi (…) ». */
export function providerSummary(cfg) {
  const provider = resolveProvider(cfg);
  if (provider === 'pi') return `pi (${pi.resolvePi(cfg).desc})`;
  return `claude (${claude.resolveClaude(cfg).desc}) · ${normalizeLlm(cfg.llm).claude.model}`;
}

/** Un appel brut au fournisseur actif : { text, data?, ms, runner, generation }. */
function runProvider(prompt, opts) {
  const cfg = opts.cfg;
  if (resolveProvider(cfg) === 'pi') return pi.runPi(prompt, opts);
  return claude.run(prompt, opts);
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
  const err = new Error(`Réponse de l’IA illisible (JSON attendu) : ${t.slice(0, 300)}`);
  err.status = 502;
  throw err;
}

const parsed = r => (r.data !== undefined ? r.data : extractJson(r.text));
const addCost = (a, b) => (a == null && b == null ? undefined : (a || 0) + (b || 0));

const addTokens = (a, b) => (a == null && b == null ? null : (a || 0) + (b || 0));

/** Usage log (counters only, never content). Never throws and never slows the generation down. */
function logUsage(opts, started, runs, ok, attempts) {
  try {
    const cfg = opts.cfg || {};
    if (cfg.usage?.enabled === false) return;
    const provider = resolveProvider(cfg), task = opts.task || 'letter';
    let requested = {};
    try { const g = generationSettings(cfg, provider); requested = g[task] || g.letter || {}; } catch { /* unreadable settings */ }
    const gen = [...runs].reverse().find(r => r?.generation)?.generation || {};
    const sum = key => runs.reduce((t, r) => addTokens(t, r?.usage?.[key]), null);
    recordUsage({ at: new Date().toISOString(), task, provider, model: gen.model || opts.model || requested.requestedModel, effort: opts.effort || opts.thinking || requested.requestedThinking,
      ms: ok ? runs.reduce((t, r) => t + (r?.ms || 0), 0) : Date.now() - started, attempts, ok,
      costUsd: runs.reduce((t, r) => addCost(t, r?.generation?.costUsd), undefined) ?? null, inputTokens: sum('inputTokens'), outputTokens: sum('outputTokens'), billing: billingMode() });
  } catch { /* the log must never break a generation */ }
}

/** Appelle le fournisseur et parse le JSON (`structured_output` si présent) ; un second essai est fait si ce n'est pas du JSON valide. */
export async function askJson(prompt, opts = {}) {
  const started = Date.now(), runs = [];
  const call = async text => {
    try { const r = await runProvider(text, opts); runs.push(r); return r; }
    catch (e) { if (e?.name !== 'AbortError') logUsage(opts, started, runs, false, runs.length + 1); throw e; } // a cancellation is not a failure
  };
  const first = await call(prompt);
  try {
    const data = parsed(first);
    logUsage(opts, started, runs, true, 1);
    return { data, ms: first.ms, runner: first.runner, generation: first.generation };
  } catch {
    const retry = await call(
      `${prompt}\n\nIMPORTANT : ta réponse précédente n'était pas un JSON valide. Réponds UNIQUEMENT avec l'objet JSON, sans aucun texte autour.`,
    );
    const generation = { ...retry.generation, attempts: 2 };
    const cost = addCost(first.generation?.costUsd, retry.generation?.costUsd);
    if (cost !== undefined) generation.costUsd = cost;
    let data;
    try { data = parsed(retry); } catch (e) { logUsage(opts, started, runs, false, 2); throw e; }
    logUsage(opts, started, runs, true, 2);
    return { data, ms: first.ms + retry.ms, runner: retry.runner, generation };
  }
}
