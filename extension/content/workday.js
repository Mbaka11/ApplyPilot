// ApplyPilot — spécificités Workday (étapes, pays en premier, ajout des blocs expérience/formation).
(() => {
  const AP = globalThis.ApplyPilot;

  function currentStep() {
    const active = document.querySelector('[data-automation-id="progressBarActiveStep"]');
    if (active) {
      const t = AP.textOf(active);
      const m = t.match(/(\d+)\s*(?:of|sur|de)\s*(\d+)/i);
      const name = t
        .replace(/current step|étape actuelle|étape en cours|etape actuelle/gi, '')
        .replace(/\d+\s*(?:of|sur|de)\s*\d+/i, '')
        .trim();
      return { index: m ? +m[1] : null, total: m ? +m[2] : null, name };
    }
    const h = document.querySelector('[data-automation-id="applyFlowPage"] h2, [data-automation-id="applyFlowPage"] h3');
    return h ? { index: null, total: null, name: AP.textOf(h) } : null;
  }

  /** Le pays modifie le bloc adresse : on le règle avant le reste. */
  async function preFill(ctx) {
    const btn = document.querySelector(
      'button[data-automation-id="countryDropdown"], [data-automation-id="formField-country"] button[aria-haspopup="listbox"], button#country--country',
    );
    if (!btn || !AP.isVisible(btn)) return;
    const want = ctx.addr.country || 'Canada';
    if (AP.similarity(AP.textOf(btn), want) >= 0.9) return;
    const d = AP.describeElement(btn);
    await AP.fillField(d, { value: want }, ctx);
    await AP.sleep(900);
  }

  // Sections "répétées" : expériences et formations seulement si la section est vide ;
  // langues et sites Web complétés tant que les blocs présents sont vierges (Workday en affiche souvent un vide).
  const SECTIONS = {
    experience: {
      re: /^(work experience|experience professionnelle|experiences? professionnelles?|employment history|work history|experience)$/,
      wanted: (c) => c.p.experience || [],
    },
    education: { re: /^(education|formation|formation academique|scolarite|etudes)$/, wanted: (c) => c.p.education || [] },
    language: { re: /^(languages?|langues?|competences linguistiques|language skills)$/, wanted: (c) => AP.langEntries(c).filter((l) => AP.levelInfo(l.level)), topUp: true },
    website: { re: /^(websites?|web sites?|sites web|sites internet|liens|links)$/, wanted: (c) => AP.websiteList(c), topUp: true },
  };

  function addButtonAfter(heading) {
    let scope = heading.parentElement;
    for (let k = 0; scope && k < 4; k++, scope = scope.parentElement) {
      const btn = [...scope.querySelectorAll('button, [role="button"]')].find((b) => {
        if (!AP.isVisible(b) || !(heading.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)) return false;
        const aid = b.getAttribute('data-automation-id') || '';
        const t = AP.norm(AP.textOf(b) || b.getAttribute('aria-label') || '');
        return /^(add|add another|add-button)$/i.test(aid) || /^(add|ajouter)\b/.test(t);
      });
      if (btn) return { scope, btn };
    }
    return null;
  }

  function countEntries(scope, type) {
    const ids = new Set();
    for (const d of AP.scanFields(scope)) if (d.entryType === type) ids.add(d.entryIndex);
    return ids.size;
  }

  /** Un bloc déjà saisi (par toi ou par le site) empêche d'ajouter des blocs : rien n'est dupliqué. */
  const hasFilledEntry = (scope, type) => AP.scanFields(scope).some((d) => d.entryType === type && d.kind !== 'checkbox' && !d.isEmpty);

  /** Ajoute les blocs expérience/formation manquants (seulement si la section est vide). */
  async function ensureEntries(ctx) {
    const added = { experience: 0, education: 0, language: 0, website: 0 };
    AP.computePageFlags(ctx, AP.scanFields()); // ex. champ LinkedIn dédié : pas de bloc « site Web » pour lui
    for (const [type, { re, wanted: want, topUp }] of Object.entries(SECTIONS)) {
      const wanted = want(ctx) || [];
      if (!wanted.length) continue;
      const heading = [...document.querySelectorAll('h2, h3, h4, legend, [role="heading"]')].find(
        (h) => AP.isVisible(h) && re.test(AP.norm(AP.textOf(h))),
      );
      if (!heading) continue;
      const found = addButtonAfter(heading);
      if (!found) continue;
      const existing = countEntries(found.scope, type);
      if (topUp ? hasFilledEntry(found.scope, type) : existing > 0) continue;
      const max = Math.min(wanted.length, Number(ctx.options.maxEntries) || 6) - (topUp ? existing : 0);
      for (let i = 0; i < max; i++) {
        const current = addButtonAfter(heading);
        if (!current) break;
        const before = countEntries(current.scope, type);
        AP.click(current.btn);
        const ok = await AP.waitFor(() => countEntries(current.scope, type) > before, { timeout: 2500 });
        if (!ok) break;
        added[type]++;
        await AP.sleep(250);
      }
    }
    // Les champs ajoutés sont scannés juste après par fillPage().
    AP.scanFields();
    return added;
  }

  AP.workday = { currentStep, preFill, ensureEntries };
})();
