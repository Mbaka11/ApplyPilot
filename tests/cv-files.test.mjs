// File-manager launches are simulated; no Explorer/Finder windows are opened.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { createCvFileActions } from '../server/src/cv-files.js';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'applypilot-cv-files-'));
const name = 'Demo CV [FR] & résumé.pdf';
const id = name.slice(0, -4);
const cfg = { cvDir: root };
fs.writeFileSync(path.join(root, name), '%PDF-1.4\nsynthetic\n');
const mockLaunch = (calls, mode = 'ok') => (command, args, options) => {
  calls.push({ command, args, options });
  if (mode === 'throw') throw new Error('synthetic launch failure');
  const child = new EventEmitter(); child.unref = () => {};
  queueMicrotask(() => child.emit(mode === 'error' ? 'error' : 'spawn', mode === 'error' ? new Error('missing file manager') : undefined));
  return child;
};
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

test('details expose only the selected configured PDF and fresh file metadata', () => {
  const service = createCvFileActions({ platform: 'win32' });
  const details = service.details(cfg, id);
  assert.equal(details.id, id); assert.equal(details.file, name);
  assert.equal(details.pdfPath, fs.realpathSync(path.join(root, name)));
  assert.equal(details.revealMode, 'select'); assert.equal(details.revealSupported, true);
  assert.equal(details.texPath, undefined);
  fs.appendFileSync(path.join(root, name), 'changed bytes');
  assert.ok(service.details(cfg, id).size > details.size);
});
for (const platform of ['win32', 'darwin', 'linux']) test(`${platform}: revealing uses fixed executable, individual arguments, no shell`, async () => {
  const calls = [], service = createCvFileActions({ platform, launch: mockLaunch(calls), env: { SystemRoot: 'C:\\Windows' } });
  const before = fs.readFileSync(path.join(root, name));
  const reply = await service.reveal(cfg, id);
  assert.deepEqual(reply, { requested: true, mode: platform === 'linux' ? 'folder' : 'select' });
  assert.equal(calls.length, 1); const call = calls[0];
  assert.equal(call.options.shell, false); assert.equal(call.options.stdio, 'ignore');
  const file = fs.realpathSync(path.join(root, name));
  if (platform === 'win32') { assert.equal(call.command, 'C:\\Windows\\explorer.exe'); assert.deepEqual(call.args, ['/select,', file]); }
  else if (platform === 'darwin') { assert.equal(call.command, '/usr/bin/open'); assert.deepEqual(call.args, ['-R', file]); }
  else { assert.equal(call.command, 'xdg-open'); assert.deepEqual(call.args, [path.dirname(file)]); }
  assert.deepEqual(fs.readFileSync(path.join(root, name)), before);
});
test('missing/hidden IDs, traversal, directories and arbitrary file paths never launch anything', async () => {
  const calls = [], service = createCvFileActions({ launch: mockLaunch(calls) });
  fs.mkdirSync(path.join(root, 'not-a-file.pdf'));
  for (const input of ['missing', '../profile.yaml', path.join(root, name), 'not-a-file']) {
    assert.throws(() => service.details(cfg, input), { status: 404 });
    await assert.rejects(service.reveal(cfg, input), { status: 404 });
  }
  const hidden = { ...cfg, cvs: [{ file: name, hidden: true }] };
  assert.throws(() => service.details(hidden, id), { status: 404 });
  await assert.rejects(service.reveal(hidden, id), { status: 404 });
  assert.equal(calls.length, 0);
});
test('symlink PDFs outside the configured folder are not selectable', async t => {
  const outside = path.join(path.dirname(root), path.basename(root) + '-outside.pdf');
  const link = path.join(root, 'linked.pdf');
  fs.writeFileSync(outside, '%PDF-1.4\n');
  try {
    try { fs.symlinkSync(outside, link); } catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) return t.skip('Creating a symlink requires additional OS rights'); throw error; }
    const calls = [], service = createCvFileActions({ launch: mockLaunch(calls) });
    assert.throws(() => service.details(cfg, 'linked'), { status: 404 });
    await assert.rejects(service.reveal(cfg, 'linked'), { status: 404 });
    assert.equal(calls.length, 0);
  } finally { fs.rmSync(link, { force: true }); fs.rmSync(outside, { force: true }); }
});
for (const mode of ['error', 'throw']) test(`launch ${mode} returns a safe failure, not a false success`, async () => {
  const service = createCvFileActions({ platform: 'win32', launch: mockLaunch([], mode) });
  await assert.rejects(service.reveal(cfg, id), { status: 502 });
});
test('unsupported platforms can still inspect/copy paths but cannot launch a command', async () => {
  const calls = [], service = createCvFileActions({ platform: 'other', launch: mockLaunch(calls) });
  assert.equal(service.details(cfg, id).revealSupported, false);
  await assert.rejects(service.reveal(cfg, id), { status: 501 });
  assert.equal(calls.length, 0);
});
