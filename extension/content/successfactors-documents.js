// Opt-in attachment transfer. Only follows the two semantic launchers into a newly opened dialog.
// Anonymous diagnostic references are not selectors. No dialog confirmation/cloud/Submit buttons are clicked.
(() => {
  const AP = globalThis.ApplyPilot;
  let plan = null;
  const kinds = ['cv', 'letter'];
  const actionType = { cv: 'resume', letter: 'cover-letter' };
  const visibleDialogs = () => [...document.querySelectorAll('[role="dialog"], dialog')].filter(AP.isVisible);
  const fail = message => { throw new Error(message); };
  const label = kind => kind === 'cv' ? 'CV' : 'Lettre d’accompagnement';
  const scopeText = element => String(element.innerText || '').replace(/\s+/g, ' ').trim();
  const hasName = (zone, name) => {
    const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|[\\s(\\[«"'])${escaped}(?=$|[\\s)\\]»"'])`, 'u').test(scopeText(zone));
  };
  const confirmedZone = (kind, before, name) => {
    let zone = before.zone;
    if (!zone.isConnected) { try { zone = context(kind).zone; } catch { return false; } }
    return hasName(zone, name) && ![...zone.querySelectorAll('[role="alert"], [role="progressbar"], [aria-busy="true"], [aria-invalid="true"]')].some(AP.isVisible);
  };
  const occupied = zone => /[\p{L}\p{N}_-][^\s/\\]*\.(pdf|docx?|rtf|odt)\b/iu.test(scopeText(zone)) ||
    [...zone.querySelectorAll('a[download]')].some(AP.isVisible) ||
    [...zone.querySelectorAll('input[type="file"]')].some(input => input.files?.length) ||
    [...zone.querySelectorAll('button, [role="button"], a')].filter(AP.isVisible).some(el => /supprimer|retirer|remplacer|delete|remove|replace/i.test(AP.labelFor(el) || AP.textOf(el)));
  function context(kind) {
    const actions = AP.successfactors.actions(document);
    const matches = actions.filter(action => action.actionType === actionType[kind]);
    if (matches.length !== 1) fail('Zone CV ou lettre ambiguë : aucun document envoyé.');
    const action = matches[0], trigger = action.element;
    // The observed launcher is linked to a separate field label. Keep the smallest shared ancestor.
    const labels = (trigger.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => document.getElementById(id)).filter(el => el?.tagName === 'LABEL');
    if (labels.length !== 1) fail('Zone CV ou lettre ambiguë : aucun document envoyé.');
    let zone = trigger.parentElement;
    while (zone && !zone.contains(labels[0])) zone = zone.parentElement;
    if (!zone || zone.matches('form, body, html') || actions.some(other => other !== action && zone.contains(other.element))) fail('Zone CV ou lettre ambiguë : aucun document envoyé.');
    return { zone, trigger, text: scopeText(zone), fieldId: trigger.getAttribute('data-applypilot-id') || '' };
  }
  function assertSite(ctx) {
    ctx.checkpoint();
    if (AP.platform() !== 'successfactors' || window !== window.top) fail('Documents automatiques disponibles uniquement sur la page principale SuccessFactors.');
  }
  function prepare(payload, ctx) {
    assertSite(ctx); plan = null;
    if (visibleDialogs().length) fail('Ferme le dialogue ouvert sur le site, puis relance les documents automatiques.');
    const targets = Object.fromEntries(kinds.map(kind => [kind, context(kind)]));
    plan = { ticket: crypto.randomUUID(), expires: Date.now() + 600000, targets, used: new Set() };
    return { ticket: plan.ticket, present: Object.fromEntries(kinds.map(kind => [kind,
      payload.documentNames?.[kind] && hasName(targets[kind].zone, payload.documentNames[kind]) ? 'same-name' : occupied(targets[kind].zone) ? 'other' : 'empty'])) };
  }
  function result(kind, status, note, file, completed = false) {
    return { completed, result: { id: plan?.targets[kind]?.fieldId || '', label: label(kind), kind: 'manual-action', status, value: file?.name || '', note, source: 'profil' } };
  }
  function checkPlan(payload, ctx) {
    assertSite(ctx);
    if (!plan || payload.ticket !== plan.ticket || Date.now() > plan.expires || !kinds.includes(payload.documentKind)) fail('Préparation des documents périmée : relance depuis le panneau.');
  }
  async function attach(payload, ctx) {
    checkPlan(payload, ctx);
    const kind = payload.documentKind, file = payload.file;
    if (!file || typeof file.name !== 'string' || !/^[^\\/\x00-\x1f]{1,200}\.pdf$/i.test(file.name) || file.type !== 'application/pdf' ||
      typeof file.base64 !== 'string' || file.base64.length > 28 * 1024 * 1024 || !file.base64.startsWith('JVBERi0')) fail('Document PDF invalide ou trop volumineux : aucun fichier envoyé.');
    if (visibleDialogs().length) fail('Ferme le dialogue ouvert sur le site, puis relance les documents automatiques.');
    const target = context(kind);
    if (hasName(target.zone, file.name)) return result(kind, 'kept', 'Nom de fichier déjà présent : aucun remplacement. Vérifie la version sur le site.', file, true);
    if (occupied(target.zone)) return result(kind, 'check', 'Une pièce est déjà présente dans cette zone : aucun remplacement automatique.', file);
    const before = plan.targets[kind];
    if (plan.used.has(kind) || target.zone !== before.zone || target.trigger !== before.trigger || target.text !== before.text) fail('Zone de document modifiée : opération arrêtée sans remplacement.');
    plan.used.add(kind); // One attempt only, including errors and cancellation. Never retry a potential upload.
    ctx.checkpoint(); AP.click(target.trigger);
    const dialog = await AP.waitFor(() => {
      const dialogs = visibleDialogs();
      if (dialogs.length > 1) fail('Plusieurs dialogues ouverts : aucun fichier envoyé.');
      return dialogs.length === 1 ? dialogs[0] : null;
    }, { timeout: 2500, checkpoint: ctx.checkpoint });
    ctx.checkpoint();
    if (!dialog) return result(kind, 'check', 'Dialogue de téléversement non reconnu : aucun fichier envoyé.', file);
    const inputs = [...dialog.querySelectorAll('input[type="file"]')].filter(input => input.closest('[role="dialog"], dialog') === dialog && !input.disabled);
    const input = inputs[0];
    if (inputs.length !== 1 || input.multiple || input.files?.length || input.getAttribute('aria-disabled') === 'true') return result(kind, 'check', 'Champ fichier ambigu ou déjà occupé : aucun fichier envoyé.', file);
    const accept = input.accept.toLowerCase().split(',').map(value => value.trim()).filter(Boolean);
    if (accept.length && !accept.some(value => ['.pdf', 'application/pdf', 'application/*', '*/*'].includes(value))) return result(kind, 'check', 'Ce champ n’accepte pas le PDF : aucun fichier envoyé.', file);
    checkPlan(payload, ctx);
    if (!target.zone.isConnected || !target.trigger.isConnected || scopeText(target.zone) !== before.text || visibleDialogs().length !== 1 || !AP.isVisible(dialog) || !input.isConnected) fail('Zone de document modifiée : opération arrêtée sans remplacement.');
    const transfer = new DataTransfer();
    transfer.items.add(AP.b64ToFile(file.base64, file.name, file.type));
    input.files = transfer.files;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    ctx.checkpoint();
    if (input.isConnected) input.dispatchEvent(new Event('change', { bubbles: true }));
    // A populated FileList alone proves nothing. Require the dialog to close and a visible filename in this field's zone.
    const confirmed = await AP.waitFor(() => {
      if (visibleDialogs().length) return false;
      return confirmedZone(kind, before, file.name);
    }, { timeout: 10000, checkpoint: ctx.checkpoint });
    ctx.checkpoint();
    if (!confirmed) return result(kind, 'check', 'Fichier transmis au champ, mais dépôt non confirmé visuellement. Vérifie le site avant de continuer.', file);
    // Brief second observation catches immediate site-side rejection/re-render; not a server-side save guarantee.
    await AP.sleep(400); ctx.checkpoint();
    let stable = false;
    try { stable = !visibleDialogs().length && confirmedZone(kind, before, file.name); } catch { /* manual review */ }
    return result(kind, 'check', stable
      ? 'Fichier affiché dans la bonne zone. Vérifie le document et sa conservation sur le site avant de soumettre.'
      : 'Le site n’a pas conservé le fichier : vérifie la pièce jointe manuellement.', file, stable);
  }
  AP.sfDocuments = { prepare, attach, revision: 1 };
})();
