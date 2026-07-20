'use client';

/**
 * Free tier UI helpers — caps + daily remaining from commercial status.
 * Server freeQuota remains authority; this is preflight UX only.
 */

import { useCallback, useEffect, useState } from 'react';
import { API } from '@/contracts';
import { useNovelStore } from '@/store/useNovelStore';
import { buildClientApiHeaders } from '../modules/apiClient';
import {
  FREE_LIMITS,
  type FreeQuotaBucket,
  freeChapterCapMessage,
  freeQuotaExhaustedMessage,
  freeWordCapMessage,
  clampFreeChapterCount,
  clampFreeWordGoal,
} from '@/lib/commercial/freeLimitsPolicy';

export type FreeLimitsStatus = {
  applies: boolean;
  maxWordsPerChapter: number;
  maxChapters: number;
  dailyUsesPerFeature: number;
  day: string;
  used: Partial<Record<FreeQuotaBucket, number>>;
  remaining: Partial<Record<FreeQuotaBucket, number>>;
};

const DEFAULT: FreeLimitsStatus = {
  applies: false,
  maxWordsPerChapter: FREE_LIMITS.maxWordsPerChapter,
  maxChapters: FREE_LIMITS.maxChapters,
  dailyUsesPerFeature: FREE_LIMITS.dailyUsesPerFeature,
  day: '',
  used: {},
  remaining: {},
};

/** Store-side free detection (cosmetic; server re-checks). */
export function storeIsFreeTier(flags?: {
  is_pro?: boolean;
  is_trial?: boolean;
  is_vip?: boolean;
}): boolean {
  const s = flags || useNovelStore.getState();
  if (s.is_trial) return false;
  if (s.is_pro || s.is_vip) return false;
  return true;
}

export function useFreeLimits() {
  const is_pro = useNovelStore((s) => s.is_pro);
  const is_trial = useNovelStore((s) => s.is_trial);
  const is_vip = useNovelStore((s) => s.is_vip);
  const storeFree = storeIsFreeTier({ is_pro, is_trial, is_vip });
  const [status, setStatus] = useState<FreeLimitsStatus>({
    ...DEFAULT,
    applies: storeFree,
  });

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(API.commercialStatus, {
        method: 'GET',
        headers: buildClientApiHeaders(),
        cache: 'no-store',
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        tier?: string;
        freeLimits?: Partial<FreeLimitsStatus> & {
          applies?: boolean;
        };
      };
      if (!res.ok || !data.ok) {
        setStatus((prev) => ({ ...prev, applies: storeFree }));
        return;
      }
      const fl = data.freeLimits || {};
      const applies =
        fl.applies === true || data.tier === 'free' || storeFree;
      setStatus({
        applies,
        maxWordsPerChapter:
          Number(fl.maxWordsPerChapter) || FREE_LIMITS.maxWordsPerChapter,
        maxChapters: Number(fl.maxChapters) || FREE_LIMITS.maxChapters,
        dailyUsesPerFeature:
          Number(fl.dailyUsesPerFeature) || FREE_LIMITS.dailyUsesPerFeature,
        day: String(fl.day || ''),
        used: (fl.used || {}) as FreeLimitsStatus['used'],
        remaining: (fl.remaining || {}) as FreeLimitsStatus['remaining'],
      });
    } catch {
      setStatus((prev) => ({ ...prev, applies: storeFree }));
    }
  }, [storeFree]);

  useEffect(() => {
    void refresh();
  }, [refresh, is_pro, is_trial]);

  const remainingOf = useCallback(
    (bucket: FreeQuotaBucket): number => {
      if (!status.applies) return Infinity;
      const r = status.remaining[bucket];
      if (typeof r === 'number') return r;
      return FREE_LIMITS.dailyUsesPerFeature;
    },
    [status],
  );

  const assertCanUse = useCallback(
    (bucket: FreeQuotaBucket): { ok: true } | { ok: false; message: string } => {
      if (!status.applies) return { ok: true };
      const rem = remainingOf(bucket);
      if (rem <= 0) {
        const used =
          status.used[bucket] ?? FREE_LIMITS.dailyUsesPerFeature;
        return {
          ok: false,
          message: freeQuotaExhaustedMessage(
            bucket,
            used,
            FREE_LIMITS.dailyUsesPerFeature,
          ),
        };
      }
      return { ok: true };
    },
    [status, remainingOf],
  );

  const clampSetupForFree = useCallback(
    (so_chuong: number, so_tu_chuong: number) => {
      if (!status.applies && !storeFree) {
        return { so_chuong, so_tu_chuong };
      }
      return {
        so_chuong: clampFreeChapterCount(so_chuong),
        so_tu_chuong: clampFreeWordGoal(so_tu_chuong),
      };
    },
    [status.applies, storeFree],
  );

  const assertCanAddChapter = useCallback(
    (currentCount: number): { ok: true } | { ok: false; message: string } => {
      if (!status.applies && !storeFree) return { ok: true };
      if (currentCount >= FREE_LIMITS.maxChapters) {
        return { ok: false, message: freeChapterCapMessage() };
      }
      return { ok: true };
    },
    [status.applies, storeFree],
  );

  const assertWriteWordGoal = useCallback(
    (goal: number): { ok: true; goal: number } | { ok: false; message: string } => {
      if (!status.applies && !storeFree) return { ok: true, goal };
      if (goal > FREE_LIMITS.maxWordsPerChapter) {
        return { ok: false, message: freeWordCapMessage() };
      }
      return { ok: true, goal: clampFreeWordGoal(goal) };
    },
    [status.applies, storeFree],
  );

  return {
    free: status.applies || storeFree,
    status,
    refresh,
    remainingOf,
    assertCanUse,
    clampSetupForFree,
    assertCanAddChapter,
    assertWriteWordGoal,
    FREE_LIMITS,
  };
}
