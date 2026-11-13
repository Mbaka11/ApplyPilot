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
