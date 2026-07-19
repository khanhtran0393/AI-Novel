'use client';

/**
 * Boot + focus sync of Free/Pro/VIP/Trial from server commercial status + local token.
 * - ownerUnlimited only → Pro unlimited (CISO; never ship)
 * - open mode → KHÔNG ép UI Pro (API server vẫn open khi MODE=open)
 * - valid paid token → claims
 * - active trial → is_pro + is_trial (badge TRIAL)
 * - else Free
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
  trial?: { active?: boolean; endsIso?: string | null };
  claims?: { is_pro?: boolean; is_vip?: boolean } | null;
};

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

      // Chỉ CISO flag — không ép Pro khi MODE=open (tránh “luôn PRO” khi test Free)
      if (data.ownerUnlimited) {
        setVipStatus(true, true, false);
        setCredits(999_999_999);
        return;
      }

      if (data.tokenValid && data.claims) {
        setVipStatus(
          !!data.claims.is_vip,
          !!data.claims.is_pro || !!data.claims.is_vip,
          false,
        );
        setCredits(999_999_999);
        return;
      }

      if (data.trial?.active) {
        // Quyền Pro-equivalent + cờ trial để badge UI = TRIAL (không hiện PRO trả phí)
        setVipStatus(false, true, true);
        setCredits(50_000);
        return;
      }

      // Free
      setVipStatus(false, false, false);
      const cur = useNovelStore.getState().credits;
      if (cur > 100_000) setCredits(100);
    } catch {
      /* offline — keep last known store plan */
    }
  }, [setVipStatus, setCredits]);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    void sync();
    const onFocus = () => void sync();
    window.addEventListener('focus', onFocus);
    // Re-sync when token storage changes in another tab
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
