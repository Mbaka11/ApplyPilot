// Explicit, read-only DOM diagnostics. No content-script registry, API, storage or model calls.
// Keep collectFormStructure self-contained: Chrome serializes it into an isolated world.
export function collectFormStructure() {
  const blocked = /(^|\.)(linkedin\.com|google\.(com|ca|fr|co\.uk))\.?$/i;
  if (!/^https?:$/.test(location.protocol) || blocked.test(location.hostname)) return null;
  let scope = 'top';
  if (window !== window.top) {
    try {
      if (location.origin !== window.top.location.origin || blocked.test(window.top.location.hostname)) return null;
      scope = 'same-origin-frame';
    } catch { return null; }
  }

  const limits = { elements: 6000, nodes: 500, textNodesPerLabel: 48, labelCharacters: 500, relations: 6, ancestors: 8 };
  // Only fixed vocabulary is exported, never verbatim labels, IDs, names, classes or text.
  const terms = [
    ['resume', /\bcv\b|curriculum|\bresume\b/],
    ['cover-letter', /cover letter|lettre (d accompagnement|de motivation)/],
    ['attachment', /attachment|piece.*jointe|document|fichier|\bfile\b/],
    ['upload', /televers|upload|joindre|attach/],
    ['add', /\bajouter\b|\badd\b/],
    ['education', /education|formation|scolarit|etudes/],
    ['language', /langue|language/],
    ['excluding-french', /outre le francais|other than french|besides french/],
    ['school', /school|universit|college|etablissement|ecole/],
    ['degree', /diplome|degree|niveau/],
    ['program', /programme|program|discipline|domaine|field of study|major/],
    ['graduation-date', /graduat|diplomation|obtention.*diplome/],
    ['internship-count', /(combien|nombre|how many|number).*(stages|internships)/],
    ['source', /\bsource\b|how did you|comment avez vous/],
    ['source-detail', /sous type|subtype|sub type/],
    ['onboarding', /integration|onboarding/],
    ['previous-employment', /relation professionnelle|previous.*employ|worked.*before|deja travaille/],
    ['suffix', /suffix/],
    ['given-name', /prenom|first name|given name/],
    ['family-name', /nom de famille|last name|family name|surname/],
    ['email', /courriel|e mail|email/],
    ['phone', /telephone|phone/],
    ['address', /adresse|address|postal|\bcity\b|\bville\b/],
    ['experience', /experience|employment/],
    ['date', /\bdate\b|\bmois\b|\bannee\b|\bmonth\b|\byear\b/],
    ['save', /enregistrer|sauvegarder|\bsave\b/],
    ['cancel', /annuler|\bcancel\b/],
    ['submit', /soumettre|envoyer|postuler|\bsubmit\b|\bapply\b/],
  ];
  const knownClasses = new Set([
    'sapMInput', 'sapMInputBase', 'sapMInputBaseInner', 'sapMInputBaseContentWrapper',
    'sapMComboBox', 'sapMComboBoxBase', 'sapMComboBoxBaseInputInner', 'sapMComboBoxTextField',
    'sapMComboBoxTextFieldInner', 'sapMComboBoxBaseArrow', 'sapMSlt', 'sapMSltLabel', 'sapMSltArrow',
    'sapMSelectList', 'sapMSelectListItemBase', 'sapMSelectListItem', 'sapMLabel', 'sapMText',
    'sapMBtn', 'sapMBtnInner', 'sapMBtnContent', 'sapMDialog', 'sapMDialogSection', 'sapMPopover',
    'sapMPanel', 'sapMPanelHdr', 'sapMPanelContent', 'sapMList', 'sapMListTbl', 'sapMListTblRow',
    'sapMListTblCell', 'sapMTitle', 'sapUiForm', 'sapUiFormElement', 'sapUiFormContainer',
    'sapUiFup', 'sapUiFupInput', 'sapUiFupInputMask', 'sapUiFupInputMaskInput', 'sapMUploadSet',
    'sapMUploadCollection', 'sapMTextArea', 'sapMTextAreaInner', 'sapMTokenizer', 'sapMToken',
  ]);
  const roles = new Set(['button', 'combobox', 'textbox', 'listbox', 'option', 'dialog', 'group', 'region', 'heading', 'table', 'row', 'cell', 'grid', 'gridcell', 'checkbox', 'radio', 'radiogroup', 'spinbutton', 'searchbox']);
  const types = new Set(['text', 'search', 'email', 'tel', 'url', 'number', 'date', 'month', 'time', 'week', 'datetime-local', 'file', 'button', 'submit', 'reset', 'checkbox', 'radio']);
  const popups = new Set(['true', 'false', 'menu', 'listbox', 'tree', 'grid', 'dialog']);
  const ignore = 'script, style, noscript, template, input[type="hidden" i], input[type="password" i], [contenteditable]:not([contenteditable="false"]), .g-recaptcha, .h-captcha, [data-sitekey]';
  const valueText = 'input, textarea, select, option, output, [role="textbox"], [role="searchbox"], [role="spinbutton"], [role="combobox"], [role="listbox"], [role="option"], [aria-selected], [data-automation-id="selectedItem"], .sapMToken, .sapMSltLabel';
  const candidates = 'input, select, textarea, button, a, [role], [aria-haspopup], label, legend, h1, h2, h3, h4, h5, h6, section, fieldset, form, table, tr';
  const normalize = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  const categories = text => {
    const normalized = normalize(text);
    return terms.filter(([, pattern]) => pattern.test(normalized)).map(([name]) => name);
  };
  const safe = element => element && !element.closest(ignore);
  const refs = new Map();
  const elements = [];
  let textTruncated = false;
  const root = document.body;
  if (!root) return { schema: 1, scope, nodes: [], truncated: false, limits };
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
    acceptNode: node => node.matches(ignore) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  let next;
  while (elements.length < limits.elements && (next = walker.nextNode())) {
    refs.set(next, `n${elements.length + 1}`);
    elements.push(next);
  }
  const elementLimit = elements.length === limits.elements && !!walker.nextNode();

  // Walk only label/heading/button text, never input properties or option/current-selection text.
  const staticText = element => {
    if (!safe(element) || element.closest(valueText)) return '';
    let text = ''; let visited = 0;
    const walk = node => {
      if (++visited > limits.textNodesPerLabel || text.length >= limits.labelCharacters) { textTruncated = true; return; }
      if (node.nodeType === Node.TEXT_NODE) text += ` ${node.nodeValue.slice(0, limits.labelCharacters - text.length)}`;
      else if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.matches(`${ignore}, ${valueText}, [aria-hidden="true"]`)) return;
        for (const child of node.childNodes) {
          if (visited >= limits.textNodesPerLabel || text.length >= limits.labelCharacters) { textTruncated = true; break; }
          walk(child);
        }
      }
    };
    walk(element);
    return text.slice(0, limits.labelCharacters);
  };
  const shape = element => ({
    ref: refs.get(element) || null,
    tag: /^[A-Z][A-Z0-9]{0,15}$/.test(element.tagName) ? element.tagName.toLowerCase() : 'custom-element',
    role: roles.has(element.getAttribute('role')) ? element.getAttribute('role') : null,
    classes: [...knownClasses].filter(name => element.classList.contains(name)),
    sapUi: element.hasAttribute('data-sap-ui'),
  });
  const targets = (element, attr) => (element.getAttribute(attr) || '').slice(0, 1200).split(/\s+/).slice(0, limits.relations)
    .map(id => document.getElementById(id)).filter(target => safe(target) && refs.has(target));
  const labelMap = new Map();
  for (const element of elements) {
    if (element.tagName !== 'LABEL') continue;
    const target = document.getElementById(element.getAttribute('for') || '');
    if (target && refs.has(target)) {
      const labels = labelMap.get(target) || [];
      if (labels.length < limits.relations) labels.push(element);
      labelMap.set(target, labels);
    }
  }
  const selected = elements.filter(element => element.matches(candidates) &&
    (element.tagName !== 'A' || element.getAttribute('role') === 'button' || categories(staticText(element)).some(term => ['add', 'upload', 'attachment', 'resume', 'cover-letter'].includes(term))));
  const nodes = selected.slice(0, limits.nodes).map(element => {
    const labels = [];
    const addLabel = (via, target, text) => labels.push({ via, ref: target ? refs.get(target) || null : null, terms: categories(text) });
    for (const label of labelMap.get(element) || []) addLabel('for', label, staticText(label));
    for (const label of targets(element, 'aria-labelledby')) addLabel('aria-labelledby', label, staticText(label));
    const wrap = element.closest('label');
    if (wrap && wrap !== element) addLabel('wrapped-label', wrap, staticText(wrap));
    // An ARIA label can contain an interpolated answer: emit vocabulary only, never its raw text.
    if (element.hasAttribute('aria-label')) addLabel('aria-label', null, element.getAttribute('aria-label').slice(0, limits.labelCharacters));
    if (element.matches('label, legend, h1, h2, h3, h4, h5, h6, button, a, [role="heading"], [role="button"]')) addLabel('own-label', element, staticText(element));
    const ancestors = [];
    for (let parent = element.parentElement; parent && parent !== root && ancestors.length < limits.ancestors; parent = parent.parentElement) ancestors.push(shape(parent));
    const relations = {};
    for (const attr of ['aria-labelledby', 'aria-controls', 'aria-owns']) {
      if (element.hasAttribute(attr)) relations[attr] = targets(element, attr).map(shape);
    }
    const kind = element.tagName === 'INPUT' ? element.type : element.tagName === 'BUTTON' ? element.type : null;
    const popup = element.getAttribute('aria-haspopup');
    return {
      ...shape(element), type: types.has(kind) ? kind : null, labels, ancestors, relations,
      visible: !!element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden',
      required: element.hasAttribute('required') || element.getAttribute('aria-required') === 'true',
      disabled: element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true',
      readOnly: element.hasAttribute('readonly'), multiple: element.hasAttribute('multiple'),
      hasPopup: popups.has(popup) ? popup : null,
      expanded: ['true', 'false'].includes(element.getAttribute('aria-expanded')) ? element.getAttribute('aria-expanded') === 'true' : null,
    };
  });
  return {
    schema: 1, scope, nodes, limits,
    truncated: elementLimit || selected.length > limits.nodes || textTruncated,
    omitted: ['values', 'selected-options', 'file-names', 'raw-labels', 'raw-ids', 'raw-classes', 'urls', 'cookies', 'storage', 'hidden-and-password-fields'],
  };
}

// Probe only frame origin/scope. No URL, title, form data or error text leaves the page.
export function diagnosticFrameScope() {
  if (!/^https?:$/.test(location.protocol) || /(^|\.)(linkedin\.com|google\.(com|ca|fr|co\.uk))\.?$/i.test(location.hostname)) return null;
  if (window === window.top) return 'top';
  try { return location.origin === window.top.location.origin ? 'same-origin-frame' : null; }
  catch { return null; }
}

export async function createFormDiagnostic({ tabId, scripting = chrome.scripting, isCurrent = async () => true, version = chrome.runtime.getManifest().version }) {
  const check = async () => {
    if (!await isCurrent()) throw new Error('Page changée ou remplissage en cours : diagnostic annulé.');
  };
  await check();
  let probes;
  try { probes = await scripting.executeScript({ target: { tabId, allFrames: true }, func: diagnosticFrameScope }); }
  catch { throw new Error('Diagnostic inaccessible : garde le formulaire ouvert et réessaie depuis le panneau.'); }
  await check();
  const allowed = probes.filter(probe => ['top', 'same-origin-frame'].includes(probe.result) && probe.documentId)
    .sort((a, b) => Number(b.result === 'top') - Number(a.result === 'top'));
  if (!allowed.some(probe => probe.result === 'top')) throw new Error('Diagnostic inaccessible : garde le formulaire ouvert et réessaie depuis le panneau.');
  let frames;
  try {
    frames = await scripting.executeScript({ target: { tabId, documentIds: allowed.slice(0, 8).map(probe => probe.documentId) }, func: collectFormStructure });
  } catch { throw new Error('Diagnostic inaccessible : garde le formulaire ouvert et réessaie depuis le panneau.'); }
  await check();
  // Ensure even a same-URL reload has not replaced a captured document. No reinjection/navigation.
  const current = await scripting.executeScript({ target: { tabId, allFrames: true }, func: diagnosticFrameScope }).catch(() => []);
  if (allowed.slice(0, 8).some(probe => !current.some(frame => frame.documentId === probe.documentId && frame.result === probe.result))) {
    throw new Error('Page changée ou remplissage en cours : diagnostic annulé.');
  }
  await check();
  const reports = frames.filter(frame => frame.result?.schema === 1).map(frame => frame.result);
  if (!reports.some(report => report.scope === 'top')) throw new Error('Diagnostic inaccessible : garde le formulaire ouvert et réessaie depuis le panneau.');
  const report = { schema: 1, purpose: 'applypilot-form-structure', extensionVersion: version, frames: reports,
    truncated: allowed.length > 8 || reports.some(frame => frame.truncated), skippedFrames: probes.length - reports.length };
  const json = JSON.stringify(report, null, 2);
  if (new TextEncoder().encode(json).byteLength > 2 * 1024 * 1024) throw new Error('Diagnostic trop volumineux : aucun rapport exporté.');
  return json;
}

export function downloadFormDiagnostic(json) {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'applypilot-form-diagnostic.json';
  anchor.click(); // Extension document only — never a page/form control.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
