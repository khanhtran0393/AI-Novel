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
/** Skip re-fetch on window focus if last sync was recent (GUI jank fix). */
const FOCUS_SYNC_MIN_INTERVAL_MS = 45_000;

type CommercialStatus = {
  ok?: boolean;
  openMode?: boolean;
  ownerUnlimited?: boolean;
  tier?: string;
  tokenValid?: boolean;
  /** When true, drop local token — Supabase has no active license for HWID */
  clearLocalToken?: boolean;
  /** Fresh ticket after soft drift (replace localStorage) */
  rebindToken?: string | null;
  ticketStale?: boolean;
  /** Supabase ledger status: none | revoked | expired | active | … */
  cloudStatus?: string | null;
  cloudRevoked?: boolean;
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
  const lastSyncAt = useRef(0);
  const syncInFlight = useRef(false);

  const sync = useCallback(async (opts?: { force?: boolean }) => {
    const force = Boolean(opts?.force);
    const now = Date.now();
    if (!force && now - lastSyncAt.current < FOCUS_SYNC_MIN_INTERVAL_MS) {
      return;
    }
    if (syncInFlight.current) return;
    syncInFlight.current = true;
    try {
      const res = await fetch(API.commercialStatus, {
        method: 'GET',
        headers: buildClientApiHeaders(),
        cache: 'no-store',
      });
      const data = (await res.json().catch(() => ({}))) as CommercialStatus;
      if (!res.ok || !data.ok) return;
      lastSyncAt.current = Date.now();

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

      // Prefer server rebind (ticket drift but HWID still Pro/Trial on ledger)
      const rebind =
        typeof data.rebindToken === 'string' &&
        data.rebindToken.startsWith('AINOVEL2.')
          ? data.rebindToken.trim()
          : '';
      if (rebind) {
        try {
          window.localStorage.setItem(ENTITLEMENT_LS_KEY, rebind);
        } catch {
          /* ignore */
        }
      }

      // Packaged customer: heartbeat to the seller API for revoke/expiry.
      // Network failure keeps the offline-signed token; hard ledger deny removes it.
      // Soft ticket drift must NOT force Free when commercial/status still says Pro.
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
          const online = (await heartbeat.json().catch(() => ({}))) as {
            valid?: boolean;
            rebindToken?: string | null;
            cloud?: { status?: string; revoked?: boolean };
          };
          const soft =
            online.cloud?.status === 'token_mismatch' ||
            online.cloud?.status === 'claims_mismatch' ||
            online.cloud?.status === 'ticket_stale' ||
            online.cloud?.status === 'ticket_rebound' ||
            online.cloud?.status === 'hwid_mismatch';
          if (
            typeof online.rebindToken === 'string' &&
            online.rebindToken.startsWith('AINOVEL2.')
          ) {
            try {
              window.localStorage.setItem(
                ENTITLEMENT_LS_KEY,
                online.rebindToken.trim(),
              );
            } catch {
              /* ignore */
            }
          } else if (
            heartbeat.ok &&
            online.valid === false &&
            !soft &&
            (online.cloud?.revoked === true ||
              online.cloud?.status === 'none' ||
              online.cloud?.status === 'expired' ||
              online.cloud?.status === 'revoked' ||
              data.tier === 'free')
          ) {
            try {
              window.localStorage.removeItem(ENTITLEMENT_LS_KEY);
            } catch {
              /* ignore */
            }
            setVipStatus(false, false, false);
            setCredits(100);
            return;
          }
        } catch {
          // Offline grace: Ed25519/HWID/expiry remain enforced locally.
        }
      }

      // Ledger (Supabase) hard-deny → drop local ticket.
      // clearLocalToken is false when rebindToken was issued (already stored above).
      if (
        data.clearLocalToken ||
        data.cloudRevoked ||
        data.cloudStatus === 'none' ||
        data.cloudStatus === 'expired' ||
        data.cloudStatus === 'revoked'
      ) {
        if (!rebind) {
          try {
            window.localStorage.removeItem(ENTITLEMENT_LS_KEY);
          } catch {
            /* ignore */
          }
        }
      }

      // CISO only — Pro full, never VIP badge
      if (data.ownerUnlimited) {
        setVipStatus(false, true, false);
        setCredits(999_999_999);
        return;
      }

      // Prefer server tier (Supabase-first): Free wins over stale local ticket
      if (data.tier === 'free' || data.tier === 'FREE') {
        setVipStatus(false, false, false);
        const cur = useNovelStore.getState().credits;
        if (cur > 100_000) setCredits(100);
        // Clamp Free product caps (default store often 4250 từ)
        try {
          const {
            FREE_LIMITS,
            clampFreeChapterCount,
            clampFreeWordGoal,
          } = await import('@/lib/commercial/freeLimitsPolicy');
          const st = useNovelStore.getState();
          const ch = clampFreeChapterCount(Number(st.setup?.so_chuong) || 1);
          const words = clampFreeWordGoal(
            Number(st.setup?.so_tu_chuong) || FREE_LIMITS.maxWordsPerChapter,
          );
          if (
            st.setup?.so_chuong !== ch ||
            st.setup?.so_tu_chuong !== words
          ) {
            st.setSetup({ so_chuong: ch, so_tu_chuong: words });
          }
        } catch {
          /* ignore */
        }
        return;
      }

      // Paid Pro only when server still says token/ledger valid
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
    } finally {
      syncInFlight.current = false;
    }
  }, [setVipStatus, setCredits]);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    void sync({ force: true });
    // Focus: throttle — commercial/status is 1–3s and freezes GUI when spam
    const onFocus = () => void sync({ force: false });
    window.addEventListener('focus', onFocus);
    // Token changed in another tab/window → always re-sync
    const onStorage = (e: StorageEvent) => {
      if (e.key === ENTITLEMENT_LS_KEY) void sync({ force: true });
    };
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('storage', onStorage);
    };
  }, [sync]);

  return { sync: () => sync({ force: true }) };
}
