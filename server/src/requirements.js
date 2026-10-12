// Exigences repérées dans l'offre (pièces, conditions), comparées au profil : à prévoir AVANT de remplir.
// Simple et déterministe (expressions régulières FR/EN) : aucun appel IA, aucune donnée envoyée.
import fs from 'node:fs';

const norm = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’`´]/g, "'");

/** Extrait court autour de la première correspondance (pour montrer d'où vient l'exigence). */
function excerpt(text, re) {
  const n = norm(text);
  const m = re.exec(n);
  if (!m) return '';
  const start = Math.max(0, m.index - 60);
  const end = Math.min(text.length, m.index + m[0].length + 90);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${end < text.length ? '…' : ''}`;
}

function gpaValue(s) {
  const m = String(s ?? '').match(/(\d+(?:[.,]\d+)?)\s*(?:\/\s*(\d+(?:[.,]\d+)?))?/);
  if (!m) return null;
  const v = parseFloat(m[1].replace(',', '.'));
  const scale = m[2] ? parseFloat(m[2].replace(',', '.')) : 4;
  return Number.isFinite(v) && scale > 0 ? (v / scale) * 4 : null;
}

export function transcriptPath(profile) {
  const p = profile?.documents?.transcript;
  return typeof p === 'string' && p.trim() && fs.existsSync(p.trim()) ? p.trim() : null;
}

/**
 * @returns {{id:string,label:string,status:'ok'|'todo'|'warn'|'info',note:string,excerpt:string}[]}
 */
export function detectRequirements(job = {}, profile = {}) {
  const text = [job.title, job.description, job.requirements].filter(Boolean).join('\n');
  const n = norm(text);
  const out = [];
  const add = (id, label, status, note, re) => out.push({ id, label, status, note, excerpt: re ? excerpt(text, re) : '' });

  const TRANSCRIPT = /transcript|releve de notes|releves de notes|bulletin (de notes|cumulatif)|copie (non officielle|officielle) de (ton|votre) (releve|bulletin)/;
  if (TRANSCRIPT.test(n)) {
    const has = transcriptPath(profile);
    add('transcript', 'Relevé de notes exigé', has ? 'ok' : 'todo', has ? 'Relevé configuré : il sera joint automatiquement' : 'Ajoute le chemin de ton relevé (PDF) dans Profil → Documents', TRANSCRIPT);
  }

  const LETTER = /cover letter|lettre de (motivation|presentation)|letter of (motivation|interest)/;
  if (LETTER.test(n)) add('letter', 'Lettre de motivation demandée', 'info', 'Génère-la ci-dessous avant de remplir', LETTER);

  const CREDIT = /credited internship|internship (for|with) (academic )?credit|for (academic )?credit|stage credite|stage .{0,25}credit|credit(s)? universitaire|institution must credit|must (credit|certify) (your|the) internship|reconnu.{0,30}(programme|cheminement)|(co-?op|cooperatif) (program|programme|term|stage).{0,30}(required|obligatoire|exige)/;
  if (CREDIT.test(n)) {
    const v = profile?.student?.creditedInternship;
    add('credit', 'Stage crédité par le programme', v === true ? 'ok' : v === false ? 'warn' : 'todo',
      v === true ? 'Ton profil : oui' : v === false ? 'Ton profil : non — cette offre semble l’exiger' : 'Réponds dans Profil → Études (oui / non)', CREDIT);
  }

  const GPA = /(gpa|cgpa|moyenne cumulative|cumulative (grade point )?average|moyenne (minimale|d'au moins)|grade point average)[^.\n]{0,40}?(?<v>\d[.,]\d{1,2})/;
  const g = GPA.exec(n);
  if (g) {
    const min = parseFloat(g.groups.v.replace(',', '.'));
    const mine = gpaValue(profile?.education?.[0]?.gpa);
    add('gpa', `GPA minimum ${g.groups.v}`, mine == null ? 'todo' : mine + 1e-9 >= min ? 'ok' : 'warn',
      mine == null ? 'GPA absent du profil' : `Ton GPA actuel : ${profile.education[0].gpa}`, GPA);
  }

  const FRENCH = /bilingu|french and english|english and french|francais et anglais|anglais et francais|maitrise (du|de la langue) francais|francais (est )?(requis|exige|obligatoire)|communiques? en francais|french (is )?(required|mandatory)|advance[d]? french/;
  if (FRENCH.test(n)) add('french', 'Français / bilinguisme exigé', 'info', 'Vérifie tes niveaux de langue dans Profil → Langues', FRENCH);

  const ONSITE = /exclusivement en presentiel|100 ?% (en )?presentiel|on-?site only|fully on-?site|in (the )?office monday|5 (jours|days) (par|per|a|a la) semaine|du lundi au vendredi.{0,40}presentiel/;
  const HYBRID = /hybrid|hybride|(\d) (jours|days) (par|per|a) semaine (au bureau|in office|on-?site)|(\d) days?\/week/;
  if (ONSITE.test(n)) add('onsite', 'Présentiel à temps plein', 'info', 'Aucun télétravail', ONSITE);
  else if (HYBRID.test(n)) add('hybrid', 'Mode hybride', 'info', '', HYBRID);

  const CHECKS = /controlled goods|marchandises controlees|security clearance|cote de (securite|fiabilite)|antecedents judiciaires|background (check|verification)|verification (des|d') antecedents|criminal record/;
  if (CHECKS.test(n)) add('checks', 'Vérifications (antécédents, sécurité)', 'info', 'Conditionnelles à l’embauche : rien à joindre maintenant', CHECKS);

  const ENROLLED = /(must be|be|actively|currently) (actively )?(enrolled|registered)|(etre|etudiant(e)?) inscrit(e)?|returning to (school|studies)/;
  if (ENROLLED.test(n)) {
    const v = profile?.student?.currentlyEnrolled;
    add('enrolled', 'Étudiant inscrit pendant le stage', v === true ? 'ok' : v === false ? 'warn' : 'todo', v === true ? 'Ton profil : inscrit' : 'À préciser dans Profil → Études', ENROLLED);
  }

  const PAY = /(\d{2}[.,]\d{2}|\d{2})\s?\$?\s?(\/ ?heure|de l'heure|per hour|an hour|\/ ?h\b|\$\/h)|\$\s?\d{2}[.,]?\d{0,2}\s?(-|a|to|–)\s?\$?\s?\d{2}[.,]?\d{0,2}\s?(cad )?(per hour|\/h|de l'heure)/;
  const pay = PAY.exec(n);
  // norm() garde la longueur des lettres accentuées précomposées : l'index vaut aussi pour le texte original.
  if (pay) add('pay', 'Rémunération indiquée', 'info', text.slice(pay.index, pay.index + pay[0].length).replace(/s+/g, ' ').trim(), null);

  const DEADLINE = /(posting end date|application deadline|apply by|date limite|date de fin d'affichage|fin de l'affichage)\s*:?\s*(\d{4}-\d{2}-\d{2}|[a-z]+ \d{1,2},? \d{4}|\d{1,2} [a-z]+ \d{4})/;
  const dl = DEADLINE.exec(n);
  if (dl || job.endDate) add('deadline', `Date limite : ${job.endDate || dl[2]}`, 'warn', 'Postule avant cette date', null);

  return out;
}
