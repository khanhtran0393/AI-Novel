/**
 * Machine-local commercial vaults that survive portable wipe / re-extract.
 *
 * Priority (same family as hwidRebind / seatPresence):
 *   1. AI_NOVEL_USER_DATA  — Electron sets to app.getPath('userData')
 *   2. AINOVEL_DATA_ROOT   — tests / seller override
 *   3. ~/.ainovel-license  — fallback when not under Electron
 *
 * NEVER use AI_NOVEL_ROOT / process.cwd() for free-quota or local trial —
 * those live inside the portable folder and reset when the user deletes the app.
 *
 * Seller-only vaults (activation-codes, seller-orders) stay under app data root.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';

const STORE_DIR_NAME = '.ainovel-license';

/** Durable root outside the portable app tree. */
export function licenseMachineStoreDir(): string {
  const userData = (process.env.AI_NOVEL_USER_DATA || '').trim();
  const dataRoot = (process.env.AINOVEL_DATA_ROOT || '').trim();

  // Electron: nest under userData so wipe-portable keeps stamps; seller tests use DATA_ROOT flat.
  if (userData) {
    const nested = path.join(userData, STORE_DIR_NAME);
    try {
      fs.mkdirSync(nested, { recursive: true });
    } catch {
      /* ignore */
    }
    return nested;
  }
  if (dataRoot) {
    try {
      fs.mkdirSync(dataRoot, { recursive: true });
    } catch {
      /* ignore */
    }
    return dataRoot;
  }
  const home = path.join(os.homedir(), STORE_DIR_NAME);
  try {
    fs.mkdirSync(home, { recursive: true });
  } catch {
    /* ignore */
  }
  return home;
}

export function licenseMachineStoreFile(fileName: string): string {
  return path.join(licenseMachineStoreDir(), fileName);
}

/**
 * Legacy path inside app/portable tree (reset when folder deleted).
 * Used only for one-shot migration into the machine store.
 */
export function legacyInAppLicenseFile(fileName: string): string {
  const root =
    (process.env.AI_NOVEL_ROOT || '').trim() ||
    (process.env.AINOVEL_DATA_ROOT || '').trim() ||
    process.cwd();
  return path.join(root, 'data', 'licenses', fileName);
}

export function ensureParentDir(filePath: string): void {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  } catch {
    /* ignore */
  }
}

function readJsonFile(filePath: string): unknown | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

/**
 * If durable file missing/empty and legacy exists → copy (or merge via callback).
 * After successful write, leave legacy in place (read-only archive); do not delete
 * (seller may still inspect; wipe-portable will drop it anyway).
 */
export function migrateLegacyJsonVault<T extends object>(options: {
  durablePath: string;
  legacyPath: string;
  isValid: (raw: unknown) => raw is T;
  /** When both exist, combine (e.g. max counters / first trial wins). */
  merge?: (durable: T, legacy: T) => T;
  empty: T;
}): T {
  const durableRaw = readJsonFile(options.durablePath);
  const legacyRaw =
    options.legacyPath !== options.durablePath
      ? readJsonFile(options.legacyPath)
      : null;

  const durableOk =
    durableRaw != null && options.isValid(durableRaw) ? durableRaw : null;
  const legacyOk =
    legacyRaw != null && options.isValid(legacyRaw) ? legacyRaw : null;

  if (durableOk && legacyOk && options.merge) {
    const merged = options.merge(durableOk, legacyOk);
    try {
      ensureParentDir(options.durablePath);
      fs.writeFileSync(
        options.durablePath,
        JSON.stringify(merged, null, 2),
        'utf8',
      );
    } catch {
      /* ignore */
    }
    return merged;
  }

  if (durableOk) return durableOk;

  if (legacyOk) {
    try {
      ensureParentDir(options.durablePath);
      fs.writeFileSync(
        options.durablePath,
        JSON.stringify(legacyOk, null, 2),
        'utf8',
      );
    } catch {
      /* ignore */
    }
    return legacyOk;
  }

  return options.empty;
}

/** Windows HKCU stamp — survives folder wipe; soft secondary for trial used. */
const WIN_REG_KEY = 'HKCU\\Software\\AiNovel\\MachineStore';

/**
 * HKCU secondary is for real customer machines.
 * Skip when isolated AINOVEL_DATA_ROOT-only (smokes) so real HWID reg is not polluted.
 * Force: AINOVEL_MACHINE_REG=1|0
 */
export function machineRegEnabled(): boolean {
  const force = (process.env.AINOVEL_MACHINE_REG || '').trim().toLowerCase();
  if (force === '0' || force === 'false' || force === 'off') return false;
  if (force === '1' || force === 'true' || force === 'on') return true;
  if (process.platform !== 'win32') return false;
  // Electron / real user profile
  if ((process.env.AI_NOVEL_USER_DATA || '').trim()) return true;
  // Isolated test root without userData → no HKCU
  if ((process.env.AINOVEL_DATA_ROOT || '').trim()) return false;
  return true;
}

export function windowsRegReadValue(name: string): string {
  if (!machineRegEnabled()) return '';
  try {
    // 2>nul: missing key is expected before first stamp (no console noise)
    const out = execSync(
      `cmd /d /c reg query "${WIN_REG_KEY}" /v ${name} 2>nul`,
      {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 5_000,
      },
    );
    const m = out.match(new RegExp(`${name}\\s+REG_SZ\\s+(.+)`, 'i'));
    return (m?.[1] || '').trim();
  } catch {
    return '';
  }
}

export function windowsRegWriteValue(name: string, value: string): void {
  if (!machineRegEnabled()) return;
  const safeName = String(name).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64);
  // Escape for cmd: wrap value, strip dangerous chars
  const safeVal = String(value)
    .replace(/[\r\n"]/g, '')
    .slice(0, 2000);
  try {
    execSync(
      `cmd /d /c reg add "${WIN_REG_KEY}" /v ${safeName} /t REG_SZ /d "${safeVal}" /f >nul 2>nul`,
      { encoding: 'utf8', windowsHide: true, timeout: 5_000 },
    );
  } catch {
    /* ignore — optional secondary */
  }
}

/**
 * Compact trial stamp: "startedAt:endsAt" under name trial_<hwid16>.
 * Used when trials.json was wiped with portable folder but same Windows user.
 */
export function readTrialRegStamp(hwid: string): {
  startedAt: number;
  endsAt: number;
} | null {
  const id = hwid.toLowerCase().replace(/[^a-f0-9]/g, '').slice(0, 16);
  if (!id) return null;
  const raw = windowsRegReadValue(`trial_${id}`);
  if (!raw) return null;
  const [a, b] = raw.split(':');
  const startedAt = Number(a);
  const endsAt = Number(b);
  if (!Number.isFinite(startedAt) || !Number.isFinite(endsAt) || endsAt <= 0) {
    return null;
  }
  return { startedAt, endsAt };
}

export function writeTrialRegStamp(
  hwid: string,
  startedAt: number,
  endsAt: number,
): void {
  const id = hwid.toLowerCase().replace(/[^a-f0-9]/g, '').slice(0, 16);
  if (!id) return;
  windowsRegWriteValue(`trial_${id}`, `${startedAt}:${endsAt}`);
}

/**
 * Free-day stamp: free_<hwid8>_<YYYYMMDD> = compact "bucket:count,..."
 * Survives portable wipe for the same Windows user + calendar day.
 */
export function readFreeDayRegStamp(
  hwid: string,
  day: string,
): Record<string, number> | null {
  const id = hwid.toLowerCase().replace(/[^a-f0-9]/g, '').slice(0, 8);
  const dayKey = day.replace(/-/g, '');
  if (!id || !dayKey) return null;
  const raw = windowsRegReadValue(`free_${id}_${dayKey}`);
  if (!raw) return null;
  const out: Record<string, number> = {};
  for (const part of raw.split(',')) {
    const [k, v] = part.split(':');
    if (!k) continue;
    const n = Math.max(0, Math.floor(Number(v) || 0));
    if (n > 0) out[k] = n;
  }
  return Object.keys(out).length ? out : null;
}

export function writeFreeDayRegStamp(
  hwid: string,
  day: string,
  counts: Record<string, number>,
): void {
  const id = hwid.toLowerCase().replace(/[^a-f0-9]/g, '').slice(0, 8);
  const dayKey = day.replace(/-/g, '');
  if (!id || !dayKey) return;
  const parts = Object.entries(counts)
    .filter(([, n]) => Number(n) > 0)
    .map(([k, n]) => `${k}:${Math.floor(Number(n))}`);
  if (!parts.length) return;
  windowsRegWriteValue(`free_${id}_${dayKey}`, parts.join(',').slice(0, 500));
}
