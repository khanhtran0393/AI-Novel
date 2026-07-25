'use client';

/**
 * Workspace mount warm-up — **bridge only**.
 *
 * Policy (docs/flow-bridge.md):
 * - Mở app / vào Workspace → GET /api/flow/status (bật bridge WS/HTTP)
 * - **CẤM** mở Chrome/login trên boot
 * - Browser chỉ mở khi user bấm Đăng nhập / gen media preflight
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
          if (Date.now() - last < 60_000) return;
          sessionStorage.setItem(KEY, String(Date.now()));
        } catch {
          /* ignore */
        }

        // Bridge-only: ensure WS/HTTP up. Never POST bootstrap / forceChrome.
        const stRes = await fetch(API.flowStatus, { cache: 'no-store' }).catch(
          () => null,
        );
        if (cancelled || !stRes) return;
        await stRes.json().catch(() => ({}));
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
