// ApplyPilot — point d'entrée des scripts de contenu : commandes appelées par le panneau latéral.
(() => {
  const AP = globalThis.ApplyPilot;
  AP.VERSION = '0.4.0';
  AP.frameToken = AP.frameToken || Math.random().toString(36).slice(2, 6);

  AP.cancelledRuns = AP.cancelledRuns || new Set();
  const cancelledError = () => Object.assign(new Error('Remplissage arrêté ou étape changée'), { name: 'AbortError' });

  function pageIdentity() {
    const step = AP.platform() === 'workday' ? AP.workday.currentStep() : null;
    const heading = step?.name || AP.textOf(document.querySelector('main h1, main h2, form h1, form h2, h1, h2'));
    return JSON.stringify([location.href, step?.index ?? null, heading]);
  }

  function fillContext(payload) {
    const token = { id: payload.runId || Math.random().toString(36), cancelled: false, page: payload.expectedPage || pageIdentity() };
    if (AP.activeFill) AP.activeFill.cancelled = true;
    AP.activeFill = token;
    const ctx = AP.makeContext(payload);
    ctx.checkpoint = () => {
      if (token.cancelled || AP.activeFill !== token || AP.cancelledRuns.has(token.id) || pageIdentity() !== token.page) throw cancelledError();
    };
    ctx.checkpoint();
    return ctx;
  }

  const CHOICE = new Set(['select', 'radio', 'dropdown', 'prompt', 'combobox', 'checkboxes']);
  const hasRuntime = () => {
    try {
      return !!globalThis.chrome?.runtime?.id;
    } catch {
      return false;
    }
  };

  function short(v) {
    if (v === true) return 'coché';
    if (v === false) return 'décoché';
    const s = Array.isArray(v) ? v.join(', ') : String(v ?? '');
    return s.length > 90 ? `${s.slice(0, 87)}…` : s;
  }

  function serializeResult(id, r) {
    const d = r.d;
    return {
      id,
      label: d.label || d.placeholder || d.name || '(sans libellé)',
      kind: d.kind,
      section: [d.section, d.entryType ? `${d.entryType === 'experience' ? 'Expérience' : d.entryType === 'education' ? 'Formation' : d.entryType} ${d.entryIndex + 1}` : '']
        .filter(Boolean)
        .join(' · '),
      required: d.required,
      status: r.status,
      value: short(r.value),
      note: r.note || '',
      source: r.source || '',
    };
  }

  function paint(d, status, note, language = 'fr') {
    const map = { ok: 'ok', check: 'check', todo: 'todo', fail: 'todo', unresolved: 'todo' };
    if (map[status]) AP.highlight(d.container || d.el, map[status], globalThis.ApplyPilotI18n?.translate(note, language) ?? note);
  }

  function detect() {
    const q = AP.quickJob();
    const fields = AP.scanFields();
    const plat = AP.platform();
    return {
      platform: plat,
      isPosting: q.isPosting,
      title: q.title,
      company: q.company,
      jobKey: AP.jobKey(),
      pageIdentity: pageIdentity(),
      fieldCount: fields.filter((f) => f.kind !== 'file').length,
      fileCount: fields.filter((f) => f.kind === 'file').length,
      step: plat === 'workday' ? AP.workday.currentStep() : null,
      hasPassword: !!document.querySelector('input[type="password"]'),
    };
  }

  /** Remplit la page : règles du profil (plusieurs passes), puis liste ce qui reste pour l'IA. */
  async function fillPage(payload) {
    AP.usedHere = true;
    AP.lastPayload = payload;
    const ctx = fillContext(payload);
    AP.clearHighlights();
    const info = {};
    if (ctx.platform === 'workday') {
      try {
        await AP.workday.preFill(ctx);
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        console.warn('[ApplyPilot] pays', e);
      }
      if (ctx.options.addEntries !== false) {
        try {
          info.addedEntries = await AP.workday.ensureEntries(ctx);
        } catch (e) {
          if (e.name === 'AbortError') throw e;
          console.warn('[ApplyPilot] blocs', e);
        }
      }
    }

    const results = new Map();
    for (let pass = 0; pass < 3; pass++) {
      ctx.checkpoint();
      const fields = AP.scanFields();
      AP.computePageFlags(ctx, fields);
      let acted = 0;
      for (const d of fields) {
        ctx.checkpoint();
        if (results.has(d.id) && results.get(d.id).status !== 'unresolved') continue;
        const r = AP.resolve(d, ctx);
        let res;
        if (!r) res = { status: 'unresolved' };
        else if (r.skip) res = { status: r.status || 'skip', note: r.note };
        else if (r.missing) res = { status: 'todo', note: r.note };
        else if (!d.isEmpty && !ctx.options.overwrite && d.kind !== 'file' && d.kind !== 'checkbox' &&
          !(r.multi && Array.isArray(r.value) && ['prompt', 'checkboxes', 'select'].includes(d.kind))) {
          res = { status: 'kept', value: d.value, note: 'Déjà rempli (non modifié)' };
        } else {
          try {
            res = await AP.fillField(d, r, ctx);
          } catch (e) {
            if (e.name === 'AbortError') throw e;
            res = { status: 'fail', note: String(e?.message || e) };
          }
          if (res.status === 'ok' && (r.review || (r.confidence ?? 1) < 0.8)) res.status = 'check';
          res.source = r.source;
          res.note = res.note || r.note || '';
          acted++;
        }
        results.set(d.id, { d, ...res, ruleId: r?.ruleId });
      }
      AP.releaseFocus(); // dernier champ validé avant de rescanner (Workday enregistre au blur)
      if (!acted) break;
      await AP.sleep(450); // laisse la page afficher les champs dépendants
    }

    const unresolved = [];
    let probes = 0;
    for (const r of results.values()) {
      ctx.checkpoint();
      const choiceFail = r.status === 'fail' && CHOICE.has(r.d.kind) && r.ruleId !== 'skills';
      if (r.status !== 'unresolved' && !choiceFail) continue;
      if (!r.d.el.isConnected) continue;
      if (r.options?.length) r.d.options = r.options;
      if (r.d.kind === 'dropdown' && !r.d.options?.length && probes < 25) {
        probes++;
        try {
          r.d.options = await AP.probeOptions(r.d, ctx);
        } catch {
          r.d.options = [];
        }
      }
      unresolved.push(AP.serializeField(r.d));
    }

    const out = [];
    ctx.checkpoint();
    for (const [id, r] of results) {
      if (r.status === 'skip' && !r.note) continue;
      paint(r.d, r.status, r.note, ctx.options.uiLanguage || ctx.lang);
      out.push(serializeResult(id, r));
    }
    return {
      platform: ctx.platform,
      step: ctx.platform === 'workday' ? AP.workday.currentStep() : null,
      info,
      results: out,
      unresolved,
    };
  }

  /** Applique les réponses de l'IA (toujours marquées « à vérifier »). */
  async function fillValues(payload) {
    const ctx = fillContext(payload);
    const fields = AP.scanFields();
    AP.computePageFlags(ctx, fields);
    const byId = new Map(fields.map((f) => [f.id, f]));
    const out = [];
    for (const [id, a] of Object.entries(payload.answers || {})) {
      ctx.checkpoint();
      const d = byId.get(id);
      if (!d) continue; // champ d'un autre cadre (iframe)
      let res;
      if (a.value === null || a.value === undefined || a.value === '') {
        res = { status: 'todo', note: a.note || 'Information absente du profil : à remplir' };
      } else {
        const r = { value: a.value, confidence: a.confidence, source: 'ia', multi: Array.isArray(a.value) && CHOICE.has(d.kind) };
        if (typeof a.value === 'boolean') r.bool = a.value;
        try {
          res = await AP.fillField(d, r, ctx);
        } catch (e) {
          if (e.name === 'AbortError') throw e;
          res = { status: 'fail', note: String(e?.message || e) };
        }
        if (res.status === 'ok') res.status = 'check';
        res.note = a.note || res.note || '';
      }
      ctx.checkpoint();
      const r = { d, ...res, source: 'ia' };
      paint(d, r.status, r.note, ctx.options.uiLanguage || ctx.lang);
      out.push(serializeResult(id, r));
    }
    AP.releaseFocus();
    return { results: out };
  }

  /** Réponses « nouvelles » de la page (questions non couvertes par le profil) pour la mémoire. */
  function sameAsRule(d, v, r) {
    if (typeof v === 'boolean') return v === (r.bool ?? r.value);
    if (d.kind === 'date' || d.kind === 'date-native') {
      const a = AP.ym(v);
      const b = AP.ym(r.value);
      return !!a && !!b && a.year === b.year && (a.month ?? 0) === (b.month ?? 0);
    }
    const text = Array.isArray(v) ? v.join(' ') : String(v);
    return AP.bestMatch([text], AP.wantsOf(r), (x) => x).score >= 0.9;
  }

  function captureAnswers() {
    const ctx = AP.makeContext(AP.lastPayload || {});
    const fields = AP.scanFields();
    AP.computePageFlags(ctx, fields);
    const items = [];
    for (const d of fields) {
      if (d.kind === 'file' || d.kind === 'textarea' || d.inputType === 'password' || d.entryType) continue;
      if (d.isEmpty || !d.label || d.label.length < 3) continue;
      const v = d.value;
      if (typeof v === 'string' && v.length > 120) continue;
      const r = AP.resolve(d, ctx);
      if (r && AP.NO_MEMORY.has(r.ruleId)) continue;
      if (r && r.ruleId !== 'memory' && !r.missing && !r.skip) {
        const same = sameAsRule(d, v, r);
        if (same) continue; // identique à la règle : rien à apprendre
      }
      items.push({ label: d.label, value: v, kind: d.kind });
    }
    return items;
  }

  function focusField(id) {
    const el = document.querySelector(`[data-applypilot-id="${CSS.escape(id)}"]`);
    if (!el) return { found: false };
    const target = el.closest('[data-automation-id^="formField"]') || el;
    AP.flash(target);
    AP.focus(el);
    return { found: true };
  }

  async function run(cmd, payload = {}) {
    const base = { __ap: true, version: AP.VERSION, frameToken: AP.frameToken, url: location.href, isTop: window === window.top };
    try {
      switch (cmd) {
        case 'ping':
          return base;
        case 'detect':
          return { ...base, ...detect() };
        case 'extractJob':
          return { ...base, job: AP.extractJob() };
        case 'fill':
          return { ...base, ...(await fillPage(payload)) };
        case 'fillValues':
          return { ...base, ...(await fillValues(payload)) };
        case 'cancel':
          if (payload.runId) {
            AP.cancelledRuns.add(payload.runId);
            if (AP.cancelledRuns.size > 64) AP.cancelledRuns.delete(AP.cancelledRuns.values().next().value);
          }
          if (AP.activeFill && (!payload.runId || AP.activeFill.id === payload.runId)) {
            AP.activeFill.cancelled = true;
            AP.releaseFocus();
          }
          return { ...base, cancelled: true };
        case 'capture':
          return { ...base, items: captureAnswers() };
        case 'focus':
          return { ...base, ...focusField(payload.id) };
        case 'clear':
          AP.clearHighlights();
          return base;
        default:
          return { ...base, error: `Commande inconnue : ${cmd}` };
      }
    } catch (e) {
      if (e.name === 'AbortError') return { ...base, cancelled: true };
      return { ...base, error: String(e?.stack || e) };
    }
  }

  globalThis.__applyPilot = { run, version: AP.VERSION };

  // Mémoire : quand tu passes à l'étape suivante, les réponses non couvertes par le profil sont retenues.
  const NAV_RE = /^(next|continue|save and continue|save & continue|submit|review|suivant|continuer|enregistrer et continuer|sauvegarder et continuer|soumettre|envoyer|postuler|terminer)$/;
  globalThis.__applyPilotOnClick = (e) => {
    if (!AP.usedHere || !hasRuntime()) return;
    const btn = e.target?.closest?.('button, [role="button"], input[type="submit"]');
    if (!btn) return;
    const aid = btn.getAttribute('data-automation-id') || '';
    const t = AP.norm(AP.textOf(btn) || btn.value || btn.getAttribute('aria-label') || '');
    if (!NAV_RE.test(t) && !/bottom-navigation-(next|submit)-button|pageFooter(Next|Submit)Button/i.test(aid)) return;
    if (AP.activeFill && !AP.activeFill.cancelled) {
      AP.activeFill.cancelled = true;
      AP.cancelledRuns.add(AP.activeFill.id);
      chrome.runtime.sendMessage({ type: 'ap:fillCancelled', runId: AP.activeFill.id }).catch(() => {});
    }
    try {
      const items = captureAnswers();
      if (items.length) chrome.runtime.sendMessage({ type: 'ap:memory', items }).catch(() => {});
    } catch {
      /* contexte d'extension invalidé */
    }
  };
  if (!globalThis.__applyPilotClickInstalled) {
    document.addEventListener('click', (e) => globalThis.__applyPilotOnClick?.(e), true);
    globalThis.__applyPilotClickInstalled = true;
  }

  // Workday change d'étape sans recharger la page : on prévient le panneau latéral.
  if (window === window.top && AP.platform() === 'workday' && !globalThis.__applyPilotObserver && hasRuntime()) {
    let last = '';
    let timer = null;
    const obs = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const s = AP.workday.currentStep();
        const key = `${location.pathname}#${s ? `${s.index}/${s.name}` : ''}`;
        if (key === last) return;
        last = key;
        try {
          if (hasRuntime()) chrome.runtime.sendMessage({ type: 'ap:pageChanged', step: s, url: location.href, pageIdentity: pageIdentity() }).catch(() => {});
        } catch {
          /* ignore */
        }
      }, 700);
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
    globalThis.__applyPilotObserver = obs;
  }
})();
