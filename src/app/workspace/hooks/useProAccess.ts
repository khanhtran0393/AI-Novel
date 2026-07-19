'use client';

/**
 * UI Pro gate helpers — feature matrix + store plan.
 */
import { useMemo } from 'react';
import { useNovelStore } from '@/store/useNovelStore';
import {
  canAccessFeature,
  resolvePlanTier,
  type CommercialFeatureId,
  type PlanTier,
} from '@/lib/commercial/featureMatrix';

export function useProAccess() {
  const is_pro = useNovelStore((s) => s.is_pro);
  const is_vip = useNovelStore((s) => s.is_vip);
  const is_trial = useNovelStore((s) => s.is_trial);
  const credits = useNovelStore((s) => s.credits);

  const tier: PlanTier = useMemo(
    () =>
      resolvePlanTier({
        // Paid Pro only when not on trial (trial stores is_pro for feature unlock)
        is_pro: is_pro && !is_trial,
        is_vip,
        trialActive: is_trial,
      }),
    [is_pro, is_vip, is_trial],
  );

  /** Trial | Pro | VIP — mở gate Pro-equivalent (video/CapCut/ship…) */
  const isProEquivalent = is_pro || is_vip || is_trial;

  const can = (feature: CommercialFeatureId) => canAccessFeature(tier, feature);

  const requirePro = (feature: CommercialFeatureId): { ok: boolean; message: string } => {
    if (can(feature)) return { ok: true, message: '' };
    return {
      ok: false,
      message: `Tính năng «${feature}» cần Pro/Trial. Nhấp logo app (up to PRO) để mở Bản quyền / kích hoạt.`,
    };
  };

  return {
    tier,
    is_pro,
    is_vip,
    is_trial,
    isProEquivalent,
    credits,
    can,
    requirePro,
  };
}
