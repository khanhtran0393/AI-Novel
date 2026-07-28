'use client';

/**
 * Workspace boot — warm LA Studio engine once when app/workspace loads.
 * Does not wait for user to open «Cấu hình giọng» / tab LA Studio.
 * Free → 403 quiet stop. Trial/Pro/open → spawn hidden + poll.
 * Heartbeat only re-probes; spawn is no-op if process/API already up
 * (see isLaStudioProcessRunning / ensureInFlight in laStudioLocal).
 */
import { useEffect, useRef } from 'react';
import { API } from '@/contracts';
import { useNovelStore } from '@/store/useNovelStore';
import { buildClientApiHeaders } from '../../modules/apiClient';

const KEY = 'ainovel_la_studio_bootstrap_v3';

type StatusPayload = {
  canSynth?: boolean;
  kokoroCliReady?: boolean;
  online?: boolean;
  message?: string;
  error?: string;
  ok?: boolean;
};

export default function LaStudioAutoBootstrap() {
  const sessionId = useRef(0);
  const freeDenied = useRef(false);
  const isPro = useNovelStore((s) => !!s.is_pro);
  const isTrial = useNovelStore((s) => !!s.is_trial);
  const isVip = useNovelStore((s) => !!s.is_vip);
  const storePremium = isPro || isTrial || isVip;

  useEffect(() => {
    // Upgraded Free → Trial/Pro mid-session: allow bootstrap again
    if (storePremium && freeDenied.current) {
      freeDenied.current = false;
    }
    if (freeDenied.current) return;

    const mySession = ++sessionId.current;
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;

    const alive = () =>
      !cancelled && sessionId.current === mySession && !freeDenied.current;

    const ensure = async (reason: string, spawn: boolean) => {
      if (!alive()) return null;
      try {
        const res = await fetch(API.laStudioStatus, {
          method: spawn ? 'POST' : 'GET',
          headers: {
            'Content-Type': 'application/json',
            ...buildClientApiHeaders(),
          },
          body: spawn
            ? JSON.stringify({
                spawnApp: true,
                hidden: true,
                pollMs: reason === 'boot' ? 25_000 : 8_000,
              })
            : undefined,
          cache: 'no-store',
        });
        const data = (await res.json().catch(() => ({}))) as StatusPayload;

        if (res.status === 403) {
          freeDenied.current = true;
          console.info(
            '[LaStudioAutoBootstrap] skip (tts_premium / Free) —',
            data.error || data.message || '403',
          );
          if (interval) {
            clearInterval(interval);
            interval = null;
          }
          return data;
        }

        console.info(
          `[LaStudioAutoBootstrap] ${reason} spawn=${spawn} canSynth=${data.canSynth} cli=${data.kokoroCliReady} api=${data.online}`,
        );
        try {
          sessionStorage.setItem(
            KEY,
            JSON.stringify({
              at: Date.now(),
              canSynth: !!data.canSynth,
              online: !!data.online,
            }),
          );
        } catch {
          /* ignore */
        }
        return data;
      } catch (e) {
        console.warn('[LaStudioAutoBootstrap]', reason, e);
        return null;
      }
    };

    const sleep = (ms: number) =>
      new Promise<void>((r) => {
        setTimeout(r, ms);
      });

    (async () => {
      // Check sessionStorage cache (TTL 30s) to avoid redundant 15s boot probe on quick reload
      try {
        const raw = sessionStorage.getItem(KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as {
            at?: number;
            online?: boolean;
            canSynth?: boolean;
          };
          if (
            parsed.at &&
            Date.now() - parsed.at < 30_000 &&
            (parsed.online || parsed.canSynth)
          ) {
            return;
          }
        }
      } catch {
        /* ignore */
      }

      // Boot once at workspace load (not when opening LA Studio tab)
      let data = await ensure('boot', true);
      if (!alive()) return;

      if (!data?.canSynth && !data?.online) {
        for (const wait of [3_000, 8_000, 15_000]) {
          if (!alive()) return;
          await sleep(wait);
          data = await ensure(`retry_${wait}`, true);
          if (data?.canSynth || data?.online) break;
        }
      }

      if (!alive()) return;

      // Heartbeat: GET first; warm only if offline
      interval = setInterval(() => {
        if (!alive()) return;
        void (async () => {
          const probe = await ensure('heartbeat_probe', false);
          if (!alive()) return;
          if (probe?.canSynth || probe?.online) return;
          await ensure('heartbeat_warm', true);
        })();
      }, 180_000);
    })();

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [storePremium]);

  return null;
}
