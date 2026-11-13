// Candidature en quatre étapes : une seule dépliée, les autres résumées sur une ligne.
import { S } from '../state.mjs';
import { $, tr } from '../ui.mjs';
import { newContext, pageHasForm, renderActionBar } from './actionbar.mjs';

export const STEPS = ['offer', 'docs', 'fill', 'submit'];
const NAME = { offer: 'Offre', docs: 'Documents', fill: 'Remplissage', submit: 'Soumission' };

const docsReady = () => !!(S.app?.cvId && S.app?.letter);

/** Étape suggérée d’après l’état. Elle n’est jamais imposée : un choix manuel la remplace. */
export function suggestedStep() {
  if (!S.app || newContext()) return 'offer';
  if (S.app.status === 'soumise') return 'submit';
  if (pageHasForm()) return 'fill';
  if (!docsReady()) return 'docs';
  return 'fill';
}
export const openStep = () => (S.step === null ? suggestedStep() : S.step);

export function toggleStep(name) {
  if (!STEPS.includes(name)) return;
  S.step = openStep() === name ? '' : name;
  renderStepper();
}

function summary(name) {
  const a = S.app;
  if (name === 'offer') return a ? [a.job?.company, a.job?.title].filter(Boolean).join(' · ') : S.page?.isPosting ? S.page.title || '' : tr('Aucune offre analysée');
  if (!a && name !== 'fill') return '';
  if (name === 'docs') {
    const cv = S.cvs.find((c) => c.id === a.cvId);
    return `${cv ? cv.name : tr('Pas de CV')} · ${tr(a.letter ? 'Lettre prête' : 'Lettre à générer')}`;
  }
  if (name === 'fill') {
    if (S.fillBusy) return tr(S.fillPhase || 'Préparation…');
    if (S.fill) return tr('{count} champ(s) traité(s)', { count: S.fill.results.length });
    return pageHasForm() ? tr('{count} champ(s) détecté(s)', { count: S.page.fieldCount }) : tr('Pas de formulaire ouvert');
  }
  return tr(a.status === 'soumise' ? 'Soumise ✓' : 'Après ta vérification');
}

const done = (name) => {
  const a = S.app;
  if (name === 'offer') return !!a;
  if (name === 'docs') return docsReady();
  if (name === 'fill') return !!S.fill && !S.fillBusy;
  return a?.status === 'soumise';
};

export function renderStepper() {
  const open = openStep(), suggested = suggestedStep();
  $('#stepper').dataset.appId = S.app?.id || '';
  for (const name of STEPS) {
    const li = $(`.step[data-step="${name}"]`);
    if (!li) continue;
    const isOpen = open === name, isDone = done(name);
    li.classList.toggle('open', isOpen);
    li.classList.toggle('done', isDone);
    li.classList.toggle('suggested', suggested === name && !isOpen);
    const head = li.querySelector('.step-head');
    head.setAttribute('aria-expanded', String(isOpen));
    li.querySelector('.step-num').textContent = isDone ? '✓' : String(STEPS.indexOf(name) + 1);
    li.querySelector('.step-name').textContent = tr(NAME[name]);
    const sum = li.querySelector('.step-sum');
    sum.textContent = isOpen ? '' : summary(name);
    sum.title = isOpen ? '' : summary(name);
    $(`#stepBody-${name}`).hidden = !isOpen;
  }
  renderActionBar();
}
