/**
 * Free + Trial daily usage vault — HWID + local calendar day.
 * Not a Pro license quota (LICENSE_ONE_PATH rejects Pro request/day metering).
 * Applies when tier === 'free' | 'trial'.
 *
 * Storage: machine store outside portable app folder (survives delete+re-extract)
 * + Windows HKCU secondary stamp for same-day counters.
 */

import fs from 'fs';
import { AppError } from '@/lib/errors';
import { getHwid, resolveRequestAccessAsync } from '@/lib/entitlement';
import {
  FREE_BUCKET_LABELS,
  FREE_LIMITS,
  FREE_QUOTA_BUCKETS,
  TRIAL_LIMITS,
  type FreeQuotaBucket,
  freeChapterCapMessage,
  freeQuotaExhaustedMessage,
  freeWordCapMessage,
  trialChapterCapMessage,
  trialWordCapMessage,
  clampFreeWordGoal,
  clampTrialWordGoal,
  contentWordCeilingForTier,
  countContentWords,
  isFreeChapterOutOfRange,
  isTrialChapterOutOfRange,
  limitsForMeteredTier,
  resolveWriteChapterNum,
} from '@/lib/commercial/freeLimitsPolicy';
import {
  ensureParentDir,
  legacyInAppLicenseFile,
  licenseMachineStoreFile,
  migrateLegacyJsonVault,
  readFreeDayRegStamp,
  writeFreeDayRegStamp,
} from '@/lib/commercial/licenseMachineStore';

type DayBucketCounts = Partial<Record<FreeQuotaBucket, number>>;

type FreeUsageVault = {
  version: 1;
  /** key = `${hwidLower}:${YYYY-MM-DD}` */
  days: Record<string, DayBucketCounts>;
};

export type FreeQuotaSnapshot = {
  applies: boolean;
  tier: string;
  day: string;
  hwid: string;
  limits: {
    maxWordsPerChapter: number;
    maxChapters: number;
    dailyUsesPerFeature: number;
  };
  used: Record<FreeQuotaBucket, number>;
  remaining: Record<FreeQuotaBucket, number>;
};

const VAULT_FILE = 'free-usage.json';

function vaultPath(): string {
  return licenseMachineStoreFile(VAULT_FILE);
}

function isFreeUsageVault(raw: unknown): raw is FreeUsageVault {
  if (!raw || typeof raw !== 'object') return false;
  const v = raw as FreeUsageVault;
  return v.version === 1 && typeof v.days === 'object' && v.days != null;
}

function mergeFreeVaults(a: FreeUsageVault, b: FreeUsageVault): FreeUsageVault {
  const days: Record<string, DayBucketCounts> = { ...a.days };
  for (const [key, counts] of Object.entries(b.days || {})) {
    const cur = { ...(days[key] || {}) };
    for (const [bucket, n] of Object.entries(counts || {})) {
      const prev = Math.max(0, Math.floor(Number(cur[bucket as FreeQuotaBucket]) || 0));
      const next = Math.max(0, Math.floor(Number(n) || 0));
      cur[bucket as FreeQuotaBucket] = Math.max(prev, next);
    }
    days[key] = cur;
  }
  return { version: 1, days };
}

function loadVault(): FreeUsageVault {
  return migrateLegacyJsonVault<FreeUsageVault>({
    durablePath: vaultPath(),
    legacyPath: legacyInAppLicenseFile(VAULT_FILE),
    isValid: isFreeUsageVault,
    merge: mergeFreeVaults,
    empty: { version: 1, days: {} },
  });
}

function saveVault(v: FreeUsageVault) {
  const p = vaultPath();
  ensureParentDir(p);
  // Prune entries older than 14 days to keep file small
  const cutoff = localDayKey(Date.now() - 14 * 86400_000);
  const next: FreeUsageVault = { version: 1, days: {} };
  for (const [k, counts] of Object.entries(v.days)) {
    const day = k.includes(':') ? k.slice(k.lastIndexOf(':') + 1) : '';
    if (!day || day >= cutoff) next.days[k] = counts;
  }
  fs.writeFileSync(p, JSON.stringify(next, null, 2), 'utf8');
}

/** Merge Windows reg secondary into today's row (max counts). */
function applyRegDayStamp(
  hwid: string,
  day: string,
  row: DayBucketCounts,
): DayBucketCounts {
  const stamp = readFreeDayRegStamp(hwid, day);
  if (!stamp) return row;
  const out: DayBucketCounts = { ...row };
  for (const b of FREE_QUOTA_BUCKETS) {
    const fromFile = Math.max(0, Math.floor(Number(out[b]) || 0));
    const fromReg = Math.max(0, Math.floor(Number(stamp[b]) || 0));
    if (fromReg > fromFile) out[b] = fromReg;
  }
  return out;
}

/** Local calendar day YYYY-MM-DD */
export function localDayKey(ms = Date.now()): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function dayRecordKey(hwid: string, day = localDayKey()): string {
  return `${hwid.toLowerCase()}:${day}`;
}

function emptyUsed(): Record<FreeQuotaBucket, number> {
  const o = {} as Record<FreeQuotaBucket, number>;
  for (const b of FREE_QUOTA_BUCKETS) o[b] = 0;
  return o;
}

export function readFreeUsageForHwid(
  hwid?: string,
  dailyLimit: number = FREE_LIMITS.dailyUsesPerFeature,
): {
  day: string;
  used: Record<FreeQuotaBucket, number>;
  remaining: Record<FreeQuotaBucket, number>;
} {
  const id = (hwid || getHwid()).toLowerCase();
  const day = localDayKey();
  const vault = loadVault();
  const row = applyRegDayStamp(
    id,
    day,
    vault.days[dayRecordKey(id, day)] || {},
  );
  const used = emptyUsed();
  const remaining = emptyUsed();
  const limit = Math.max(1, Math.floor(dailyLimit));
  for (const b of FREE_QUOTA_BUCKETS) {
    const u = Math.max(0, Math.floor(Number(row[b]) || 0));
    used[b] = u;
    remaining[b] = Math.max(0, limit - u);
  }
  return { day, used, remaining };
}

/**
 * Whether Free/Trial product limits apply for this request.
 * open / owner / pro → false. free + trial → true.
 */
export async function freeLimitsApply(
  req: Request,
  body?: unknown,
): Promise<{ applies: boolean; tier: string }> {
  const { tier } = await resolveRequestAccessAsync(req, body);
  const applies = tier === 'free' || tier === 'trial';
  return { applies, tier };
}

export async function getFreeQuotaSnapshot(
  req: Request,
  body?: unknown,
): Promise<FreeQuotaSnapshot> {
  const { applies, tier } = await freeLimitsApply(req, body);
  const hwid = getHwid().toLowerCase();
  const limits = limitsForMeteredTier(tier) || {
    maxWordsPerChapter: FREE_LIMITS.maxWordsPerChapter,
    maxChapters: FREE_LIMITS.maxChapters,
    dailyUsesPerFeature: FREE_LIMITS.dailyUsesPerFeature,
  };
  const { day, used, remaining } = readFreeUsageForHwid(
    hwid,
    limits.dailyUsesPerFeature,
  );
  return {
    applies,
    tier,
    day,
    hwid: hwid.toUpperCase(),
    limits,
    used,
    remaining,
  };
}

/**
 * Check + consume one Free/Trial daily use. No-op when Pro / open.
 * Call AFTER validating chapter/word caps for write paths.
 */
export async function assertAndConsumeFreeQuota(
  req: Request,
  bucket: FreeQuotaBucket,
  body?: unknown,
): Promise<{ remaining: number; used: number; day: string } | null> {
  const { applies, tier } = await freeLimitsApply(req, body);
  if (!applies) return null;

  const limits = limitsForMeteredTier(tier);
  if (!limits) return null;

  const hwid = getHwid().toLowerCase();
  const day = localDayKey();
  const key = dayRecordKey(hwid, day);
  const vault = loadVault();
  const row: DayBucketCounts = applyRegDayStamp(hwid, day, {
    ...(vault.days[key] || {}),
  });
  const used = Math.max(0, Math.floor(Number(row[bucket]) || 0));
  const limit = limits.dailyUsesPerFeature;
  const msgTier = tier === 'trial' ? 'trial' : 'free';

  if (used >= limit) {
    throw new AppError(freeQuotaExhaustedMessage(bucket, used, limit, msgTier), {
      code: 'QUOTA',
      status: 429,
      details: {
        freeQuota: true,
        tier: msgTier,
        bucket,
        used,
        limit,
        day,
        label: FREE_BUCKET_LABELS[bucket],
      },
    });
  }

  row[bucket] = used + 1;
  vault.days[key] = row;
  saveVault(vault);
  // Secondary stamp: survives portable wipe on same Windows user
  const flat: Record<string, number> = {};
  for (const b of FREE_QUOTA_BUCKETS) {
    const n = Math.max(0, Math.floor(Number(row[b]) || 0));
    if (n > 0) flat[b] = n;
  }
  writeFreeDayRegStamp(hwid, day, flat);

  const nextUsed = used + 1;
  return {
    used: nextUsed,
    remaining: Math.max(0, limit - nextUsed),
    day,
  };
}

/**
 * Write constraints:
 * - Free: chapter ≤ 2, word goal ≤ 600, content word cap
 * - Trial: chapter ≤ 10, word goal ≤ 3000, content word cap
 */
export async function assertFreeWriteConstraints(
  req: Request,
  payload: Record<string, unknown> | null | undefined,
  body?: unknown,
): Promise<{ wordGoal: number; tier: string; clampWords: boolean } | null> {
  const { applies, tier } = await freeLimitsApply(req, body);
  if (!applies) return null;

  const p = payload || {};
  // WRITE_CHAPTER: chuong_hien_tai is chapter object; top-level so_chuong = planned total.
  const chapterNum = resolveWriteChapterNum(p);

  if (tier === 'trial') {
    if (isTrialChapterOutOfRange(chapterNum)) {
      throw new AppError(trialChapterCapMessage(), {
        code: 'QUOTA',
        status: 403,
        details: {
          freeQuota: true,
          tier: 'trial',
          reason: 'max_chapters',
          maxChapters: TRIAL_LIMITS.maxChapters,
          chapterNum,
        },
      });
    }
    const planned =
      p.so_chuong_ke_hoach ?? p.totalChapters ?? p.chapterCount ?? p.so_chuong_setup;
    if (planned != null && Number(planned) > TRIAL_LIMITS.maxChapters) {
      throw new AppError(trialChapterCapMessage(), {
        code: 'QUOTA',
        status: 403,
        details: {
          freeQuota: true,
          tier: 'trial',
          reason: 'max_chapters_plan',
          maxChapters: TRIAL_LIMITS.maxChapters,
          planned: Number(planned),
        },
      });
    }
    const trialWordGoal = clampTrialWordGoal(
      p.so_tu_chuong ?? p.wordGoal ?? p.targetWords,
    );
    const trialExisting = String(
      p.noi_dung_hien_tai || p.previousContent || '',
    ).trim();
    if (trialExisting) {
      const words = countContentWords(trialExisting);
      // Absolute runaway only — do NOT cut mid-script at soft +20% while still bù cảnh
      const softCeil = contentWordCeilingForTier('trial');
      const hardRunaway = Math.round(TRIAL_LIMITS.maxWordsPerChapter * 1.35);
      const forcing = Boolean(p.force_word_gate_continue);
      if (words >= hardRunaway || (words >= softCeil && !forcing)) {
        throw new AppError(trialWordCapMessage(), {
          code: 'QUOTA',
          status: 403,
          details: {
            freeQuota: true,
            tier: 'trial',
            reason: 'max_words',
            words,
            maxWords: TRIAL_LIMITS.maxWordsPerChapter,
            contentCeiling: softCeil,
            hardRunaway,
          },
        });
      }
    }
    return { wordGoal: trialWordGoal, tier: 'trial', clampWords: true };
  }

  // Free
  if (isFreeChapterOutOfRange(chapterNum)) {
    throw new AppError(freeChapterCapMessage(), {
      code: 'QUOTA',
      status: 403,
      details: {
        freeQuota: true,
        tier: 'free',
        reason: 'max_chapters',
        maxChapters: FREE_LIMITS.maxChapters,
        chapterNum,
      },
    });
  }

  const planned =
    p.so_chuong_ke_hoach ?? p.totalChapters ?? p.chapterCount ?? p.so_chuong_setup;
  if (planned != null && Number(planned) > FREE_LIMITS.maxChapters) {
    throw new AppError(freeChapterCapMessage(), {
      code: 'QUOTA',
      status: 403,
      details: {
        freeQuota: true,
        tier: 'free',
        reason: 'max_chapters_plan',
        maxChapters: FREE_LIMITS.maxChapters,
        planned: Number(planned),
      },
    });
  }

  const freeWordGoal = clampFreeWordGoal(
    p.so_tu_chuong ?? p.wordGoal ?? p.targetWords,
  );
  const freeExisting = String(
    p.noi_dung_hien_tai || p.previousContent || '',
  ).trim();
  if (freeExisting) {
    const words = countContentWords(freeExisting);
    // Soft +20% is NOT mid-script cut; hard runaway = tier×1.35.
    // force_word_gate_continue may still finish scenes past soft ceil.
    const softCeil = contentWordCeilingForTier('free');
    const hardRunaway = Math.round(FREE_LIMITS.maxWordsPerChapter * 1.35);
    const forcing = Boolean(p.force_word_gate_continue);
    if (words >= hardRunaway || (words >= softCeil && !forcing)) {
      throw new AppError(freeWordCapMessage(), {
        code: 'QUOTA',
        status: 403,
        details: {
          freeQuota: true,
          tier: 'free',
          reason: 'max_words',
          words,
          maxWords: FREE_LIMITS.maxWordsPerChapter,
          contentCeiling: softCeil,
          hardRunaway,
        },
      });
    }
  }

  return { wordGoal: freeWordGoal, tier: 'free', clampWords: true };
}

/** Mutate payload so Free/Trial write respects word goal (cap already applied) */
export function applyFreeWordGoalToPayload(
  payload: Record<string, unknown>,
  wordGoal: number,
): void {
  payload.so_tu_chuong = wordGoal;
  payload.wordGoal = wordGoal;
  payload.targetWords = wordGoal;
  // Do NOT clear force_word_gate_continue — needed to finish full chapter (scenes/floor)
}

/** Outline / setup: clamp so_chuong in payload for Free / Trial */
export async function assertFreeOutlineConstraints(
  req: Request,
  payload: Record<string, unknown> | null | undefined,
  body?: unknown,
): Promise<null> {
  const { applies, tier } = await freeLimitsApply(req, body);
  if (!applies) return null;
  const p = payload || {};
  const n = Number(p.so_chuong ?? p.chapterCount ?? p.so_chuong_moi_cung ?? 0);
  const maxCh =
    tier === 'trial' ? TRIAL_LIMITS.maxChapters : FREE_LIMITS.maxChapters;
  if (Number.isFinite(n) && n > maxCh) {
    throw new AppError(
      tier === 'trial' ? trialChapterCapMessage() : freeChapterCapMessage(),
      {
        code: 'QUOTA',
        status: 403,
        details: {
          freeQuota: true,
          tier,
          reason: 'max_chapters_outline',
          maxChapters: maxCh,
          requested: n,
        },
      },
    );
  }
  return null;
}
