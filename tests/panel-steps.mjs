// Shared helpers for driving the stepper in the application tab. One step is expanded at a time,
// so tests open the step they want to interact with, exactly like a user would.
export async function openStep(panel, name) {
  await panel.evaluate((step) => {
    const head = document.querySelector(`[data-step-toggle="${step}"]`);
    if (head && head.getAttribute('aria-expanded') !== 'true') head.click();
  }, name);
  await panel.waitForFunction((step) => document.querySelector(`[data-step-toggle="${step}"]`)?.getAttribute('aria-expanded') === 'true', {}, name);
}

export async function openFillOptions(panel) {
  await openStep(panel, 'fill');
  await panel.$eval('#fillOptions', (details) => { details.open = true; });
}

/** Screenshot of the whole panel at its natural height (the shell scrolls inside <main>, so fullPage would clip). */
export async function fitScreenshot(panel, file, { width = 400, theme = 'light', max = 1800 } = {}) {
  const previous = panel.viewport();
  await panel.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }]);
  await panel.evaluate(() => { document.querySelector('#toast').className = 'toast'; document.querySelector('main').scrollTop = 0; });
  await panel.setViewport({ width, height: 900 });
  const height = await panel.evaluate(() => [...document.body.children]
    .filter((el) => !['SCRIPT', 'STYLE'].includes(el.tagName) && el.id !== 'toast' && !el.classList.contains('hidden'))
    .reduce((sum, el) => sum + (el.tagName === 'MAIN' ? el.scrollHeight : el.getBoundingClientRect().height), 0));
  await panel.setViewport({ width, height: Math.min(max, Math.ceil(height)) });
  await new Promise((resolve) => setTimeout(resolve, 150));
  await panel.screenshot({ path: file });
  await panel.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  if (previous) await panel.setViewport(previous);
}
