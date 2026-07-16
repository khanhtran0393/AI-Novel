'use client';

/**
 * Silent bridge warm-up once per session when workspace mounts.
 * Chỉ ensure bridge HTTP/WS — KHÔNG mở Chrome / tab Flow (user chủ động Đăng nhập).
 */
import { useEffect, useRef } from 'react';
import { API } from '@/contracts';

const KEY = 'ainovel_flow_session_bootstrap_v1';

export default function FlowAutoBootstrap() {
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    let cancelled = false;
    (async () => {
      try {
        try {
          const last = Number(sessionStorage.getItem(KEY) || 0);
          if (Date.now() - last < 120_000) return;
        } catch {
          /* ignore */
        }

        // GET status → ensureBridgeStarted only (no browser launch)
        await fetch(API.flowStatus, { cache: 'no-store' }).catch(() => null);
        if (cancelled) return;
        try {
          sessionStorage.setItem(KEY, String(Date.now()));
        } catch {
          /* ignore */
        }
      } catch (e) {
        console.warn('[FlowAutoBootstrap]', e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
