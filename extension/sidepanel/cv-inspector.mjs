// One selected file, bound to its application/server/CV identity. No file:// access.
export function createCvInspector({ api, tr, esc, toast, canAct = () => true, openTab = url => chrome.tabs.create({ url }), copyText = text => navigator.clipboard.writeText(text), locale = () => 'en-CA' }) {
  let context = null, element = null, controller = null, revision = 0, actionRevision = 0;
  let details = null, loading = false, error = '', action = '', expanded = false, disabled = false;
  function current(captured, token) { return context?.key === captured.key && revision === token && !controller?.signal.aborted; }
  function render() {
    if (!element || !context) return;
    const cv = details || context.cv;
    const locked = disabled || loading || !!action || !context.available;
    const date = cv?.modifiedAt ? new Date(cv.modifiedAt).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' }) : '';
    const bytes = Number(cv?.size);
    const size = Number.isFinite(bytes) ? tr('{size} Ko', { size: new Intl.NumberFormat(locale()).format(Math.max(1, Math.ceil(bytes / 1024))) }) : '';
    const button = (name, label, extraDisabled = false) => `<button type="button" class="btn" data-cv-action="${name}" ${locked || extraDisabled ? 'disabled' : ''}>${esc(tr(label))}</button>`;
    element.innerHTML = `<div class="small cv-file-name">${esc(cv?.file || context.cvId || '')}</div>
      ${date ? `<div class="small muted">${esc(tr('Modifié le {date}', { date }))}${size ? ' · ' + esc(size) : ''}</div>` : ''}
      <div class="row cv-file-actions">${button('preview', 'Aperçu du CV')}${button('reveal', 'Afficher dans le dossier', details?.revealSupported === false)}</div>
      <details class="cv-file-details" ${expanded ? 'open' : ''}><summary>${esc(tr('Fichier et emplacement'))}</summary>
        ${details ? `<code class="cv-file-path">${esc(details.pdfPath)}</code><div class="row">${button('copy', 'Copier le chemin')}</div>` : ''}
        <div class="row">${button('refresh', 'Actualiser le fichier')}</div>
        <p class="small muted">${esc(tr('Ce PDF est le fichier source actuel. Un ancien CV déjà joint au formulaire n’est pas remplacé par cet aperçu.'))}</p>
      </details>
      <div class="small ${error ? 'cv-file-error' : 'muted'}" role="status" aria-live="polite">${esc(tr(error || (loading ? 'Vérification du fichier…' : !context.available ? context.cvId ? 'Le CV sélectionné est introuvable. Actualise la liste des CV.' : 'Choisis un CV' : '')))}</div>`;
    element.querySelector('details')?.addEventListener('toggle', event => { expanded = event.target.open; });
  }
  async function refresh(captured = context) {
    if (!captured?.available) return null;
    controller?.abort(); controller = new AbortController();
    const token = ++revision;
    loading = true; error = ''; render();
    try {
      const data = await api(`/cvs/${encodeURIComponent(captured.cvId)}/details`, { signal: controller.signal });
      if (!current(captured, token)) return null;
      if (data.id !== captured.cvId || typeof data.pdfPath !== 'string' || !data.pdfPath) throw new Error('Réponse du fichier CV invalide.');
      details = data;
      return { data, token };
    } catch (failure) {
      if (current(captured, token)) { details = null; error = failure.status === 404 ? 'Le CV sélectionné est introuvable. Actualise la liste des CV.' : failure.message; }
      return null;
    } finally { if (current(captured, token)) { loading = false; render(); } }
  }
  async function perform(name) {
    if (!context?.available || disabled || loading || action || !canAct()) return;
    const captured = context, owner = ++actionRevision;
    action = name; render();
    try {
      // Each action checks the latest file instead of trusting a cached list or path.
      const result = await refresh(captured);
      if (!result || !current(captured, result.token) || !canAct()) return;
      if (name === 'preview') await openTab(`${captured.server}/cvs/${encodeURIComponent(captured.cvId)}/pdf?t=${Date.now()}`);
      else if (name === 'copy') { await copyText(result.data.pdfPath); if (current(captured, result.token)) toast('Chemin du CV copié.'); }
      else if (name === 'reveal') {
        if (!result.data.revealSupported) throw new Error('L’ouverture du dossier n’est pas disponible sur ce système. Copie le chemin du CV.');
        const reply = await api(`/cvs/${encodeURIComponent(captured.cvId)}/reveal`, { method: 'POST', body: { confirm: true }, signal: controller.signal });
        if (current(captured, result.token) && reply.requested) toast('Demande d’ouverture du dossier envoyée.');
      }
    } catch (failure) {
      if (actionRevision === owner && context?.key === captured.key && failure.name !== 'AbortError') { error = failure.message; toast(failure.message, 'error'); }
    } finally { if (actionRevision === owner && context?.key === captured.key) { action = ''; render(); } }
  }
  function mount(next) {
    const key = JSON.stringify([next.server, next.applicationId, next.cvId, next.cv?.modifiedAt, next.cv?.size]);
    const changed = key !== context?.key;
    if (changed) {
      controller?.abort(); ++revision; ++actionRevision;
      details = null; loading = false; error = ''; action = ''; expanded = false;
    } else expanded = element?.querySelector('details')?.open ?? expanded;
    context = { ...next, key }; element = next.element; disabled = !!next.disabled;
    element.onclick = event => {
      const target = event.target.closest('[data-cv-action]');
      if (!target || target.disabled) return;
      event.preventDefault();
      perform(target.dataset.cvAction);
    };
    render();
    if (changed && context.available) refresh();
  }
  function reset() {
    controller?.abort(); ++revision; ++actionRevision;
    context = null; element = null; details = null; loading = false; error = ''; action = ''; expanded = false;
  }
  return { mount, reset, setDisabled(value) { const next = !!value; if (next !== disabled) { disabled = next; render(); } } };
}
