import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { texToText } from './cvs.js';
import { killTree } from './llm.js';
import { detectLanguage, norm, truncate } from './util.js';

/**
 * Per-posting CV tailoring. Only two kinds of text may change in a copy of the
 * chosen LaTeX CV: the About paragraph and the order/selection of the items in
 * each skills row. Every claim must come from the candidate's own CV/profile,
 * and the copy must still compile to a single page. The original CV is never
 * written.
 */

const ABOUT_HEADS = /^(about me|about|summary|a propos|profil|profile)$/;
const SKILLS_HEADS = /^(skills|competences)$/;
const HUMAN_LANGUAGE_ROWS = /^(languages?|langues?)$/;
const SECHEAD = /\\sechead\{([^}]*)\}/;

export class TailorError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    if (details) this.details = details;
  }
}

export const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

const skillKey = (item) => norm(String(item).replace(/\\mbox\{([^}]*)\}/g, '$1'));

/** Locates the editable parts of a CV written with the \sechead layout. */
export function parseTailorable(source) {
  const crlf = source.includes('\r\n');
  const lines = String(source).replace(/\r\n/g, '\n').split('\n');
  const headIndex = (re) => lines.findIndex((line) => {
    const m = SECHEAD.exec(line);
    return m && re.test(norm(m[1]));
  });
  const endOfBlock = (from) => {
    for (let i = from; i < lines.length; i++) if (lines[i].trim() === '}') return i;
    return -1;
  };

  const aboutHead = headIndex(ABOUT_HEADS);
  if (aboutHead < 0) throw new TailorError(422, 'Ce CV n’a pas de section « À propos » reconnue : adaptation impossible.');
  const aboutEnd = endOfBlock(aboutHead + 1);
  const aboutLines = aboutEnd > aboutHead + 1 ? lines.slice(aboutHead + 1, aboutEnd) : [];
  const text = aboutLines.map((l) => l.trim()).filter(Boolean).join(' ');
  if (aboutEnd < 0 || !text) throw new TailorError(422, 'La section « À propos » de ce CV est illisible : adaptation impossible.');
  if (/[\\{}]/.test(text.replace(/\\[&%$#_]/g, ''))) throw new TailorError(422, 'La section « À propos » contient du formatage LaTeX : adaptation impossible.');

  const skills = [];
  const skillsHead = headIndex(SKILLS_HEADS);
  if (skillsHead >= 0) {
    const end = endOfBlock(skillsHead + 1);
    const row = /^(\s*\\textbf\{([^}]*?):?\}\s*&\s*)(.+?)(\s*\\\\(?:\[[^\]]*\])?)?\s*$/;
    for (let i = skillsHead + 1; i < (end < 0 ? lines.length : end); i++) {
      const m = row.exec(lines[i]);
      if (!m || HUMAN_LANGUAGE_ROWS.test(norm(m[2]))) continue;
      skills.push({ line: i, label: m[2].trim(), prefix: m[1], items: m[3].split(/,\s*/).map((s) => s.trim()).filter(Boolean), suffix: m[4] || '' });
    }
  }
  return {
    crlf,
    lines,
    about: { start: aboutHead + 1, end: aboutEnd, indent: /^\s*/.exec(aboutLines.find((l) => l.trim()) || '')[0], text },
    skills,
  };
}

export function escapeLatexText(text) {
  return String(text).replace(/[&%$#_]/g, (c) => `\\${c}`).replace(/\^/g, '\\^{}').replace(/~/g, '\\textasciitilde{}');
}

/** Everything the candidate has written about themselves, normalised for membership checks. */
export function buildFactBank({ tex, profile = {}, job = {} }) {
  const cvText = texToText(tex);
  const pick = (p) => JSON.stringify({ education: p.education, experience: p.experience, projects: p.projects, skills: p.skills, languages: p.languages, headline: p.headline, student: p.student });
  const bank = norm(`${cvText} ${pick(profile)}`);
  const allowed = norm(`${job.company || ''} ${job.title || ''}`);
  const words = new Set(bank.split(/[^a-z0-9+#]+/).filter(Boolean));
  const numbers = new Set(bank.match(/\d+/g) || []);
  const extra = new Set(allowed.split(/[^a-z0-9+#]+/).filter(Boolean));
  return { cvText, bank, words, numbers, extra };
}

function findUnsupported(text, bank) {
  const problems = [];
  const tokenRe = /[\p{L}\p{N}+#./-]+/gu;
  let m;
  while ((m = tokenRe.exec(text))) {
    const token = m[0].replace(/^[./-]+|[./-]+$/g, '');
    if (!token) continue;
    const prev = text.slice(0, m.index).trimEnd();
    const sentenceStart = !prev || /[.!?:;]$/.test(prev) || /[\n]$/.test(text.slice(0, m.index));
    const technical = /\p{Lu}/u.test(token.slice(1)) || /[\d+#]/.test(token) || (/^\p{Lu}/u.test(token) && !sentenceStart);
    if (!technical) continue;
    for (const part of token.split(/[-/.]/).filter((p) => p.length > 1)) {
      const key = norm(part);
      if (/^\d+$/.test(key)) continue;
      if (!bank.words.has(key) && !bank.extra.has(key) && !bank.words.has(key.replace(/s$/, ''))) problems.push(`terme « ${part} » absent du CV`);
    }
  }
  return [...new Set(problems)];
}

/** Rejects anything that is not a faithful reordering/rewording of the candidate's own material. */
export function validateProposal({ parsed, proposal, bank }) {
  const errors = [];
  const about = typeof proposal?.about === 'string' ? proposal.about.replace(/\s+/g, ' ').trim() : '';
  const base = parsed.about.text;
  if (!about) errors.push('texte « À propos » manquant');
  else {
    if (/[\\{}$]|[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(about)) errors.push('le texte contient des caractères de formatage interdits');
    if (about.length < Math.min(120, base.length * 0.5)) errors.push('texte « À propos » trop court');
    if (about.length > Math.max(base.length * 1.25, base.length + 90)) errors.push('texte « À propos » trop long pour tenir sur une page');
    if (/\d/.test(about.replace(/[\p{L}+#][\p{L}\d+#]*/gu, ''))) errors.push('chiffres interdits dans « À propos »');
    errors.push(...findUnsupported(about, bank));
  }

  const proposed = new Map();
  for (const entry of Array.isArray(proposal?.skills) ? proposal.skills : []) {
    if (entry && typeof entry.label === 'string' && Array.isArray(entry.items)) proposed.set(norm(entry.label.replace(/:$/, '')), entry.items.map(String));
  }
  const skills = parsed.skills.map((row) => {
    const items = proposed.get(norm(row.label));
    if (!items) return row.items;
    const byKey = new Map(row.items.map((item) => [skillKey(item), item]));
    const chosen = [];
    for (const item of items) {
      const original = byKey.get(skillKey(item));
      if (!original) { errors.push(`compétence inventée « ${String(item).slice(0, 40)} » dans ${row.label}`); continue; }
      if (!chosen.includes(original)) chosen.push(original);
    }
    const minimum = Math.min(row.items.length, Math.max(3, Math.ceil(row.items.length * 0.6)));
    if (chosen.length < minimum) { errors.push(`trop de compétences retirées dans ${row.label}`); return row.items; }
    return chosen;
  });
  return { ok: errors.length === 0, errors, about, skills };
}

export function applyTailoring(parsed, { about, skills }) {
  const lines = [...parsed.lines];
  const replacement = `${parsed.about.indent}${escapeLatexText(about)}`;
  lines.splice(parsed.about.start, parsed.about.end - parsed.about.start, replacement);
  const shift = 1 - (parsed.about.end - parsed.about.start);
  parsed.skills.forEach((row, i) => {
    lines[row.line > parsed.about.start ? row.line + shift : row.line] = `${row.prefix}${skills[i].join(', ')}${row.suffix}`;
  });
  const text = lines.join('\n');
  return parsed.crlf ? text.replace(/\n/g, '\r\n') : text;
}

export function buildTailorPrompt({ job, cv, parsed, bank, language, instructions = '' }) {
  const rows = parsed.skills.map((r) => `- ${r.label} : ${r.items.join(', ')}`).join('\n');
  const langName = language === 'fr' ? 'français (québécois)' : 'anglais (canadien)';
  return `Tu adaptes la section « À propos » et l'ordre des compétences d'un CV à une offre précise. Tu ne rédiges pas une lettre et tu ne modifies rien d'autre.

## Règles strictes
- Langue de sortie : ${langName}, la même que le CV.
- Utilise UNIQUEMENT des faits présents dans le CV et le profil ci-dessous : aucune expérience, technologie, outil, chiffre, date, diplôme, résultat ou affirmation nouveau. Ne cite aucune exigence de l'offre que le candidat ne démontre pas.
- « À propos » : un court pitch personnel à la première personne (3 à 5 phrases, environ ${parsed.about.text.length} caractères, jamais plus de ${Math.round(Math.max(parsed.about.text.length * 1.2, parsed.about.text.length + 80))}). Ce n'est PAS un résumé des expériences : dis ce qui motive le candidat, le genre de problèmes qu'il aime et ce qu'il cherche, en l'orientant vers 2 ou 3 thèmes de l'offre qu'il peut réellement soutenir. Pas de chiffres, pas de liste de technologies, pas de formatage, pas de clichés (« passionné depuis toujours »).
- Compétences : pour chaque rangée ci-dessous, renvoie les MÊMES éléments (aucun nouveau, orthographe identique) dans l'ordre le plus utile pour cette offre. Tu peux retirer au plus 40 % des éléments d'une rangée, jamais ceux que l'offre demande explicitement.
- Ne touche ni aux langues parlées, ni aux dates, ni aux expériences, ni aux projets.${instructions ? `\n- Consignes du candidat : ${instructions}` : ''}

## Offre
Titre : ${job.title || '(inconnu)'}
Entreprise : ${job.company || '(inconnue)'}
Lieu : ${job.location || '(inconnu)'}
"""
${truncate(job.description || '(aucune description)', 12000)}
"""

## À propos actuel (à remplacer, même ton et même longueur)
${parsed.about.text}

## Compétences actuelles (une rangée par ligne)
${rows || '(aucune rangée modifiable)'}

## Faits du candidat (CV complet)
${truncate(bank.cvText, 9000)}

## Format de réponse
Réponds UNIQUEMENT avec un objet JSON valide :
{
  "about": "nouveau texte",
  "skills": [{"label": "libellé exact de la rangée", "items": ["éléments réordonnés"]}],
  "keywords": ["2 à 6 thèmes de l'offre auxquels tu as répondu"],
  "warnings": ["limites ou doutes que le candidat doit vérifier (peut être vide)"]
}${cv?.name ? `\n\n(CV de base : ${cv.name})` : ''}`;
}

// ---------------------------------------------------------------------------
// Compilation
// ---------------------------------------------------------------------------

function onPath(name) {
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext);
      try { if (fs.statSync(candidate).isFile()) return candidate; } catch { /* next */ }
    }
  }
  return null;
}

export function findLatex(cfg) {
  const configured = cfg?.cvTailor?.pdflatex;
  if (configured) return fs.existsSync(configured) ? configured : null;
  const local = process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'MiKTeX', 'miktex', 'bin', 'x64', 'pdflatex.exe');
  return onPath('pdflatex') || (local && fs.existsSync(local) ? local : null);
}

/** Compiles the tailored source in a throw-away folder; returns the PDF bytes and the page count. */
export async function compileTex(source, { cfg, signal, timeoutMs = 120_000 } = {}) {
  if (signal?.aborted) throw new TailorError(499, 'Adaptation du CV arrêtée.');
  const exe = findLatex(cfg);
  if (!exe) throw new TailorError(503, 'LaTeX (pdflatex) est introuvable : installe MiKTeX ou TeX Live, ou indique cvTailor.pdflatex dans config.yaml.');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'applypilot-cv-'));
  try {
    fs.writeFileSync(path.join(dir, 'main.tex'), source, 'utf8');
    const script = /\.(mjs|js)$/i.test(exe);
    const args = [...(script ? [exe] : []), '-interaction=nonstopmode', '-halt-on-error', '-no-shell-escape', '-disable-write18', 'main.tex'];
    const code = await new Promise((resolve, reject) => {
      const child = spawn(script ? process.execPath : exe, args, { cwd: dir, stdio: 'ignore', windowsHide: true, detached: process.platform !== 'win32' });
      const stop = () => { killTree(child); };
      const timer = setTimeout(() => { stop(); reject(new TailorError(504, 'La compilation du CV a dépassé le délai.')); }, timeoutMs);
      const abort = () => { stop(); reject(new TailorError(499, 'Adaptation du CV arrêtée.')); };
      if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
      child.on('error', (e) => { clearTimeout(timer); reject(new TailorError(503, `Impossible de lancer LaTeX : ${e.message}`)); });
      child.on('close', (c) => { clearTimeout(timer); signal?.removeEventListener('abort', abort); resolve(c); });
    });
    const pdf = path.join(dir, 'main.pdf');
    if (code !== 0 || !fs.existsSync(pdf)) {
      let tail = '';
      try { tail = fs.readFileSync(path.join(dir, 'main.log'), 'utf8').split('\n').filter((l) => l.startsWith('!')).slice(0, 2).join(' '); } catch { /* no log */ }
      throw new TailorError(422, `Le CV adapté ne compile pas${tail ? ` (${tail.slice(0, 160)})` : ''}. Le CV d’origine est intact.`);
    }
    let pages = 0;
    try { pages = Number(/\((\d+) pages?[,)]/.exec(fs.readFileSync(path.join(dir, 'main.log'), 'utf8').replace(/\r?\n/g, ''))?.[1]) || 0; } catch { /* count below */ }
    const bytes = fs.readFileSync(pdf);
    if (!pages) pages = (bytes.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
    return { bytes, pages };
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* the OS temp folder is cleaned later */ }
  }
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/**
 * Builds a tailored copy for one posting. `ask` and `compile` are injectable so tests can run
 * without a model or a LaTeX installation.
 */
export async function tailorCv({ job, cv, profile, cfg, instructions = '', ask, compile = compileTex, signal }) {
  if (!cv?.texPath || !fs.existsSync(cv.texPath)) throw new TailorError(422, 'Le CV sélectionné n’a pas de source LaTeX : adaptation impossible.');
  const source = fs.readFileSync(cv.texPath, 'utf8');
  const parsed = parseTailorable(source);
  if (!findLatex(cfg) && compile === compileTex) throw new TailorError(503, 'LaTeX (pdflatex) est introuvable : installe MiKTeX ou TeX Live, ou indique cvTailor.pdflatex dans config.yaml.');
  const bank = buildFactBank({ tex: source, profile, job });
  const language = cv.language === 'fr' || cv.language === 'en' ? cv.language : detectLanguage(parsed.about.text, 'fr');
  const prompt = buildTailorPrompt({ job, cv, parsed, bank, language, instructions });
  const { data, ms, generation } = await ask(prompt, { cfg, task: 'tailor', signal });
  if (signal?.aborted) throw new TailorError(499, 'Adaptation du CV arrêtée.');
  const verdict = validateProposal({ parsed, proposal: data, bank });
  if (!verdict.ok) throw new TailorError(422, `Adaptation refusée : ${verdict.errors.slice(0, 4).join(' ; ')}. Le CV d’origine est intact.`, verdict.errors);
  const tailoredTex = applyTailoring(parsed, verdict);
  const { bytes, pages } = await compile(tailoredTex, { cfg, signal });
  if (pages !== 1) throw new TailorError(422, `Le CV adapté occupe ${pages} pages : il doit tenir sur une seule page. Relance l’adaptation.`);
  return {
    tex: tailoredTex,
    pdf: bytes,
    report: {
      schema: 1,
      baseCvId: cv.id,
      baseTexSha256: sha256(source),
      language,
      pages,
      generationMs: ms,
      generation,
      about: { before: parsed.about.text, after: verdict.about },
      skills: parsed.skills.map((row, i) => ({ label: row.label, before: row.items, after: verdict.skills[i] })),
      keywords: (Array.isArray(data.keywords) ? data.keywords : []).map((k) => String(k).slice(0, 80)).slice(0, 8),
      warnings: (Array.isArray(data.warnings) ? data.warnings : []).map((w) => String(w).slice(0, 300)).slice(0, 6),
      checks: { factsOnly: true, unsupportedTerms: 0, singlePage: true },
    },
  };
}
