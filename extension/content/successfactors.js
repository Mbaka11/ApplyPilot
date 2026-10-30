// SuccessFactors: conservative ARIA interaction and visible manual-action guidance.
// No private IDs/classes, page internals, attachment-dialog guesses or automatic Add/Save/Submit clicks.
(() => {
  const AP = globalThis.ApplyPilot;
  const enabled = () => AP.platform() === 'successfactors';
  const sectionType = group => {
    if (!group) return null;
    const name = AP.norm(AP.labelFor(group));
    if (/^(informations sur les etudes|education|education information|educational information|etudes|formation)$/.test(name)) return 'education';
    if (/^(quelles langues|languages?\b|langues?\b|what languages|which languages)/.test(name)) return 'language';
    return null;
  };
  function manualReason(element) {
    if (!enabled()) return '';
    if (element.matches('input[type="file"]')) return 'Pièce jointe SuccessFactors non automatisée : sélectionne et vérifie le fichier manuellement.';
    if (element.closest('[role="dialog"], dialog')) return 'Dialogue SuccessFactors non validé : complète-le manuellement, sans relancer le remplissage ici.';
    for (let group = element.closest('[role="group"][aria-labelledby]'); group; group = group.parentElement?.closest('[role="group"][aria-labelledby]')) {
      if (sectionType(group)) return 'Section SuccessFactors non validée : complète et enregistre les entrées manuellement.';
    }
    return '';
  }
  function actions(root) {
    if (!enabled()) return [];
    const found = [];
    for (const element of root.querySelectorAll('button, [role="button"]')) {
      if (!AP.isVisible(element) || AP.isOffscreen(element) || element.matches(':disabled, [aria-disabled="true"]') || element.closest('[role="dialog"], dialog')) continue;
      // A heading's accordion button may have native type=submit. Never treat it as an action.
      if (element.tagName === 'BUTTON' && element.type !== 'button') continue;
      const label = element.hasAttribute('aria-labelledby') || element.hasAttribute('aria-label')
        ? AP.labelFor(element) : AP.textOf(element) || AP.labelFor(element);
      const name = AP.norm(`${label} ${AP.textOf(element)}`);
      let actionType = null;
      if (/televers|upload|joindre|attach|ajouter un document|add (a )?document/.test(name)) {
        if (/\bcv\b|resume|curriculum/.test(name)) actionType = 'resume';
        else if (/lettre|cover letter/.test(name)) actionType = 'cover-letter';
        else if (/document|piece.*jointe|attachment/.test(name)) actionType = 'attachment';
      } else if (/^(ajouter|add|add another)$/.test(AP.norm(AP.textOf(element)))) {
        actionType = sectionType(element.closest('[role="group"][aria-labelledby]'));
      }
      if (!actionType || found.some(row => row.element.contains(element) || element.contains(row.element))) continue;
      found.push({ element, actionType, label, required: actionType === 'resume' && /\*/.test(label) });
    }
    return found;
  }
  function actionAnswer(d, ctx) {
    const notes = {
      resume: ctx.files.cv
        ? 'CV à vérifier : ouvre « Téléverser un CV » et joins le PDF sélectionné manuellement si nécessaire.'
        : 'Aucun CV sélectionné : analyse l’offre dans un autre onglet, puis reviens joindre le CV manuellement.',
      'cover-letter': ctx.files.letter
        ? 'Lettre à vérifier : ouvre « Joindre une lettre d’accompagnement » et joins le PDF manuellement si nécessaire.'
        : 'Lettre à vérifier : génère et relis la lettre si nécessaire, puis joins-la manuellement.',
      attachment: 'Autres documents : ouvre « Ajouter un document » seulement si une pièce supplémentaire est demandée.',
      education: 'Études : clique « Ajouter », puis complète et enregistre chaque formation manuellement. Aucun bloc ajouté automatiquement.',
      language: 'Langues : clique « Ajouter » et complète les langues demandées manuellement, sans inventer de niveau.',
    };
    return { missing: true, note: notes[d.actionType] || 'Action manuelle requise.', ruleId: 'manual-action' };
  }
  function liveInput(d) {
    const element = (d.htmlId && document.getElementById(d.htmlId)) || (d.el?.isConnected ? d.el : null);
    if (!element || element.tagName !== 'INPUT' || element.getAttribute('role') !== 'combobox' || element.disabled || element.getAttribute('aria-disabled') === 'true') return null;
    d.el = element;
    if (!element.hasAttribute('data-applypilot-id')) element.setAttribute('data-applypilot-id', d.id);
    return element;
  }
  function ownedOptions(input) {
    const ids = `${input?.getAttribute('aria-controls') || ''} ${input?.getAttribute('aria-owns') || ''}`.trim().split(/\s+/);
    const options = new Set();
    for (const id of ids.slice(0, 6)) {
      const container = document.getElementById(id);
      if (!container || !AP.isVisible(container)) continue;
      for (const option of container.querySelectorAll('[role="option"]')) {
        if (AP.isVisible(option) && !option.matches(':disabled, [aria-disabled="true"]')) options.add(option);
      }
    }
    return [...options]; // Never search unrelated/global options when an owner is absent.
  }
  function exactOption(options, wants) {
    for (const want of wants) {
      const matches = options.filter(option => AP.norm(AP.textOf(option)) === AP.norm(want));
      if (matches.length === 1) return matches[0];
      if (matches.length > 1) return null;
    }
    return null;
  }
  async function fillCombobox(d, result, ctx) {
    const checkpoint = ctx.checkpoint || (() => {});
    checkpoint();
    let input = liveInput(d);
    if (!input) return { status: 'check', note: 'Liste modifiée ou indisponible : sélectionne la réponse manuellement.' };
    const original = input.value;
    const wants = AP.wantsOf(result);
    const buttons = [...input.parentElement.children].filter(element => element.matches('button[type="button"]') &&
      AP.isVisible(element) && !element.disabled && element.getAttribute('aria-disabled') !== 'true' &&
      !/effacer|supprim|clear|remove|reset/.test(AP.norm(AP.labelFor(element) || AP.textOf(element))));
    if (input.getAttribute('aria-expanded') !== 'true') {
      if (buttons.length === 1 && input.parentElement.querySelectorAll('input[role="combobox"]').length === 1) AP.click(buttons[0]);
      else { AP.focus(input); await AP.press(input, 'ArrowDown'); }
    }
    let options = await AP.waitFor(() => ownedOptions(liveInput(d)), { timeout: 1800, checkpoint });
    checkpoint();
    const option = exactOption(options || [], wants);
    if (!option) {
      input = liveInput(d);
      if (input) { await AP.press(input, 'Escape'); AP.blur(input); }
      return { status: 'check', value: original && !AP.PLACEHOLDER_RE.test(original) ? original : '', note: 'Aucune option exacte dans la liste liée : sélectionne manuellement. Aucun texte ni Entrée envoyé.' };
    }
    const chosen = AP.textOf(option);
    checkpoint(); AP.click(option);
    await AP.sleep(180);
    checkpoint(); input = liveInput(d);
    if (input) AP.blur(input);
    await AP.sleep(250);
    checkpoint(); input = liveInput(d);
    const persisted = input && AP.norm(input.value) === AP.norm(chosen) && input.getAttribute('aria-expanded') !== 'true';
    return {
      status: 'check', // DOM persistence is not confirmation of the employer's saved server state.
      value: persisted ? chosen : input?.value && !AP.PLACEHOLDER_RE.test(input.value) ? input.value : '',
      note: persisted ? 'Option cliquée et conservée après validation du champ : vérifie la sélection sur le site.' : 'Le site n’a pas conservé la sélection : choisis la réponse manuellement.',
    };
  }
  AP.successfactors = { actions, actionAnswer, manualReason, fillCombobox, revision: 2 };
})();
