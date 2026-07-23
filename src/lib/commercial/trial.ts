/**
 * One-time trial per HWID — machine-local vault outside portable app folder.
 * Packaged builds prefer cloud trial; local vault is for dev / ALLOW_LOCAL_TRIAL.
 * Survives delete-app + re-extract via machine store + Windows HKCU secondary stamp.
 */

import fs from 'fs';
import { getHwid, issueEntitlementToken } from '@/lib/entitlement';
import {
  ensureParentDir,
  legacyInAppLicenseFile,
  licenseMachineStoreFile,
  migrateLegacyJsonVault,
  readTrialRegStamp,
  writeTrialRegStamp,
} from '@/lib/commercial/licenseMachineStore';

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

const VAULT_FILE = 'trials.json';

function trialDays(): number {
  // Product default 7 days (was 3). Override: AINOVEL_TRIAL_DAYS
  const n = Number(process.env.AINOVEL_TRIAL_DAYS || 7);
  if (!Number.isFinite(n) || n <= 0) return 7;
  return Math.min(30, Math.floor(n));
}

export function isTrialEnabled(): boolean {
  if (
    process.env.AI_NOVEL_PACKAGED === '1' &&
    process.env.AINOVEL_ALLOW_LOCAL_TRIAL !== '1'
  ) {
    return false;
  }
  const v = (process.env.AINOVEL_TRIAL_ENABLED || '1').trim().toLowerCase();
  return !(v === '0' || v === 'false' || v === 'off' || v === 'no');
}

function vaultPath(): string {
  return licenseMachineStoreFile(VAULT_FILE);
}

function isTrialVault(raw: unknown): raw is TrialVault {
  if (!raw || typeof raw !== 'object') return false;
  const v = raw as TrialVault;
  return v.version === 1 && typeof v.trials === 'object' && v.trials != null;
}

/** First-use wins (earlier startedAt); never drop a used HWID. */
function mergeTrialVaults(a: TrialVault, b: TrialVault): TrialVault {
  const trials: Record<string, TrialRecord> = { ...a.trials };
  for (const [id, rec] of Object.entries(b.trials || {})) {
    const cur = trials[id];
    if (!cur) {
      trials[id] = rec;
      continue;
    }
    // Prefer earlier start (true first trial); keep later endsAt if still active longer
    const startedAt = Math.min(cur.startedAt, rec.startedAt);
    const endsAt = Math.max(cur.endsAt, rec.endsAt);
    trials[id] = {
      hwid: id,
      startedAt,
      endsAt,
      plan: 'trial',
    };
  }
  return { version: 1, trials };
}

function loadVault(): TrialVault {
  const vault = migrateLegacyJsonVault<TrialVault>({
    durablePath: vaultPath(),
    legacyPath: legacyInAppLicenseFile(VAULT_FILE),
    isValid: isTrialVault,
    merge: mergeTrialVaults,
    empty: { version: 1, trials: {} },
  });
  return vault;
}

function saveVault(v: TrialVault) {
  const p = vaultPath();
  ensureParentDir(p);
  fs.writeFileSync(p, JSON.stringify(v, null, 2), 'utf8');
}

function resolveRecord(id: string, vault: TrialVault): TrialRecord | null {
  const fromFile = vault.trials[id] || null;
  const fromReg = readTrialRegStamp(id);
  if (!fromFile && !fromReg) return null;
  if (fromFile && !fromReg) return fromFile;
  if (!fromFile && fromReg) {
    // Heal file from registry after portable wipe
    const rec: TrialRecord = {
      hwid: id,
      startedAt: fromReg.startedAt,
      endsAt: fromReg.endsAt,
      plan: 'trial',
    };
    vault.trials[id] = rec;
    try {
      saveVault(vault);
    } catch {
      /* ignore */
    }
    return rec;
  }
  // both: first-use wins
  const startedAt = Math.min(fromFile!.startedAt, fromReg!.startedAt);
  const endsAt = Math.max(fromFile!.endsAt, fromReg!.endsAt);
  return {
    hwid: id,
    startedAt,
    endsAt,
    plan: 'trial',
  };
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
  const rec = resolveRecord(id, vault);
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

/** Issue Ed25519 trial ticket when seller/dev signer is available (gates + UI). */
export function mintTrialTokenIfPossible(
  hwid: string,
  endsAtUnix: number,
): string | null {
  try {
    const now = Math.floor(Date.now() / 1000);
    const expSeconds = Math.max(60, endsAtUnix - now);
    return issueEntitlementToken({
      is_pro: true,
      is_vip: false,
      is_trial: true,
      plan: 'trial',
      hwid: hwid.toLowerCase(),
      expSeconds,
    });
  } catch {
    return null;
  }
}

/** Start trial once per HWID. Second call returns existing (or expired used). */
export function startTrial(hwid?: string): {
  ok: boolean;
  created: boolean;
  status: ReturnType<typeof getTrialStatus>;
  error?: string;
  /** AINOVEL2 trial ticket when private signer available */
  token?: string | null;
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
  const existing = resolveRecord(id, vault);
  if (existing) {
    // Ensure both durable file + reg still hold the stamp after wipe recovery
    vault.trials[id] = existing;
    saveVault(vault);
    writeTrialRegStamp(id, existing.startedAt, existing.endsAt);
    const active = existing.endsAt > Math.floor(Date.now() / 1000);
    return {
      ok: true,
      created: false,
      status: getTrialStatus(id),
      token: active ? mintTrialTokenIfPossible(id, existing.endsAt) : null,
      error: active
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
  writeTrialRegStamp(id, rec.startedAt, rec.endsAt);
  return {
    ok: true,
    created: true,
    status: getTrialStatus(id),
    token: mintTrialTokenIfPossible(id, rec.endsAt),
  };
}

/**
 * Trial grants Pro-equivalent claims for assert path when no paid token.
 * Only used when mode=enforce and no valid paid token.
 */
export function trialGrantsPro(hwid?: string): boolean {
  return getTrialStatus(hwid).active;
}
