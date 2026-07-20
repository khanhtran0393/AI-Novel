'use client';

/**
 * UI Pro gate helpers — feature matrix + store plan.
 */
import { useMemo } from 'react';
import { useNovelStore } from '@/store/useNovelStore';
import {
  canAccessFeature,
  storeFlagsToTier,
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
      storeFlagsToTier({
        is_pro,
        is_vip,
        is_trial,
      }),
    [is_pro, is_vip, is_trial],
  );

  /** Trial | Pro — coarse unlock (video/CapCut/ship…); is_vip chỉ là dữ liệu legacy. */
  const isProEquivalent = is_pro || is_vip || is_trial;

  const can = (feature: CommercialFeatureId) => canAccessFeature(tier, feature);

  const requirePro = (feature: CommercialFeatureId): { ok: boolean; message: string } => {
    if (can(feature)) return { ok: true, message: '' };
    const need =
      feature === 'toolbox_labs' ||
      feature === 'multi_channel' ||
      feature === 'flow_multi_account' ||
      feature === 'integrations_pipeline'
        ? 'Pro trả phí (Trial không đủ)'
        : 'Pro/Trial';
    return {
      ok: false,
      message: `Tính năng «${feature}» cần ${need}. Nhấp logo app (up to PRO) để mở Bản quyền / kích hoạt.`,
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
