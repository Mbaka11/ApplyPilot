import fs from 'node:fs';
import path from 'node:path';
import { detectLanguage, escapeRegExp, norm } from './util.js';

function guessLangFromName(base) {
  if (/(^|[_\-\s(])(EN|ENG|English|Anglais)(?=$|[_\-\s).])/i.test(base)) return 'en';
  if (/(^|[_\-\s(])(FR|Francais|Français|French)(?=$|[_\-\s).])/i.test(base)) return 'fr';
  return null;
}

function prettify(base) {
  return base.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function findTex(dir, base, explicit) {
  const candidates = [
    explicit && path.resolve(dir, explicit),
    path.join(dir, base, 'main.tex'),
    path.join(dir, `${base}.tex`),
    path.join(dir, base, `${base}.tex`),
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p)) || null;
}

/**
 * Convertit un CV LaTeX en texte lisible pour le modèle.
 * Pas parfait (le LaTeX résiduel est bien compris par le LLM), mais réduit le bruit.
 */
/** Remplace chaque \begin{env} et ses arguments [..] / {..} (accolades imbriquees comprises) par un saut de ligne. */
function stripBeginArgs(s) {
  const re = /\\begin\{[a-zA-Z*]+\}/g;
  let out = '';
  let last = 0;
  let m;
  while ((m = re.exec(s))) {
    out += `${s.slice(last, m.index)}\n`;
    let i = m.index + m[0].length;
    for (;;) {
      while (s[i] === ' ') i++;
      const open = s[i];
      if (open !== '[' && open !== '{') break;
      const close = open === '[' ? ']' : '}';
      let depth = 0;
      let j = i;
      for (; j < s.length; j++) {
        if (s[j] === open) depth++;
        else if (s[j] === close && --depth === 0) break;
      }
      i = j + 1;
    }
    last = i;
    re.lastIndex = i;
  }
  return out + s.slice(last);
}

export function texToText(tex) {
  let s = String(tex);
  const begin = s.indexOf('\\begin{document}');
  const end = s.lastIndexOf('\\end{document}');
  if (begin >= 0) s = s.slice(begin + '\\begin{document}'.length, end > begin ? end : undefined);

  s = s.replace(/(^|[^\\])%.*$/gm, '$1'); // commentaires
  s = s.replace(/\\&/g, '\u0001'); // esperluette littérale (protégée)
  s = s.replace(/\\%/g, '\u0002');
  s = s.replace(/\\href\{([^}]*)\}\{([^}]*)\}/g, (m, url, text) =>
    /^mailto:/i.test(url) || url === text ? text : `${text} (${url})`,
  );
  s = s.replace(/\\url\{([^}]*)\}/g, '$1');
  // \begin{env}[opt]{arg}{spec avec {imbrication}} … et \end{env}
  s = stripBeginArgs(s);
  s = s.replace(/\\end\{[a-zA-Z*]+\}/g, '\n');
  s = s.replace(/\\(?:vspace|hspace)\*?\{[^}]*\}/g, ' ');
  s = s.replace(/\\rule(?:\[[^\]]*\])?\{[^}]*\}\{[^}]*\}/g, ' ');
  s = s.replace(/\\fontsize\{[^}]*\}\{[^}]*\}/g, '');
  s = s.replace(/\\makebox(?:\[[^\]]*\])*/g, '');
  s = s.replace(/\\parbox(?:\[[^\]]*\])*\{[^}]*\}/g, '');
  s = s.replace(/\\raisebox\{[^}]*\}/g, '');
  s = s.replace(/\\hangindent=\S+/g, '');
  s = s.replace(/\\fa[A-Za-z]+\*?/g, '');
  s = s.replace(/\\textbullet\\?\s*/g, '• ');
  s = s.replace(/\\item\b/g, '\n• ');
  s = s.replace(/\\\\(?:\[[^\]]*\])?/g, '\n');
  s = s.replace(/\\([#$_{}])/g, '$1');
  s = s.replace(/---/g, '—').replace(/--/g, '–');
  s = s.replace(/~/g, ' ');
  s = s.replace(/&/g, ' | ');
  s = s.replace(/\\[a-zA-Z]+\*?/g, ' '); // commandes restantes
  s = s.replace(/[{}]/g, '');
  s = s.replace(/\u0001/g, '&').replace(/\u0002/g, '%');
  return s
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').replace(/^(\s*\|\s*)+/, '').replace(/(\s*\|\s*)+$/, '').trim())
    .filter((l) => l && !/^[|\s•]+$/.test(l))
    .join('\n');
}

/** Liste les variantes de CV : chaque PDF du dossier, avec son .tex s'il existe. */
export function listCvs(cfg) {
  const dir = cfg.cvDir;
  if (!dir) return { cvs: [], error: 'cvDir n’est pas configuré dans config.yaml' };
  if (!fs.existsSync(dir)) return { cvs: [], error: `Dossier de CV introuvable : ${dir}` };
  const descriptors = Array.isArray(cfg.cvs) ? cfg.cvs : [];
  const pdfs = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && /\.pdf$/i.test(e.name))
    .map((e) => e.name)
    .sort();

  const cvs = [];
  for (const file of pdfs) {
    const base = file.replace(/\.pdf$/i, '');
    const desc = descriptors.find((d) => d && (d.file === file || d.file === base)) || {};
    if (desc.hidden) continue;
    const pdfPath = path.join(dir, file);
    const texPath = findTex(dir, base, desc.tex);
    const st = fs.statSync(pdfPath);
    const cv = {
      id: base,
      name: desc.label || prettify(base),
      file,
      pdfPath,
      texPath,
      language: desc.language || guessLangFromName(base),
      tags: Array.isArray(desc.tags) ? desc.tags : [],
      default: !!desc.default,
      size: st.size,
      modifiedAt: st.mtime.toISOString(),
    };
    if (!cv.language) cv.language = texPath ? detectLanguage(getCvText(cv)) : null;
    cvs.push(cv);
  }
  return { cvs };
}

export function getCvText(cv) {
  if (!cv?.texPath) return '';
  try {
    return texToText(fs.readFileSync(cv.texPath, 'utf8'));
  } catch {
    return '';
  }
}

export function publicCv(cv) {
  const { pdfPath, texPath, ...rest } = cv;
  return { ...rest, hasTex: !!texPath };
}

/**
 * Recommande un CV : langue de l'offre (+10), variante générale (+4), mots-clés des variantes
 * spécialisées (+3 par tag). Une variante spécialisée l'emporte donc dès 2 mots-clés trouvés.
 */
export function recommendCv(cvs, job = {}) {
  if (!cvs.length) return null;
  const text = ` ${norm(`${job.title || ''} ${job.company || ''} ${job.description || ''}`)} `;
  const lang = job.language || detectLanguage(job.description || job.title || '');
  let best = null;
  for (const cv of cvs) {
    let score = 0;
    const reasons = [];
    if (cv.language && cv.language === lang) {
      score += 10;
      reasons.push(`langue ${lang.toUpperCase()}`);
    }
    const hits = (cv.tags || []).filter((t) => new RegExp(`\\b${escapeRegExp(norm(t))}\\b`).test(text));
    score += hits.length * 3;
    if (hits.length) reasons.push(`mots-clés : ${hits.slice(0, 4).join(', ')}`);
    if ((cv.tags || []).length && !hits.length) score -= 2;
    if (cv.default) score += 4;
    if (!best || score > best.score) best = { cv, score, reasons };
  }
  return { cvId: best.cv.id, reason: best.reasons.join(' · ') || 'par défaut', language: lang };
}
