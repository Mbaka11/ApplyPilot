// ApplyPilot — détection de plateforme et extraction de l'offre (JSON-LD, Workday, générique).
(() => {
  const AP = globalThis.ApplyPilot;

  const PLATFORMS = [
    ['workday', /(^|\.)myworkdayjobs\.com$|(^|\.)myworkdaysite\.com$|(^|\.)workday\.com$/i],
    ['greenhouse', /(^|\.)greenhouse\.io$/i],
    ['lever', /(^|\.)lever\.co$/i],
    ['ashby', /(^|\.)ashbyhq\.com$/i],
    ['smartrecruiters', /(^|\.)smartrecruiters\.com$/i],
    ['icims', /(^|\.)icims\.com$/i],
    ['taleo', /(^|\.)taleo\.net$/i],
    ['successfactors', /successfactors\.(com|eu)$|(^|\.)sapsf\.(com|eu)$/i],
    ['jobvite', /(^|\.)jobvite\.com$/i],
    ['workable', /(^|\.)workable\.com$/i],
    ['bamboohr', /(^|\.)bamboohr\.com$/i],
  ];

  function platform(host = location.hostname) {
    for (const [name, re] of PLATFORMS) if (re.test(host)) return name;
    if (document.querySelector('[data-automation-id="jobPostingHeader"], [data-automation-id="applyFlowPage"]')) return 'workday';
    return 'generic';
  }

  /** Texte lisible depuis du HTML non fiable (document inerte : aucun script, aucune image chargée). */
  function htmlToText(html) {
    if (!html) return '';
    const parse = (h) => blockText(new DOMParser().parseFromString(String(h), 'text/html').body);
    let text = parse(html);
    if (/<\/?(p|li|ul|br|div|strong|span)\b/i.test(text)) text = parse(text); // HTML échappé deux fois
    return text;
  }

  function blockText(root) {
    const parts = [];
    const BLOCK = /^(P|DIV|LI|UL|OL|H[1-6]|BR|TR|SECTION|ARTICLE|HEADER|FOOTER|TABLE|DL|DT|DD|BLOCKQUOTE|PRE)$/;
    const walk = (node) => {
      for (const c of node.childNodes) {
        if (c.nodeType === 3) parts.push(c.nodeValue);
        else if (c.nodeType === 1 && !/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(c.tagName)) {
          const block = BLOCK.test(c.tagName);
          parts.push(c.tagName === 'LI' ? '\n• ' : block ? '\n' : '');
          walk(c);
          if (block) parts.push('\n');
        }
      }
    };
    if (root) walk(root);
    return parts
      .join('')
      .replace(/[ \t\u00a0]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function findJsonLdJob() {
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      let data;
      try {
        data = JSON.parse(s.textContent);
      } catch {
        continue;
      }
      const stack = [data];
      while (stack.length) {
        const x = stack.pop();
        if (!x || typeof x !== 'object') continue;
        if (Array.isArray(x)) {
          stack.push(...x);
          continue;
        }
        const t = x['@type'];
        if (t === 'JobPosting' || (Array.isArray(t) && t.includes('JobPosting'))) return x;
        if (x['@graph']) stack.push(x['@graph']);
      }
    }
    return null;
  }

  function jobFromJsonLd(j) {
    const org = j.hiringOrganization;
    const locs = []
      .concat(j.jobLocation || [])
      .map((l) => {
        const a = l?.address || {};
        if (typeof a === 'string') return a;
        const country = typeof a.addressCountry === 'object' ? a.addressCountry?.name : a.addressCountry;
        return [a.addressLocality, a.addressRegion, country].filter(Boolean).join(', ');
      })
      .filter(Boolean);
    const ident = j.identifier;
    return {
      title: String(j.title || '').trim(),
      company: String((typeof org === 'string' ? org : org?.name) || '').trim(),
      location: locs.join(' · ') || (j.jobLocationType === 'TELECOMMUTE' ? 'Télétravail' : ''),
      description: htmlToText(j.description || ''),
      postedAt: j.datePosted || '',
      employmentType: [].concat(j.employmentType || []).join(', '),
      requisitionId: typeof ident === 'object' ? String(ident?.value || '') : String(ident || ''),
    };
  }

  function workdayJob() {
    const q = (id) => document.querySelector(`[data-automation-id="${id}"]`);
    const desc = q('jobPostingDescription');
    if (!desc) return null;
    const dd = (id) => {
      const c = q(id);
      if (!c) return '';
      const dds = [...c.querySelectorAll('dd')];
      return (dds.length ? dds.map(AP.textOf).join(' · ') : AP.textOf(c)).trim();
    };
    return {
      title: AP.textOf(q('jobPostingHeader')),
      location: dd('locations'),
      requisitionId: dd('requisitionId'),
      postedAt: dd('postedOn'),
      employmentType: dd('time'),
      description: (desc.innerText || '').trim(),
    };
  }

  function prettyName(slug) {
    return String(slug || '')
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim();
  }

  /** Devine l'entreprise depuis l'URL (sous-domaine Workday, chemin Greenhouse/Lever, etc.). */
  function companyFromUrl(u = location) {
    const host = u.hostname.replace(/^www\./, '');
    const parts = host.split('.');
    const path = u.pathname.split('/').filter(Boolean);
    if (/myworkdaysite\.com$/i.test(host)) return prettyName(path[1] || '');
    if (/myworkdayjobs\.com$/i.test(host)) return prettyName(parts[0]);
    if (/greenhouse\.io$|lever\.co$|ashbyhq\.com$|jobvite\.com$|smartrecruiters\.com$|workable\.com$/i.test(host)) {
      return prettyName(path[0] === 'embed' ? new URLSearchParams(u.search).get('for') || '' : path[0] || '');
    }
    if (/successfactors|sapsf/i.test(host)) return prettyName(new URLSearchParams(u.search).get('company') || '');
    if (/taleo\.net$|icims\.com$|bamboohr\.com$|recruitee\.com$|breezy\.hr$/i.test(host)) {
      return prettyName(parts[0].replace(/^(careers?|jobs?)-/, '').replace(/-(careers?|jobs?)$/, ''));
    }
    const meaningful = parts.filter((p) => !/^(careers?|jobs?|emplois?|carrieres?|recrutement|apply|talent|join|work|www|fr|en|ca|com|org|net|io|co|qc)$/i.test(p));
    return prettyName(meaningful[0] || parts[0]);
  }

  /**
   * « À propos de Pratt & Whitney Canada » / « About Acme » en tête d'offre : utile quand la page ne donne
   * pas l'employeur (portail Workday d'un groupe, ex. « globalhr » pour RTX).
   */
  function companyFromDescription(desc) {
    const m = /(?:^|\n)[ \t]*(?:\u00e0 propos de|a propos de|about)[ \t]+([A-Z\u00c0-\u00dd0-9&][^\n:.,(]{1,60}?)[ \t]*(?=\n|:|\.|,|\()/i.exec(String(desc || '').slice(0, 4000));
    if (!m) return '';
    const name = m[1].replace(/^&\s*/, '').trim();
    return /^(l['\u2019]|(us|nous|vous|toi|you|the|this|our|la|le poste|ce poste|cette)(\b|\s|$))/i.test(name) ? '' : name;
  }

  const KEYWORDS =
    /responsibilit|qualification|requirement|exigence|responsabilit|profil recherch|compétence|competenc|what you|you will|vous (allez|ferez|aurez)|mission|about the role|your role|votre rôle|nous recherchons|we are looking|ce que nous offrons|what we offer|atouts|nice to have/gi;

  function genericDescription() {
    const selectors = [
      '[data-automation-id="jobPostingDescription"]',
      '#job-description',
      '.job-description',
      '[class*="job-description" i]',
      '[class*="jobdescription" i]',
      '[id*="job-description" i]',
      '[id*="jobdescription" i]',
      '[class*="description" i]',
      '[id*="description" i]',
      '[class*="posting" i]',
      '[data-testid*="description" i]',
      '[class*="job-details" i]',
      'article',
      'main',
      '[role="main"]',
    ];
    let best = null;
    const seen = new Set();
    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        if (seen.has(el) || !AP.isVisible(el)) continue;
        seen.add(el);
        const t = (el.innerText || '').trim();
        if (t.length < 300) continue;
        const kw = (t.match(KEYWORDS) || []).length;
        const inputs = el.querySelectorAll('input, select, textarea').length;
        const score = kw * 3 + Math.min(t.length, 8000) / 1000 - (t.length > 25000 ? 4 : 0) - (inputs > 6 ? 6 : 0);
        if (!best || score > best.score) best = { score, t };
      }
    }
    return (best?.t || document.body?.innerText || '').slice(0, 30000);
  }

  function pageTitle() {
    const og = document.querySelector('meta[property="og:title"]')?.content;
    const h1 = [...document.querySelectorAll('h1')].find(AP.isVisible);
    return String(AP.textOf(h1) || og || document.title || '')
      .split(/\s+[|–—-]\s+/)[0]
      .trim();
  }

  function detectLanguage(text) {
    const t = ` ${AP.norm(text).slice(0, 6000)} `;
    const count = (ws) => ws.reduce((n, w) => n + t.split(w).length - 1, 0);
    const fr = count([' le ', ' la ', ' les ', ' des ', ' et ', ' vous ', ' pour ', ' avec ', ' une ', ' est ', ' dans ', ' nous ', ' votre ']);
    const en = count([' the ', ' and ', ' you ', ' for ', ' with ', ' our ', ' are ', ' will ', ' to ', ' of ', ' we ', ' your ']);
    if (fr + en < 8) {
      const lang = (document.documentElement.lang || '').slice(0, 2).toLowerCase();
      return lang === 'fr' ? 'fr' : lang === 'en' ? 'en' : fr > en ? 'fr' : 'en';
    }
    return fr > en * 1.1 ? 'fr' : 'en';
  }

  /** Clé stable d'une offre : la page de l'offre et les pages « postuler » partagent la même clé. */
  function jobKey(href = location.href) {
    let u;
    try {
      u = new URL(href);
    } catch {
      return '';
    }
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    let p = decodeURIComponent(u.pathname).replace(/\/+$/, '');
    if (/myworkday(jobs|site)\.com$|workday\.com$/i.test(host)) {
      p = p.replace(/\/(apply|applyManually|autofillWithResume|useMyLastApplication)(\/.*)?$/i, '');
      const last = p.split('/').filter(Boolean).pop() || '';
      return `${host}/${last}`.toLowerCase();
    }
    p = p.replace(/\/(apply|application|applications|candidature|postuler|apply-now)(\/.*)?$/i, '');
    const params = new URLSearchParams(u.search);
    const idParam = ['gh_jid', 'jobId', 'jobid', 'job', 'id', 'jid', 'requisitionId', 'career_job_req_id'].find((k) => params.get(k));
    return `${host}${p}${idParam ? `?${idParam}=${params.get(idParam)}` : ''}`.toLowerCase();
  }

  function isPostingPage(job) {
    if (job.source === 'json-ld' || job.source === 'workday') return true;
    const urlish = /job|career|carriere|emploi|offre|posting|position|opening|vacanc|stage|intern|requisition/i.test(location.href);
    const kw = (String(job.description).match(KEYWORDS) || []).length;
    return urlish && kw >= 2 && job.description.length >= 600;
  }

  /** Extraction complète (texte de l'offre inclus). */
  function extractJob() {
    const plat = platform();
    const ld = findJsonLdJob();
    const wd = plat === 'workday' ? workdayJob() : null;
    const base = ld ? jobFromJsonLd(ld) : {};
    const job = {
      url: location.href,
      jobKey: jobKey(),
      platform: plat,
      title: base.title || wd?.title || pageTitle(),
      company: base.company || document.querySelector('meta[property="og:site_name"]')?.content?.trim() || '',
      companyGuess: companyFromUrl(),
      location: base.location || wd?.location || '',
      description: (wd?.description?.length > (base.description?.length || 0) ? wd.description : base.description) || '',
      postedAt: base.postedAt || wd?.postedAt || '',
      requisitionId: base.requisitionId || wd?.requisitionId || '',
      employmentType: base.employmentType || wd?.employmentType || '',
      source: ld ? 'json-ld' : wd ? 'workday' : 'generic',
    };
    if (!job.description || job.description.length < 200) job.description = genericDescription();
    if (!job.company) job.company = companyFromDescription(job.description) || job.companyGuess;
    job.language = detectLanguage(`${job.title}\n${job.description}`);
    job.isPosting = isPostingPage(job);
    return job;
  }

  /** Version légère pour la détection (sans texte complet). */
  function quickJob() {
    const ld = findJsonLdJob();
    const wdTitle = AP.textOf(document.querySelector('[data-automation-id="jobPostingHeader"]'));
    const hasWdDesc = !!document.querySelector('[data-automation-id="jobPostingDescription"]');
    const title = (ld && String(ld.title || '').trim()) || wdTitle || pageTitle();
    const org = ld?.hiringOrganization;
    const company = (ld && (typeof org === 'string' ? org : org?.name)) || companyFromUrl();
    let isPosting = !!ld || hasWdDesc;
    if (!isPosting && /job|career|carriere|emploi|offre|posting|position|stage|intern/i.test(location.href)) {
      const t = (document.querySelector('main, article, [role="main"]') || document.body)?.innerText || '';
      isPosting = (t.match(KEYWORDS) || []).length >= 3 && t.length > 800;
    }
    return { title, company, isPosting };
  }

  Object.assign(AP, { platform, htmlToText, extractJob, quickJob, jobKey, detectLanguage, companyFromUrl, companyFromDescription });
})();
