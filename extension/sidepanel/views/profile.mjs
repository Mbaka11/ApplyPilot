// Onglet Profil : éditeur de profil, CV, réponses mémorisées et connexion au serveur.
import { S, DEFAULT_SERVER } from '../state.mjs';
import { $, esc, tr, toast, infoButton, infoBody } from '../ui.mjs';
import { api, checkServer } from '../api.mjs';
import { cvInspector, cvTailor } from './application.mjs';
import { searchPanel } from './search.mjs';

function profileField(f) {
  const saved = f.path.split('.').reduce((o, k) => o?.[k], S.profile);
  const value = String((Object.hasOwn(S.profileDraft, f.path) ? S.profileDraft[f.path] : saved) ?? '');
  const id = `profile-${f.path.replace(/\./g, '-')}`;
  const attrs = `id="${esc(id)}" data-profile-path="${esc(f.path)}"`;
  let input;
  if (f.type === 'boolean') {
    input = `<select ${attrs}>${[['', 'Je réponds moi-même'], ['true', 'Oui'], ['false', 'Non']].map(([v, label]) => `<option value="${v}" ${v === value ? 'selected' : ''}>${tr(label)}</option>`).join('')}</select>`;
  } else {
    const type = f.type === 'integer' ? 'number' : f.type === 'path' ? 'text' : f.type;
    input = `<input ${attrs} type="${esc(type)}" value="${esc(value)}" maxlength="500"
      ${f.autocomplete ? `autocomplete="${esc(f.autocomplete)}"` : 'autocomplete="off"'}
      ${f.placeholder ? `placeholder="${esc(tr(f.placeholder))}"` : ''}
      ${f.type === 'integer' ? `min="${f.min}" max="${f.max}" step="1"` : ''}>`;
  }
  let label = tr(f.label);
  const languageField = f.path.match(/^languages\.(\d+)\.level$/);
  if (languageField) {
    const language = S.profile?.languages?.[+languageField[1]];
    const name = (S.uiLanguage === 'en' ? language?.languageEn : language?.language) || language?.language || String(+languageField[1] + 1);
    label = tr('Niveau — {name}', { name });
  }
  return `<div class="profile-field"><label class="field" for="${esc(id)}">${esc(label)}</label>${input}</div>`;
}

export async function saveProfile() {
  if (S.profileBusy || !$('#profileForm')?.reportValidity()) return;
  const values = {};
  for (const [key, raw] of Object.entries(S.profileDraft)) {
    const f = S.profileFields.find((x) => x.path === key);
    if (!f) throw new Error('Champ de profil inconnu.');
    if (f.type === 'boolean') {
      if (!['', 'true', 'false'].includes(raw)) throw new Error('Réponse oui/non invalide.');
      values[key] = raw === '' ? null : raw === 'true';
    } else if (f.type === 'integer') {
      values[key] = raw === '' ? null : Number(raw);
      if (raw !== '' && !Number.isInteger(values[key])) throw new Error('La durée doit être un nombre entier.');
    } else values[key] = raw;
  }
  if (!Object.keys(values).length) return toast('Aucune modification à enregistrer.');
  S.profileBusy = true;
  try {
    const saved = await api('/profile', { method: 'PUT', body: { revision: S.profileRevision, values } });
    S.profile = saved.profile;
    S.profileRevision = saved.revision;
    S.profileFields = saved.fields;
    S.profileDraft = {};
    await checkServer();
    await renderProfile();
    toast('Profil enregistré ✓ — utilisé au prochain remplissage');
  } finally {
    S.profileBusy = false;
  }
}

export async function reloadProfile() {
  if (Object.keys(S.profileDraft).length && !confirm(tr('Recharger le profil et abandonner les modifications non enregistrées ?'))) return;
  S.profileDraft = {};
  S.profileRevision = null;
  await renderProfile();
}

export async function renderProfile({ refresh = true } = {}) {
  const el = $('#tab-profile');
  if (!S.health) {
    el.innerHTML = `<div class="card"><h2>${tr('Profil')}</h2><div class="empty small">${tr('Serveur non connecté.')}</div><button type="button" class="btn" data-tab="settings">${tr('Réglages')}</button></div>`;
    return;
  }
  let data;
  try {
    if (refresh || !S.profileResponse) {
      [S.memory, data] = await Promise.all([api('/memory'), api('/profile')]);
      S.profileResponse = data;
    } else data = S.profileResponse;
  } catch (err) {
    el.innerHTML = `<div class="card"><h2>${tr('Profil')}</h2><div class="small text-bad">${esc(tr(err.message))}</div><button class="btn" data-action="reloadProfile">${tr('Réessayer')}</button></div>`;
    return;
  }
  const dirty = Object.keys(S.profileDraft).length > 0;
  const conflict = dirty && S.profileRevision && S.profileRevision !== data.revision;
  if (!dirty) {
    S.profile = data.profile;
    S.profileRevision = data.revision;
    S.profileFields = data.fields || [];
  }
  const groups = [...new Set(S.profileFields.map((f) => f.group))];
  const editor = S.profileFields.length ? `<form id="profileForm">
    ${groups.map((group, i) => `<details class="profile-group" ${i < 2 ? 'open' : ''}><summary>${esc(tr(group))}</summary>${S.profileFields.filter((f) => f.group === group).map(profileField).join('')}</details>`).join('')}
    <div class="profile-save row"><button type="button" class="btn primary" data-action="saveProfile">${tr('Enregistrer le profil')}</button>
      <button type="button" class="btn" data-action="reloadProfile">${tr('Recharger')}</button></div>
    </form>` : `<div class="small text-warn">${tr('Redémarre le serveur pour activer l’éditeur de profil.')}</div>`;
  const h = { ...S.health, warnings: data.warnings || S.health.warnings };
  const mem = Object.entries(S.memory.items || {}).sort((a, b) => String(b[1].lastUsedAt).localeCompare(String(a[1].lastUsedAt)));
  el.innerHTML = `
    <div class="card"><h2>${tr('Profil')}</h2>
      <div class="small">${tr('Fichier :')} <span class="kbd">${esc(h.profileFile)}</span></div>
      ${h.profileError ? `<div class="small text-bad">${esc(tr(h.profileError))}</div>` : ''}
      ${h.warnings?.length ? `<div style="margin-top:8px"><b class="small">${tr('À compléter')}:</b><ul class="warnings">${h.warnings.map((w) => `<li>${esc(tr(w.label))} <span class="muted">(${esc(w.path)})</span></li>`).join('')}</ul></div>` : `<div class="small text-ok">${tr('Champs essentiels renseignés ✓')}</div>`}
      <div class="row small muted"><span class="grow">${tr('Vide ou « Je réponds moi-même » : aucune réponse inventée.')}</span>${infoButton('info-profile')}</div>
      ${infoBody('info-profile', `<p>${tr('Enregistre ici tes coordonnées, disponibilités et réponses d’admissibilité. Vide / « Je réponds moi-même » = aucune réponse inventée. Sauvegarde privée automatique avant chaque modification.')}</p><p>${tr('Les expériences et formations détaillées restent dans le YAML. Modifier le profil ne modifie pas les CV PDF ni les lettres déjà générées.')}</p>`)}
      ${conflict ? `<div class="small text-warn">${tr('Le fichier a changé ailleurs. Tes saisies sont conservées ; utilise « Recharger » avant de réessayer.')}</div>` : ''}
      ${editor}
    </div>
    <div class="card"><h2>CV (${S.cvs.length})</h2>
      <div class="small">${tr('Dossier :')} <span class="kbd">${esc(h.cvDir || tr('non configuré'))}</span></div>
      ${h.cvError ? `<div class="small text-bad">${esc(tr(h.cvError))}</div>` : ''}
      <ul class="list">${S.cvs.map((c) => `<li class="small"><b>${esc(c.name)}</b> <span class="badge grey">${esc((c.language || '?').toUpperCase())}</span> ${c.hasTex ? `<span class="badge ok">${tr('.tex lu')}</span>` : `<span class="badge warn">${tr('pas de .tex')}</span>`}${c.tags?.length ? `<div class="muted">${tr('Mots-clés :')} ${esc(c.tags.join(', '))}</div>` : ''}<div class="row cv-file-actions"><button type="button" class="btn" data-profile-cv="${esc(c.id)}" data-open-url="${esc(`${S.server}/cvs/${encodeURIComponent(c.id)}/pdf?t=${Date.now()}`)}">${tr('Aperçu du CV')}</button></div></li>`).join('')}</ul>
    </div>
    <div class="card"><h2>${tr('Réponses mémorisées')} (${mem.length})</h2>
      ${mem.length ? `<ul class="list">${mem.map(([k, m]) => `<li class="small"><div class="row"><b class="grow">${esc(m.label)}</b><button class="btn ghost danger" data-forget="${esc(k)}">✕</button></div><div>${esc(Array.isArray(m.value) ? m.value.join(', ') : String(m.value))}</div>${m.adaptable || m.lastCompany ? `<div class="row small muted">${m.adaptable ? `<span class="badge warn">${tr('adaptable')}</span>` : ''}${m.lastCompany ? `<span>${esc(tr('Mémorisée pour {company}', { company: m.lastCompany }))}</span>` : ''}</div>` : ''}</li>`).join('')}</ul>` : `<div class="small muted">${tr('Tes réponses aux questions récurrentes (non couvertes par le profil) seront retenues quand tu passes à l’étape suivante d’un formulaire.')}</div>`}
    </div>`;
}

export async function saveServer() {
  if (S.letterBusy || S.appBusy || S.cvBusy || S.switching || S.fillRun?.documents || cvTailor.busy()) throw new Error('Attends la fin de l’opération sur cette candidature.');
  searchPanel.reset(); cvInspector.reset(); cvTailor.reset();
  S.server = ($('#serverUrl').value || DEFAULT_SERVER).replace(/\/+$/, '');
  S.serverDraft = null;
  await chrome.storage.local.set({ serverUrl: S.server });
  await checkServer();
  toast(S.health ? 'Serveur connecté ✓' : 'Serveur injoignable', S.health ? '' : 'error');
  if (S.tab === 'profile') renderProfile();
}

export async function forgetMemory(key) {
  await api(`/memory/${encodeURIComponent(key)}`, { method: 'DELETE' });
  return renderProfile();
}
