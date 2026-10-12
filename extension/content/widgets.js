// ApplyPilot — remplissage de chaque type de champ (natif, ARIA, Workday).
(() => {
  const AP = globalThis.ApplyPilot;
  const MIN_SCORE = 0.6;

  /** Liste des valeurs acceptables, par ordre de préférence. */
  function wantsOf(result) {
    const v = result.value;
    const list = Array.isArray(v) ? [...v] : [v];
    for (const a of result.alts || []) if (a !== undefined && a !== null && a !== '') list.push(a);
    return list.filter((x) => x !== undefined && x !== null && x !== '').map(String);
  }

  function ym(s) {
    const m = String(s ?? '').match(/^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?/);
    if (m) return { year: +m[1], month: m[2] ? +m[2] : null, day: m[3] ? +m[3] : null };
    const m2 = String(s ?? '').match(/^(\d{1,2})\/(\d{4})$/);
    return m2 ? { year: +m2[2], month: +m2[1], day: null } : null;
  }
  const pad = (n) => String(n).padStart(2, '0');

  /** Formate une date selon le gabarit du champ texte (MM/AAAA, AAAA-MM-JJ…). */
  function formatDateFor(d, value) {
    const p = ym(value);
    if (!p) return String(value);
    const hint = `${d.placeholder} ${d.label}`.toLowerCase();
    const day = p.day || 1;
    if (/mm\s*\/\s*(yyyy|aaaa)/.test(hint)) return `${pad(p.month || 1)}/${p.year}`;
    if (/(dd|jj)\s*\/\s*mm\s*\/\s*(yyyy|aaaa)/.test(hint)) return `${pad(day)}/${pad(p.month || 1)}/${p.year}`;
    if (/mm\s*\/\s*(dd|jj)\s*\/\s*(yyyy|aaaa)/.test(hint)) return `${pad(p.month || 1)}/${pad(day)}/${p.year}`;
    // "Date de graduation (mois et année)" / "month and year" : MM/AAAA, pas seulement l'année.
    const lab = AP.norm(`${d.label} ${d.placeholder}`);
    if (p.month && /\b(mois|month)\b/.test(lab) && /\b(annee|year)\b/.test(lab)) return `${pad(p.month)}/${p.year}`;
    if (/^(yyyy|aaaa)$/.test(hint.trim()) || /\byear\b|\bannee\b/.test(AP.norm(d.label))) return String(p.year);
    return p.month ? `${p.year}-${pad(p.month)}${p.day ? `-${pad(p.day)}` : ''}` : String(p.year);
  }

  function pickByLanguage(list, lang) {
    // ['Yes', 'Oui'] → texte libre dans la langue de la page
    if (list.length === 2 && /^(yes|no)$/i.test(list[0]) && /^(oui|non)$/i.test(list[1])) return lang === 'fr' ? list[1] : list[0];
    return list[0];
  }

  const equivalent = (a, b) =>
    String(a).replace(/[\s\-().+]/g, '').toLowerCase() === String(b).replace(/[\s\-().+]/g, '').toLowerCase();

  async function fillText(d, result, ctx) {
    const el = d.el;
    let v = result.value;
    if (Array.isArray(v)) v = result.multi ? v.join(', ') : pickByLanguage(v, ctx.lang);
    if (typeof v === 'boolean') v = v ? (ctx.lang === 'fr' ? 'Oui' : 'Yes') : ctx.lang === 'fr' ? 'Non' : 'No';
    v = String(v ?? '');
    if (/^\d{4}-\d{1,2}(-\d{1,2})?$/.test(v) || /date|mm\/|yyyy|aaaa/i.test(`${d.placeholder} ${d.sig}`)) {
      if (ym(v)) v = formatDateFor(d, v);
    }
    let note = '';
    if (d.maxLength && v.length > d.maxLength) {
      v = v.slice(0, d.maxLength);
      note = `Tronqué à ${d.maxLength} caractères`;
    }
    const got = await AP.setValue(el, v, { checkpoint: d.checkpoint });
    if (got === v) return { status: 'ok', value: v, note };
    if (equivalent(got, v)) return { status: 'ok', value: got, note: 'Reformaté par le site' };
    return { status: 'check', value: got || v, note: 'Le site a modifié la valeur' };
  }

  async function fillNativeDate(d, result) {
    const p = ym(result.value);
    if (!p) return { status: 'fail', note: 'Date invalide' };
    const v = d.inputType === 'month' ? `${p.year}-${pad(p.month || 1)}` : `${p.year}-${pad(p.month || 1)}-${pad(p.day || 1)}`;
    await AP.setValue(d.el, v, { checkpoint: d.checkpoint });
    return { status: d.el.value === v ? 'ok' : 'check', value: v };
  }

  async function fillDateParts(d, result) {
    const p = ym(result.value);
    if (!p) return { status: 'fail', note: 'Date invalide' };
    const { month, day, year } = d.parts;
    const steps = [
      [month, p.month ? pad(p.month) : null],
      [day, day ? pad(p.day || 1) : null],
      [year, String(p.year)],
    ];
    for (const [input, v] of steps) {
      d.checkpoint?.();
      if (!input || !v) continue;
      AP.click(input);
      await AP.typeText(input, v, { checkpoint: d.checkpoint });
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await AP.sleep(60);
    }
    d.checkpoint?.();
    AP.blur(year || month);
    await AP.sleep(80);
    const ok = (!year || year.value.includes(String(p.year))) && (!month || !p.month || Number(month.value) === p.month);
    return { status: ok ? 'ok' : 'check', value: [p.month && pad(p.month), p.year].filter(Boolean).join('/') };
  }

  async function fillSelect(d, result) {
    const el = d.el;
    const opts = [...el.options].filter((o) => !o.disabled && o.value !== '' && !AP.PLACEHOLDER_RE.test(o.text.trim()));
    const wants = wantsOf(result);
    if (el.multiple && Array.isArray(result.value) && result.multi) {
      let n = 0;
      for (const w of result.value) {
        const { option, score } = AP.bestMatch(opts, [w], (o) => o.text);
        if (option && score >= MIN_SCORE) {
          option.selected = true;
          n++;
        }
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { status: n ? 'ok' : 'fail', value: `${n} option(s)` };
    }
    const { option, score } = AP.bestMatch(opts, wants, (o) => o.text);
    if (!option || score < MIN_SCORE) return { status: 'fail', note: 'Aucune option correspondante', options: opts.map((o) => o.text.trim()) };
    AP.focus(el);
    AP.setNativeValue(el, option.value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    AP.blur(el);
    return { status: el.value === option.value ? 'ok' : 'check', value: option.text.trim() };
  }

  function labelElFor(input) {
    return (input.id && document.querySelector(`label[for="${CSS.escape(input.id)}"]`)) || input.closest('label');
  }

  async function toggle(input, desired, checkpoint = () => {}) {
    checkpoint();
    if (input.checked === desired) return true;
    const lab = labelElFor(input);
    AP.click(AP.isVisible(input) || !lab ? input : lab);
    await AP.sleep(80);
    checkpoint();
    if (input.checked !== desired && lab) {
      AP.click(lab);
      await AP.sleep(80);
    }
    return input.checked === desired;
  }

  async function fillRadio(d, result) {
    const items = d.radios.map((r) => ({ el: r, text: AP.optionLabel(r) }));
    const { option, score } = AP.bestMatch(items, wantsOf(result), (o) => o.text);
    if (!option || score < MIN_SCORE) return { status: 'fail', note: 'Aucune option correspondante', options: items.map((i) => i.text) };
    const ok = await toggle(option.el, true, d.checkpoint);
    return { status: ok ? 'ok' : 'fail', value: option.text };
  }

  function desiredBool(result) {
    if (typeof result.bool === 'boolean') return result.bool;
    if (typeof result.value === 'boolean') return result.value;
    const v = AP.norm(Array.isArray(result.value) ? result.value[0] : result.value);
    if (/^(yes|oui|true|vrai|1)$/.test(v)) return true;
    if (/^(no|non|false|faux|0)$/.test(v)) return false;
    return null;
  }

  async function fillCheckbox(d, result) {
    const want = desiredBool(result);
    if (want === null) return { status: 'fail', note: 'Valeur oui/non attendue' };
    const ok = await toggle(d.el, want, d.checkpoint);
    return { status: ok ? 'ok' : 'fail', value: want ? 'coché' : 'décoché' };
  }

  async function fillCheckboxes(d, result) {
    const wants = Array.isArray(result.value) ? result.value : [result.value];
    let n = 0;
    for (const w of wants) {
      const items = d.boxes.map((b) => ({ el: b, text: AP.optionLabel(b) }));
      const { option, score } = AP.bestMatch(items, [w], (o) => o.text);
      if (option && score >= MIN_SCORE && (await toggle(option.el, true, d.checkpoint))) n++;
    }
    return { status: n ? 'ok' : 'fail', value: `${n} case(s) cochée(s)` };
  }

  // ----- Listes déroulantes ARIA (boutons Workday « Sélectionner ») -----
  const visibleListboxes = () => [...document.querySelectorAll('[role="listbox"]')].filter(AP.isVisible);
  const listOptions = (list) => [...list.querySelectorAll('[role="option"]')].filter(AP.isVisible);
  const optText = (o) => {
    const label = o.querySelector?.('[data-automation-id="promptOption"]');
    return o.getAttribute('data-automation-label') || label?.getAttribute('data-automation-label') || AP.textOf(label || o);
  };

  function controlled(btn) {
    const id = btn.getAttribute('aria-controls') || btn.getAttribute('aria-owns');
    const el = id && document.getElementById(id);
    return el && AP.isVisible(el) ? el : null;
  }

  async function openListbox(btn, checkpoint = () => {}) {
    checkpoint();
    const before = new Set(visibleListboxes());
    const find = () => controlled(btn) || visibleListboxes().find((l) => !before.has(l) && !l.contains(btn));
    if (btn.getAttribute('aria-expanded') === 'true') {
      const l = controlled(btn) || visibleListboxes().find((x) => !x.contains(btn));
      if (l) return l;
    }
    AP.click(btn);
    let list = await AP.waitFor(find, { timeout: 2000, checkpoint });
    if (!list) {
      checkpoint();
      await AP.press(btn, 'ArrowDown');
      list = await AP.waitFor(find, { timeout: 1200, checkpoint });
    }
    if (list) await AP.waitFor(() => listOptions(list), { timeout: 1500, checkpoint });
    return list;
  }

  const isOpen = (btn) => btn.getAttribute('aria-expanded') === 'true' || !!controlled(btn);

  async function closeListbox(btn, checkpoint = () => {}) {
    checkpoint();
    const list = controlled(btn);
    await AP.press(AP.focusedElement() || list || btn, 'Escape');
    await AP.sleep(120);
    checkpoint();
    if (isOpen(btn) && list?.isConnected) {
      // Liste Workday (Canvas Kit) : Escape doit viser la liste elle-même.
      await AP.press(list, 'Escape');
      await AP.sleep(120);
    }
    checkpoint();
    if (isOpen(btn)) {
      AP.click(btn);
      await AP.sleep(120);
    }
  }

  async function fillDropdown(d, result) {
    const btn = d.el;
    const wants = wantsOf(result);
    const cur = AP.textOf(btn);
    if (cur && !AP.PLACEHOLDER_RE.test(cur) && AP.bestMatch([cur], wants, (x) => x).score >= 0.9) {
      return { status: 'ok', value: cur, note: 'Déjà sélectionné' };
    }
    const list = await openListbox(btn, d.checkpoint);
    d.checkpoint?.();
    if (!list) return { status: 'fail', note: 'Liste impossible à ouvrir' };
    let opts = listOptions(list);
    let { option, score } = AP.bestMatch(opts, wants, optText);
    if ((!option || score < MIN_SCORE) && wants[0]) {
      // Liste longue/virtualisée : saisie au clavier pour faire défiler.
      for (const ch of wants[0].slice(0, 6)) AP.key(document.activeElement || list, 'keydown', ch);
      await AP.sleep(300);
      d.checkpoint?.();
      opts = listOptions(list);
      ({ option, score } = AP.bestMatch(opts, wants, optText));
    }
    if (!option || score < MIN_SCORE) {
      const options = opts.map(optText).filter((t) => t && !AP.PLACEHOLDER_RE.test(t)).slice(0, 80);
      await closeListbox(btn, d.checkpoint);
      return { status: 'fail', note: 'Aucune option correspondante', options };
    }
    try {
      option.scrollIntoView({ block: 'nearest' });
    } catch {
      /* ignore */
    }
    const chosen = optText(option);
    d.checkpoint?.();
    AP.click(option);
    await AP.sleep(300);
    d.checkpoint?.();
    if (btn.getAttribute('aria-expanded') === 'true' || AP.isVisible(list)) {
      await AP.press(option, 'Enter');
      await AP.sleep(200);
    }
    const now = AP.textOf(btn);
    const ok = AP.similarity(now, chosen) >= 0.8;
    if (!ok && (btn.getAttribute('aria-expanded') === 'true' || AP.isVisible(list))) await closeListbox(btn, d.checkpoint);
    return { status: ok ? 'ok' : 'check', value: chosen, note: ok ? '' : 'Sélection à confirmer' };
  }

  /** Lit les options d'une liste fermée (pour les envoyer à l'IA). */
  async function probeOptions(d, ctx = {}) {
    d.checkpoint = ctx.checkpoint;
    d.checkpoint?.();
    if (d.kind !== 'dropdown') return d.options || [];
    const list = await openListbox(d.el, d.checkpoint);
    if (!list) return [];
    const opts = listOptions(list)
      .map(optText)
      .filter((t) => t && !AP.PLACEHOLDER_RE.test(t))
      .slice(0, 80);
    await closeListbox(d.el, d.checkpoint);
    return opts;
  }

  // ----- Champs « prompt » Workday (recherche + sélection) et combobox ARIA -----
  /** React peut recréer l'input (et les pastilles) après chaque sélection. */
  function refreshPrompt(d) {
    let input = d.htmlId && document.getElementById(d.htmlId);
    if (!input && d.container?.isConnected) {
      input = d.container.querySelector('input[data-uxi-widget-type="selectinput"], input[role="combobox"], input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])');
    }
    if (!input && d.el?.isConnected) input = d.el;
    if (!input) return null;
    d.el = input;
    if (!d.container?.isConnected) {
      d.container = input.closest('[data-automation-id^="formField"], [data-automation-id="multiSelectContainer"]') || input.parentElement;
    }
    if (!input.hasAttribute('data-applypilot-id')) input.setAttribute('data-applypilot-id', d.id);
    return input;
  }

  function promptOptions(d, before = new Set()) {
    const input = refreshPrompt(d);
    if (!input) return [];
    const list = controlled(input);
    const owner = input.getAttribute('data-uxi-multiselect-id');
    const items = new Set();
    for (const el of document.querySelectorAll('[data-automation-id="promptOption"], [data-automation-id="promptLeafNode"], [role="option"]')) {
      // Les pastilles utilisent aussi promptOption. Ce ne sont pas des résultats de recherche.
      if (el.closest('[data-automation-id="selectedItemList"], [data-automation-id="selectedItem"]')) continue;
      // Workday : le onClick est sur promptLeafNode, pas sur son wrapper role=option.
      const option = el.closest('[data-automation-id="promptLeafNode"]') || el.querySelector('[data-automation-id="promptLeafNode"]') || el.closest('[role="option"]') || el;
      if (!AP.isVisible(option) || option.matches('[aria-disabled="true"], :disabled')) continue;
      const optionOwner = option.closest('[data-uxi-multiselect-id]')?.getAttribute('data-uxi-multiselect-id');
      if (owner && optionOwner && owner !== optionOwner) continue;
      if (list && !list.contains(option)) continue;
      const popup = option.closest('[role="listbox"]');
      if (!list && !(owner && owner === optionOwner) && popup && before.has(popup) && !d.container.contains(popup)) continue;
      items.add(option);
    }
    return [...items];
  }

  function selectedPrompt(d, wants) {
    refreshPrompt(d);
    return AP.selectedPromptItems(d.container).find((t) => AP.bestMatch([t], wants, (x) => x).score >= 0.8) || null;
  }

  async function expandPromptSelections(d) {
    d.checkpoint?.();
    refreshPrompt(d);
    // Workday replie la liste au-delà de cinq éléments. Il faut la déplier pour vérifier les suivants.
    const more = d.container?.querySelector('[data-automation-id="wd-MoreLink"][data-automation-morelinkexpanded="false"] [data-automation-id="moreLinkLabel"]');
    if (more && AP.isVisible(more)) {
      AP.click(more);
      await AP.sleep(120);
      refreshPrompt(d);
    }
  }

  async function waitForPromptSelection(d, wants) {
    const start = Date.now();
    do {
      await expandPromptSelections(d);
      const selected = selectedPrompt(d, wants);
      if (selected) return selected;
      await AP.sleep(80);
    } while (Date.now() - start < 1400);
    d.checkpoint?.();
    return null;
  }

  async function clearInput(input, checkpoint = () => {}) {
    checkpoint();
    if (!input?.isConnected) return;
    AP.setNativeValue(input, '');
    input.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'deleteContentBackward' }));
    await AP.press(input, 'Escape');
  }

  async function searchAndPick(d, query, wants) {
    d.checkpoint?.();
    let input = refreshPrompt(d);
    if (!input) return null;
    const before = new Set(visibleListboxes());
    AP.click(input);
    input = refreshPrompt(d);
    if (!input) return null;
    await AP.typeText(input, query, { delay: 5, checkpoint: d.checkpoint });
    await AP.press(refreshPrompt(d) || input, 'Enter');
    // Attendre une correspondance, pas simplement n'importe quelle option d'une autre liste.
    const match = await AP.waitFor(() => {
      const m = AP.bestMatch(promptOptions(d, before), wants, optText);
      return m.option && m.score >= MIN_SCORE ? m : null;
    }, { timeout: 3500, checkpoint: d.checkpoint });
    d.checkpoint?.();
    if (!match) {
      await clearInput(refreshPrompt(d), d.checkpoint);
      return null;
    }
    const option = match.option;
    const alreadyChecked = option.getAttribute('data-automation-checked') === 'Checked' || option.getAttribute('data-uxi-multiselectlistitem-isselected') === 'true';
    if (!alreadyChecked) AP.click(option);
    let selected = await waitForPromptSelection(d, wants);
    d.checkpoint?.();
    if (selected) return selected;
    if (!alreadyChecked) {
      // Catégorie hiérarchique ou composant dont seul le contrôle intérieur sélectionne.
      const sub = AP.bestMatch(promptOptions(d, before), wants, optText);
      if (sub.option && sub.score >= MIN_SCORE && sub.option !== option) AP.click(sub.option);
      else {
        const inner = option.isConnected && option.querySelector('input[type="radio"], input[type="checkbox"], [role="checkbox"]');
        if (inner && !inner.checked && inner.getAttribute('aria-checked') !== 'true') AP.click(inner);
        else { await clearInput(refreshPrompt(d), d.checkpoint); return null; }
      }
      selected = await waitForPromptSelection(d, wants);
    }
    if (!selected) await clearInput(refreshPrompt(d), d.checkpoint);
    return selected; // un clic ou du texte tapé n'est jamais une preuve de sélection
  }

  async function fillPrompt(d, result) {
    const targets = result.multi && Array.isArray(result.value) ? result.value.map((v) => [v]) : [wantsOf(result)];
    for (const wants of targets) {
      await expandPromptSelections(d);
      if (selectedPrompt(d, wants)) continue; // garder les choix existants, sans les recocher/décocher
      for (const q of wants.slice(0, 3)) {
        if (await searchAndPick(d, q, wants)) break;
      }
    }
    await clearInput(refreshPrompt(d), d.checkpoint);
    await AP.sleep(120);
    await expandPromptSelections(d);
    const picked = targets.map((w) => selectedPrompt(d, w)).filter(Boolean);
    const missed = targets.filter((w) => !selectedPrompt(d, w)).map((w) => w[0]);
    const note = missed.length ? `Non sélectionnés : ${missed.slice(0, 5).join(', ')}` : '';
    if (!picked.length) return { status: 'fail', note };
    return { status: missed.length ? 'check' : 'ok', value: [...new Set(picked)].join(', '), note };
  }

  function comboOptions(input) {
    const id = input.getAttribute('aria-controls') || input.getAttribute('aria-owns');
    const scope = (id && document.getElementById(id)) || document;
    return [...scope.querySelectorAll('[role="option"], .select__option, [class*="option" i][id*="option" i]')].filter(AP.isVisible);
  }

  async function fillCombobox(d, result) {
    const input = d.el;
    const wants = wantsOf(result);
    AP.click(input);
    await AP.typeText(input, wants[0], { checkpoint: d.checkpoint });
    const opts = await AP.waitFor(() => comboOptions(input), { timeout: 2500, checkpoint: d.checkpoint });
    d.checkpoint?.();
    if (opts) {
      const { option, score } = AP.bestMatch(opts, wants, AP.textOf);
      if (option && score >= MIN_SCORE) {
        const chosen = AP.textOf(option);
        AP.click(option);
        await AP.sleep(250);
        return { status: 'ok', value: chosen };
      }
    }
    d.checkpoint?.();
    await AP.press(input, 'Enter');
    return { status: 'check', value: wants[0], note: 'Texte saisi : aucune option correspondante' };
  }

  // ----- Fichiers -----
  async function fillFile(d, result) {
    const input = d.el;
    const files = (Array.isArray(result.value) ? result.value : [result.value]).filter((f) => f && f.base64);
    if (!files.length) return { status: 'todo', note: 'Aucun fichier à joindre' };
    const zone = input.closest('[data-automation-id="attachmentsSection"], [data-automation-id="resumeSection"], section, fieldset, form') || input.parentElement?.parentElement || input.parentElement;
    const zoneText = AP.textOf(zone);
    const present = new Set([...(input.files || [])].map((f) => f.name));
    const toAdd = files.filter((f) => !present.has(f.name) && !zoneText.includes(f.name) && !zoneText.includes(f.name.replace(/\.pdf$/i, '')));
    if (!toAdd.length) return { status: 'ok', value: files.map((f) => f.name).join(', '), note: 'Déjà joint' };
    const accepted = input.multiple ? toAdd : toAdd.slice(0, 1);
    const dt = new DataTransfer();
    if (input.multiple) for (const f of input.files || []) dt.items.add(f);
    for (const f of accepted) dt.items.add(AP.b64ToFile(f.base64, f.name, f.type || 'application/pdf'));
    input.files = dt.files;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await AP.sleep(700);
    const skipped = toAdd.length - accepted.length;
    return {
      status: 'ok',
      value: accepted.map((f) => f.name).join(', '),
      note: skipped ? 'Ce champ n’accepte qu’un fichier : joins la lettre dans le champ prévu' : '',
    };
  }

  /** Remplit un champ selon son type. `result` = { value, alts?, multi?, bool? }. */
  async function fillField(d, result, ctx) {
    d.checkpoint = ctx?.checkpoint;
    d.checkpoint?.();
    if (!d.el?.isConnected) return { status: 'fail', note: 'Champ disparu' };
    switch (d.kind) {
      case 'text':
      case 'textarea':
        return fillText(d, result, ctx);
      case 'date-native':
        return fillNativeDate(d, result);
      case 'date':
        return fillDateParts(d, result);
      case 'select':
        return fillSelect(d, result);
      case 'radio':
        return fillRadio(d, result);
      case 'checkbox':
        return fillCheckbox(d, result);
      case 'checkboxes':
        return fillCheckboxes(d, result);
      case 'dropdown':
        return fillDropdown(d, result);
      case 'prompt':
        return fillPrompt(d, result);
      case 'combobox':
        return fillCombobox(d, result);
      case 'file':
        return fillFile(d, result);
      default:
        return { status: 'fail', note: `Type non géré : ${d.kind}` };
    }
  }

  Object.assign(AP, { fillField, probeOptions, wantsOf, ym });
})();
