import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { escapeHtml, safeFileName } from './util.js';

const require = createRequire(import.meta.url);

const PAPERS = {
  Letter: { css: 'Letter', widthIn: 8.5, heightIn: 11 },
  A4: { css: 'A4', widthIn: 210 / 25.4, heightIn: 297 / 25.4 },
};
const MARGIN = { top: 0.8, bottom: 0.75, side: 0.9 }; // pouces

let fontCss = null;
function fontFaces() {
  if (fontCss !== null) return fontCss;
  try {
    const dir = path.join(path.dirname(require.resolve('@fontsource/roboto/package.json')), 'files');
    const faces = [
      [300, 'normal'],
      [400, 'normal'],
      [400, 'italic'],
      [500, 'normal'],
      [700, 'normal'],
    ];
    fontCss = faces
      .map(([w, st]) => {
        const file = path.join(dir, `roboto-latin-${w}-${st}.woff2`);
        if (!fs.existsSync(file)) return '';
        const b64 = fs.readFileSync(file).toString('base64');
        return `@font-face{font-family:'RobotoAP';font-weight:${w};font-style:${st};src:url(data:font/woff2;base64,${b64}) format('woff2');}`;
      })
      .join('\n');
  } catch {
    fontCss = ''; // repli sur Segoe UI / Arial
  }
  return fontCss;
}

export function formatLetterDate(lang, d = new Date()) {
  if (lang === 'fr') {
    const day = d.getDate();
    const month = d.toLocaleDateString('fr-CA', { month: 'long' });
    return `${day === 1 ? '1er' : day} ${month} ${d.getFullYear()}`;
  }
  return d.toLocaleDateString('en-CA', { month: 'long', day: 'numeric', year: 'numeric' });
}

export function letterFileName({ profile, cfg, language, company, title }) {
  const id = profile.identity || {};
  const pattern = language === 'en' ? cfg.letter.fileNameEn : cfg.letter.fileNameFr;
  const name = String(pattern || '{first}_{last}_{company}.pdf')
    .replace(/\{first\}/g, safeFileName(id.firstName || 'Prenom', 30))
    .replace(/\{last\}/g, safeFileName(id.lastName || 'Nom', 30))
    .replace(/\{company\}/g, safeFileName(company || 'Entreprise', 40))
    .replace(/\{title\}/g, safeFileName(title || 'Poste', 40))
    .replace(/\{date\}/g, new Date().toISOString().slice(0, 10));
  return /\.pdf$/i.test(name) ? name : `${name}.pdf`;
}

function paragraphs(body) {
  return String(body || '')
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

/** Lettre complète en texte brut (pour les champs « collez votre lettre »). */
export function letterPlainText({ letter, profile }) {
  const id = profile.identity || {};
  const signature = profile.letter?.signatureName || [id.firstName, id.lastName].filter(Boolean).join(' ');
  return `${String(letter.body || '').trim()}\n\n${signature}`.trim();
}

export function renderLetterHtml({ letter, profile, cfg, job }) {
  const lang = letter.language === 'en' ? 'en' : 'fr';
  const paper = PAPERS[cfg.letter.paper] || PAPERS.Letter;
  const id = profile.identity || {};
  const links = profile.links || {};
  const fullName = [id.firstName, id.lastName].filter(Boolean).join(' ');
  const signature = profile.letter?.signatureName || fullName;
  const city = cfg.letter.city || id.address?.city || '';
  const date = formatLetterDate(lang);
  const dateLine = city ? (lang === 'fr' ? `${city}, le ${date}` : `${city}, ${date}`) : date;

  const phone = [id.phoneCountryCode, id.phone].filter(Boolean).join(' ');
  const contact = [
    phone && escapeHtml(phone),
    id.email && `<a href="mailto:${escapeHtml(id.email)}">${escapeHtml(id.email)}</a>`,
    links.linkedin && `<a href="${escapeHtml(links.linkedin)}">LinkedIn</a>`,
    links.github && `<a href="${escapeHtml(links.github)}">GitHub</a>`,
    links.portfolio && `<a href="${escapeHtml(links.portfolio)}">Portfolio</a>`,
    city && escapeHtml(city),
  ].filter(Boolean);

  const header = cfg.letter.showHeader
    ? `<header>
  <h1 class="name">${escapeHtml(fullName)}</h1>
  ${profile.headline ? `<div class="headline">${escapeHtml(profile.headline)}</div>` : ''}
  <div class="contact">${contact.map((c) => `<span>${c}</span>`).join('')}</div>
  <hr class="rule">
</header>`
    : '';

  const company = letter.company || job?.company || '';
  const recipientLines = [
    company && `<div class="company">${escapeHtml(company)}</div>`,
    letter.recipient && `<div>${escapeHtml(letter.recipient)}</div>`,
    (letter.location || job?.location) && `<div>${escapeHtml(letter.location || job.location)}</div>`,
  ].filter(Boolean);

  const meta =
    cfg.letter.showRecipient || cfg.letter.showDate
      ? `<div class="meta">
  <div class="recipient">${cfg.letter.showRecipient ? recipientLines.join('') : ''}</div>
  <div class="date">${cfg.letter.showDate ? escapeHtml(dateLine) : ''}</div>
</div>`
      : '';

  const subjectPrefix = lang === 'fr' ? 'Objet\u00a0:' : 'Subject:';
  const contentWidthIn = paper.widthIn - 2 * MARGIN.side;
  const availPx = Math.floor((paper.heightIn - MARGIN.top - MARGIN.bottom) * 96);

  return `<!doctype html>
<html lang="${lang === 'fr' ? 'fr-CA' : 'en-CA'}">
<head>
<meta charset="utf-8">
<title>${escapeHtml(`${signature} – ${company}`)}</title>
<style>
${fontFaces()}
@page { size: ${paper.css}; margin: ${MARGIN.top}in ${MARGIN.side}in ${MARGIN.bottom}in; }
:root { --fs: 10.8pt; --lh: 1.45; --accent: #1A73E8; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; }
body { font-family: 'RobotoAP', 'Segoe UI', Arial, sans-serif; font-weight: 400; color: #1f2328; font-size: var(--fs); line-height: var(--lh); -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page { width: ${contentWidthIn}in; }
header { margin-bottom: 20pt; }
.name { font-size: 19pt; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; margin: 0; line-height: 1.1; }
.headline { font-size: 10.5pt; font-style: italic; color: #444; margin-top: 3pt; }
.contact { margin-top: 6pt; font-size: 8.8pt; color: #333; display: flex; flex-wrap: wrap; gap: 2pt 11pt; }
.contact a { color: var(--accent); text-decoration: none; }
.rule { border: 0; border-top: .9pt solid #1f2328; margin: 8pt 0 0; }
.meta { display: flex; justify-content: space-between; align-items: flex-start; gap: 24pt; margin-bottom: 16pt; }
.recipient { line-height: 1.35; }
.recipient .company { font-weight: 700; }
.date { text-align: right; white-space: nowrap; }
.subject { font-weight: 700; margin: 0 0 11pt; }
.body p { margin: 0 0 8.5pt; text-align: left; }
.signature { margin-top: 12pt; font-weight: 700; }
</style>
</head>
<body>
<div class="page" data-avail-px="${availPx}">
${header}
${meta}
<p class="subject">${escapeHtml(subjectPrefix)} ${escapeHtml(letter.subject || '')}</p>
<div class="body">
${paragraphs(letter.body)}
</div>
<div class="signature">${escapeHtml(signature)}</div>
</div>
</body>
</html>`;
}
