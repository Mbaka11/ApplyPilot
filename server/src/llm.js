import { normalizeLlm } from './config.js';
import { cancelAll, killTree } from './llm/common.js';
import * as pi from './llm/pi.js';
import * as claude from './llm/claude.js';

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

/** Appelle le fournisseur et parse le JSON (`structured_output` si présent) ; un second essai est fait si ce n'est pas du JSON valide. */
export async function askJson(prompt, opts = {}) {
  const first = await runProvider(prompt, opts);
  try {
    return { data: parsed(first), ms: first.ms, runner: first.runner, generation: first.generation };
  } catch {
    const retry = await runProvider(
      `${prompt}\n\nIMPORTANT : ta réponse précédente n'était pas un JSON valide. Réponds UNIQUEMENT avec l'objet JSON, sans aucun texte autour.`,
      opts,
    );
    const generation = { ...retry.generation, attempts: 2 };
    const cost = addCost(first.generation?.costUsd, retry.generation?.costUsd);
    if (cost !== undefined) generation.costUsd = cost;
    return { data: parsed(retry), ms: first.ms + retry.ms, runner: retry.runner, generation };
  }
}
