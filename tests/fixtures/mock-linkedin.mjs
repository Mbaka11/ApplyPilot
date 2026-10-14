// Test-process preload only. Never imported by the application or extension.
import fs from 'node:fs';
import path from 'node:path';
if (process.env.APPLYPILOT_LINKEDIN_FIXTURE !== '1' || !process.env.APPLYPILOT_DATA_DIR) throw new Error('LinkedIn fixture requires an isolated test environment');
const dir = process.env.APPLYPILOT_DATA_DIR;
fs.mkdirSync(dir, { recursive: true });
const log = value => fs.appendFileSync(path.join(dir, 'linkedin-fixture-log.jsonl'), JSON.stringify(value) + '\n');
const html = fs.readFileSync(new URL('./linkedin-public.html', import.meta.url), 'utf8');
globalThis.fetch = async (url, options = {}) => {
  const target = new URL(url);
  if (target.origin !== 'https://www.linkedin.com' || target.pathname !== '/jobs-guest/jobs/api/seeMoreJobPostings/search') throw new Error('Unexpected network target in isolated test server');
  let mode = 'ready';
  try { mode = JSON.parse(fs.readFileSync(path.join(dir, 'linkedin-fixture-mode.json'), 'utf8')).mode; } catch { /* default fixture */ }
  log({ type: 'request', mode, anonymous: options.credentials === 'omit' && !options.headers?.cookie && !options.headers?.authorization, noRedirect: options.redirect === 'manual' });
  if (mode === 'wait') return new Promise((resolve, reject) => {
    const abort = () => { log({ type: 'abort' }); reject(new DOMException('Stopped', 'AbortError')); };
    if (options.signal.aborted) abort(); else options.signal.addEventListener('abort', abort, { once: true });
  });
  if (mode === 'blocked') return new Response('', { status: 429, headers: { 'retry-after': '300' } });
  return new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
};
