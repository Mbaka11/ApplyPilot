// A local, quota-free CLI fixture. No provider request or candidate data is saved.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let input = '';
if (!process.argv.includes('--child')) for await (const chunk of process.stdin) input += chunk;
let settings = {};
try { settings = JSON.parse(input.split('\n\nIMPORTANT :')[0]); } catch { /* Most API prompts use the waiting mode. */ }
function output(text) {
  if (!process.argv.includes('--mode')) return process.stdout.write(text);
  const message = { role: 'assistant', provider: 'fixture', model: 'demo-observed', stopReason: 'stop',
    content: [{ type: 'thinking', thinking: 'PRIVATE_REASONING_CANARY_NOT_FOR_STORAGE' }, { type: 'text', text }] };
  process.stdout.write(JSON.stringify({ type: 'message_end', message }) + '\n' + JSON.stringify({ type: 'agent_end', messages: [message] }) + '\n');
}
const child = settings.child ? spawn(process.execPath, [fileURLToPath(import.meta.url), '--child'], { stdio: 'ignore' }) : null;
const dir = process.env.APPLYPILOT_FAKE_PI_DIR;
if (dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${process.pid}.json`), JSON.stringify({
    pid: process.pid, child: child?.pid || null,
    isolated: ['PI_SESSION_ID', 'PI_SESSION_FILE', 'PI_PROVIDER', 'PI_MODEL'].every((key) => !process.env[key]),
    flags: process.argv.slice(2),
    instructionsSeen: input.includes('SYNTHETIC_INSTRUCTION_CANARY'),
  }));
}
if (settings.mode === 'json' || (settings.mode === 'retry' && input.includes('\n\nIMPORTANT :'))) {
  output(JSON.stringify({ answers: {} }));
} else if (settings.mode === 'invalid' || settings.mode === 'retry') {
  output('not JSON');
} else if (input.startsWith('Tu es un rédacteur expert')) {
  await new Promise(resolve => setTimeout(resolve, 500));
  output(JSON.stringify({ language: 'en', company: 'Nordic Analytics', jobTitle: 'Machine Learning Intern', subject: 'Machine Learning Internship',
    body: 'Dear Hiring Team,\n\nI would like to contribute to the machine learning internship at Nordic Analytics. My academic projects and internship experience have given me practical experience with Python, SQL and model evaluation.\n\nI value clear experiments, reliable data and useful documentation. I would welcome the opportunity to discuss the team’s needs and the contributions I could make.\n\nThank you for considering my application.\n\nSincerely,', warnings: [] }));
} else {
  await new Promise((resolve) => setTimeout(resolve, settings.delay ?? 90_000));
  output(JSON.stringify({ answers: {} }));
}
