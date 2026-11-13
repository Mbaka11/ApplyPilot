// Petits utilitaires d’interface partagés par toutes les vues.
import { translate } from './i18n.mjs';
import { S, STATUS_LABEL } from './state.mjs';

export const $ = (sel) => document.querySelector(sel);
export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const tr = (source, values = {}) => translate(source, S.uiLanguage, values);
export const statusLabel = (status) => tr(STATUS_LABEL[status] || status);
export const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString(S.uiLanguage === 'fr' ? 'fr-CA' : 'en-CA', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

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

/** Nom d’affichage d’un identifiant de modèle : claude-sonnet-5-5 → Sonnet 5.5. */
export function modelLabel(id) {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d+))?/i.exec(String(id || ''));
  if (!m) return String(id || '');
  return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ''}`;
}
export function fmtCost(usd) {
  if (!Number.isFinite(usd)) return '';
  if (usd > 0 && usd < 0.01) return S.uiLanguage === 'fr' ? '< 0,01 $' : '< $0.01';
  const n = usd.toFixed(2);
  return S.uiLanguage === 'fr' ? `${n.replace('.', ',')} $` : `$${n}`;
}
