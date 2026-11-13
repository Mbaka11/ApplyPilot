/** Nom d’affichage d’un identifiant de modèle : claude-sonnet-5-5 → Sonnet 5.5. */
export function modelLabel(id) {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2})(?!\d))?/i.exec(String(id || ''));
  if (!m) return String(id || '');
  return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ''}`;
}
