// Read-only Google result cards. No cookies, clicks, result visits or LinkedIn reads.
// The in-page guard also protects against navigation racing with script injection.
(() => {
  const googleHost = host => /^(?:www\.)?google\.(?:com|ca|fr|co\.uk)$/.test(host);
  function allowed(href, query) {
    try { const u = new URL(href); return u.protocol === 'https:' && !u.username && !u.password && !u.port && googleHost(u.hostname) && u.pathname === '/search' && u.searchParams.get('q') === query; } catch { return false; }
  }
  function resultUrl(href, base) {
    try {
      let url = new URL(href, base);
      if (googleHost(url.hostname) && url.pathname === '/url') url = new URL(url.searchParams.get('q') || url.searchParams.get('url') || '');
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port || googleHost(url.hostname) || /(^|\.)google(?:usercontent|adservices)?\.com$/.test(url.hostname)) return null;
      return url.href;
    } catch { return null; }
  }
  const text = el => (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
  function collectGoogle(query) {
    const href = location.href;
    const result = (status, items = []) => ({ status, items, href });
    if (!allowed(href, query)) return result('navigation'); // before ANY document access
    const body = text(document.body).slice(0, 24000).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (document.querySelector('form[action*="/sorry"], #captcha, #recaptcha, iframe[src*="recaptcha"], iframe[src*="hcaptcha"]') || /unusual traffic|trafic inhabituel|not a robot|n.?etes pas un robot|verify you are human/i.test(body)) return result('challenge');
    if (document.querySelector('form[action*="consent"], form[action*="accounts.google"], #identifierId') || /before you continue to google|avant d.acceder a google|avant de continuer vers google/i.test(body)) return result('consent');
    if (/too many requests|access denied|acces refuse|temporarily blocked|429 too many|403 forbidden/i.test(body)) return result('blocked');
    const items = [], seen = new Set();
    for (const heading of document.querySelectorAll('#search h3, #rso h3, main h3')) {
      const anchor = heading.closest('a') || heading.parentElement?.querySelector('a[href]');
      if (!anchor || heading.closest('[data-text-ad], .uEierd, [aria-label="Ads"], [aria-label="Sponsored"], [aria-label="Annonces"]')) continue;
      const url = resultUrl(anchor.getAttribute('href'), href);
      if (!url || seen.has(url)) continue;
      const title = text(heading);
      if (!title) continue;
      let block = anchor.parentElement;
      for (let n = 0; block?.parentElement && n < 6; n++) {
        if (block.querySelector('.VwiC3b, .aCOpRe, [data-sncf], .yXK7lf')) break;
        if (block.parentElement.querySelectorAll('h3').length > 1) break;
        block = block.parentElement;
      }
      const snippet = text(block?.querySelector('.VwiC3b, .aCOpRe, [data-sncf], .yXK7lf')) || text(block).replace(title, '').trim();
      seen.add(url);
      items.push({ title: title.slice(0, 300), url, snippet: snippet.slice(0, 4000), source: 'google' });
      if (items.length >= 30) break;
    }
    if (items.length) return result('ready', items);
    if (/did not match any documents|no results found|aucun resultat|ne correspond a aucun document/i.test(body)) return result('empty');
    return result('loading');
  }
  globalThis.__applyPilotSearch = { collectGoogle };
})();
