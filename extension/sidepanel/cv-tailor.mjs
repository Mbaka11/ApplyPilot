// Per-posting CV copy: explicit request, before/after review, opt-in use for forms. One application at a time.
export function createCvTailor({ api, tr, esc, toast, canAct = () => true, onChange = () => {}, ask = text => confirm(text), openTab = url => chrome.tabs.create({ url }), locale = () => 'en-CA' }) {
  let context = null, element = null, controller = null, revision = 0;
  let report = null, loading = false, running = false, error = '', disabled = false, expanded = false, infoOpen = false;
  const same = (captured, token) => context?.key === captured.key && revision === token;
  const stale = value => value && (value.baseChanged || value.jobChanged || value.cvChanged);
  const list = items => esc((items || []).join(', '));

  function status() {
    const features = context?.health?.features, tool = context?.health?.cvTailor;
    if (features?.cvTailoring !== 1) return 'restart';
    if (tool && tool.latexAvailable === false) return 'latex';
    return 'ready';
  }
  function render() {
    if (!element || !context) return;
    const state = status();
    const locked = disabled || loading || running || !canAct();
    const button = (name, label, cls = '', off = false) => `<button type="button" class="btn ${cls}" data-ct-action="${name}" ${locked || off ? 'disabled' : ''}>${esc(tr(label))}</button>`;
    let body;
    if (!context.available) body = `<div class="small muted">${esc(tr('Choisis un CV pour l’adapter à l’offre.'))}</div>`;
    else if (context.cv?.hasTex === false) body = `<div class="small muted">${esc(tr('Ce CV n’a pas de source LaTeX : adaptation impossible.'))}</div>`;
    else if (state === 'restart') body = `<div class="small muted">${esc(tr('Redémarre le serveur ApplyPilot pour adapter le CV à l’offre.'))}</div>`;
    else if (state === 'latex') body = `<div class="small muted">${esc(tr('LaTeX (pdflatex) est introuvable : installe MiKTeX ou TeX Live pour adapter le CV.'))}</div>`;
    else if (running) body = `<div class="small muted" role="status">${esc(tr('Adaptation du CV en cours…'))}</div><div class="row"><button type="button" class="btn" data-ct-action="stop">${esc(tr('Arrêter'))}</button></div>`;
    else if (!context.application.cvTailored) body = `<div class="small muted">${esc(tr('Réécrit « À propos » et l’ordre des compétences pour cette offre.'))}</div><div class="row">${button('tailor', 'Adapter le CV à cette offre', '', context.application.status === 'soumise')}</div>`;
    else if (!report) body = `<div class="small muted" role="status">${esc(tr(error || (loading ? 'Chargement du CV adapté…' : 'CV adapté indisponible.')))}</div><div class="row">${button('discard', 'Supprimer')}</div>`;
    else {
      const date = new Date(report.createdAt).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' });
      const old = stale(report.stale);
      const changedRows = (report.skills || []).filter(row => JSON.stringify(row.before) !== JSON.stringify(row.after));
      body = `<div class="small">${esc(tr('Adapté le {date} · {pages} page', { date, pages: report.pages }))}</div>
        ${old ? `<div class="small cv-file-error" role="alert">${esc(tr('Le CV de base, l’offre ou le CV choisi a changé : régénère la copie avant de l’utiliser.'))}</div>` : ''}
        <details class="cv-file-details" ${expanded ? 'open' : ''}><summary>${esc(tr('Changements'))}</summary>
          <div class="small muted">${esc(tr('À propos — avant'))}</div><div class="small">${esc(report.about.before)}</div>
          <div class="small muted" style="margin-top:6px">${esc(tr('À propos — après'))}</div><div class="small">${esc(report.about.after)}</div>
          ${changedRows.map(row => `<div class="small muted" style="margin-top:6px">${esc(row.label)}</div><div class="small">${list(row.after)}</div>`).join('')}
          ${(report.warnings || []).map(w => `<div class="small muted">⚠ ${esc(w)}</div>`).join('')}
        </details>
        <label class="small" style="display:block;margin:6px 0"><input type="checkbox" data-ct-use ${context.application.cvTailored.useForForms ? 'checked' : ''} ${locked || old ? 'disabled' : ''}> ${esc(tr('Utiliser ce CV adapté pour les formulaires de cette candidature'))}</label>
        <div class="row">${button('preview', 'Aperçu du CV adapté')}${button('tailor', 'Régénérer', '', context.application.status === 'soumise')}${button('discard', 'Supprimer')}</div>`;
    }
    element.innerHTML = `<div class="cv-tailor"><div class="cv-tailor-head"><strong>${esc(tr('CV adapté à l’offre'))}</strong><button type="button" class="info-btn" data-ct-info aria-expanded="${infoOpen}" aria-label="${esc(tr('Plus de détails'))}">ⓘ</button></div><div class="info-body" ${infoOpen ? '' : 'hidden'}>${esc(tr('Modifie seulement « À propos » et l’ordre des compétences, à partir de tes faits. Ton CV d’origine n’est pas touché.'))}</div>${body}<div class="small ${error && report ? 'cv-file-error' : 'muted'}" role="status" aria-live="polite">${report ? esc(tr(error)) : ''}</div></div>`;
    element.querySelector('details')?.addEventListener('toggle', event => { expanded = event.target.open; });
  }

  async function load(captured = context) {
    if (!captured?.application?.cvTailored || status() !== 'ready') { report = null; return; }
    controller?.abort(); controller = new AbortController();
    const token = ++revision;
    loading = true; error = ''; render();
    try {
      const data = await api(`/applications/${encodeURIComponent(captured.applicationId)}/cv-tailored`, { signal: controller.signal });
      if (!same(captured, token)) return;
      if (!data?.tailoredCv?.about || !Array.isArray(data.tailoredCv.skills)) throw new Error('Réponse du CV adapté invalide.');
      report = data.tailoredCv;
    } catch (failure) {
      if (same(captured, token) && failure.name !== 'AbortError') { report = null; error = failure.message; }
    } finally { if (same(captured, token)) { loading = false; render(); } }
  }

  async function tailor() {
    const captured = context;
    if (!captured?.available || running || disabled || !canAct() || status() !== 'ready') return;
    const { application, cv } = captured;
    if (!ask(tr('Adapter le CV « {cv} » à « {title} » — {company} ?\nSeuls « À propos » et l’ordre des compétences changent, uniquement à partir de tes faits. Utilise ton quota IA habituel. Ton CV d’origine n’est pas modifié.{replace}', { cv: cv?.name || captured.cvId, title: application.job?.title || '', company: application.job?.company || '', replace: application.cvTailored ? `\n${tr('La copie précédente sera remplacée.')}` : '' }))) return;
    controller?.abort(); controller = new AbortController();
    const mine = controller, token = ++revision;
    running = true; error = ''; render();
    try {
      const data = await api(`/applications/${encodeURIComponent(captured.applicationId)}/cv/tailor`, { method: 'POST', body: { cvId: captured.cvId }, signal: mine.signal });
      if (!same(captured, token)) return;
      report = data.tailoredCv;
      onChange(data.application);
      toast('CV adapté ✓ — relis les changements');
    } catch (failure) {
      if (failure.name !== 'AbortError' && same(captured, token)) { error = failure.message; toast(failure.message, 'error'); }
    } finally { if (same(captured, token) || mine === controller) { running = false; render(); } }
  }

  async function act(name) {
    if (name === 'stop') { controller?.abort(); running = false; render(); return; }
    if (!context?.available || disabled || running || loading || !canAct()) return;
    const captured = context, token = revision;
    try {
      if (name === 'tailor') return await tailor();
      if (name === 'preview') return await openTab(`${captured.server}/applications/${encodeURIComponent(captured.applicationId)}/cv-tailored.pdf?t=${Date.now()}`);
      if (name === 'discard') {
        if (!ask(tr('Supprimer le CV adapté de cette candidature ? Ton CV d’origine n’est pas touché.'))) return;
        const data = await api(`/applications/${encodeURIComponent(captured.applicationId)}/cv-tailored`, { method: 'DELETE' });
        if (same(captured, token)) { report = null; onChange(data.application); }
      }
    } catch (failure) {
      if (same(captured, token) && failure.name !== 'AbortError') { error = failure.message; toast(failure.message, 'error'); render(); }
    }
  }

  async function setUse(use) {
    if (!context?.available || disabled || running || loading || !canAct()) return;
    const captured = context, token = revision;
    try {
      const data = await api(`/applications/${encodeURIComponent(captured.applicationId)}/cv-tailored/use`, { method: 'PUT', body: { use } });
      if (same(captured, token)) { onChange(data.application); toast(use ? 'Le CV adapté sera joint aux formulaires.' : 'Le CV d’origine sera joint aux formulaires.'); }
    } catch (failure) {
      if (same(captured, token) && failure.name !== 'AbortError') { error = failure.message; toast(failure.message, 'error'); render(); }
    }
  }

  function mount(next) {
    const t = next.application?.cvTailored;
    const key = JSON.stringify([next.server, next.applicationId, next.cvId, t?.createdAt || '', !!t?.useForForms, next.application?.status]);
    const changed = key !== context?.key;
    const loadKey = JSON.stringify([next.server, next.applicationId, t?.createdAt || '']);
    const sameApp = context?.server === next.server && context?.applicationId === next.applicationId;
    const reload = loadKey !== context?.loadKey && !(sameApp && report && t && report.createdAt === t.createdAt);
    if (reload) { controller?.abort(); ++revision; report = null; loading = false; running = false; error = ''; expanded = false; }
    context = { ...next, key, loadKey }; element = next.element; disabled = !!next.disabled;
    element.onclick = event => {
      if (event.target.closest('[data-ct-info]')) { infoOpen = !infoOpen; render(); return; }
      const target = event.target.closest('[data-ct-action]');
      if (!target || target.disabled) return;
      event.preventDefault();
      act(target.dataset.ctAction);
    };
    element.onchange = event => { if (event.target.matches('[data-ct-use]')) setUse(event.target.checked); };
    render();
    if ((reload || changed && !report) && t) load();
  }
  function refresh() { if (context?.application?.cvTailored && !running && !loading) { load(); } }
  function reset() { controller?.abort(); ++revision; context = null; element = null; report = null; loading = false; running = false; error = ''; expanded = false; }
  return { mount, reset, refresh, busy: () => running, setDisabled(value) { const next = !!value; if (next !== disabled) { disabled = next; render(); } } };
}
