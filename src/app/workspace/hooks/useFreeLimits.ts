'use client';

/**
 * Free + Trial UI helpers — caps + daily remaining from commercial status.
 * Server freeQuota remains authority; this is preflight UX only.
 * Free caps unchanged; Trial: 5/day, max 10 chapters, no word cap.
 */

import { useCallback, useEffect, useState } from 'react';
import { API } from '@/contracts';
import { useNovelStore } from '@/store/useNovelStore';
import { buildClientApiHeaders } from '../modules/apiClient';
import {
  FREE_LIMITS,
  TRIAL_LIMITS,
  type FreeQuotaBucket,
  freeChapterCapMessage,
  freeQuotaExhaustedMessage,
  freeWordCapMessage,
  trialChapterCapMessage,
  clampFreeChapterCount,
  clampFreeWordGoal,
  clampTrialChapterCount,
  clampTrialWordGoal,
  trialWordCapMessage,
} from '@/lib/commercial/freeLimitsPolicy';

export type FreeLimitsStatus = {
  applies: boolean;
  tier: 'free' | 'trial' | 'pro' | string;
  maxWordsPerChapter: number;
  maxChapters: number;
  dailyUsesPerFeature: number;
  day: string;
  used: Partial<Record<FreeQuotaBucket, number>>;
  remaining: Partial<Record<FreeQuotaBucket, number>>;
};

const DEFAULT: FreeLimitsStatus = {
  applies: false,
  tier: 'free',
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

export function storeIsTrialTier(flags?: {
  is_pro?: boolean;
  is_trial?: boolean;
}): boolean {
  const s = flags || useNovelStore.getState();
  return !!s.is_trial;
}

export function useFreeLimits() {
  const is_pro = useNovelStore((s) => s.is_pro);
  const is_trial = useNovelStore((s) => s.is_trial);
  const is_vip = useNovelStore((s) => s.is_vip);
  const storeFree = storeIsFreeTier({ is_pro, is_trial, is_vip });
  const storeTrial = storeIsTrialTier({ is_pro, is_trial });
  const [status, setStatus] = useState<FreeLimitsStatus>({
    ...DEFAULT,
    applies: storeFree || storeTrial,
    tier: storeTrial ? 'trial' : storeFree ? 'free' : 'pro',
    ...(storeTrial
      ? {
          maxWordsPerChapter: TRIAL_LIMITS.maxWordsPerChapter,
          maxChapters: TRIAL_LIMITS.maxChapters,
          dailyUsesPerFeature: TRIAL_LIMITS.dailyUsesPerFeature,
        }
      : {}),
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
          tier?: string;
        };
      };
      if (!res.ok || !data.ok) {
        setStatus((prev) => ({
          ...prev,
          applies: storeFree || storeTrial,
          tier: storeTrial ? 'trial' : storeFree ? 'free' : 'pro',
        }));
        return;
      }
      const fl = data.freeLimits || {};
      const tier = String(fl.tier || data.tier || (storeTrial ? 'trial' : 'free'));
      const applies =
        fl.applies === true ||
        tier === 'free' ||
        tier === 'trial' ||
        storeFree ||
        storeTrial;
      const isTrial = tier === 'trial' || storeTrial;
      setStatus({
        applies,
        tier,
        maxWordsPerChapter: isTrial
          ? Number(fl.maxWordsPerChapter) || TRIAL_LIMITS.maxWordsPerChapter
          : Number(fl.maxWordsPerChapter) || FREE_LIMITS.maxWordsPerChapter,
        maxChapters: isTrial
          ? Number(fl.maxChapters) || TRIAL_LIMITS.maxChapters
          : Number(fl.maxChapters) || FREE_LIMITS.maxChapters,
        dailyUsesPerFeature: isTrial
          ? Number(fl.dailyUsesPerFeature) || TRIAL_LIMITS.dailyUsesPerFeature
          : Number(fl.dailyUsesPerFeature) || FREE_LIMITS.dailyUsesPerFeature,
        day: String(fl.day || ''),
        used: (fl.used || {}) as FreeLimitsStatus['used'],
        remaining: (fl.remaining || {}) as FreeLimitsStatus['remaining'],
      });
    } catch {
      setStatus((prev) => ({
        ...prev,
        applies: storeFree || storeTrial,
        tier: storeTrial ? 'trial' : storeFree ? 'free' : 'pro',
      }));
    }
  }, [storeFree, storeTrial]);

  useEffect(() => {
    void refresh();
  }, [refresh, is_pro, is_trial]);

  const remainingOf = useCallback(
    (bucket: FreeQuotaBucket): number => {
      if (!status.applies) return Infinity;
      const r = status.remaining[bucket];
      if (typeof r === 'number') return r;
      return status.dailyUsesPerFeature;
    },
    [status],
  );

  const assertCanUse = useCallback(
    (bucket: FreeQuotaBucket): { ok: true } | { ok: false; message: string } => {
      if (!status.applies) return { ok: true };
      const rem = remainingOf(bucket);
      if (rem <= 0) {
        const used = status.used[bucket] ?? status.dailyUsesPerFeature;
        const msgTier = status.tier === 'trial' ? 'trial' : 'free';
        return {
          ok: false,
          message: freeQuotaExhaustedMessage(
            bucket,
            used,
            status.dailyUsesPerFeature,
            msgTier,
          ),
        };
      }
      return { ok: true };
    },
    [status, remainingOf],
  );

  const clampSetupForFree = useCallback(
    (so_chuong: number, so_tu_chuong: number) => {
      if (status.tier === 'trial' || storeTrial) {
        return {
          so_chuong: clampTrialChapterCount(so_chuong),
          so_tu_chuong: clampTrialWordGoal(so_tu_chuong),
        };
      }
      if (!status.applies && !storeFree) {
        return { so_chuong, so_tu_chuong };
      }
      return {
        so_chuong: clampFreeChapterCount(so_chuong),
        so_tu_chuong: clampFreeWordGoal(so_tu_chuong),
      };
    },
    [status.applies, status.tier, storeFree, storeTrial],
  );

  const assertCanAddChapter = useCallback(
    (currentCount: number): { ok: true } | { ok: false; message: string } => {
      if (status.tier === 'trial' || storeTrial) {
        if (currentCount >= TRIAL_LIMITS.maxChapters) {
          return { ok: false, message: trialChapterCapMessage() };
        }
        return { ok: true };
      }
      if (!status.applies && !storeFree) return { ok: true };
      if (currentCount >= FREE_LIMITS.maxChapters) {
        return { ok: false, message: freeChapterCapMessage() };
      }
      return { ok: true };
    },
    [status.applies, status.tier, storeFree, storeTrial],
  );

  const assertWriteWordGoal = useCallback(
    (goal: number): { ok: true; goal: number } | { ok: false; message: string } => {
      if (status.tier === 'trial' || storeTrial) {
        if (goal > TRIAL_LIMITS.maxWordsPerChapter) {
          return { ok: false, message: trialWordCapMessage() };
        }
        return { ok: true, goal: clampTrialWordGoal(goal) };
      }
      if (!status.applies && !storeFree) return { ok: true, goal };
      if (goal > FREE_LIMITS.maxWordsPerChapter) {
        return { ok: false, message: freeWordCapMessage() };
      }
      return { ok: true, goal: clampFreeWordGoal(goal) };
    },
    [status.applies, status.tier, storeFree, storeTrial],
  );

  return {
    free: (status.applies && status.tier === 'free') || storeFree,
    trial: (status.applies && status.tier === 'trial') || storeTrial,
    metered: status.applies || storeFree || storeTrial,
    status,
    refresh,
    remainingOf,
    assertCanUse,
    clampSetupForFree,
    assertCanAddChapter,
    assertWriteWordGoal,
    FREE_LIMITS,
    TRIAL_LIMITS,
  };
}
