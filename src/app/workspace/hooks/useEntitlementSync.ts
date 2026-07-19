'use client';

/**
 * Boot + focus sync of Free / Trial / Pro (no VIP product tier).
 * - ownerUnlimited (AINOVEL_OWNER_UNLIMITED) → Pro unlimited (CISO)
 * - MODE=open → không ép UI (server assert nới riêng)
 * - paid token → Pro
 * - trial token / vault → Trial
 * - else Free
 * Legacy is_vip claims collapse → Pro.
 */
import { useCallback, useEffect, useRef } from 'react';
import { API } from '@/contracts';
import { useNovelStore } from '@/store/useNovelStore';
import { buildClientApiHeaders } from '../modules/apiClient';

const ENTITLEMENT_LS_KEY = 'ainovel.entitlementToken';

type CommercialStatus = {
  ok?: boolean;
  openMode?: boolean;
  ownerUnlimited?: boolean;
  tier?: string;
  tokenValid?: boolean;
  trial?: { active?: boolean; endsIso?: string | null; fromToken?: boolean };
  claims?: {
    is_pro?: boolean;
    is_vip?: boolean;
    is_trial?: boolean;
    plan?: string;
  } | null;
};

function claimsAreTrial(claims: CommercialStatus['claims'], tier?: string): boolean {
  if (!claims) return false;
  if (claims.is_trial || claims.plan === 'trial') return true;
  return tier === 'trial';
}

/** Paid Pro (including legacy VIP tokens). */
function claimsArePaidPro(claims: CommercialStatus['claims']): boolean {
  if (!claims) return false;
  if (claimsAreTrial(claims)) return false;
  return !!(claims.is_pro || claims.is_vip || claims.plan === 'pro' || claims.plan === 'vip');
}

export function useEntitlementSync() {
  const setVipStatus = useNovelStore((s) => s.setVipStatus);
  const setCredits = useNovelStore((s) => s.setCredits);
  const ran = useRef(false);

  const sync = useCallback(async () => {
    try {
      const res = await fetch(API.commercialStatus, {
        method: 'GET',
        headers: buildClientApiHeaders(),
        cache: 'no-store',
      });
      const data = (await res.json().catch(() => ({}))) as CommercialStatus;
      if (!res.ok || !data.ok) return;

      // CISO only — Pro full, never VIP badge
      if (data.ownerUnlimited) {
        setVipStatus(false, true, false);
        setCredits(999_999_999);
        return;
      }

      if (data.tokenValid && data.claims && claimsArePaidPro(data.claims)) {
        setVipStatus(false, true, false);
        setCredits(999_999_999);
        return;
      }

      if (
        data.tier === 'trial' ||
        data.trial?.active ||
        claimsAreTrial(data.claims, data.tier)
      ) {
        setVipStatus(false, true, true);
        setCredits(50_000);
        return;
      }

      setVipStatus(false, false, false);
      const cur = useNovelStore.getState().credits;
      if (cur > 100_000) setCredits(100);
    } catch {
      /* offline */
    }
  }, [setVipStatus, setCredits]);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    void sync();
    const onFocus = () => void sync();
    window.addEventListener('focus', onFocus);
    const onStorage = (e: StorageEvent) => {
      if (e.key === ENTITLEMENT_LS_KEY) void sync();
    };
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('storage', onStorage);
    };
  }, [sync]);

  return { sync };
}
