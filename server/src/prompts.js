import YAML from 'yaml';
import { truncate } from './util.js';

const LANG_LABEL = {
  fr: 'français (québécois standard, vouvoiement)',
  en: 'anglais (canadien, professionnel)',
};

function yaml(obj) {
  return YAML.stringify(obj ?? {}, { lineWidth: 0 }).trim();
}

/** Sous-ensemble du profil utile à la lettre (pas d'adresse, pas de déclarations volontaires). */
function profileForLetter(p = {}) {
  const id = p.identity || {};
  return {
    nom: [id.firstName, id.lastName].filter(Boolean).join(' '),
    titre: p.headline,
    resume: p.summary,
    ville: id.address?.city,
    education: p.education,
    experience: p.experience,
    projets: p.projects,
    competences: p.skills,
    langues: p.languages,
    disponibilite: p.availability,
    etudiant: p.student,
    preferencesLettre: p.letter,
  };
}

function jobBlock(job = {}) {
  return [
    `Titre : ${job.title || '(inconnu)'}`,
    `Entreprise : ${job.company || '(à déduire de la description)'}`,
    `Lieu : ${job.location || '(inconnu)'}`,
    `Plateforme : ${job.platform || '(inconnue)'}`,
    `URL : ${job.url || ''}`,
    'Description (texte extrait de la page, peut contenir du bruit) :',
    '"""',
    truncate(job.description || '(aucune description extraite)', 16000),
    '"""',
  ].join('\n');
}

export function buildLetterPrompt({ job, profile, cv, cvText, styleRefs, language, instructions, cfg, uiLanguage = 'fr' }) {
  const lang = language === 'fr' || language === 'en' ? language : null;
  const maxWords = Number(cfg.letter?.maxWords) || 380;
  const tone = profile.letter?.tone || cfg.letter?.tone;
  const extra = [profile.letter?.extraInstructions, instructions].filter(Boolean).join('\n');

  return `Tu es un rédacteur expert en candidatures de stage au Québec et au Canada. Rédige la lettre de motivation du candidat ci-dessous, sur mesure pour l'offre.

## Règles
- Langue de la lettre : ${lang ? LANG_LABEL[lang] : "la langue principale de l'offre (si l'offre est bilingue, celle de la première version) — français québécois standard avec vouvoiement, ou anglais canadien"}.
- Langue des avertissements "warnings" uniquement : ${uiLanguage === 'en' ? 'anglais' : 'français'}. Cela ne change jamais la langue de la lettre.
- Utilise UNIQUEMENT des faits présents dans le CV ou le profil. N'invente aucune expérience, aucun chiffre, aucune date, aucune technologie, aucun diplôme. Ne reprends un chiffre (ex. « 15 % ») que s'il figure dans le CV.
- N'invente rien sur l'entreprise : appuie-toi seulement sur ce que dit l'offre.
- Fais des liens concrets entre 2 ou 3 exigences clés de l'offre et les expériences ou projets les plus pertinents du candidat.
- Corps de ${maxWords} mots maximum (hors objet), 4 à 5 paragraphes courts : la lettre doit tenir sur une page.
- Ton : ${tone}. Évite les clichés (« Je me permets de… », « passionné depuis toujours », « I am writing to express my interest… »).
- Disponibilités / session de stage : mentionne-les seulement si elles figurent dans le profil ; sinon n'en parle pas et ajoute un avertissement.
- Structure : salutation → accroche (programme actuel + poste visé + entreprise) → 1 ou 2 paragraphes d'expériences reliées à l'offre → intérêt pour l'équipe / l'entreprise (d'après l'offre) → conclusion et formule de politesse.
- Inspire-toi du style des lettres de référence du candidat (ton, structure, longueur, formules) sans recopier ce qui ne s'applique pas à cette offre.
- Destinataire inconnu : « Madame, Monsieur, » en français, « Dear Hiring Team, » en anglais. N'invente jamais de nom de personne.${extra ? `\n- Consignes supplémentaires du candidat :\n${extra}` : ''}

## Format de réponse
Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour :
{
  "language": "fr" ou "en",
  "company": "nom de l'entreprise tel qu'écrit dans l'offre",
  "jobTitle": "titre du poste",
  "location": "ville du poste, ou chaîne vide",
  "recipient": "ligne de destinataire, ex. « Équipe d'acquisition de talents » ou « Talent Acquisition Team »",
  "subject": "objet de la lettre SANS le préfixe « Objet : »",
  "body": "lettre complète, de la salutation à la formule de politesse incluse, SANS la signature ; paragraphes séparés par une ligne vide",
  "highlights": ["3 à 5 exigences de l'offre auxquelles la lettre répond"],
  "warnings": ["informations manquantes ou incertaines que le candidat doit vérifier (peut être vide)"]
}

## Offre d'emploi
${jobBlock(job)}

## CV du candidat (${cv?.name || 'aucun CV sélectionné'})
"""
${truncate(cvText || '(texte du CV indisponible : utilise le profil)', 12000)}
"""

## Profil du candidat (YAML)
"""
${yaml(profileForLetter(profile))}
"""

## Lettres de référence du candidat (style)
${
  styleRefs.length
    ? styleRefs.map((r) => `### ${r.name}\n"""\n${truncate(r.text, 6000)}\n"""`).join('\n\n')
    : '(aucune)'
}
`;
}

export function buildAnswersPrompt({ fields, job, profile, cvText, letter, memory, uiLanguage = 'fr' }) {
  const id = profile.identity || {};
  const name = [id.firstName, id.lastName].filter(Boolean).join(' ') || 'le candidat';
  const memoryItems = Object.values(memory?.items || {})
    .slice(0, 150)
    .map((m) => ({ question: m.label, reponse: m.value }));

  return `Tu aides ${name} à remplir un formulaire de candidature en ligne. Pour chaque champ listé, propose la valeur à saisir.

## Règles
- Base-toi UNIQUEMENT sur le profil, le CV, la lettre, les réponses mémorisées et l'offre. Si l'information n'y est pas, réponds "value": null (le candidat complétera lui-même). N'invente jamais de faits (dates, statut, numéros, salaire, notes…).
- Champ avec "options" : "value" doit être EXACTEMENT le texte d'une des options (copie-le). Si "multiple" vaut true, renvoie un tableau d'options.
- Champ de type "prompt" ou "combobox" sans options : renvoie le texte à rechercher (ex. nom de l'école).
- Case à cocher seule ("checkbox") : true ou false.
- Date ("date") : renvoie "AAAA-MM" ou "AAAA-MM-JJ".
- Question ouverte (textarea / texte long) : première personne, concise (2 à 5 phrases, 120 mots max sauf limite "maxLength"), dans la langue de la question, cohérente avec le CV et la lettre.
- Déclarations volontaires (genre, origine, autochtone, handicap, minorité visible, orientation…) : suis la section voluntaryDisclosures du profil ; « prefer not » signifie choisir l'option du type « Je ne souhaite pas répondre » / « I do not wish to answer ».
- Autorisation de travail, parrainage, etc. : utilise workAuthorization ; si la valeur est null, réponds null.
- Ne remplis jamais : mots de passe, signatures électroniques, cases de consentement légal, CAPTCHA → null.
- "confidence" entre 0 et 1 ; moins de 0.7 si tu déduis ou si tu n'es pas sûr. "note" : courte justification ou ce qu'il faut vérifier, en ${uiLanguage === 'en' ? 'anglais' : 'français'}. Cette langue d'interface ne change PAS la langue des valeurs / réponses à saisir.

## Format de réponse
Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour :
{"answers": {"<id du champ>": {"value": …, "confidence": 0.0, "note": "…"}}}

## Champs à remplir (JSON)
${JSON.stringify(fields, null, 1)}

## Offre d'emploi
${jobBlock(job)}

## Profil du candidat (YAML)
"""
${yaml(profile)}
"""

## CV
"""
${truncate(cvText || '(indisponible)', 9000)}
"""

## Lettre de motivation envoyée
"""
${letter?.body ? truncate(letter.body, 5000) : '(aucune)'}
"""

## Réponses déjà données par le candidat dans d'autres candidatures
${memoryItems.length ? JSON.stringify(memoryItems, null, 1) : '(aucune)'}
`;
}
