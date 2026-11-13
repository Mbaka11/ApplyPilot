// Réglages : langue de l’interface, serveur local et fournisseur IA (lecture seule).
import { S } from '../state.mjs';
import { $, esc, tr, modelLabel, infoButton, infoBody } from '../ui.mjs';

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
    ${!llm.available ? `<div class="small text-warn">${tr(claude ? 'Claude Code est introuvable : installe-le et connecte-toi avec « claude », ou choisis pi.' : 'pi est introuvable : installe-le ou configure llm.command.')}</div>` : ''}
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
    <div class="card"><h2>${tr('IA')}</h2>${aiBlock()}</div>`;
}
