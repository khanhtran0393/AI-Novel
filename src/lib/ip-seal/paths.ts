/**
 * Resolve crown seal files on disk (dev workspace + Electron packaged).
 */
import fs from 'fs';
import path from 'path';

export function resolveCrownSealPath(moduleFile: string): string {
  const name = moduleFile.endsWith('.seal') ? moduleFile : `${moduleFile}.seal`;
  const candidates: string[] = [];

  // Electron packaged: extraResources → resources/crown
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron') as { app?: { isPackaged?: boolean; getAppPath?: () => string } };
    if (electron?.app?.isPackaged && typeof electron.app.getAppPath === 'function') {
      const appPath = electron.app.getAppPath();
      candidates.push(path.join(path.dirname(appPath), 'crown', name));
      candidates.push(path.join(path.dirname(appPath), 'resources', 'crown', name));
    }
  } catch {
    /* not in electron main */
  }

  const cwd = process.cwd();
  candidates.push(path.join(cwd, 'resources', 'crown', name));
  candidates.push(path.join(cwd, 'crown', name));

  // process.resourcesPath (Electron utility / next in electron)
  const resPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (resPath) {
    candidates.push(path.join(resPath, 'crown', name));
  }

  // Env override for tests
  if (process.env.AINOVEL_CROWN_DIR) {
    candidates.unshift(path.join(process.env.AINOVEL_CROWN_DIR, name));
  }

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  // Prefer canonical workspace path for error messages
  return path.join(cwd, 'resources', 'crown', name);
}

export function crownSealExists(moduleFile: string): boolean {
  const p = resolveCrownSealPath(moduleFile);
  return fs.existsSync(p);
}
