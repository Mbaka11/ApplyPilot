// Navigation déclenchée uniquement par le candidat. Pas de mot de passe ni de soumission.
export function applicationUrl(jobUrl) {
  const u = new URL(jobUrl);
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) throw new Error('URL de candidature invalide.');
  const workday = /(^|\.)myworkday(jobs|site)\.com$/i.test(u.hostname);
  if (workday && /\/job\//i.test(u.pathname) && !/\/(apply|applyManually|autofillWithResume|useMyLastApplication)(\/|$)/i.test(u.pathname)) {
    u.pathname = `${u.pathname.replace(/\/+$/, '')}/apply`;
    u.hash = '';
  }
  return u.href;
}

/** Retrouve un formulaire déjà ouvert, sans recharger ni perdre les saisies en cours. */
export function existingApplicationTab(jobUrl, tabs) {
  const target = new URL(applicationUrl(jobUrl));
  const workday = /(^|\.)myworkday(jobs|site)\.com$/i.test(target.hostname);
  const base = target.pathname.split(/\/(?:apply|applyManually|autofillWithResume|useMyLastApplication)(?:\/|$)/i)[0];
  const slug = base.split('/').filter(Boolean).pop();
  return tabs.find((tab) => {
    let u;
    try { u = new URL(tab.url); } catch { return false; }
    if (u.origin !== target.origin) return false;
    if (!workday) return u.pathname === target.pathname && u.search === target.search;
    return !!slug && u.pathname.includes(slug) && /\/(apply|applyManually|autofillWithResume|useMyLastApplication)(\/|$)/i.test(u.pathname);
  });
}
