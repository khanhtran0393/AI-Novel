/**
 * Repo integration paths — bridges D:\repo/* into AI Novel without forking those trees.
 * Override via env: AINOVEL_REPO_ROOT, AINOVEL_SEEDANCE_DIR, etc.
 */
import fs from 'fs';
import path from 'path';

const DEFAULT_REPO_ROOT = process.env.AINOVEL_REPO_ROOT || 'D:\\repo';

export type IntegrationId = 'seedance' | 'fablecut' | 'watch' | 'mirofish';

export interface IntegrationPaths {
  repoRoot: string;
  seedance: string;
  fablecut: string;
  watch: string;
  watchScripts: string;
  mirofish: string;
  mirofishBackend: string;
  /** App-local workspaces for integration outputs */
  workRoot: string;
  fablecutExport: string;
  watchWork: string;
  mirofishWork: string;
  seedanceWork: string;
}

function firstExisting(...candidates: string[]): string {
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return candidates[0] || '';
}

export function getIntegrationPaths(cwd = process.cwd()): IntegrationPaths {
  const repoRoot = process.env.AINOVEL_REPO_ROOT || DEFAULT_REPO_ROOT;
  // Prefer app-vendored packages (ship-ready) over D:\repo (dev machine only)
  const seedance = firstExisting(
    process.env.AINOVEL_SEEDANCE_DIR || '',
    path.join(cwd, 'vendor', 'seedance-2.0'),
    path.join(repoRoot, 'seedance-2.0-main'),
  );
  const fablecut = firstExisting(
    process.env.AINOVEL_FABLECUT_DIR || '',
    path.join(cwd, 'vendor', 'FableCut'),
    path.join(repoRoot, 'FableCut-main'),
  );
  const watchRoot = firstExisting(
    process.env.AINOVEL_WATCH_DIR || '',
    path.join(cwd, 'vendor', 'watch'),
    path.join(repoRoot, 'claude-video-main', 'skills', 'watch'),
    path.join(repoRoot, 'claude-video-main'),
  );
  const watchScripts = firstExisting(
    path.join(watchRoot, 'scripts'),
    path.join(cwd, 'vendor', 'watch', 'scripts'),
    path.join(repoRoot, 'claude-video-main', 'skills', 'watch', 'scripts'),
  );
  const mirofish = firstExisting(
    process.env.AINOVEL_MIROFISH_DIR || '',
    path.join(cwd, 'vendor', 'MiroFish'),
    path.join(repoRoot, 'MiroFish-main'),
  );

  const workRoot = path.join(cwd, 'exports', 'integrations');
  return {
    repoRoot,
    seedance,
    fablecut,
    watch: watchRoot,
    watchScripts,
    mirofish,
    mirofishBackend: path.join(mirofish, 'backend'),
    workRoot,
    fablecutExport: path.join(workRoot, 'fablecut'),
    watchWork: path.join(workRoot, 'watch'),
    mirofishWork: path.join(workRoot, 'mirofish'),
    seedanceWork: path.join(workRoot, 'seedance'),
  };
}

export function ensureWorkDirs(paths: IntegrationPaths = getIntegrationPaths()): void {
  for (const dir of [
    paths.workRoot,
    paths.fablecutExport,
    paths.watchWork,
    paths.mirofishWork,
    paths.seedanceWork,
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function probeIntegration(id: IntegrationId, paths = getIntegrationPaths()) {
  switch (id) {
    case 'seedance':
      return {
        id,
        path: paths.seedance,
        ready: fs.existsSync(path.join(paths.seedance, 'SKILL.md')) ||
          fs.existsSync(path.join(paths.seedance, 'skills', 'seedance-prompt', 'SKILL.md')),
        markers: ['SKILL.md', 'skills/seedance-prompt', 'references/directing-engine.md'],
      };
    case 'fablecut':
      return {
        id,
        path: paths.fablecut,
        ready: fs.existsSync(path.join(paths.fablecut, 'server.js')),
        markers: ['server.js', 'app.js', 'library/'],
      };
    case 'watch':
      return {
        id,
        path: paths.watchScripts,
        ready: fs.existsSync(path.join(paths.watchScripts, 'watch.py')),
        markers: ['watch.py', 'frames.py', 'transcribe.py'],
      };
    case 'mirofish':
      return {
        id,
        path: paths.mirofish,
        ready: fs.existsSync(path.join(paths.mirofish, 'backend', 'run.py')),
        markers: ['backend/run.py', 'frontend/', 'README.md'],
      };
  }
}

export function localFfmpegBin(cwd = process.cwd()): string | null {
  const candidates = [
    path.join(cwd, 'bin', 'ffmpeg.exe'),
    path.join(cwd, 'bin', 'ffmpeg'),
    path.join(cwd, 'python_core', 'ffmpeg', 'ffmpeg.exe'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

export function localFfprobeBin(cwd = process.cwd()): string | null {
  const candidates = [
    path.join(cwd, 'bin', 'ffprobe.exe'),
    path.join(cwd, 'bin', 'ffprobe'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}
