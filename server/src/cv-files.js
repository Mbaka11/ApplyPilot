// Explicit, read-only file inspection. Callers provide a configured CV ID, never a path.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { listCvs, publicCv } from './cvs.js';
const fail = (status, message) => Object.assign(new Error(message), { status });
function configuredCv(cfg, id) {
  let cv;
  try { cv = listCvs(cfg).cvs.find(item => item.id === id); }
  catch { throw fail(404, 'Le CV sélectionné est introuvable. Actualise la liste des CV.'); }
  if (!cv) throw fail(404, 'Le CV sélectionné est introuvable. Actualise la liste des CV.');
  // A symlink PDF is not listed by listCvs. Recheck the resolved file belongs to
  // the configured directory before handing anything to an OS file manager.
  let file, folder, stat;
  try {
    file = fs.realpathSync(cv.pdfPath);
    folder = fs.realpathSync(cfg.cvDir);
    stat = fs.statSync(file);
  } catch { throw fail(404, 'Le CV sélectionné est introuvable. Actualise la liste des CV.'); }
  const relative = path.relative(folder, file);
  if (!stat.isFile() || !relative || path.dirname(relative) !== '.' || path.isAbsolute(relative) || relative === '..') throw fail(400, 'Le CV doit rester dans le dossier configuré.');
  return { cv, file, stat };
}
export function createCvFileActions({ launch = spawn, platform = process.platform, env = process.env } = {}) {
  const supported = ['win32', 'darwin', 'linux'].includes(platform);
  const revealMode = platform === 'linux' ? 'folder' : 'select';
  function details(cfg, id) {
    const { cv, file, stat } = configuredCv(cfg, id);
    return { ...publicCv(cv), pdfPath: file, size: stat.size, modifiedAt: stat.mtime.toISOString(), revealSupported: supported, revealMode: supported ? revealMode : null };
  }
  async function reveal(cfg, id) {
    const file = configuredCv(cfg, id).file;
    if (!supported) throw fail(501, 'L’ouverture du dossier n’est pas disponible sur ce système. Copie le chemin du CV.');
    const command = platform === 'win32' ? path.win32.join(env.SystemRoot || env.WINDIR || 'C:\\Windows', 'explorer.exe') : platform === 'darwin' ? '/usr/bin/open' : 'xdg-open';
    const args = platform === 'win32' ? ['/select,', file] : platform === 'darwin' ? ['-R', file] : [path.dirname(file)];
    await new Promise((resolve, reject) => {
      let child;
      const failed = () => reject(fail(502, 'Impossible d’ouvrir le dossier. Copie le chemin du CV.'));
      try {
        child = launch(command, args, { shell: false, windowsHide: true, stdio: 'ignore' });
        child.once('error', failed);
        // File managers can dispatch to an existing process and return a nonzero
        // exit code. A spawn is a request, not proof of a visible OS window.
        child.once('spawn', () => { child.unref(); resolve(); });
      } catch { failed(); }
    });
    return { requested: true, mode: revealMode };
  }
  return { details, reveal };
}
export const cvFileActions = createCvFileActions();
