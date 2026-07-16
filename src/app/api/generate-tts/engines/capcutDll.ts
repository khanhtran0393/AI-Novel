/**
 * Locate CapCut sscronet.dll (Cronet) — required for CapCut TTS (no Edge fallback).
 */
  import os from 'os';
  
  // Hide from Turbopack
  const fs = typeof window === 'undefined' ? eval('require("fs")') : null;
  const path = typeof window === 'undefined' ? eval('require("path")') : null;

export type CapCutDllHit = {
  dllPath: string;
  appDir: string;
  version?: string;
};

function isDir(p: string): boolean {
  try {
    return fs.existsSync(p) && fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function isFile(p: string): boolean {
  try {
    return fs.existsSync(p) && fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** Walk one CapCut/Jianying Apps tree: Apps/<version>/sscronet.dll */
function scanAppsRoot(appsRoot: string): CapCutDllHit[] {
  const hits: CapCutDllHit[] = [];
  if (!isDir(appsRoot)) return hits;
  let versions: string[] = [];
  try {
    versions = fs.readdirSync(appsRoot)
      .filter((f: string) => isDir(path.join(appsRoot, f)));
  } catch {
    return hits;
  }
  versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  for (const v of versions) {
    const appDir = path.join(appsRoot, v);
    const dllPath = path.join(appDir, 'sscronet.dll');
    if (isFile(dllPath)) {
      hits.push({ dllPath, appDir, version: v });
    }
  }
  return hits;
}

/** Also check direct layout: CapCut/sscronet.dll or CapCut/Application/sscronet.dll */
function scanFlatRoots(roots: string[]): CapCutDllHit[] {
  const hits: CapCutDllHit[] = [];
  for (const root of roots) {
    if (!isDir(root)) continue;
    const candidates = [
      path.join(root, 'sscronet.dll'),
      path.join(root, 'Application', 'sscronet.dll'),
      path.join(root, 'bin', 'sscronet.dll'),
    ];
    for (const dllPath of candidates) {
      if (isFile(dllPath)) {
        hits.push({ dllPath, appDir: path.dirname(dllPath) });
      }
    }
  }
  return hits;
}

/**
 * Search all known CapCut / JianyingPro install locations.
 */
export function findCapCutSscronet(): CapCutDllHit | null {
  if (!fs || !path) return null;

  // Use dynamic arrays to prevent Turbopack from statically analyzing path.join
  const buildPath = (...args: string[]) => args.join(path.sep);
  
  const env = process.env;
  const userProfile = env.USERPROFILE || env.HOME || '';
  const localApp = env.LOCALAPPDATA || buildPath(userProfile, 'AppData', 'Local');
  
  const programFiles = [
    env['ProgramFiles'] || 'C:\\Program Files',
    env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
  ];

  const appsRoots = [
    buildPath(localApp, 'CapCut', 'Apps'),
    buildPath(localApp, 'JianyingPro', 'Apps'),
    buildPath(localApp, 'CapCut', 'User Data', 'Apps'),
    ...['K07VN', 'Khanh', 'Admin', 'User']
      .map((u) => buildPath('C:', 'Users', u, 'AppData', 'Local', 'CapCut', 'Apps'))
      .filter((p) => isDir(p)),
    env.AINOVEL_CAPCUT_APPS || '',
  ].filter(Boolean);

  for (const root of appsRoots) {
    const hits = scanAppsRoot(root);
    if (hits[0]) return hits[0];
  }

  const flat = scanFlatRoots([
    buildPath(localApp, 'CapCut'),
    buildPath(localApp, 'JianyingPro'),
    ...programFiles.map((pf) => buildPath(pf, 'CapCut')),
    ...programFiles.map((pf) => buildPath(pf, 'JianyingPro')),
    buildPath(userProfile, 'CapCut'),
    buildPath('D:', 'CapCut'),
    env.AINOVEL_CAPCUT_DIR || '',
  ].filter(Boolean));

  if (flat[0]) return flat[0];

  try {
    const configPath = buildPath(
      process.cwd(),
      'src',
      'app',
      'api',
      'generate-tts',
      'capcut_api',
      'capcut_windows',
      'config.py',
    );
    if (isFile(configPath)) {
      const txt = fs.readFileSync(configPath, 'utf8');
      const m = txt.match(/SSCRONET_DLL\s*=\s*r?["']([^"']+)["']/);
      if (m?.[1] && isFile(m[1])) {
        return { dllPath: m[1], appDir: path.dirname(m[1]) };
      }
    }
  } catch {
    /* ignore */
  }

  return null;
}

export function capCutDllMissingMessage(searchedHint?: string): string {
  if (!path) return '';
  const buildPath = (...args: string[]) => args.join(path.sep);
  const env = process.env;
  const userProfile = env.USERPROFILE || env.HOME || '';
  const local = env.LOCALAPPDATA || buildPath(userProfile, 'AppData', 'Local');
  return [
    'CapCut TTS: thiếu CapCut/sscronet.dll — cài CapCut Desktop (bản PC), mở app 1 lần, rồi thử lại.',
    `Đường dẫn mong đợi: ${path.join(local, 'CapCut', 'Apps', '<version>', 'sscronet.dll')}`,
    'Hoặc set AINOVEL_CAPCUT_APPS / AINOVEL_CAPCUT_DIR trỏ tới thư mục chứa sscronet.dll.',
    'Không fallback Edge (B10).',
    searchedHint ? `Đã quét: ${searchedHint}` : '',
  ]
    .filter(Boolean)
    .join(' ');
}
