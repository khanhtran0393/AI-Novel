/**
 * OPEN daily usage vault — app is free for every user, no daily metering.
 * All functions kept for API-compat; they no-op / report no limits.
 */

import type { FreeQuotaBucket } from '@/lib/commercial/freeLimitsPolicy';
import { FREE_LIMITS, FREE_QUOTA_BUCKETS } from '@/lib/commercial/freeLimitsPolicy';

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

/** Local calendar day YYYY-MM-DD */
export function localDayKey(ms = Date.now()): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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
  return { day: localDayKey(), used: emptyUsed(), remaining: emptyUsed() };
}

/**
 * Whether Free/Trial product limits apply — always false (app open).
 */
export async function freeLimitsApply(
  req: Request,
  body?: unknown,
): Promise<{ applies: boolean; tier: string }> {
  return { applies: false, tier: 'pro' };
}

export async function getFreeQuotaSnapshot(
  req: Request,
  body?: unknown,
): Promise<FreeQuotaSnapshot> {
  const used = emptyUsed();
  const remaining = emptyUsed();
  return {
    applies: false,
    tier: 'pro',
    day: localDayKey(),
    hwid: 'OPEN',
    limits: {
      maxWordsPerChapter: FREE_LIMITS.maxWordsPerChapter,
      maxChapters: FREE_LIMITS.maxChapters,
      dailyUsesPerFeature: FREE_LIMITS.dailyUsesPerFeature,
    },
    used,
    remaining,
  };
}

/**
 * Check + consume one Free/Trial daily use — OPEN no-op, always allowed.
 */
export async function assertAndConsumeFreeQuota(
  req: Request,
  bucket: FreeQuotaBucket,
  body?: unknown,
): Promise<{ remaining: number; used: number; day: string } | null> {
  return null;
}

/**
 * Write constraints — OPEN no-op, always allowed (no word/chapter caps).
 */
export async function assertFreeWriteConstraints(
  req: Request,
  payload: Record<string, unknown> | null | undefined,
  body?: unknown,
): Promise<{ wordGoal: number; tier: string; clampWords: boolean } | null> {
  return null;
}

/** Mutate payload so Free/Trial write respects word goal (kept for compat). */
export function applyFreeWordGoalToPayload(
  payload: Record<string, unknown>,
  wordGoal: number,
): void {
  // No-op — app open, no clamping.
}

/** Outline / setup: clamp so_chuong — OPEN no-op, always allowed. */
export async function assertFreeOutlineConstraints(
  req: Request,
  payload: Record<string, unknown> | null | undefined,
  body?: unknown,
): Promise<null> {
  return null;
}
