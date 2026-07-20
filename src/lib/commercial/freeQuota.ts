/**
 * Free-tier daily usage vault — server source of truth (HWID + local calendar day).
 * Not a Pro license quota (LICENSE_ONE_PATH rejects Pro request/day metering).
 * Only applies when resolveRequestAccessAsync → tier === 'free'.
 */

import fs from 'fs';
import path from 'path';
import { AppError } from '@/lib/errors';
import { getHwid, resolveRequestAccessAsync } from '@/lib/entitlement';
import {
  FREE_BUCKET_LABELS,
  FREE_LIMITS,
  FREE_QUOTA_BUCKETS,
  type FreeQuotaBucket,
  freeChapterCapMessage,
  freeQuotaExhaustedMessage,
  freeWordCapMessage,
  clampFreeWordGoal,
  countContentWords,
  isFreeChapterOutOfRange,
} from '@/lib/commercial/freeLimitsPolicy';

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
  limits: typeof FREE_LIMITS;
  used: Record<FreeQuotaBucket, number>;
  remaining: Record<FreeQuotaBucket, number>;
};

function vaultPath(): string {
  const root =
    process.env.AI_NOVEL_ROOT ||
    process.env.AINOVEL_DATA_ROOT ||
    process.cwd();
  return path.join(root, 'data', 'licenses', 'free-usage.json');
}

function ensureDir(file: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

function loadVault(): FreeUsageVault {
  const p = vaultPath();
  try {
    if (!fs.existsSync(p)) return { version: 1, days: {} };
    const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as FreeUsageVault;
    if (!raw || raw.version !== 1 || typeof raw.days !== 'object' || !raw.days) {
      return { version: 1, days: {} };
    }
    return raw;
  } catch {
    return { version: 1, days: {} };
  }
}

function saveVault(v: FreeUsageVault) {
  const p = vaultPath();
  ensureDir(p);
  // Prune entries older than 14 days to keep file small
  const cutoff = localDayKey(Date.now() - 14 * 86400_000);
  const next: FreeUsageVault = { version: 1, days: {} };
  for (const [k, counts] of Object.entries(v.days)) {
    const day = k.includes(':') ? k.slice(k.lastIndexOf(':') + 1) : '';
    if (!day || day >= cutoff) next.days[k] = counts;
  }
  fs.writeFileSync(p, JSON.stringify(next, null, 2), 'utf8');
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

export function readFreeUsageForHwid(hwid?: string): {
  day: string;
  used: Record<FreeQuotaBucket, number>;
  remaining: Record<FreeQuotaBucket, number>;
} {
  const id = (hwid || getHwid()).toLowerCase();
  const day = localDayKey();
  const vault = loadVault();
  const row = vault.days[dayRecordKey(id, day)] || {};
  const used = emptyUsed();
  const remaining = emptyUsed();
  for (const b of FREE_QUOTA_BUCKETS) {
    const u = Math.max(0, Math.floor(Number(row[b]) || 0));
    used[b] = u;
    remaining[b] = Math.max(0, FREE_LIMITS.dailyUsesPerFeature - u);
  }
  return { day, used, remaining };
}

/**
 * Whether Free product limits apply for this request.
 * open / owner / trial / pro → false.
 */
export async function freeLimitsApply(
  req: Request,
  body?: unknown,
): Promise<{ applies: boolean; tier: string }> {
  const { tier } = await resolveRequestAccessAsync(req, body);
  return { applies: tier === 'free', tier };
}

export async function getFreeQuotaSnapshot(
  req: Request,
  body?: unknown,
): Promise<FreeQuotaSnapshot> {
  const { applies, tier } = await freeLimitsApply(req, body);
  const hwid = getHwid().toLowerCase();
  const { day, used, remaining } = readFreeUsageForHwid(hwid);
  return {
    applies,
    tier,
    day,
    hwid: hwid.toUpperCase(),
    limits: FREE_LIMITS,
    used,
    remaining,
  };
}

/**
 * Check + consume one Free daily use. No-op when not Free tier.
 * Call AFTER validating chapter/word caps for write paths.
 */
export async function assertAndConsumeFreeQuota(
  req: Request,
  bucket: FreeQuotaBucket,
  body?: unknown,
): Promise<{ remaining: number; used: number; day: string } | null> {
  const { applies } = await freeLimitsApply(req, body);
  if (!applies) return null;

  const hwid = getHwid().toLowerCase();
  const day = localDayKey();
  const key = dayRecordKey(hwid, day);
  const vault = loadVault();
  const row: DayBucketCounts = { ...(vault.days[key] || {}) };
  const used = Math.max(0, Math.floor(Number(row[bucket]) || 0));
  const limit = FREE_LIMITS.dailyUsesPerFeature;

  if (used >= limit) {
    throw new AppError(freeQuotaExhaustedMessage(bucket, used, limit), {
      code: 'QUOTA',
      status: 429,
      details: {
        freeQuota: true,
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

  const nextUsed = used + 1;
  return {
    used: nextUsed,
    remaining: Math.max(0, limit - nextUsed),
    day,
  };
}

/**
 * Free write constraints: chapter index ≤ 2, word goal ≤ 600,
 * existing content must not already exceed word cap when continuing.
 */
export async function assertFreeWriteConstraints(
  req: Request,
  payload: Record<string, unknown> | null | undefined,
  body?: unknown,
): Promise<{ wordGoal: number } | null> {
  const { applies } = await freeLimitsApply(req, body);
  if (!applies) return null;

  const p = payload || {};
  const chapterNum =
    p.chuong_hien_tai ?? p.so_chuong ?? p.chapterNum ?? p.chapter ?? 1;
  if (isFreeChapterOutOfRange(chapterNum)) {
    throw new AppError(freeChapterCapMessage(), {
      code: 'QUOTA',
      status: 403,
      details: {
        freeQuota: true,
        reason: 'max_chapters',
        maxChapters: FREE_LIMITS.maxChapters,
        chapterNum: Number(chapterNum),
      },
    });
  }

  // Optional: total planned chapters / list length if client sends them
  const planned =
    p.so_chuong_ke_hoach ?? p.totalChapters ?? p.chapterCount ?? p.so_chuong_setup;
  if (planned != null && Number(planned) > FREE_LIMITS.maxChapters) {
    throw new AppError(freeChapterCapMessage(), {
      code: 'QUOTA',
      status: 403,
      details: {
        freeQuota: true,
        reason: 'max_chapters_plan',
        maxChapters: FREE_LIMITS.maxChapters,
        planned: Number(planned),
      },
    });
  }

  const wordGoal = clampFreeWordGoal(p.so_tu_chuong ?? p.wordGoal ?? p.targetWords);
  const existing = String(p.noi_dung_hien_tai || p.previousContent || '').trim();
  if (existing) {
    const words = countContentWords(existing);
    if (words >= FREE_LIMITS.maxWordsPerChapter) {
      throw new AppError(freeWordCapMessage(), {
        code: 'QUOTA',
        status: 403,
        details: {
          freeQuota: true,
          reason: 'max_words',
          words,
          maxWords: FREE_LIMITS.maxWordsPerChapter,
        },
      });
    }
  }

  return { wordGoal };
}

/** Mutate payload so Free write never asks LLM for >600 words */
export function applyFreeWordGoalToPayload(
  payload: Record<string, unknown>,
  wordGoal: number,
): void {
  payload.so_tu_chuong = wordGoal;
  payload.wordGoal = wordGoal;
  payload.targetWords = wordGoal;
  // Free: no endless word-gate continue past cap
  if (payload.force_word_gate_continue) {
    payload.force_word_gate_continue = false;
  }
}

/** Outline / setup: clamp so_chuong in payload for Free */
export async function assertFreeOutlineConstraints(
  req: Request,
  payload: Record<string, unknown> | null | undefined,
  body?: unknown,
): Promise<null> {
  const { applies } = await freeLimitsApply(req, body);
  if (!applies) return null;
  const p = payload || {};
  const n = Number(p.so_chuong ?? p.chapterCount ?? p.so_chuong_moi_cung ?? 0);
  if (Number.isFinite(n) && n > FREE_LIMITS.maxChapters) {
    throw new AppError(freeChapterCapMessage(), {
      code: 'QUOTA',
      status: 403,
      details: {
        freeQuota: true,
        reason: 'max_chapters_outline',
        maxChapters: FREE_LIMITS.maxChapters,
        requested: n,
      },
    });
  }
  return null;
}
