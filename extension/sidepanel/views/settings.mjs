// Réglages : langue de l’interface, serveur local et fournisseur IA (lecture seule).
import { S } from '../state.mjs';
import { $, esc, tr, toast, modelLabel, infoButton, infoBody, fmtCost } from '../ui.mjs';
import { api } from '../api.mjs';

export async function loadUsage() {
  if (!S.health) { S.usage = null; return; }
  try {
    const [day, week, month] = await Promise.all([1, 7, 30].map((days) => api(`/usage?days=${days}`)));
    S.usage = { day, week, month };
  } catch { S.usage = null; } // serveur plus ancien : la section reste masquée
}

export async function clearUsage() {
  if (!confirm(tr('Effacer tout l’historique d’usage IA ? Cette action est définitive.'))) return;
  await api('/usage', { method: 'DELETE' });
  await loadUsage();
  renderSettings();
  toast('Historique d’usage effacé ✓');
}

const fmtTokens = (n) => (n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
function fmtDuration(ms) {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
}

function usageBlock() {
  const u = S.usage;
  if (!S.health || !u) return '';
  const cols = [['24 h', u.day], ['7 jours', u.week], ['30 jours', u.month]];
  const month = u.month;
  const apiBilled = month.billing.api > 0 && month.billing.subscription === 0;
  const withCost = cols.some(([, s]) => s.totals.costUsd > 0);
  const tok = (t) => (t.count && !t.inputTokens && !t.outputTokens ? '—' : `${fmtTokens(t.inputTokens)} + ${fmtTokens(t.outputTokens)}`);
  const row = (label, fn) => `<tr><th scope="row">${esc(tr(label))}</th>${cols.map(([, s]) => `<td>${esc(fn(s.totals))}</td>`).join('')}</tr>`;
  const list = (items, name) => items.length ? `<ul class="usage-list small">${items.map((i) => `<li><span>${esc(name(i))}</span><span class="muted">${i.count} · ${esc(fmtDuration(i.ms))}</span></li>`).join('')}</ul>` : '';
  const none = !month.totals.count;
  return `<div class="card" id="usageCard"><h2>${tr('Usage IA')}</h2>
    ${u.month.enabled === false ? `<div class="small text-warn">${tr('Journal d’usage désactivé')}</div><div class="small muted">${tr('Modifiable dans config.yaml (usage.enabled), puis redémarre le serveur.')}</div>` : `<div class="small muted">${tr('Compteurs locaux : aucun texte, nom ni donnée de profil n’est enregistré.')}</div>`}
    ${none ? `<div class="empty small">${tr('Aucune génération enregistrée.')}</div>` : `<table class="usage-table"><thead><tr><th></th>${cols.map(([label]) => `<th scope="col">${esc(tr(label))}</th>`).join('')}</tr></thead><tbody>
      ${row('Générations', (t) => String(t.count))}
      ${row('Réussies / échouées', (t) => `${t.ok} / ${t.failed}`)}
      ${row('Jetons (entrée + sortie)', tok)}
      ${row('Durée totale', (t) => fmtDuration(t.ms))}
      ${withCost ? row(apiBilled ? 'Coût facturé' : 'Estimation (abonnement : rien n’est facturé à l’appel)', (t) => fmtCost(t.costUsd)) : ''}
    </tbody></table>
    <div class="small"><b>${tr('Par tâche')}</b> <span class="muted">(${tr('30 jours')})</span></div>${list(month.byTask, (i) => tr(EFFORT_LABEL[i.task] || i.task))}
    <div class="small"><b>${tr('Par modèle')}</b> <span class="muted">(${tr('30 jours')})</span></div>${list(month.byModel, (i) => modelLabel(i.model) || i.model)}`}
    <div class="row"><button type="button" class="btn ghost danger" data-action="clearUsage" ${none ? 'disabled' : ''}>${tr('Effacer l’historique d’usage')}</button></div></div>`;
}

const EFFORT_LABEL = { letter: 'Lettre', answers: 'Réponses', tailor: 'CV sur mesure' };

function aiBlock() {
  const llm = S.health?.llm;
  if (!S.health) return `<div class="empty small">${tr('Serveur non connecté.')}</div>`;
  if (!llm) return `<div class="small muted">${tr('Redémarre le serveur ApplyPilot pour afficher le fournisseur IA.')}</div>`;
  const claude = llm.provider === 'claude';
  const effort = typeof llm.effort === 'string' ? { letter: llm.effort } : llm.effort || {};
  const rows = [
    [tr('Fournisseur'), claude ? 'Claude Code' : 'pi'],
    [tr('Modèle'), claude ? modelLabel(llm.model) || tr('modèle automatique') : llm.model || tr('modèle automatique')],
    ...Object.entries(effort).filter(([, v]) => v).map(([k, v]) => [`${tr('Effort')} · ${tr(EFFORT_LABEL[k] || k)}`, String(v)]),
    [tr('Disponibilité'), llm.available ? tr(llm.version ? 'Disponible · v{version}' : 'Disponible', { version: llm.version }) : tr('Introuvable')],
  ];
  return `<dl class="kv">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    ${!llm.available ? `<div class="small text-warn">${tr(claude ? 'Claude Code est introuvable : installe-le et connecte-toi avec « claude », ou choisis pi.' : 'pi est introuvable : installe-le ou configure llm.pi.command.')}</div>` : ''}
    ${claude && llm.apiKeyInEnv ? `<div class="small text-warn">${tr('ANTHROPIC_API_KEY est définie : l’API sera facturée au lieu de ton abonnement.')}</div>` : ''}
    <div class="row small muted"><span class="grow">${tr('Lecture seule. Pour changer ces réglages, modifie config.yaml puis redémarre le serveur.')}</span>${infoButton('info-llm-config')}</div>
    ${infoBody('info-llm-config', `<p>${tr('Dans config.yaml, section llm : provider (claude ou pi), model et effort. L’écriture depuis le panneau est volontairement absente : elle effacerait les commentaires du fichier.')}</p><pre class="code">llm:\n  provider: claude\n  claude:\n    model: claude-sonnet-5-5\n    effort:\n      letter: medium</pre>`)}`;
}

export function renderSettings() {
  const el = $('#tab-settings');
  if (!el) return;
  // Ne pas écraser une saisie en cours (URL du serveur).
  if (S.tab === 'settings' && el.contains(document.activeElement) && document.activeElement.id === 'serverUrl') return;
  const h = S.health;
  el.innerHTML = `<div class="card"><h2>${tr('Réglages')}</h2>
      <label class="field" for="uiLanguage" id="uiLanguageLabel">${tr('Langue de l’interface')}</label>
      <select id="uiLanguage"><option value="en" ${S.uiLanguage === 'en' ? 'selected' : ''}>English</option><option value="fr" ${S.uiLanguage === 'fr' ? 'selected' : ''}>Français</option></select>
      <div class="small muted">${tr('Ne change pas la langue de tes lettres ni de tes formulaires.')}</div></div>
    <div class="card"><h2>${tr('Serveur local')}</h2>
      <label class="field" for="serverUrl">${tr('Adresse du serveur')}</label>
      <div class="row"><input type="url" id="serverUrl" class="grow" value="${esc(S.serverDraft ?? S.server)}"><button type="button" class="btn" data-action="saveServer">${tr('Enregistrer')}</button></div>
      <div class="small muted">${h ? `${tr('Serveur')} v${esc(h.version || '—')} · Chrome (PDF) : ${h.chrome ? 'OK' : tr('introuvable')}` : esc(tr('Serveur arrêté'))}</div></div>
    <div class="card"><h2>${tr('IA')}</h2>${aiBlock()}</div>${usageBlock()}`;
}
