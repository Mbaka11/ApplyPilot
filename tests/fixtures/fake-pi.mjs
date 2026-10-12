// A local, quota-free CLI fixture. No provider request or candidate data is saved.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let input = '';
if (!process.argv.includes('--child')) for await (const chunk of process.stdin) input += chunk;
let settings = {};
try { settings = JSON.parse(input); } catch { /* API prompts use the waiting mode. */ }
const child = settings.child ? spawn(process.execPath, [fileURLToPath(import.meta.url), '--child'], { stdio: 'ignore' }) : null;
const dir = process.env.APPLYPILOT_FAKE_PI_DIR;
if (dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${process.pid}.json`), JSON.stringify({
    pid: process.pid, child: child?.pid || null,
    isolated: ['PI_SESSION_ID', 'PI_SESSION_FILE', 'PI_PROVIDER', 'PI_MODEL'].every((key) => !process.env[key]),
    flags: process.argv.slice(2),
  }));
}
if (settings.mode === 'json') {
  process.stdout.write(JSON.stringify({ answers: {} }));
} else if (settings.mode === 'invalid') {
  process.stdout.write('not JSON');
} else {
  await new Promise((resolve) => setTimeout(resolve, settings.delay ?? 90_000));
  process.stdout.write(JSON.stringify({ answers: {} }));
}
