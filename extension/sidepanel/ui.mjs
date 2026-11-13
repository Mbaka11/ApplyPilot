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
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = 'toast'), type === 'error' ? 6000 : 3000);
}
