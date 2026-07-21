/**
 * Resolve crown seal files on disk (dev workspace + Electron packaged).
 *
 * CẤM require('electron') ở đây — Turbopack/Next bundle vào server chunks
 * rồi khi boot gọi path npm electron → "Downloading Electron binary" + crash.
 * Dùng process.resourcesPath + env do main.js set (AI_NOVEL_ROOT, AINOVEL_CROWN_DIR).
 */
import fs from 'fs';
import path from 'path';

export function resolveCrownSealPath(moduleFile: string): string {
  const name = moduleFile.endsWith('.seal') ? moduleFile : `${moduleFile}.seal`;
  const candidates: string[] = [];

  // Env override (tests / main)
  if (process.env.AINOVEL_CROWN_DIR) {
    candidates.push(path.join(process.env.AINOVEL_CROWN_DIR, name));
  }

  // main.js sets AI_NOVEL_ROOT = resourcesPath when packaged
  const root = (process.env.AI_NOVEL_ROOT || '').trim();
  if (root) {
    candidates.push(path.join(root, 'crown', name));
    candidates.push(path.join(root, 'resources', 'crown', name));
  }

  // Electron always exposes process.resourcesPath in main/utility/renderer Node
  const resPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (resPath) {
    candidates.push(path.join(resPath, 'crown', name));
  }

  const cwd = process.cwd();
  candidates.push(path.join(cwd, 'resources', 'crown', name));
  candidates.push(path.join(cwd, 'crown', name));

  // Fallback: next to packaged .exe → resources/crown
  if (process.versions?.electron) {
    try {
      const exeDir = path.dirname(process.execPath);
      candidates.push(path.join(exeDir, 'resources', 'crown', name));
    } catch {
      /* ignore */
    }
  }

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return path.join(cwd, 'resources', 'crown', name);
}

export function crownSealExists(moduleFile: string): boolean {
  const p = resolveCrownSealPath(moduleFile);
  return fs.existsSync(p);
}
