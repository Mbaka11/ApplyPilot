// Édition locale du profil : liste blanche de champs, validation, révision et sauvegarde atomique.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import YAML from 'yaml';
import { DATA_DIR, PROFILE_FILE, invalidateProfileCache, profileWarnings } from './config.js';

const field = (group, key, label, type = 'text', extra = {}) => ({ group, path: key, label, type, ...extra });
export const PROFILE_FIELDS = [
  field('Coordonnées', 'identity.firstName', 'Prénom', 'text', { autocomplete: 'given-name' }),
  field('Coordonnées', 'identity.lastName', 'Nom', 'text', { autocomplete: 'family-name' }),
  field('Coordonnées', 'identity.preferredName', 'Prénom préféré (facultatif)'),
  field('Coordonnées', 'identity.email', 'Courriel', 'email', { autocomplete: 'email' }),
  field('Coordonnées', 'identity.phone', 'Téléphone', 'tel', { autocomplete: 'tel-national' }),
  field('Coordonnées', 'identity.phoneCountryCode', 'Indicatif', 'text', { placeholder: '+1' }),
  field('Coordonnées', 'identity.phoneCountry', 'Pays du téléphone', 'text', { placeholder: 'Canada' }),
  field('Coordonnées', 'identity.phoneType', 'Type de téléphone', 'text', { placeholder: 'Mobile' }),
  field('Adresse', 'identity.address.line1', 'Rue et numéro', 'text', { autocomplete: 'address-line1' }),
  field('Adresse', 'identity.address.line2', 'Appartement / complément (facultatif)', 'text', { autocomplete: 'address-line2' }),
  field('Adresse', 'identity.address.city', 'Ville', 'text', { autocomplete: 'address-level2' }),
  field('Adresse', 'identity.address.province', 'Province / État', 'text', { placeholder: 'Québec' }),
  field('Adresse', 'identity.address.provinceCode', 'Province — abréviation', 'text', { placeholder: 'QC' }),
  field('Adresse', 'identity.address.postalCode', 'Code postal', 'text', { autocomplete: 'postal-code' }),
  field('Adresse', 'identity.address.country', 'Pays', 'text', { autocomplete: 'country-name' }),
  field('Liens', 'links.linkedin', 'LinkedIn', 'url'),
  field('Liens', 'links.github', 'GitHub', 'url'),
  field('Liens', 'links.portfolio', 'Portfolio', 'url'),
  field('Disponibilités', 'availability.term', 'Session (FR)', 'text', { placeholder: 'Hiver 2027' }),
  field('Disponibilités', 'availability.termEn', 'Session (EN)', 'text', { placeholder: 'Winter 2027' }),
  field('Disponibilités', 'availability.startDate', 'Date de début', 'date'),
  field('Disponibilités', 'availability.endDate', 'Date de fin', 'date'),
  field('Disponibilités', 'availability.durationMonths', 'Durée en mois', 'integer', { min: 1, max: 24 }),
  field('Disponibilités', 'availability.fullTime', 'Disponible à temps plein', 'boolean'),
  field('Disponibilités', 'availability.willingToRelocate', 'Prêt à déménager', 'boolean'),
  field('Disponibilités', 'availability.workMode', 'Mode de travail', 'text', { placeholder: 'Hybride' }),
  field('Études — questions générales', 'student.currentlyEnrolled', 'Actuellement inscrit', 'boolean'),
  field('Études — questions générales', 'student.expectedGraduation', 'Fin des études prévue', 'month'),
  field('Études — questions générales', 'student.returningToSchoolAfterInternship', 'Retour aux études après le stage', 'boolean'),
  field('Études — questions générales', 'student.creditedInternship', 'Stage crédité par ton programme', 'boolean'),
  field('Documents', 'documents.transcript', 'Relevé de notes : chemin complet du PDF', 'path', { placeholder: 'C:\\Users\\…\\releve.pdf' }),
  field('Autorisation de travail — Canada', 'workAuthorization.citizenship', 'Citoyenneté'),
  field('Autorisation de travail — Canada', 'workAuthorization.canada.authorizedToWork', 'Autorisé à travailler au Canada', 'boolean'),
  field('Autorisation de travail — Canada', 'workAuthorization.canada.needsSponsorship', 'Besoin de parrainage au Canada', 'boolean'),
  field('Autorisation de travail — Canada', 'workAuthorization.canada.status', 'Statut', 'text', { placeholder: 'Citoyen canadien' }),
  field('Préférences', 'preferences.howDidYouHear', 'Comment nous avez-vous connus ?'),
  field('Préférences', 'preferences.salaryExpectation', 'Attentes salariales (facultatif)'),
];
const LEVEL_HINT = 'natif / courant / avancé / intermédiaire / notions';

/** Un champ « niveau » par langue du profil (les langues elles-mêmes restent dans le YAML). */
function languageFields(profile) {
  return (Array.isArray(profile?.languages) ? profile.languages : [])
    .slice(0, 12)
    .map((l, i) => field('Langues', `languages.${i}.level`, `Niveau — ${l?.language || l?.languageEn || `langue ${i + 1}`}`, 'text', { placeholder: LEVEL_HINT }));
}

const fieldsFor = (profile) => [...PROFILE_FIELDS, ...languageFields(profile)];
const pathKeys = (key) => key.split('.').map((k) => (/^\d+$/.test(k) ? Number(k) : k));
const revisionOf = (raw) => crypto.createHash('sha256').update(raw).digest('hex');
const error = (status, message) => Object.assign(new Error(message), { status });

function readDocument() {
  const raw = fs.existsSync(PROFILE_FILE) ? fs.readFileSync(PROFILE_FILE, 'utf8') : '';
  const doc = YAML.parseDocument(raw);
  if (doc.errors.length) throw error(400, `Profil YAML invalide : ${doc.errors[0].message}`);
  const profile = doc.toJS() ?? {};
  if (typeof profile !== 'object' || Array.isArray(profile)) throw error(400, 'Le profil doit être un objet YAML.');
  return { raw, doc, profile, revision: revisionOf(raw) };
}

export function editableProfile() {
  const { profile, revision } = readDocument();
  return { profile, revision, fields: fieldsFor(profile), warnings: profileWarnings(profile), file: PROFILE_FILE };
}

function validate(f, value) {
  if (f.type === 'boolean') {
    if (value === null || typeof value === 'boolean') return value;
    throw error(400, `${f.label} : oui, non ou « répondre moi-même » attendu.`);
  }
  if (f.type === 'integer') {
    if (value === null || value === '') return null;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < f.min || value > f.max) {
      throw error(400, `${f.label} : entier entre ${f.min} et ${f.max} attendu.`);
    }
    return value;
  }
  if (typeof value !== 'string') throw error(400, `${f.label} : texte attendu.`);
  let s = value.trim();
  if (s.length > 500 || /[\u0000-\u001f\u007f]/.test(s)) throw error(400, `${f.label} : texte trop long ou caractères de contrôle.`);
  if (!s) return ''; // Une information inconnue reste vide, jamais devinée.
  if (f.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw error(400, 'Courriel invalide.');
  if (f.type === 'url') {
    let u;
    try { u = new URL(s); } catch { throw error(400, `${f.label} : URL invalide.`); }
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) throw error(400, `${f.label} : utilise une URL HTTP(S) sans identifiants.`);
  }
  if (f.type === 'month' && !/^\d{4}-(0[1-9]|1[0-2])$/.test(s)) throw error(400, `${f.label} : format AAAA-MM attendu.`);
  if (f.type === 'path') {
    s = s.replace(/^"(.*)"$/, '$1'); // chemin collé depuis l'Explorateur (« Copier en tant que chemin »)
    if (!path.isAbsolute(s) || !/\.pdf$/i.test(s)) throw error(400, `${f.label} : chemin complet d'un fichier PDF attendu.`);
    let st;
    try {
      st = fs.statSync(s);
    } catch {
      throw error(400, `${f.label} : fichier introuvable (${s}).`);
    }
    if (!st.isFile() || st.size > 10 * 1024 * 1024) throw error(400, `${f.label} : fichier PDF de 10 Mo maximum attendu.`);
  }
  if (f.path.startsWith('languages.') && s.length > 60) throw error(400, `${f.label} : 60 caractères maximum.`);
  if (f.type === 'date' && (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s) || new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) !== s)) {
    throw error(400, `${f.label} : date valide au format AAAA-MM-JJ attendue.`);
  }
  if (f.path === 'identity.address.postalCode' || f.path === 'identity.address.provinceCode') s = s.toUpperCase().replace(/\s+/g, ' ');
  return s;
}

export function updateProfile({ revision, values } = {}) {
  if (typeof revision !== 'string' || !/^[a-f0-9]{64}$/.test(revision)) throw error(400, 'Révision du profil manquante : recharge le profil.');
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw error(400, 'Les champs du profil doivent être un objet.');
  const current = readDocument();
  const fields = new Map(fieldsFor(current.profile).map((f) => [f.path, f]));
  const changes = Object.entries(values).map(([key, value]) => {
    const f = fields.get(key);
    if (!f) throw error(400, `Champ non modifiable : ${key}`);
    return [key, validate(f, value)];
  });
  if (revision !== current.revision) throw error(409, 'Le profil a été modifié ailleurs. Tes saisies sont conservées : recharge le profil avant de réessayer.');
  if (!changes.length) return { ...editableProfile(), updated: 0 };
  for (const [key, value] of changes) current.doc.setIn(pathKeys(key), value);
  const next = current.doc.toJS();
  if (next.availability?.startDate && next.availability?.endDate && String(next.availability.endDate) < String(next.availability.startDate)) {
    throw error(400, 'La date de fin du stage ne peut pas précéder la date de début.');
  }
  const dir = path.join(DATA_DIR, 'backups', 'profile');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const suffix = crypto.randomBytes(4).toString('hex');
  if (fs.existsSync(PROFILE_FILE)) fs.copyFileSync(PROFILE_FILE, path.join(dir, `${stamp}-${suffix}.yaml`));
  const tmp = `${PROFILE_FILE}.${suffix}.tmp`;
  try {
    fs.writeFileSync(tmp, current.doc.toString(), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    fs.renameSync(tmp, PROFILE_FILE);
    invalidateProfileCache();
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  return { ...editableProfile(), updated: changes.length };
}
