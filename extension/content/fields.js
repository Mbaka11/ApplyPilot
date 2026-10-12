// ApplyPilot — inventaire des champs d'un formulaire (natifs, ARIA, widgets Workday).
(() => {
  const AP = globalThis.ApplyPilot;
  const registry = new Map();
  AP.registry = registry;
  let counter = 0;

  const SKIP_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image', 'password']);
  const PLACEHOLDER_RE = /^(select one|select|choose|choisir|choisissez|sélectionner|selectionner|sélectionnez|selectionnez|aucune? sélection|no selection|--+|please select|veuillez (choisir|sélectionner))\b/i;

  // Le compteur vit sur AP : après une mise à jour de l'extension, les scripts sont réinjectés dans
  // une page dont les champs portent déjà des identifiants ; repartir de 0 créerait des doublons.
  function idFor(el) {
    let id = el.getAttribute('data-applypilot-id');
    if (!id) {
      do {
        AP.idCounter = (AP.idCounter || counter) + 1;
        id = `ap${AP.frameToken || 'x'}-${AP.idCounter}`;
      } while (document.querySelector(`[data-applypilot-id="${id}"]`));
      el.setAttribute('data-applypilot-id', id);
    }
    return id;
  }

  function cleanLabel(s) {
    return String(s || '')
      .replace(/\s+/g, ' ')
      .replace(/\s*\*+\s*$/, '')
      .replace(/\s*\((required|obligatoire|requis)\)\s*$/i, '')
      .trim()
      .slice(0, 300);
  }

  /** Texte d'un élément sans le texte de ses contrôles (options, boutons…). */
  function ownText(el) {
    if (!el) return '';
    const clone = el.cloneNode(true);
    clone
      .querySelectorAll('input, select, textarea, button, [role="listbox"], [role="option"], script, style, [aria-hidden="true"]')
      .forEach((n) => n.remove());
    return clone.textContent.replace(/\s+/g, ' ').trim();
  }

  function textByIds(ids, self) {
    return String(ids || '')
      .split(/\s+/)
      .map((id) => document.getElementById(id))
      .filter((n) => n && n !== self)
      .map((n) => AP.textOf(n))
      .join(' ')
      .trim();
  }

  /** Texte qui précède `el` à l'intérieur de `container` (libellé de groupe). */
  function textBefore(container, el) {
    try {
      const r = document.createRange();
      r.setStart(container, 0);
      r.setEndBefore(el);
      return r.toString().replace(/\s+/g, ' ').trim().slice(-250);
    } catch {
      return '';
    }
  }

  function workdayContainer(el) {
    return el.closest('[data-automation-id^="formField-"], [data-automation-id^="formField"]');
  }

  function labelFor(el) {
    const wd = workdayContainer(el);
    if (wd) {
      const l = wd.querySelector('legend, label, [data-automation-id="formLabel"]');
      const t = l && ownText(l);
      if (t) return cleanLabel(t);
    }
    if (el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      const t = l && ownText(l);
      if (t) return cleanLabel(t);
    }
    const lb = el.getAttribute('aria-labelledby');
    if (lb) {
      const t = textByIds(lb, el);
      if (t) return cleanLabel(t);
    }
    const wrap = el.closest('label');
    if (wrap) {
      const t = ownText(wrap);
      if (t) return cleanLabel(t);
    }
    const al = el.getAttribute('aria-label');
    if (al) return cleanLabel(al);
    const fs = el.closest('fieldset');
    if (fs) {
      const lg = fs.querySelector('legend');
      if (lg && AP.textOf(lg)) return cleanLabel(AP.textOf(lg));
    }
    let node = el;
    for (let depth = 0; depth < 4 && node && node !== document.body; depth++) {
      let sib = node.previousElementSibling;
      for (let k = 0; sib && k < 3; k++, sib = sib.previousElementSibling) {
        if (sib.matches('input, select, textarea, button') || sib.querySelector('input, select, textarea')) break;
        const t = AP.textOf(sib);
        if (t && t.length <= 250) return cleanLabel(t);
      }
      node = node.parentElement;
    }
    return cleanLabel(el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('name') || '');
  }

  function optionLabel(input) {
    if (input.id) {
      const l = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
      if (l && ownText(l)) return cleanLabel(ownText(l));
    }
    const wrap = input.closest('label');
    if (wrap && ownText(wrap)) return cleanLabel(ownText(wrap));
    const lb = input.getAttribute('aria-labelledby');
    if (lb) {
      const t = textByIds(lb, input);
      if (t) return cleanLabel(t);
    }
    if (input.getAttribute('aria-label')) return cleanLabel(input.getAttribute('aria-label'));
    const next = input.nextElementSibling;
    if (next && AP.textOf(next).length < 120) return cleanLabel(AP.textOf(next));
    return cleanLabel(input.value || '');
  }

  function commonAncestor(els) {
    let node = els[0]?.parentElement;
    while (node && !els.every((e) => node.contains(e))) node = node.parentElement;
    return node || document.body;
  }

  function groupLabel(inputs) {
    const first = inputs[0];
    const wd = workdayContainer(first);
    const group = first.closest('[role="radiogroup"], [role="group"], fieldset');
    for (const c of [group, wd].filter(Boolean)) {
      const lb = c.getAttribute('aria-labelledby');
      if (lb) {
        const t = textByIds(lb);
        if (t) return cleanLabel(t);
      }
      if (c.getAttribute('aria-label')) return cleanLabel(c.getAttribute('aria-label'));
      const lg = c.querySelector('legend');
      if (lg && ownText(lg)) return cleanLabel(ownText(lg));
    }
    const container = commonAncestor(inputs);
    const firstWrap = first.closest('label') || first;
    let t = textBefore(container, firstWrap);
    if (t) return cleanLabel(t);
    let node = container;
    for (let depth = 0; depth < 3 && node && node !== document.body; depth++) {
      const sib = node.previousElementSibling;
      if (sib && !sib.querySelector('input, select, textarea')) {
        t = AP.textOf(sib);
        if (t && t.length <= 250) return cleanLabel(t);
      }
      node = node.parentElement;
    }
    return '';
  }

  function sectionFor(el) {
    let node = el.parentElement;
    for (let depth = 0; node && node !== document.body && depth < 14; depth++, node = node.parentElement) {
      const heads = node.querySelectorAll(
        ':scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > legend, :scope > [role="heading"], :scope > div > h2, :scope > div > h3, :scope > div > h4, :scope > header h2, :scope > header h3',
      );
      for (const h of heads) {
        if (h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) {
          const t = AP.textOf(h);
          if (t && t.length < 120) return t;
        }
      }
    }
    return '';
  }

  const ENTRY_TYPE = (s) => {
    const t = AP.norm(s);
    if (/work ?experience|experience|employment|emploi|work history/.test(t)) return 'experience';
    if (/education|formation|scolarit|etudes|school/.test(t)) return 'education';
    if (/language|langue/.test(t)) return 'language';
    if (/web ?sites?|sites? web|sites? internet|web ?address|\burl\b/.test(t)) return 'website';
    if (/certification|licen[cs]e/.test(t)) return 'certification';
    return null;
  };

  /** Bloc répété (Expérience 1, Formation 2…) contenant le champ. */
  function entryInfo(el) {
    const m = /^(workExperience|education|languages?|websites?|webAddress|certifications?)-(\d+)--/i.exec(el.id || '') ||
      /^(workExperience|education|languages?|websites?|webAddress|certifications?)-(\d+)--/i.exec(el.getAttribute('name') || '');
    let node = el.parentElement;
    for (let depth = 0; node && node !== document.body && depth < 12; depth++, node = node.parentElement) {
      const aid = node.getAttribute('data-automation-id') || '';
      if (/^(workExperience|education|languages?|websites?|certifications?)-\d+$/i.test(aid)) {
        return { container: node, type: ENTRY_TYPE(aid.replace(/-\d+$/, '').replace(/([a-z])([A-Z])/g, '$1 $2')) };
      }
      if (node.getAttribute('role') === 'group') {
        const lb = node.getAttribute('aria-labelledby');
        const label = (lb ? textByIds(lb) : '') || node.getAttribute('aria-label') || AP.textOf(node.querySelector('h2, h3, h4, h5, legend, [role="heading"]'));
        if (/\d+\s*$/.test(label.trim()) && ENTRY_TYPE(label)) return { container: node, type: ENTRY_TYPE(label) };
      }
    }
    if (m) {
      const key = `${m[1]}-${m[2]}`;
      const type = ENTRY_TYPE(m[1].replace(/([a-z])([A-Z])/g, '$1 $2'));
      return type ? { container: null, key, type } : null;
    }
    return null;
  }

  function isCaptcha(el) {
    return !!el.closest('.g-recaptcha, .h-captcha, [data-sitekey], [class*="captcha" i], [id*="captcha" i]') ||
      /captcha|g-recaptcha-response/i.test(`${el.name} ${el.id}`);
  }

  function classify(el) {
    const tag = el.tagName;
    if (tag === 'SELECT') return 'select';
    if (tag === 'TEXTAREA') return 'textarea';
    if (tag === 'BUTTON') return 'dropdown';
    if (tag !== 'INPUT') return el.getAttribute('role') === 'combobox' ? 'dropdown' : null;
    const type = (el.type || 'text').toLowerCase();
    if (type === 'file') return 'file';
    if (type === 'radio') return 'radio';
    if (type === 'checkbox') return 'checkbox';
    const aid = `${el.getAttribute('data-automation-id') || ''} ${el.id || ''}`;
    if (/dateSection(Month|Day|Year)-input/.test(aid)) return 'date-part';
    if (
      el.closest('[data-automation-id="multiselectInputContainer"], [data-automation-id="multiSelectContainer"]') ||
      el.getAttribute('data-uxi-widget-type') === 'selectinput'
    ) {
      return 'prompt';
    }
    if (el.getAttribute('role') === 'combobox' || el.getAttribute('aria-autocomplete') === 'list') return 'combobox';
    if (type === 'date' || type === 'month') return 'date-native';
    return 'text';
  }

  const splitCamel = (s) => String(s || '').replace(/([a-z])([A-Z])/g, '$1 $2');

  function signature(d) {
    const raw = [d.label, splitCamel(d.automationId), splitCamel(d.name), splitCamel(d.htmlId), d.placeholder, d.ariaLabel, d.autocomplete].join(' | ');
    return AP.norm(raw).replace(/[_\-./]+/g, ' ').replace(/\s+/g, ' ');
  }

  function isRequired(el, wd) {
    if (el.required || el.getAttribute('aria-required') === 'true') return true;
    const lab = wd?.querySelector('label, legend') || (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`));
    return !!lab && /\*/.test(lab.textContent || '');
  }

  function dateParts(container) {
    const q = (p) => container.querySelector(`input[data-automation-id="dateSection${p}-input"], input[id$="dateSection${p}-input"]`);
    return { month: q('Month'), day: q('Day'), year: q('Year') };
  }

  function selectedPromptItems(container) {
    if (!container) return [];
    const items = [...container.querySelectorAll(
      '[data-automation-id="selectedItem"], [data-automation-id="selectedItemList"] [role="listitem"], [data-automation-id="selectedItemList"] [data-uxi-widget-type="selectinputlistitem"], [data-automation-id="selectedItemList"] [data-automation-id="promptSelectionLabel"], [data-automation-id="multiselectInputContainer"] [role="listitem"]',
    )];
    // Le texte du bouton de suppression ne fait pas partie de la compétence ; éviter les doublons parent/enfant.
    return [...new Set(items.filter((n) => !items.some((other) => other !== n && n.contains(other))).map((n) => {
      const label = n.querySelector('[data-automation-id="promptOption"]');
      return label?.getAttribute('data-automation-label') || AP.textOf(label) || n.getAttribute('title') || AP.textOf(n);
    }).filter(Boolean))];
  }

  function currentValue(d) {
    const el = d.el;
    switch (d.kind) {
      case 'checkbox':
        return !!el.checked;
      case 'radio': {
        const c = d.radios.find((r) => r.checked);
        return c ? optionLabel(c) : '';
      }
      case 'checkboxes':
        return d.boxes.filter((b) => b.checked).map(optionLabel);
      case 'select': {
        const o = el.selectedOptions?.[0];
        return o && o.value !== '' && !PLACEHOLDER_RE.test(o.text.trim()) ? o.text.trim() : '';
      }
      case 'dropdown': {
        const t = AP.textOf(el);
        return t && !PLACEHOLDER_RE.test(t) ? t : '';
      }
      case 'prompt':
        return selectedPromptItems(d.container);
      case 'file': {
        const names = [...(el.files || [])].map((f) => f.name);
        return names;
      }
      case 'date': {
        const p = d.parts;
        return [p.month?.value, p.day?.value, p.year?.value].filter(Boolean).join('/');
      }
      default:
        return el.value ?? '';
    }
  }

  function isEmptyValue(d, v) {
    if (d.kind === 'checkbox') return !v;
    if (Array.isArray(v)) return v.length === 0;
    return String(v ?? '').trim() === '';
  }

  function base(el, kind) {
    const wd = workdayContainer(el);
    const d = {
      id: idFor(el),
      kind,
      el,
      label: '',
      inputType: el.tagName === 'INPUT' ? (el.type || 'text').toLowerCase() : el.tagName.toLowerCase(),
      automationId: el.getAttribute('data-automation-id') || wd?.getAttribute('data-automation-id') || '',
      name: el.getAttribute('name') || '',
      htmlId: el.id || '',
      placeholder: el.getAttribute('placeholder') || '',
      ariaLabel: el.getAttribute('aria-label') || '',
      autocomplete: el.getAttribute('autocomplete') || '',
      required: isRequired(el, wd),
      multiple: !!el.multiple,
      maxLength: el.maxLength > 0 ? el.maxLength : undefined,
      section: sectionFor(el),
      container: wd || el,
    };
    return d;
  }

  function finish(d) {
    d.labelNorm = AP.norm(d.label);
    d.sig = signature(d);
    d.value = currentValue(d);
    d.isEmpty = isEmptyValue(d, d.value);
    return d;
  }

  function describe(el, kind) {
    const d = base(el, kind);
    d.label = labelFor(el);
    if (kind === 'select') {
      d.options = [...el.options]
        .filter((o) => !o.disabled && o.value !== '' && !PLACEHOLDER_RE.test(o.text.trim()))
        .map((o) => o.text.trim())
        .filter(Boolean);
    }
    if (kind === 'prompt') d.container = workdayContainer(el) || el.closest('[data-automation-id="multiselectInputContainer"]')?.parentElement || el.parentElement;
    return finish(d);
  }

  function describeGroup(inputs, kind) {
    const d = base(inputs[0], kind);
    d.label = groupLabel(inputs) || labelFor(inputs[0]);
    const opts = inputs.map(optionLabel);
    d.options = opts;
    if (kind === 'radio') d.radios = inputs;
    else d.boxes = inputs;
    const group = inputs[0].closest('[role="radiogroup"], [role="group"], fieldset');
    d.container = workdayContainer(inputs[0]) || (group && group.contains(inputs[inputs.length - 1]) ? group : commonAncestor(inputs));
    return finish(d);
  }

  function describeDate(container, parts) {
    const anyPart = parts.month || parts.year || parts.day;
    const d = base(anyPart, 'date');
    d.parts = parts;
    d.container = container;
    const l = container.querySelector('legend, label');
    d.label = cleanLabel((l && ownText(l)) || labelFor(anyPart));
    d.automationId = container.getAttribute('data-automation-id') || d.automationId;
    return finish(d);
  }

  function fieldVisible(el, kind) {
    if (kind === 'file') return true;
    if (kind === 'radio' || kind === 'checkbox') return AP.isVisible(el) || AP.isVisible(el.closest('label')) || AP.isVisible(el.parentElement);
    return AP.isVisible(el) && !AP.isOffscreen(el);
  }

  /** Inventaire des champs remplissables de la page (ou d'une portion). */
  /** Identifiants en double (pages ouvertes avant une mise à jour de l'extension) : on les réattribue. */
  function dedupeIds() {
    const seen = new Set();
    for (const e of document.querySelectorAll('[data-applypilot-id]')) {
      const id = e.getAttribute('data-applypilot-id');
      if (seen.has(id)) e.removeAttribute('data-applypilot-id');
      else seen.add(id);
    }
  }

  function scanFields(root = document) {
    dedupeIds();
    const out = [];
    const doneRadio = new Set();
    const doneDate = new Set();
    const els = root.querySelectorAll('input, select, textarea, button[aria-haspopup="listbox"], [role="combobox"]:not(input):not(select)');
    for (const el of els) {
      if (el.closest('[data-applypilot-ignore]')) continue;
      const kind = classify(el);
      if (!kind) continue;
      if (el.tagName === 'INPUT' && SKIP_TYPES.has((el.type || '').toLowerCase())) continue;
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
      if (isCaptcha(el)) continue;
      if (!fieldVisible(el, kind)) continue;
      if (el.readOnly && !['prompt', 'combobox', 'date-part'].includes(kind)) continue;
      if (el.type === 'search' && el.closest('header, nav, [role="search"]')) continue;
      if (kind !== 'file' && el.closest('header, nav, footer, [role="banner"], [role="navigation"], [role="search"], [role="contentinfo"]')) continue;

      if (kind === 'radio' || kind === 'checkbox') {
        const scope = el.form || document;
        let group = [];
        if (el.name) group = [...scope.querySelectorAll(`input[type="${kind}"][name="${CSS.escape(el.name)}"]`)];
        // Workday réutilise le même name dans chaque bloc répété (ex. « Je parle couramment » par langue).
        const ff = el.closest('[data-automation-id^="formField"]');
        if (ff && group.length > 1) group = group.filter((g) => ff.contains(g));
        if (kind === 'radio' && group.length <= 1) {
          const c = el.closest('[role="radiogroup"], fieldset') || el.parentElement?.parentElement;
          group = c ? [...c.querySelectorAll('input[type="radio"]')] : [el];
        }
        if (kind === 'radio' || group.length > 1) {
          const key = group.map(idFor).join(',');
          if (doneRadio.has(key)) continue;
          doneRadio.add(key);
          out.push(describeGroup(group, kind === 'radio' ? 'radio' : 'checkboxes'));
          continue;
        }
        out.push(describe(el, 'checkbox'));
        continue;
      }

      if (kind === 'date-part') {
        const container = workdayContainer(el) || el.closest('[data-automation-id="dateInputWrapper"]')?.parentElement || el.parentElement;
        if (doneDate.has(container)) continue;
        doneDate.add(container);
        out.push(describeDate(container, dateParts(container)));
        continue;
      }
      out.push(describe(el, kind));
    }

    // Blocs répétés (expérience n, formation n) : index par ordre d'apparition.
    const order = { experience: [], education: [], language: [], website: [], certification: [] };
    for (const d of out) {
      const info = entryInfo(d.el);
      if (!info || !order[info.type]) continue;
      const key = info.container || info.key;
      let idx = order[info.type].indexOf(key);
      if (idx < 0) {
        order[info.type].push(key);
        idx = order[info.type].length - 1;
      }
      d.entryType = info.type;
      d.entryIndex = idx;
    }

    registry.clear();
    for (const d of out) registry.set(d.id, d);
    return out;
  }

  function serializeField(d) {
    return {
      id: d.id,
      label: d.label || d.placeholder || d.name,
      kind: d.kind,
      required: d.required,
      multiple: d.multiple || d.kind === 'checkboxes',
      options: d.options?.length ? d.options.slice(0, 80) : undefined,
      section: [d.section, d.entryType ? `${d.entryType} ${d.entryIndex + 1}` : ''].filter(Boolean).join(' · ') || undefined,
      hint: d.placeholder || undefined,
      maxLength: d.maxLength,
    };
  }

  function displayValue(d) {
    const v = d.value;
    if (typeof v === 'boolean') return v;
    if (Array.isArray(v)) return v.join(', ');
    return String(v ?? '');
  }

  Object.assign(AP, {
    scanFields,
    serializeField,
    displayValue,
    labelFor,
    optionLabel,
    selectedPromptItems,
    describeElement: (el) => describe(el, classify(el)),
    PLACEHOLDER_RE,
  });
})();
