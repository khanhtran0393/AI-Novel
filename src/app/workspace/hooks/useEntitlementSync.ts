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
import { applyClientBypassProbes } from '@/lib/commercial/labyrinth/clientBypassProbe';

const ENTITLEMENT_LS_KEY = 'ainovel.entitlementToken';

type CommercialStatus = {
  ok?: boolean;
  openMode?: boolean;
  ownerUnlimited?: boolean;
  tier?: string;
  tokenValid?: boolean;
  /** When true, drop local token — Supabase has no active license for HWID */
  clearLocalToken?: boolean;
  authority?: string;
  entitlement?: { publishHint?: boolean; hwid?: string };
  trial?: { active?: boolean; endsIso?: string | null; fromToken?: boolean };
  claims?: {
    is_pro?: boolean;
    is_vip?: boolean;
    is_trial?: boolean;
    plan?: string;
  } | null;
  antiTamper?: { ok?: boolean; reasons?: string[]; bypassScore?: number };
  bypassProbe?: { ok?: boolean; findingCount?: number; categories?: string[] };
  labyrinth?: { recentCodes?: string[]; signalCount?: number };
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

      // Expanded bypass check → client shadow (UI still visible; wrong-path may run)
      const storeSnap = useNovelStore.getState();
      applyClientBypassProbes({
        storeIsPro: storeSnap.is_pro,
        storeIsTrial: storeSnap.is_trial,
        storeIsVip: storeSnap.is_vip,
        antiTamperOk:
          data.antiTamper?.ok !== false && data.bypassProbe?.ok !== false,
        labyrinthCodes: data.labyrinth?.recentCodes,
      });

      // Packaged customer: heartbeat to the seller API for revoke/expiry.
      // Network failure keeps the offline-signed token; an explicit invalid
      // response removes it immediately.
      let storedToken = '';
      try {
        storedToken = window.localStorage.getItem(ENTITLEMENT_LS_KEY) || '';
      } catch {
        storedToken = '';
      }
      if (data.entitlement?.publishHint && storedToken) {
        try {
          const heartbeat = await fetch(API.cloudLicenseVerify, {
            method: 'POST',
            headers: buildClientApiHeaders(),
            body: JSON.stringify({
              token: storedToken,
              hwid: data.entitlement.hwid,
            }),
            cache: 'no-store',
          });
          if (heartbeat.ok) {
            const online = (await heartbeat.json().catch(() => ({}))) as {
              valid?: boolean;
            };
            if (online.valid === false) {
              window.localStorage.removeItem(ENTITLEMENT_LS_KEY);
              setVipStatus(false, false, false);
              setCredits(100);
              return;
            }
          }
        } catch {
          // Offline grace: Ed25519/HWID/expiry remain enforced locally.
        }
      }

      // Supabase says no license → drop local token so stale PRO cannot stick
      if (data.clearLocalToken || (data.authority === 'supabase' && !data.tokenValid)) {
        try {
          window.localStorage.removeItem(ENTITLEMENT_LS_KEY);
        } catch {
          /* ignore */
        }
      }

      // CISO only — Pro full, never VIP badge
      if (data.ownerUnlimited) {
        setVipStatus(false, true, false);
        setCredits(999_999_999);
        return;
      }

      // Paid Pro token claims first (before free/trial branches)
      if (data.tokenValid && data.claims && claimsArePaidPro(data.claims)) {
        setVipStatus(false, true, false);
        setCredits(999_999_999);
        return;
      }

      if (data.tier === 'pro' || data.tier === 'vip') {
        setVipStatus(false, true, false);
        setCredits(999_999_999);
        return;
      }

      // Prefer server tier (Supabase-first when configured)
      if (data.tier === 'free' || data.tier === 'FREE') {
        setVipStatus(false, false, false);
        const cur = useNovelStore.getState().credits;
        if (cur > 100_000) setCredits(100);
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
