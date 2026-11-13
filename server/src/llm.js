import { normalizeLlm } from './config.js';
import { cancelAll, killTree } from './llm/common.js';
import * as pi from './llm/pi.js';
import * as claude from './llm/claude.js';

export { killTree, cancelAll };
export const cancelAllPi = cancelAll; // ancien nom
export const { runPi, resolvePi } = pi;
export const runClaude = claude.run;

/** Fournisseur actif : llm.provider explicite, sinon claude si le binaire est trouvé, sinon pi. */
export function resolveProvider(cfg) {
  const explicit = normalizeLlm(cfg.llm).provider;
  if (explicit) return explicit;
  return claude.resolveClaude(cfg).found ? 'claude' : 'pi';
}

/** Réglages affichables (modèle demandé + effort) pour la lettre et les réponses, selon le fournisseur. */
export function generationSettings(cfg) {
  if (resolveProvider(cfg) === 'pi') return pi.generationSettings(cfg);
  return { letter: claude.claudeSettings(cfg, 'letter'), answers: claude.claudeSettings(cfg, 'answers') };
}

/** Infos pour /health : { provider, available, version, model, effort }. */
export async function llmHealth(cfg) {
  const provider = resolveProvider(cfg);
  const settings = normalizeLlm(cfg.llm);
  if (provider === 'pi') {
    const g = pi.generationSettings(cfg);
    return { provider, available: true, version: null, model: g.letter.requestedModel, effort: { letter: g.letter.requestedThinking, answers: g.answers.requestedThinking, tailor: g.letter.requestedThinking },
      apiKeyInEnv: false };
  }
  const v = await claude.claudeVersion(cfg);
  return { provider, available: v.available, version: v.version, model: settings.claude.model, effort: settings.claude.effort, apiKeyInEnv: !!process.env.ANTHROPIC_API_KEY };
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
