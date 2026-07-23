'use client';

/**
 * Workspace boot — LA Studio engine ẩn chỉ cho Trial/Pro (tts_premium).
 * Free: no-op (không spawn / không gọi API).
 */
import { useEffect, useRef } from 'react';
import { API } from '@/contracts';
import { useNovelStore } from '@/store/useNovelStore';
import { buildClientApiHeaders } from '../../modules/apiClient';

const KEY = 'ainovel_la_studio_bootstrap_v2';

export default function LaStudioAutoBootstrap() {
  const ran = useRef(false);
  const isPro = useNovelStore((s) => !!s.is_pro);
  const isTrial = useNovelStore((s) => !!s.is_trial);
  const isVip = useNovelStore((s) => !!s.is_vip);
  const premium = isPro || isTrial || isVip;

  useEffect(() => {
    if (!premium) return;
    if (ran.current) return;
    ran.current = true;

    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;

    const ensure = async (reason: string) => {
      try {
        const res = await fetch(API.laStudioStatus, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...buildClientApiHeaders(),
          },
          body: JSON.stringify({
            spawnApp: true,
            hidden: true,
            pollMs: 20_000,
          }),
          cache: 'no-store',
        });
        const data = (await res.json().catch(() => ({}))) as {
          canSynth?: boolean;
          kokoroCliReady?: boolean;
          online?: boolean;
          message?: string;
        };
        console.info(
          `[LaStudioAutoBootstrap] ${reason} canSynth=${data.canSynth} cli=${data.kokoroCliReady} api=${data.online}`,
        );
        try {
          sessionStorage.setItem(KEY, String(Date.now()));
        } catch {
          /* ignore */
        }
      } catch (e) {
        console.warn('[LaStudioAutoBootstrap]', reason, e);
      }
    };

    (async () => {
      await ensure('boot');
      if (cancelled) return;
      interval = setInterval(() => {
        if (cancelled) return;
        void ensure('heartbeat');
      }, 180_000);
    })();

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [premium]);

  return null;
}
