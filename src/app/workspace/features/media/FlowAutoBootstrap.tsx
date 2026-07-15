'use client';

/**
 * Silent Flow bootstrap once per session when workspace mounts.
 * Opens Chrome + extension only if token not ready.
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

        const st = await fetch(API.flowStatus, { cache: 'no-store' })
          .then((r) => r.json())
          .catch(() => null);
        if (cancelled) return;
        if (st?.flowKeyPresent && st?.extensionConnected) return;

        await fetch(API.flowBootstrap, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ forceChrome: false, waitExtensionMs: 12000 }),
        });
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
