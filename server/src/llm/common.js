import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

// État partagé par les fournisseurs : exécutions actives, annulation, arrêt d'un arbre de processus.
export const activeRuns = new Set();
export const cancelledError = () => Object.assign(new Error('Remplissage arrêté'), { name: 'AbortError', status: 499 });
export const identifier = value => typeof value === 'string' && value.trim() && value.length <= 512 && !/[\u0000-\u001f\u007f]/.test(value) ? value.trim() : null;

export function cancelAll() {
  for (const cancel of [...activeRuns]) cancel();
}

export function killTree(child) {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  } else {
    try { process.kill(-child.pid, 'SIGTERM'); } // owned process group, including launchers
    catch { child.kill('SIGTERM'); }
  }
}

/** Premier fichier existant parmi `names` dans les dossiers du PATH (null si aucun). */
export function findOnPath(names) {
  const dirs = (process.env.PATH || process.env.Path || '').split(path.delimiter).filter(Boolean);
  for (const name of names) for (const dir of dirs) {
    const file = path.join(dir, name);
    try { if (fs.statSync(file).isFile()) return file; } catch { /* suivant */ }
  }
  return null;
}
