import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { deepMerge } from './util.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DATA_DIR = process.env.APPLYPILOT_DATA_DIR
  ? path.resolve(process.env.APPLYPILOT_DATA_DIR)
  : path.join(ROOT, 'data');
export const CONFIG_FILE = process.env.APPLYPILOT_CONFIG
  ? path.resolve(process.env.APPLYPILOT_CONFIG)
  : path.join(ROOT, 'config.yaml');
export const PROFILE_FILE = process.env.APPLYPILOT_PROFILE
  ? path.resolve(process.env.APPLYPILOT_PROFILE)
  : path.join(ROOT, 'profile.yaml');

const CONFIG_EXAMPLE = path.join(ROOT, 'config.example.yaml');
const PROFILE_EXAMPLE = path.join(ROOT, 'profile.example.yaml');

export const DEFAULTS = {
  server: { host: '127.0.0.1', port: 4317 },
  cvDir: '',
  cvs: [],
  styleDir: 'data/style',
  // Réglages détaillés (claude / pi) : voir normalizeLlm().
  llm: {
    provider: '', // vide = pi si des réglages pi sont présents, sinon claude si le binaire est trouvé, sinon pi
    timeoutSeconds: 300,
  },
  usage: { enabled: true }, // AI usage log (counts and tokens only, never content)
  chrome: { executablePath: '' },
  letter: {
    paper: 'Letter',
    showHeader: true,
    showDate: true,
    showRecipient: true,
    city: '',
    maxWords: 380,
    tone: 'professionnel, direct et concret, sans clichés',
    fileNameFr: '{first}_{last}_Lettre_de_motivation_{company}.pdf',
    fileNameEn: '{first}_{last}_Cover_Letter_{company}.pdf',
  },
  fill: {
    attachLetterWithCv: true,
    // Nom du CV envoyé aux employeurs ({first}, {last}, {lang}) : jamais celui d'une variante
    // (« CV_FR_La_Caisse_Quant.pdf » trahirait une candidature ciblée ailleurs). Vide = nom d'origine.
    cvFileName: '{first}_{last}_CV.pdf',
  },
};

export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const text = (v, d) => (typeof v === 'string' ? v.trim() : v == null ? d : String(v).trim());

const normalizedLlm = new WeakSet();
const filled = v => v != null && String(v).trim() !== '';

/**
 * Normalise llm.* : nouvelle forme (provider/claude/pi) ou anciennes clés plates (lues comme réglages pi). Idempotent :
 * un objet déjà normalisé (par getConfig) est renvoyé tel quel. `piConfigured` = l'utilisateur a réglé pi lui-même
 * (clés plates explicites ou llm.pi.* modifié) : sans llm.provider, on reste alors sur pi.
 */
export function normalizeLlm(llm = {}) {
  if (normalizedLlm.has(llm)) return llm;
  const claude = llm.claude || {}, pi = llm.pi || {}, effort = claude.effort || {};
  const level = (v) => (EFFORTS.includes(v) ? v : 'medium');
  const provider = text(llm.provider, '').toLowerCase();
  const out = {
    provider: ['claude', 'pi'].includes(provider) ? provider : '',
    timeoutSeconds: Number(llm.timeoutSeconds) || 300,
    claude: {
      command: text(claude.command, ''),
      model: text(claude.model, '') || 'claude-sonnet-5-5',
      effort: { letter: level(effort.letter), answers: level(effort.answers), tailor: level(effort.tailor) },
    },
    pi: {
      command: text(pi.command ?? llm.command, 'pi') || 'pi',
      model: text(pi.model ?? llm.model, ''),
      letterThinking: text(pi.letterThinking ?? llm.letterThinking, 'medium'),
      answersThinking: text(pi.answersThinking ?? llm.answersThinking, 'low'),
    },
  };
  out.piConfigured = llm.piConfigured === true
    || ['command', 'model', 'letterThinking', 'answersThinking'].some(k => filled(llm[k]))
    || out.pi.command !== 'pi' || out.pi.model !== '' || out.pi.letterThinking !== 'medium' || out.pi.answersThinking !== 'low';
  normalizedLlm.add(out);
  return out;
}

const cache = new Map();

function readYaml(file) {
  const st = fs.statSync(file);
  const hit = cache.get(file);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.data;
  let data;
  try {
    data = YAML.parse(fs.readFileSync(file, 'utf8')) ?? {};
  } catch (e) {
    const err = new Error(`Erreur de syntaxe YAML dans ${path.basename(file)} : ${e.message}`);
    err.status = 500;
    throw err;
  }
  cache.set(file, { mtimeMs: st.mtimeMs, size: st.size, data });
  return data;
}

/** Résout ~, %VAR% et les chemins relatifs (relatifs à la racine du projet). */
export function expandPath(p) {
  if (!p) return '';
  const s = String(p)
    .replace(/^~(?=$|[\\/])/, os.homedir())
    .replace(/%([^%]+)%/g, (m, v) => process.env[v] ?? m);
  return path.resolve(ROOT, s);
}

/** Crée config.yaml / profile.yaml à partir des exemples s'ils n'existent pas. */
export function ensureUserFiles() {
  const created = [];
  for (const [file, example] of [
    [CONFIG_FILE, CONFIG_EXAMPLE],
    [PROFILE_FILE, PROFILE_EXAMPLE],
  ]) {
    if (!fs.existsSync(file) && fs.existsSync(example)) {
      fs.copyFileSync(example, file);
      created.push(file);
    }
  }
  return created;
}

export function getConfig() {
  const user = fs.existsSync(CONFIG_FILE) ? readYaml(CONFIG_FILE) : {};
  const cfg = deepMerge(DEFAULTS, user);
  if (process.env.APPLYPILOT_PORT) cfg.server.port = Number(process.env.APPLYPILOT_PORT);
  if (process.env.APPLYPILOT_CV_DIR) cfg.cvDir = process.env.APPLYPILOT_CV_DIR;
  cfg.llm = normalizeLlm(cfg.llm);
  cfg.cvDir = expandPath(cfg.cvDir);
  cfg.styleDir = expandPath(cfg.styleDir || 'data/style');
  return cfg;
}

export function getProfile() {
  return fs.existsSync(PROFILE_FILE) ? readYaml(PROFILE_FILE) : {};
}

export function invalidateProfileCache() {
  cache.delete(PROFILE_FILE);
}

const isBlank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

/** Champs importants manquants dans le profil (affichés dans l'extension). */
export function profileWarnings(p = {}) {
  const get = (dotted) => dotted.split('.').reduce((o, k) => (o == null ? undefined : o[k]), p);
  const checks = [
    ['identity.firstName', 'Prénom'],
    ['identity.lastName', 'Nom'],
    ['identity.email', 'Courriel'],
    ['identity.phone', 'Téléphone'],
    ['identity.address.line1', 'Adresse (ligne 1)'],
    ['identity.address.city', 'Ville'],
    ['identity.address.postalCode', 'Code postal'],
    ['workAuthorization.canada.authorizedToWork', 'Autorisé à travailler au Canada (true/false)'],
    ['workAuthorization.canada.needsSponsorship', 'Besoin de parrainage au Canada (true/false)'],
    ['availability.term', 'Session de stage visée (ex. Été 2027)'],
    ['availability.startDate', 'Date de début possible'],
    ['student.expectedGraduation', 'Date de fin d’études prévue'],
  ];
  return checks.filter(([k]) => isBlank(get(k))).map(([pathKey, label]) => ({ path: pathKey, label }));
}
