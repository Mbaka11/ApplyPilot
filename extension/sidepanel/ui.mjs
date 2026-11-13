// Petits utilitaires d’interface partagés par toutes les vues.
import { translate } from './i18n.mjs';
import { S, STATUS_LABEL } from './state.mjs';
import { modelLabel } from './model-label.mjs';

export const $ = (sel) => document.querySelector(sel);
export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const tr = (source, values = {}) => translate(source, S.uiLanguage, values);
export const statusLabel = (status) => tr(STATUS_LABEL[status] || status);
export const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString(S.uiLanguage === 'fr' ? 'fr-CA' : 'en-CA', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

/** Écrit le HTML d’une carte seulement s’il a changé ; sinon rien n’est reconstruit (focus, curseur et <details> ouverts préservés). */
export function paint(el, html) {
  if (!el || el.dataset.painted === html) return false;
  const active = document.activeElement;
  const focus = active && el.contains(active) && active.id ? { id: active.id, start: active.selectionStart, end: active.selectionEnd, top: active.scrollTop } : null;
  const open = [...el.querySelectorAll('details')].map(d => d.open);
  el.innerHTML = html;
  el.dataset.painted = html;
  el.querySelectorAll('details').forEach((d, i) => { if (open.length === el.querySelectorAll('details').length && open[i]) d.open = true; });
  const next = focus && document.getElementById(focus.id);
  if (next) {
    next.focus({ preventScroll: true });
    try { if (focus.start != null) next.setSelectionRange(focus.start, focus.end); } catch { /* champ sans sélection */ }
    next.scrollTop = focus.top;
  }
  return true;
}

let toastTimer = null;
export function toast(msg, type = '') {
  const t = $('#toast');
  t.textContent = tr(msg);
  t.className = `toast show ${type}`;
  t.setAttribute('role', type === 'error' ? 'alert' : 'status');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = 'toast'), type === 'error' ? 6000 : 3000);
}

/** Bouton ⓘ et son texte masqué : le détail ne s’affiche qu’à la demande. */
export const infoButton = (id) => `<button type="button" class="info-btn" data-info="${esc(id)}" aria-expanded="${S.infoOpen.has(id)}" aria-controls="${esc(id)}" aria-label="${esc(tr('Plus de détails'))}">ⓘ</button>`;
export const infoBody = (id, html) => `<div class="info-body${S.infoOpen.has(id) ? '' : ' hidden'}" id="${esc(id)}">${html}</div>`;
export function toggleInfo(button) {
  const id = button.dataset.info, body = document.getElementById(id);
  if (!body) return;
  const open = body.classList.toggle('hidden') === false;
  button.setAttribute('aria-expanded', String(open));
  if (open) S.infoOpen.add(id); else S.infoOpen.delete(id);
}

/** Avertissement : phrase complète la première fois, puis une phrase courte et le détail derrière ⓘ. */
export function notice(key, short, full) {
  if (!S.seen[key]) return `<div class="hint"><span>${esc(tr(full))}</span><button type="button" class="btn ghost sm" data-seen="${esc(key)}">${tr('Compris')}</button></div>`;
  return `<div class="hint"><span>${esc(tr(short))}</span>${infoButton(`n-${key}`)}</div>${infoBody(`n-${key}`, esc(tr(full)))}`;
}

export { modelLabel };
export function fmtCost(usd) {
  if (!Number.isFinite(usd)) return '';
  if (usd > 0 && usd < 0.01) return S.uiLanguage === 'fr' ? '< 0,01 $' : '< $0.01';
  const n = usd.toFixed(2);
  return S.uiLanguage === 'fr' ? `${n.replace('.', ',')} $` : `$${n}`;
}
