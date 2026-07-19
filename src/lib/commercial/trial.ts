/**
 * One-time trial per HWID — file-backed vault under data/licenses/trials.json
 * Server is source of truth; client only displays.
 */

import fs from 'fs';
import path from 'path';
import { getHwid } from '@/lib/entitlement';

export type TrialRecord = {
  hwid: string;
  startedAt: number; // unix sec
  endsAt: number;
  plan: 'trial';
};

type TrialVault = {
  version: 1;
  trials: Record<string, TrialRecord>;
};

function trialDays(): number {
  const n = Number(process.env.AINOVEL_TRIAL_DAYS || 3);
  if (!Number.isFinite(n) || n <= 0) return 3;
  return Math.min(30, Math.floor(n));
}

export function isTrialEnabled(): boolean {
  const v = (process.env.AINOVEL_TRIAL_ENABLED || '1').trim().toLowerCase();
  return !(v === '0' || v === 'false' || v === 'off' || v === 'no');
}

function vaultPath(): string {
  const root =
    process.env.AI_NOVEL_ROOT ||
    process.env.AINOVEL_DATA_ROOT ||
    process.cwd();
  return path.join(root, 'data', 'licenses', 'trials.json');
}

function ensureDir(file: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

function loadVault(): TrialVault {
  const p = vaultPath();
  try {
    if (!fs.existsSync(p)) return { version: 1, trials: {} };
    const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as TrialVault;
    if (!raw || raw.version !== 1 || typeof raw.trials !== 'object') {
      return { version: 1, trials: {} };
    }
    return raw;
  } catch {
    return { version: 1, trials: {} };
  }
}

function saveVault(v: TrialVault) {
  const p = vaultPath();
  ensureDir(p);
  fs.writeFileSync(p, JSON.stringify(v, null, 2), 'utf8');
}

export function getTrialStatus(hwid?: string): {
  enabled: boolean;
  active: boolean;
  used: boolean;
  record: TrialRecord | null;
  days: number;
  hwid: string;
} {
  const id = (hwid || getHwid()).toLowerCase();
  const enabled = isTrialEnabled();
  const days = trialDays();
  if (!enabled) {
    return { enabled: false, active: false, used: false, record: null, days, hwid: id };
  }
  const vault = loadVault();
  const rec = vault.trials[id] || null;
  const now = Math.floor(Date.now() / 1000);
  if (!rec) {
    return { enabled: true, active: false, used: false, record: null, days, hwid: id };
  }
  const active = rec.endsAt > now;
  return {
    enabled: true,
    active,
    used: true,
    record: rec,
    days,
    hwid: id,
  };
}

/** Start trial once per HWID. Second call returns existing (or expired used). */
export function startTrial(hwid?: string): {
  ok: boolean;
  created: boolean;
  status: ReturnType<typeof getTrialStatus>;
  error?: string;
} {
  if (!isTrialEnabled()) {
    return {
      ok: false,
      created: false,
      status: getTrialStatus(hwid),
      error: 'Trial đang tắt (AINOVEL_TRIAL_ENABLED=0).',
    };
  }
  const id = (hwid || getHwid()).toLowerCase();
  const vault = loadVault();
  const existing = vault.trials[id];
  if (existing) {
    return {
      ok: true,
      created: false,
      status: getTrialStatus(id),
      error:
        existing.endsAt > Math.floor(Date.now() / 1000)
          ? undefined
          : 'Máy này đã dùng trial (hết hạn). Mua Pro để tiếp tục.',
    };
  }
  const now = Math.floor(Date.now() / 1000);
  const rec: TrialRecord = {
    hwid: id,
    startedAt: now,
    endsAt: now + trialDays() * 86400,
    plan: 'trial',
  };
  vault.trials[id] = rec;
  saveVault(vault);
  return { ok: true, created: true, status: getTrialStatus(id) };
}

/**
 * Trial grants Pro-equivalent claims for assert path when no paid token.
 * Only used when mode=enforce and no valid paid token.
 */
export function trialGrantsPro(hwid?: string): boolean {
  return getTrialStatus(hwid).active;
}
