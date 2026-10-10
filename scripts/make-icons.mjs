// Génère les icônes PNG de l'extension (16, 32, 48, 128 px) avec Chrome headless.
//   node scripts/make-icons.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getConfig } from '../server/src/config.js';
import { launchBrowser } from '../server/src/pdf.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'extension', 'icons');

const svg = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 128 128">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3b82f6"/><stop offset="1" stop-color="#1d4ed8"/></linearGradient></defs>
  <rect x="4" y="4" width="120" height="120" rx="28" fill="url(#g)"/>
  <g transform="translate(25 27) scale(3.25)"><path d="M2 21l21-9L2 3v7l15 2-15 2z" fill="#fff"/></g>
</svg>`;

const browser = await launchBrowser(getConfig());
try {
  const page = await browser.newPage();
  for (const size of [16, 32, 48, 128]) {
    await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg(size)}</body></html>`);
    const file = path.join(OUT, `icon${size}.png`);
    await page.screenshot({ path: file, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    console.log('✓', path.relative(ROOT, file));
  }
} finally {
  await browser.close();
}
