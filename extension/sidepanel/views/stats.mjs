// Statistiques du suivi : entonnoir en barres CSS et deux petits tableaux. Aucune bibliothèque de graphiques.
// Les valeurs sont toujours écrites en texte à côté des barres ; un taux n'apparaît qu'avec assez de candidatures soumises.
import { S, PLATFORM_LABEL } from '../state.mjs';
import { esc, tr } from '../ui.mjs';

const pct = (rate) => `${Math.round(rate * 100)} %`;
const rateText = (row) => (row.rate === null || row.rate === undefined ? tr('n = {n}', { n: row.submitted }) : pct(row.rate));

function funnel(stats) {
  const f = stats.funnel;
  const rows = [['Offres identifiées', f.identified], ['Candidatures créées', f.created], ['Soumises', f.submitted], ['Avec réponse', f.responded]];
  const max = Math.max(1, ...rows.map(([, n]) => n));
  return `<ul class="funnel" aria-label="${esc(tr('Entonnoir des candidatures'))}">${rows.map(([label, n]) => `<li>
    <span class="funnel-label">${esc(tr(label))}</span>
    <span class="funnel-bar" aria-hidden="true"><span style="width:${n ? Math.max(2, Math.round((n / max) * 100)) : 0}%"></span></span>
    <b class="funnel-n">${n}</b></li>`).join('')}</ul>`;
}

function table(title, firstColumn, rows, nameOf) {
  if (!rows.length) return '';
  return `<table class="stats-table"><caption>${esc(tr(title))}</caption>
    <thead><tr><th scope="col">${esc(tr(firstColumn))}</th><th scope="col">${esc(tr('Soumises'))}</th><th scope="col">${esc(tr('Réponses reçues'))}</th><th scope="col">${esc(tr('Taux'))}</th></tr></thead>
    <tbody>${rows.map((row) => `<tr><th scope="row">${esc(nameOf(row.key))}</th><td>${row.submitted}</td><td>${row.responded}</td><td>${esc(rateText(row))}</td></tr>`).join('')}</tbody></table>`;
}

const platformName = (key) => (key === 'other' ? tr('Autre site') : tr(PLATFORM_LABEL[key] || key));
const cvName = (key) => (key === 'none' ? tr('Sans CV') : S.cvs.find((cv) => cv.id.toLowerCase() === key)?.name || key);

export function statsHtml(stats) {
  if (!stats) return `<div class="empty small" role="status">${esc(tr('Chargement…'))}</div>`;
  if (!stats.funnel.created && !stats.funnel.identified) return `<div class="empty small">${esc(tr('Pas encore de données : les statistiques apparaissent après tes premières candidatures.'))}</div>`;
  const r = stats.responses;
  const days = stats.medianResponseDays;
  return `<h3 class="stats-h">${esc(tr('Entonnoir'))}</h3>${funnel(stats)}
    <div class="row small stats-responses"><span class="badge warn">${r.interview} ${esc(tr('entrevue(s)'))}</span><span class="badge ok">${r.offer} ${esc(tr('offre(s)'))}</span><span class="badge bad">${r.rejection} ${esc(tr('refus'))}</span></div>
    <p class="small stats-rate">${stats.rate === null ? esc(tr('Taux de réponse : n = {n} soumises (pas assez pour un pourcentage).', { n: stats.funnel.submitted })) : esc(tr('Taux de réponse : {rate}', { rate: pct(stats.rate) }))}</p>
    ${days !== null && days !== undefined ? `<p class="small">${esc(tr('Délai médian de réponse : {days} jour(s) (n = {n})', { days, n: stats.delaySamples }))}</p>` : ''}
    ${table('Par plateforme', 'Plateforme', stats.byPlatform, platformName)}${table('Par CV', 'CV', stats.byCv, cvName)}
    <p class="small muted">${esc(tr('Petits échantillons : indicatif seulement'))}</p>`;
}
