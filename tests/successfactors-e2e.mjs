// Synthetic SuccessFactors behavior in the real extension; no employer/account connection.
export async function testSuccessFactors({ panel, site, sw, check }) {
  const originalUrl = site.url();
  await panel.click('[data-tab="app"]');
  await site.goto(new URL('/successfactors-form.html', originalUrl).href);
  const tabId = await sw.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, site.url());
  const inContent = async func => (await sw.evaluate(async ({ id, source }) => {
    // Pass only fixed test functions through the fixture's isolated extension world.
    const result = await chrome.scripting.executeScript({ target: { tabId: id }, func: name => {
      if (name === 'stale') { delete ApplyPilot.successfactors; document.getElementById('first').value = 'Preserved synthetic edit'; }
      if (name === 'revision') return globalThis.ApplyPilot?.successfactors?.revision || 0;
      if (name === 'platform') ApplyPilot.platform = () => 'successfactors';
    }, args: [source] });
    return result[0]?.result;
  }, { id: tabId, source: func }));
  try {
    await site.waitForFunction(() => !!window.sfFixture);
    for (let attempt = 0; attempt < 100 && await inContent('revision') !== 2; attempt++) await new Promise(resolve => setTimeout(resolve, 40));
    await inContent('stale');
    await panel.click('#serverStatus');
    for (let attempt = 0; attempt < 100 && await inContent('revision') !== 2; attempt++) await new Promise(resolve => setTimeout(resolve, 40));
    check('same-version pre-fix scripts receive the new capability without reloading the form', await inContent('revision') === 2 && await site.$eval('#first', element => element.value === 'Preserved synthetic edit'));
    await inContent('platform');
    await panel.waitForFunction(() => !document.getElementById('serverStatus').disabled);
    await panel.click('#serverStatus');
    await panel.waitForFunction(() => document.querySelector('#pageCard')?.textContent.includes('SuccessFactors') && document.querySelector('#pageCard')?.textContent.includes('5 manual action'));
    check('page overview distinguishes manual actions from file inputs', (await panel.$eval('#pageCard', element => element.textContent)).includes('5 manual action'));
    if (await panel.$eval('#optAi', element => element.checked)) await panel.click('#optAi');
    await panel.click('[data-action="fill"]');
    await panel.waitForFunction(() => !document.querySelector('#fillCard .busy') && !!document.querySelector('#fillCard .summary'), { timeout: 30000 });
    const feedback = await panel.$eval('#fillCard', element => element.textContent);
    check('SuccessFactors manual document and Add guidance is visible in English', feedback.includes('Review the CV attachment') && feedback.includes('Education: click') && feedback.includes('Languages: click'));
    check('real panel uses the graduation date and leaves internship count to the candidate', await site.$eval('#graduation', element => element.value === '2028-01') && await site.$eval('#count', element => element.value === ''));
    check('real panel selects a verified owned option and ARIA radio, not a source-category guess', await site.$eval('#country', element => element.value === 'Canada') && await site.$eval('#auth-yes', element => element.getAttribute('aria-checked') === 'true') && await site.$eval('#source-type', element => element.value === 'Aucune sélection'));
    await panel.select('#uiLanguage', 'fr');
    check('manual action and count explanations are also localized in French', (await panel.$eval('#fillCard', element => element.textContent)).includes('Nombre de stages terminés') && (await panel.$eval('#fillCard', element => element.textContent)).includes('Aucun bloc ajouté automatiquement'));
    await panel.select('#uiLanguage', 'en');
    check('SAP adapter preserves existing input and never uploads, adds, saves or submits', await site.evaluate(() => document.getElementById('first').value === 'Preserved synthetic edit' && sfFixture.submissions === 0 && !sfFixture.clicks.some(id => /^(cv-trigger|letter-trigger|other-trigger|add-education|add-language|save|submit|unrelated-option)$/.test(id))));
  } finally {
    await site.goto(originalUrl);
    await panel.waitForFunction(() => document.querySelector('#pageCard')?.textContent.includes('Workday'), { timeout: 10000 });
  }
}
