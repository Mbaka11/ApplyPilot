// Invoked by the extension E2E suite (0.9.0 insights): new-offer badges and counter, bounded re-run,
// tracker statistics, AI usage section and the "to adapt" chips. Fictional data and fake providers only.
import path from 'node:path';
import { fitScreenshot } from './panel-steps.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const json = (apiBase, route, method = 'GET', body) => fetch(apiBase + route, { method, headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }).then(r => r.json());

/** Called from the search suite, which owns the intercepted Google tabs. `owned` and `navigations` are its live arrays. */
export async function testNewOffers({ panel, apiBase, out, check, owned, navigations, setMode }) {
  setMode('ready');
  await panel.click('[data-tab="search"]');
  await panel.waitForSelector('[data-search-action="start"]:not([disabled])');
  for (const [id, value] of [['#searchPlatform', 'all'], ['#searchSource', 'all'], ['#searchState', 'visible'], ['#searchLocation', 'all']]) await panel.select(id, value);
  await panel.click('[data-search-action="start"]');
  await panel.waitForFunction(() => document.querySelector('#searchProgress')?.textContent.includes('Search complete.'), { timeout: 40000 });
  const found = await json(apiBase, '/search');
  const shown = await panel.$$eval('[data-discovery-id]', els => els.length);
  check('offers found by a run are marked New while the Search tab is open', shown > 0 && (await panel.$$('.search-new')).length === shown && found.meta.newCount >= shown && found.meta.lastRun?.source === 'google');
  check('opening or reading the Search tab does not clear the New marks', (await json(apiBase, '/search')).meta.newCount === found.meta.newCount);
  await panel.select('#searchState', 'since');
  check('"New since my last visit" filter keeps the new offers', (await panel.$$('[data-discovery-id]')).length === shown);
  await panel.select('#searchState', 'visible');

  // Leaving the tab marks everything as seen.
  await panel.click('[data-tab="home"]');
  for (let i = 0; i < 50 && (await json(apiBase, '/search')).meta.newCount; i++) await sleep(100);
  check('leaving the Search tab calls /search/seen', (await json(apiBase, '/search')).meta.newCount === 0);
  await panel.click('[data-tab="search"]');
  await panel.waitForSelector('[data-discovery-id]');
  check('the New marks are gone after the visit', (await panel.$$('.search-new')).length === 0);
  await panel.click('[data-tab="home"]');

  // A later import is new again: Home shows the counter, which opens the filtered Search view.
  await json(apiBase, '/search/import', 'POST', { links: 'https://www.linkedin.com/jobs/view/7700110022', details: { title: 'Data Intern (fictional)', company: 'Nordic Analytics' } });
  await panel.click('#serverStatus');
  await panel.waitForSelector('#tab-home .new-count', { timeout: 10000 });
  await panel.evaluate(() => { document.querySelector('#toast').className = 'toast'; });
  await sleep(3200); // let the reconnect toast fade before the screenshot
  await fitScreenshot(panel, path.join(out, 'home-new-offers-en.png'));
  check('Home shows the new-offer counter', (await panel.$eval('#tab-home .new-count', e => e.textContent)).startsWith('1 new job'));
  await panel.click('#tab-home .new-count');
  await panel.waitForFunction(() => document.querySelectorAll('[data-discovery-id]').length === 1, { timeout: 10000 });
  check('the counter opens Search on the new-since-last-visit filter', (await panel.$eval('.tab.active', e => e.id)) === 'tab-search' && (await panel.$eval('#searchState', e => e.value)) === 'since' && (await panel.$$('[data-discovery-id]')).length === 1);
  await panel.select('#searchState', 'visible');
  await panel.click('[data-tab="home"]');
  for (let i = 0; i < 50 && (await json(apiBase, '/search')).meta.newCount; i++) await sleep(100);
  await panel.waitForFunction(() => !document.querySelector('#tab-home .new-count'));

  // One click on Home = one bounded run of the last search, never in the background.
  await panel.waitForSelector('#tab-home [data-action="rerunSearch"]');
  check('Home shows the last search with a re-run button', (await panel.$eval('#tab-home .new-offers', e => e.textContent)).includes('Last search:'));
  const before = { navigations: navigations.length, tabs: owned.length };
  await sleep(1200);
  check('nothing runs in the background', navigations.length === before.navigations);
  await panel.click('#tab-home [data-action="rerunSearch"]');
  check('the re-run button is disabled while the search is running', await panel.$eval('#tab-home [data-action="rerunSearch"]', e => e.disabled));
  await panel.waitForFunction(() => document.querySelector('#searchProgress')?.textContent.includes('Search complete.'), { timeout: 40000 });
  await sleep(800);
  check('re-run performs exactly one bounded run (2 queries, 1 tab)', navigations.length === before.navigations + 2 && owned.length === before.tabs + 1);
  await panel.click('[data-tab="home"]');
  await panel.waitForFunction(() => !document.querySelector('#tab-home [data-action="rerunSearch"]')?.disabled);
}

export async function testInsights({ panel, apiBase, out, check, englishAppId }) {
  const tap = selector => panel.$eval(selector, element => element.click()); // robust against the sticky action bar and viewport changes
  const url = file => `chrome-extension://${new URL(panel.url()).host}/sidepanel/${file}`;

  // --- Statistics: real server data, then synthetic payloads for the n >= 5 and empty cases ---
  await tap('[data-tab="journal"]');
  await panel.waitForSelector('#tab-journal [data-journal-view="stats"]');
  await tap('#tab-journal [data-journal-view="stats"]');
  await panel.waitForSelector('#tab-journal .funnel');
  const real = await json(apiBase, '/stats');
  const text = await panel.$eval('#tab-journal', e => e.textContent);
  check('statistics view shows the funnel with text values', real.funnel.submitted < 5 && text.includes('Applications created') && (await panel.$$('#tab-journal .funnel li')).length === 4);
  check('with fewer than 5 submitted, rates read "n = x" and no percentage appears', real.rate === null && /n = \d/.test(text) && !/\d\s?%/.test(text) && text.includes('Small samples: indicative only'));
  // Screenshots use a synthetic payload with enough fictional submissions to show rates.
  const cvs = (await json(apiBase, '/cvs')).cvs;
  await panel.evaluate((cvIds) => {
    globalThis.__fetch0 ||= globalThis.fetch;
    const row = (key, created, submitted, responded) => ({ key, created, submitted, responded, rate: submitted >= 5 ? Math.round((responded / submitted) * 1000) / 1000 : null });
    const payload = { minSample: 5, funnel: { identified: 64, created: 18, submitted: 14, responded: 5 }, responses: { interview: 3, offer: 1, rejection: 1 }, rate: 0.357,
      byPlatform: [row('workday', 7, 6, 3), row('greenhouse', 5, 5, 1), row('lever', 3, 2, 0), row('other', 3, 1, 1)],
      byCv: [row(cvIds[0], 10, 8, 4), row(cvIds[1] || 'none', 6, 5, 1), row('none', 2, 1, 0)], medianResponseDays: 6.5, delaySamples: 4 };
    globalThis.fetch = (u, o) => String(u).endsWith('/stats') ? Promise.resolve(new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } })) : globalThis.__fetch0(u, o);
  }, cvs.map(cv => cv.id.toLowerCase()));
  await tap('#tab-journal [data-journal-view="list"]');
  await tap('#tab-journal [data-journal-view="stats"]');
  await panel.waitForFunction(() => document.querySelector('#tab-journal')?.textContent.includes('36 %'));
  await fitScreenshot(panel, path.join(out, 'tracker-stats-en.png'));
  await fitScreenshot(panel, path.join(out, 'tracker-stats-dark.png'), { theme: 'dark' });
  await panel.evaluate(() => { globalThis.fetch = globalThis.__fetch0; });
  const html = await panel.evaluate(async (stateUrl, statsUrl) => {
    const { S } = await import(stateUrl); const { statsHtml } = await import(statsUrl);
    const rows = (keys, rate) => keys.map(key => ({ key, created: 8, submitted: 8, responded: 3, rate }));
    return {
      big: statsHtml({ minSample: 5, funnel: { identified: 40, created: 12, submitted: 10, responded: 4 }, responses: { interview: 2, offer: 1, rejection: 1 }, rate: 0.4, byPlatform: [...rows(['workday', 'greenhouse'], 0.375), { key: 'lever', created: 2, submitted: 2, responded: 1, rate: null }], byCv: [{ key: 'none', created: 2, submitted: 2, responded: 0, rate: null }], medianResponseDays: 6.5, delaySamples: 4 }),
      empty: statsHtml({ funnel: { identified: 0, created: 0, submitted: 0, responded: 0 }, responses: {}, byPlatform: [], byCv: [] }),
      ok: !!S,
    };
  }, url('state.mjs'), url('views/stats.mjs'));
  check('with 5 or more submitted, the rate shows as a percentage; smaller rows keep "n ="', html.big.includes('38 %') && html.big.includes('40 %') && html.big.includes('n = 2') && html.big.includes('Median response time: 6.5 day(s) (n = 4)'));
  check('statistics have an accessible funnel list, tables with captions and an empty state', html.big.includes('aria-label="Application funnel"') && html.big.includes('<caption>By platform</caption>') && html.big.includes('<caption>By CV</caption>') && html.empty.includes('No data yet'));
  check('median delay is hidden when unavailable', !html.empty.includes('Median'));
  await tap('#tab-journal [data-journal-view="list"]');
  await panel.waitForSelector('#tab-journal .list li');

  // --- AI usage section (Settings) ---
  await tap('[data-tab="settings"]');
  await panel.waitForFunction(() => document.querySelector('#usageCard')?.textContent.includes('Generations'), { timeout: 10000 });
  const usage = await json(apiBase, '/usage?days=30');
  check('Settings shows AI usage from the local log', usage.totals.count > 0 && (await panel.$eval('#usageCard', e => e.textContent)).includes('Generations') && !(await panel.$eval('#usageCard', e => e.textContent)).includes('PRIVATE_REASONING_CANARY'));
  await fitScreenshot(panel, path.join(out, 'settings-usage-en.png'));
  await fitScreenshot(panel, path.join(out, 'settings-usage-dark.png'), { theme: 'dark' });
  const stub = (payload) => panel.evaluate(p => {
    globalThis.__fetch0 ||= globalThis.fetch;
    globalThis.fetch = (u, o) => String(u).includes('/usage?') ? Promise.resolve(new Response(JSON.stringify(p), { headers: { 'content-type': 'application/json' } })) : globalThis.__fetch0(u, o);
  }, payload);
  const bucket = { count: 3, ok: 2, failed: 1, inputTokens: 12400, outputTokens: 3100, ms: 41000, costUsd: 0.42 };
  const summary = (billing, enabled) => ({ enabled, days: 30, totals: bucket, billing, byDay: [], byTask: [{ task: 'letter', ...bucket }], byModel: [{ model: 'claude-sonnet-5-5', ...bucket }] });
  await stub(summary({ api: 3, subscription: 0 }, false));
  await tap('[data-tab="home"]'); await tap('[data-tab="settings"]');
  await panel.waitForFunction(() => document.querySelector('#usageCard')?.textContent.includes('Usage log disabled'));
  const billed = await panel.$eval('#usageCard', e => e.textContent);
  check('API billing labels the cost as billed; disabled log is stated; tokens shown', billed.includes('Billed cost') && !billed.includes('Estimate (subscription') && billed.includes('12k + 3.1k'));
  await stub(summary({ api: 0, subscription: 3 }, true));
  await tap('[data-tab="home"]'); await tap('[data-tab="settings"]');
  await panel.waitForFunction(() => document.querySelector('#usageCard')?.textContent.includes('Estimate (subscription'));
  check('subscription billing labels the cost as an estimate', !(await panel.$eval('#usageCard', e => e.textContent)).includes('Billed cost'));
  await panel.evaluate(() => { globalThis.fetch = globalThis.__fetch0; });
  await tap('[data-tab="home"]'); await tap('[data-tab="settings"]');
  await panel.waitForSelector('#usageCard [data-action="clearUsage"]:not([disabled])');
  panel.once('dialog', d => d.dismiss());
  await tap('#usageCard [data-action="clearUsage"]');
  await sleep(300);
  check('declining the confirmation keeps the usage history', (await json(apiBase, '/usage')).totals.count === usage.totals.count);
  panel.once('dialog', d => d.accept());
  await tap('#usageCard [data-action="clearUsage"]');
  await panel.waitForFunction(() => document.querySelector('#usageCard')?.textContent.includes('No generation recorded.'));
  check('clearing empties the usage history', (await json(apiBase, '/usage')).totals.count === 0);
  await tap('[data-tab="home"]');

  // --- "to adapt" / "Adapted from" chips and the memory list ---
  const chips = await panel.evaluate(async (stateUrl, fillUrl) => {
    const { S } = await import(stateUrl); const { renderFill } = await import(fillUrl);
    const saved = S.fill;
    const base = { kind: 'textarea', section: '', required: false, source: '' };
    S.fill = { step: null, info: {}, at: Date.now(), results: [
      { ...base, id: 'a1', label: 'Why us?', status: 'check', value: 'Short text', note: 'Réponse mémorisée pour Acme Robotics : relis-la', needsAdaptation: true },
      { ...base, id: 'a2', label: 'Motivation', status: 'check', value: 'Rewritten', note: 'Adaptée de Acme Robotics', source: 'ia' },
    ] };
    renderFill();
    const html = document.querySelector('#fillCard').innerHTML;
    S.fill = saved; renderFill();
    return html;
  }, url('state.mjs'), url('views/fill.mjs'));
  check('fill results get a "to adapt" chip and an "Adapted from {company}" chip', chips.includes('adapt-chip">to adapt<') && chips.includes('adapt-chip">Adapted from Acme Robotics<'));
  await json(apiBase, '/memory', 'POST', { items: [{ label: 'Zzz synthetic memory question', value: 'A long fictional answer about why this team is a good fit for my studies and goals.', kind: 'textarea' }], company: 'Acme Robotics' });
  await tap('[data-tab="profile"]');
  await panel.waitForFunction(() => document.querySelector('#tab-profile')?.textContent.includes('Zzz synthetic memory question'));
  const memory = await panel.$eval('#tab-profile', e => e.textContent);
  check('memory list shows the origin company and an adaptable badge', memory.includes('adaptable') && memory.includes('Remembered for Acme Robotics'));
  await json(apiBase, '/memory/zzz%20synthetic%20memory%20question', 'DELETE');
  await tap('[data-tab="app"]');
}
