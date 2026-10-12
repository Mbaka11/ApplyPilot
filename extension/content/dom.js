// ApplyPilot — utilitaires DOM partagés par les scripts de contenu.
(() => {
  const AP = (globalThis.ApplyPilot = globalThis.ApplyPilot || {});

  // Chaque pause rattrape les déplacements de focus faits par la page pendant l'attente.
  const sleep = (ms) =>
    new Promise((r) =>
      setTimeout(() => {
        try {
          syncFocus();
        } catch {
          /* page en cours de déchargement */
        }
        r();
      }, ms),
    );

  /** Attend qu'une fonction renvoie une valeur « vraie » (tableau non vide accepté). */
  async function waitFor(fn, { timeout = 3000, interval = 80, checkpoint = () => {} } = {}) {
    const t0 = Date.now();
    for (;;) {
      checkpoint();
      let v = null;
      try {
        v = fn();
      } catch {
        v = null;
      }
      if (v && (!Array.isArray(v) || v.length)) return v;
      if (Date.now() - t0 >= timeout) return null;
      await sleep(interval);
    }
  }

  /** Même normalisation que le serveur (clé de la mémoire des réponses). */
  function norm(s) {
    return String(s ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[’`´]/g, "'")
      .replace(/\((required|obligatoire|requis|optional|facultatif)\)/g, ' ')
      .replace(/[*:?!.,;()[\]{}"«»]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const STOP = new Set(
    'the a an of and or to in for on at by with your you is are do did have has be been de la le les des du et ou en un une au aux a vous votre vos tu ton ta tes est sont avez avec sur par pour dans que qui ce cet cette'.split(' '),
  );

  function tokens(s) {
    return norm(s)
      .split(/[^a-z0-9+#]+/)
      .filter((t) => t && (t.length > 1 || /\d/.test(t)) && !STOP.has(t));
  }

  /** b est préfixe de a, et s'arrête sur une frontière de mot. */
  function boundaryPrefix(a, b) {
    return a.startsWith(b) && (a.length === b.length || !/[a-z0-9+#]/.test(a[b.length]));
  }

  /** Similarité 0..1 entre deux libellés (accents, casse et ponctuation ignorés). */
  function similarity(a, b) {
    const na = norm(a);
    const nb = norm(b);
    if (!na || !nb) return 0;
    if (na === nb) return 1;
    if (boundaryPrefix(na, nb) || boundaryPrefix(nb, na)) return 0.9;
    if (` ${na} `.includes(` ${nb} `) || ` ${nb} `.includes(` ${na} `)) return 0.8;
    const ta = new Set(tokens(na));
    const tb = new Set(tokens(nb));
    if (!ta.size || !tb.size) return 0;
    let inter = 0;
    for (const t of ta) if (tb.has(t)) inter++;
    return ((2 * inter) / (ta.size + tb.size)) * 0.75;
  }

  /** Meilleure option pour une liste de valeurs souhaitées (par ordre de préférence). */
  function bestMatch(options, wants, getText = (o) => (typeof o === 'string' ? o : o.text)) {
    const list = (Array.isArray(wants) ? wants : [wants])
      .flat()
      .filter((w) => w !== null && w !== undefined && String(w).trim() !== '');
    let best = null;
    let bestScore = 0;
    list.forEach((w, i) => {
      for (const o of options) {
        const s = similarity(getText(o), w) - i * 0.005;
        if (s > bestScore) {
          bestScore = s;
          best = o;
        }
      }
    });
    return { option: best, score: Math.max(0, bestScore) };
  }

  function textOf(el) {
    if (!el) return '';
    return String(el.innerText ?? el.textContent ?? '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function isVisible(el) {
    if (!el || !el.isConnected || el.nodeType !== 1) return false;
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || st.visibility === 'collapse') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 || r.height > 0;
  }

  /** Élément placé hors du document (technique classique des champs « pot de miel »). */
  function isOffscreen(el) {
    const r = el.getBoundingClientRect();
    return r.right + window.scrollX < -50 || r.bottom + window.scrollY < -50;
  }

  function nativeSetter(el) {
    const proto =
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : el instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;
    return Object.getOwnPropertyDescriptor(proto, 'value').set;
  }

  function setNativeValue(el, v) {
    nativeSetter(el).call(el, v);
  }

  const KEYCODES = { Enter: 13, Escape: 27, Tab: 9, ArrowDown: 40, ArrowUp: 38, Backspace: 8, ' ': 32 };

  function key(el, type, k) {
    const keyCode = KEYCODES[k] ?? (k.length === 1 ? k.toUpperCase().charCodeAt(0) : 0);
    const code =
      k === ' ' ? 'Space' : k.length === 1 ? (/[a-z]/i.test(k) ? `Key${k.toUpperCase()}` : /\d/.test(k) ? `Digit${k}` : '') : k;
    return el.dispatchEvent(
      new KeyboardEvent(type, {
        key: k,
        code,
        keyCode,
        which: keyCode,
        charCode: type === 'keypress' ? (k.length === 1 ? k.charCodeAt(0) : keyCode) : 0,
        bubbles: true,
        cancelable: true,
        composed: true,
      }),
    );
  }

  async function press(el, k) {
    key(el, 'keydown', k);
    if (k === 'Enter' || k.length === 1) key(el, 'keypress', k);
    key(el, 'keyup', k);
    await sleep(60);
  }

  // ----- Focus -----
  // Quand la page n'a pas le focus (clic dans le panneau latéral, onglet en arrière-plan),
  // Chrome déplace bien document.activeElement mais ne déclenche AUCUN événement focus/blur.
  // Or Workday (React) n'enregistre un champ qu'à sa sortie (blur) : la valeur s'affiche,
  // puis « The field City is required ». On émet donc ces événements nous-mêmes, comme un vrai clic.
  const FOCUSABLE = 'input, select, textarea, button, a[href], [tabindex], [contenteditable=""], [contenteditable="true"]';
  let virtualFocus = null;

  function pageHasFocus() {
    try {
      return document.hasFocus();
    } catch {
      return true;
    }
  }

  function fireFocus(el, type, related) {
    const bubbles = type === 'focusin' || type === 'focusout';
    el.dispatchEvent(new FocusEvent(type, { bubbles, composed: true, relatedTarget: related || null }));
  }

  const isFocusable = (el) => !!el?.matches?.(FOCUSABLE) && !el.disabled;

  /**
   * La page déplace parfois le focus elle-même (ex. Workday met le focus sur la liste ouverte,
   * puis le rend au bouton). Sans focus de fenêtre, Chrome ne signale rien : on rattrape ici
   * ces changements pour que les composants reçoivent les mêmes blur/focus qu'avec un vrai clavier.
   */
  function syncFocus() {
    if (pageHasFocus()) {
      virtualFocus = null;
      return;
    }
    const a = document.activeElement;
    const cur = a && a !== document.body && a !== document.documentElement ? a : null;
    if (cur === virtualFocus || (!cur && !virtualFocus)) return;
    const prev = virtualFocus;
    virtualFocus = cur;
    if (prev?.isConnected) {
      fireFocus(prev, 'blur', cur);
      fireFocus(prev, 'focusout', cur);
    }
    if (cur) {
      fireFocus(cur, 'focus', prev);
      fireFocus(cur, 'focusin', prev);
    }
  }

  function focus(el) {
    if (!el) return;
    syncFocus();
    const prev = virtualFocus;
    try {
      el.focus({ preventScroll: true });
    } catch {
      /* non focalisable */
    }
    if (pageHasFocus()) {
      virtualFocus = null; // Chrome s'en charge
      return;
    }
    if (!isFocusable(el) || prev === el) return;
    if (prev?.isConnected) {
      fireFocus(prev, 'blur', el);
      fireFocus(prev, 'focusout', el);
    }
    virtualFocus = el;
    fireFocus(el, 'focus', prev);
    fireFocus(el, 'focusin', prev);
  }

  function blur(el) {
    if (!el) return;
    syncFocus();
    const wasVirtual = virtualFocus === el && !pageHasFocus();
    try {
      el.blur();
    } catch {
      /* ignore */
    }
    if (virtualFocus === el) virtualFocus = null;
    if (wasVirtual && el.isConnected) {
      fireFocus(el, 'blur');
      fireFocus(el, 'focusout');
    }
  }

  /** Élément qui a le focus, y compris le focus émulé quand la page est en arrière-plan. */
  function focusedElement() {
    syncFocus();
    if (virtualFocus?.isConnected && !pageHasFocus()) return virtualFocus;
    const a = document.activeElement;
    return a && a !== document.body ? a : null;
  }

  /** Fin de remplissage : le dernier champ actif est validé (blur). */
  function releaseFocus() {
    const el = focusedElement();
    if (el && el.matches?.('input, textarea, select')) blur(el);
  }

  /** Simule la frappe caractère par caractère (pour les champs de recherche et composants exigeants). */
  async function typeText(el, text, { clear = true, delay = 0, checkpoint = () => {} } = {}) {
    checkpoint();
    focus(el);
    if (clear && el.value) {
      setNativeValue(el, '');
      el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'deleteContentBackward' }));
    }
    let cur = clear ? '' : el.value || '';
    for (const ch of String(text)) {
      checkpoint();
      key(el, 'keydown', ch);
      key(el, 'keypress', ch);
      cur += ch;
      setNativeValue(el, cur);
      el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: ch }));
      key(el, 'keyup', ch);
      if (delay) await sleep(delay);
    }
    checkpoint();
  }

  /** Affecte une valeur à un input/textarea contrôlé (React & co.), avec repli sur la frappe simulée. */
  async function setValue(el, value, { blur: leave = true, checkpoint = () => {} } = {}) {
    checkpoint();
    const v = String(value ?? '');
    focus(el);
    setNativeValue(el, v);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertReplacementText', data: v }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    if (leave) blur(el);
    await sleep(40);
    checkpoint();
    if (el.value !== v) {
      await typeText(el, v, { checkpoint });
      el.dispatchEvent(new Event('change', { bubbles: true }));
      if (leave) blur(el);
      await sleep(40);
    }
    checkpoint();
    return el.value;
  }

  /** Clic réaliste : pointer/mouse down/up puis click. */
  function click(el) {
    if (!el) return false;
    try {
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
    } catch {
      /* ignore */
    }
    const r = el.getBoundingClientRect();
    const base = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      clientX: r.left + r.width / 2,
      clientY: r.top + r.height / 2,
      button: 0,
      buttons: 1,
    };
    const ptr = { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true };
    el.dispatchEvent(new PointerEvent('pointerover', ptr));
    el.dispatchEvent(new MouseEvent('mouseover', base));
    el.dispatchEvent(new PointerEvent('pointerdown', ptr));
    // Comme dans un vrai navigateur, le focus change seulement si mousedown n'est pas annulé
    // (les listes Workday l'annulent pour garder le champ de recherche actif).
    if (el.dispatchEvent(new MouseEvent('mousedown', base))) {
      const target = el.closest?.(FOCUSABLE);
      if (target && !target.disabled) focus(target);
      else {
        const cur = focusedElement();
        if (cur && !cur.contains(el)) blur(cur);
      }
    }
    el.dispatchEvent(new PointerEvent('pointerup', { ...ptr, buttons: 0 }));
    el.dispatchEvent(new MouseEvent('mouseup', { ...base, buttons: 0 }));
    el.click();
    return true;
  }

  const CLS = { ok: 'applypilot-ok', check: 'applypilot-check', todo: 'applypilot-todo' };

  function ensureStyle() {
    if (document.getElementById('applypilot-style')) return;
    const st = document.createElement('style');
    st.id = 'applypilot-style';
    st.textContent = `
.applypilot-ok { outline: 2px solid #16a34a !important; outline-offset: 2px !important; border-radius: 4px; }
.applypilot-check { outline: 2px dashed #f59e0b !important; outline-offset: 2px !important; border-radius: 4px; }
.applypilot-todo { outline: 2px dotted #ef4444 !important; outline-offset: 2px !important; border-radius: 4px; }
.applypilot-flash { animation: applypilot-flash 0.9s ease 2 !important; }
@keyframes applypilot-flash { 50% { box-shadow: 0 0 0 6px rgba(37, 99, 235, .45); } }`;
    (document.head || document.documentElement).appendChild(st);
  }

  function highlight(el, status, note) {
    if (!el || !el.classList) return;
    ensureStyle();
    el.classList.remove(...Object.values(CLS));
    if (CLS[status]) el.classList.add(CLS[status]);
    if (note) el.setAttribute('data-applypilot-note', note);
    else el.removeAttribute('data-applypilot-note');
  }

  function clearHighlights() {
    document.querySelectorAll('.applypilot-ok, .applypilot-check, .applypilot-todo').forEach((e) => {
      e.classList.remove(...Object.values(CLS));
      e.removeAttribute('data-applypilot-note');
    });
  }

  function flash(el) {
    if (!el) return;
    ensureStyle();
    try {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } catch {
      /* ignore */
    }
    el.classList.remove('applypilot-flash');
    void el.offsetWidth;
    el.classList.add('applypilot-flash');
    setTimeout(() => el.classList.remove('applypilot-flash'), 2000);
  }

  function b64ToFile(b64, name, type = 'application/pdf') {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new File([bytes], name, { type, lastModified: Date.now() });
  }

  Object.assign(AP, {
    sleep,
    waitFor,
    norm,
    tokens,
    similarity,
    bestMatch,
    textOf,
    isVisible,
    isOffscreen,
    setNativeValue,
    setValue,
    typeText,
    key,
    press,
    focus,
    blur,
    focusedElement,
    releaseFocus,
    pageHasFocus,
    click,
    highlight,
    clearHighlights,
    flash,
    b64ToFile,
  });
})();
