import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

export { puppeteer };

const WIN = [
  '%PROGRAMFILES%\\Google\\Chrome\\Application\\chrome.exe',
  '%PROGRAMFILES(X86)%\\Google\\Chrome\\Application\\chrome.exe',
  '%LOCALAPPDATA%\\Google\\Chrome\\Application\\chrome.exe',
  '%PROGRAMFILES(X86)%\\Microsoft\\Edge\\Application\\msedge.exe',
  '%PROGRAMFILES%\\Microsoft\\Edge\\Application\\msedge.exe',
];
const MAC = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
];
const LINUX = [
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/microsoft-edge',
  '/snap/bin/chromium',
];

const expandEnv = (p) => p.replace(/%([^%]+)%/g, (m, v) => process.env[v] ?? m);

export function findChrome(cfg) {
  const explicit = cfg?.chrome?.executablePath;
  if (explicit) return fs.existsSync(explicit) ? explicit : null;
  const list = process.platform === 'win32' ? WIN.map(expandEnv) : process.platform === 'darwin' ? MAC : LINUX;
  return list.find((p) => p && !p.includes('%') && fs.existsSync(p)) || null;
}

/** Lance un Chrome headless dedie (scripts et tests). */
export async function launchBrowser(cfg, { args = [] } = {}) {
  const executablePath = findChrome(cfg);
  if (!executablePath) throw new Error('Chrome/Edge introuvable : renseigne chrome.executablePath dans config.yaml');
  return puppeteer.launch({
    executablePath,
    headless: true,
    args: ['--no-first-run', '--no-default-browser-check', '--disable-extensions', ...args],
  });
}

let browserPromise = null;
let idleTimer = null;
let active = 0;

async function getBrowser(cfg) {
  if (browserPromise) {
    try {
      const b = await browserPromise;
      if (b.connected) return b;
    } catch {
      /* relance */
    }
    browserPromise = null;
  }
  const executablePath = findChrome(cfg);
  if (!executablePath) {
    throw Object.assign(new Error('Chrome/Edge introuvable : renseigne chrome.executablePath dans config.yaml'), { status: 500 });
  }
  browserPromise = puppeteer.launch({
    executablePath,
    headless: true,
    args: ['--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-gpu'],
  });
  return browserPromise;
}

function scheduleClose() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => {
    if (active > 0) return scheduleClose();
    const p = browserPromise;
    browserPromise = null;
    try {
      await (await p)?.close();
    } catch {
      /* déjà fermé */
    }
  }, 90_000);
  idleTimer.unref?.();
}

export async function closeBrowser() {
  clearTimeout(idleTimer);
  const p = browserPromise;
  browserPromise = null;
  try {
    await (await p)?.close();
  } catch {
    /* ignore */
  }
}

/** Réduit légèrement la police tant que la lettre dépasse une page (exécuté dans la page). */
function fitToOnePage() {
  const page = document.querySelector('.page');
  const avail = Number(page?.dataset.availPx || 0);
  const root = document.documentElement;
  let fs = 10.8;
  let lh = 1.45;
  const height = () => page.getBoundingClientRect().height;
  while (avail && height() > avail && fs > 9.3) {
    fs = Math.round((fs - 0.15) * 100) / 100;
    lh = Math.max(1.3, Math.round((lh - 0.015) * 1000) / 1000);
    root.style.setProperty('--fs', `${fs}pt`);
    root.style.setProperty('--lh', String(lh));
  }
  return { fontSizePt: fs, lineHeight: lh, fitsOnePage: !avail || height() <= avail };
}

export async function htmlToPdf(html, outFile, { cfg } = {}) {
  active++;
  let page;
  try {
    const browser = await getBrowser(cfg);
    page = await browser.newPage();
    await page.emulateMediaType('print');
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready.then(() => true));
    const fit = await page.evaluate(fitToOnePage);
    await page.pdf({ path: outFile, preferCSSPageSize: true, printBackground: true });
    return fit;
  } finally {
    if (page) await page.close().catch(() => {});
    active--;
    scheduleClose();
  }
}
