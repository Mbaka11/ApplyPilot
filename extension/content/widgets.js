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
    const got = await AP.setValue(el, v);
    if (got === v) return { status: 'ok', value: v, note };
    if (equivalent(got, v)) return { status: 'ok', value: got, note: 'Reformaté par le site' };
    return { status: 'check', value: got || v, note: 'Le site a modifié la valeur' };
  }

  async function fillNativeDate(d, result) {
    const p = ym(result.value);
    if (!p) return { status: 'fail', note: 'Date invalide' };
    const v = d.inputType === 'month' ? `${p.year}-${pad(p.month || 1)}` : `${p.year}-${pad(p.month || 1)}-${pad(p.day || 1)}`;
    await AP.setValue(d.el, v);
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
      if (!input || !v) continue;
      AP.click(input);
      await AP.typeText(input, v);
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await AP.sleep(60);
    }
    (year || month)?.blur?.();
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
    el.blur?.();
    return { status: el.value === option.value ? 'ok' : 'check', value: option.text.trim() };
  }

  function labelElFor(input) {
    return (input.id && document.querySelector(`label[for="${CSS.escape(input.id)}"]`)) || input.closest('label');
  }

  async function toggle(input, desired) {
    if (input.checked === desired) return true;
    const lab = labelElFor(input);
    AP.click(AP.isVisible(input) || !lab ? input : lab);
    await AP.sleep(80);
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
    const ok = await toggle(option.el, true);
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
    const ok = await toggle(d.el, want);
    return { status: ok ? 'ok' : 'fail', value: want ? 'coché' : 'décoché' };
  }

  async function fillCheckboxes(d, result) {
    const wants = Array.isArray(result.value) ? result.value : [result.value];
    let n = 0;
    for (const w of wants) {
      const items = d.boxes.map((b) => ({ el: b, text: AP.optionLabel(b) }));
      const { option, score } = AP.bestMatch(items, [w], (o) => o.text);
      if (option && score >= MIN_SCORE && (await toggle(option.el, true))) n++;
    }
    return { status: n ? 'ok' : 'fail', value: `${n} case(s) cochée(s)` };
  }

  // ----- Listes déroulantes ARIA (boutons Workday « Sélectionner ») -----
  const visibleListboxes = () => [...document.querySelectorAll('[role="listbox"]')].filter(AP.isVisible);
  const listOptions = (list) => [...list.querySelectorAll('[role="option"]')].filter(AP.isVisible);
  const optText = (o) => o.getAttribute('data-automation-label') || AP.textOf(o);

  function controlled(btn) {
    const id = btn.getAttribute('aria-controls') || btn.getAttribute('aria-owns');
    const el = id && document.getElementById(id);
    return el && AP.isVisible(el) ? el : null;
  }

  async function openListbox(btn) {
    const before = new Set(visibleListboxes());
    const find = () => controlled(btn) || visibleListboxes().find((l) => !before.has(l) && !l.contains(btn));
    if (btn.getAttribute('aria-expanded') === 'true') {
      const l = controlled(btn) || visibleListboxes().find((x) => !x.contains(btn));
      if (l) return l;
    }
    AP.click(btn);
    let list = await AP.waitFor(find, { timeout: 2000 });
    if (!list) {
      await AP.press(btn, 'ArrowDown');
      list = await AP.waitFor(find, { timeout: 1200 });
    }
    if (list) await AP.waitFor(() => listOptions(list), { timeout: 1500 });
    return list;
  }

  async function closeListbox(btn) {
    await AP.press(document.activeElement && document.activeElement !== document.body ? document.activeElement : btn, 'Escape');
    await AP.sleep(120);
    if (btn.getAttribute('aria-expanded') === 'true') {
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
    const list = await openListbox(btn);
    if (!list) return { status: 'fail', note: 'Liste impossible à ouvrir' };
    let opts = listOptions(list);
    let { option, score } = AP.bestMatch(opts, wants, optText);
    if ((!option || score < MIN_SCORE) && wants[0]) {
      // Liste longue/virtualisée : saisie au clavier pour faire défiler.
      for (const ch of wants[0].slice(0, 6)) AP.key(document.activeElement || list, 'keydown', ch);
      await AP.sleep(300);
      opts = listOptions(list);
      ({ option, score } = AP.bestMatch(opts, wants, optText));
    }
    if (!option || score < MIN_SCORE) {
      const options = opts.map(optText).filter((t) => t && !AP.PLACEHOLDER_RE.test(t)).slice(0, 80);
      await closeListbox(btn);
      return { status: 'fail', note: 'Aucune option correspondante', options };
    }
    try {
      option.scrollIntoView({ block: 'nearest' });
    } catch {
      /* ignore */
    }
    const chosen = optText(option);
    AP.click(option);
    await AP.sleep(300);
    if (btn.getAttribute('aria-expanded') === 'true' || AP.isVisible(list)) {
      await AP.press(option, 'Enter');
      await AP.sleep(200);
    }
    const now = AP.textOf(btn);
    const ok = AP.similarity(now, chosen) >= 0.8;
    if (!ok && (btn.getAttribute('aria-expanded') === 'true' || AP.isVisible(list))) await closeListbox(btn);
    return { status: ok ? 'ok' : 'check', value: chosen, note: ok ? '' : 'Sélection à confirmer' };
  }

  /** Lit les options d'une liste fermée (pour les envoyer à l'IA). */
  async function probeOptions(d) {
    if (d.kind !== 'dropdown') return d.options || [];
    const list = await openListbox(d.el);
    if (!list) return [];
    const opts = listOptions(list)
      .map(optText)
      .filter((t) => t && !AP.PLACEHOLDER_RE.test(t))
      .slice(0, 80);
    await closeListbox(d.el);
    return opts;
  }

  // ----- Champs « prompt » Workday (recherche + sélection) et combobox ARIA -----
  function promptOptions() {
    return [...document.querySelectorAll('[data-automation-id="promptOption"], [data-automation-id="promptLeafNode"], [role="option"]')].filter(AP.isVisible);
  }

  function promptSelected(d, wants) {
    const items = AP.selectedPromptItems(d.container);
    return items.some((t) => AP.bestMatch([t], wants, (x) => x).score >= 0.8);
  }

  async function clearInput(input) {
    AP.setNativeValue(input, '');
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
    await AP.press(input, 'Escape');
  }

  async function searchAndPick(d, query, wants) {
    const input = d.el;
    AP.click(input);
    await AP.typeText(input, query);
    await AP.press(input, 'Enter');
    const opts = await AP.waitFor(promptOptions, { timeout: 3500 });
    if (!opts) {
      await clearInput(input);
      return null;
    }
    const { option, score } = AP.bestMatch(opts, wants, optText);
    if (!option || score < MIN_SCORE) {
      await clearInput(input);
      return null;
    }
    const chosen = optText(option);
    AP.click(option);
    await AP.sleep(450);
    if (!promptSelected(d, wants)) {
      // Catégorie hiérarchique : un second niveau d'options apparaît.
      const sub = promptOptions();
      const m = sub.length ? AP.bestMatch(sub, wants, optText) : { option: null, score: 0 };
      if (m.option && m.score >= MIN_SCORE && m.option !== option) {
        AP.click(m.option);
        await AP.sleep(450);
      } else {
        const inner = option.querySelector?.('input[type="radio"], input[type="checkbox"]');
        if (inner && !inner.checked) {
          AP.click(inner);
          await AP.sleep(300);
        }
      }
    }
    return chosen;
  }

  async function fillPrompt(d, result) {
    const targets = result.multi && Array.isArray(result.value) ? result.value.map((v) => [v]) : [wantsOf(result)];
    const picked = [];
    const missed = [];
    for (const wants of targets) {
      if (promptSelected(d, wants)) {
        picked.push(wants[0]);
        continue;
      }
      let chosen = null;
      for (const q of wants.slice(0, 3)) {
        chosen = await searchAndPick(d, q, wants);
        if (chosen) break;
      }
      if (chosen) picked.push(chosen);
      else missed.push(wants[0]);
    }
    await AP.press(d.el, 'Escape');
    if (!picked.length) return { status: 'fail', note: `Introuvable dans la liste : ${missed.slice(0, 3).join(', ')}` };
    const confirmed = targets.every((w) => promptSelected(d, w));
    return {
      status: confirmed && !missed.length ? 'ok' : 'check',
      value: picked.join(', '),
      note: missed.length ? `Non trouvés : ${missed.slice(0, 5).join(', ')}` : confirmed ? '' : 'Sélection à confirmer',
    };
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
    await AP.typeText(input, wants[0]);
    const opts = await AP.waitFor(() => comboOptions(input), { timeout: 2500 });
    if (opts) {
      const { option, score } = AP.bestMatch(opts, wants, AP.textOf);
      if (option && score >= MIN_SCORE) {
        const chosen = AP.textOf(option);
        AP.click(option);
        await AP.sleep(250);
        return { status: 'ok', value: chosen };
      }
    }
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
