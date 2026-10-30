// Explicit isolated-test preload. Never imported by the application itself.
import fs from 'node:fs';
import path from 'node:path';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
if (process.env.APPLYPILOT_NATIVE_FIXTURE !== '1' || !process.env.APPLYPILOT_DATA_DIR) throw new Error('Native fixture requires isolated test data');
const dir = process.env.APPLYPILOT_DATA_DIR;
fs.mkdirSync(dir, { recursive: true });
const original = childProcess.spawn;
childProcess.spawn = function (command, args, options) {
  const name = String(command).split(/[\\/]/).at(-1);
  if (!['explorer.exe', 'open', 'xdg-open'].includes(name)) return original(command, args, options);
  fs.appendFileSync(path.join(dir, 'native-reveal-log.jsonl'), JSON.stringify({ command, args, shell: options.shell }) + '\n');
  let mode = 'ok';
  try { mode = JSON.parse(fs.readFileSync(path.join(dir, 'native-reveal-mode.json'), 'utf8')).mode; } catch { /* default success */ }
  const child = new EventEmitter(); child.unref = () => {};
  queueMicrotask(() => child.emit(mode === 'error' ? 'error' : 'spawn', mode === 'error' ? new Error('Synthetic file-manager failure') : undefined));
  return child;
};
syncBuiltinESMExports();
