'use client';

import { useCallback, useEffect, useState } from 'react';
import { API } from '@/contracts';

export type OmniVoiceUiStatus = {
  online: boolean;
  ready: boolean;
  modelLoaded: boolean;
  baseUrl: string | null;
  message: string;
  loading: boolean;
  starting: boolean;
  error?: string;
};

const idle: OmniVoiceUiStatus = {
  online: false,
  ready: false,
  modelLoaded: false,
  baseUrl: null,
  message: '',
  loading: false,
  starting: false,
};

export function useOmniVoiceStatus(active: boolean) {
  const [status, setStatus] = useState<OmniVoiceUiStatus>(idle);

  const refresh = useCallback(async () => {
    setStatus((s) => ({ ...s, loading: true }));
    try {
      const r = await fetch(API.omnivoiceStatus, { method: 'GET', cache: 'no-store' });
      const j = await r.json().catch(() => ({}));
      setStatus({
        online: !!j?.online,
        ready: j?.ready !== false && !!j?.online,
        modelLoaded: j?.modelLoaded !== false && !!j?.online,
        baseUrl: j?.baseUrl || null,
        message: String(j?.message || ''),
        loading: false,
        starting: false,
        error: j?.error ? String(j.error) : undefined,
      });
    } catch (e) {
      setStatus({
        ...idle,
        loading: false,
        message: e instanceof Error ? e.message : 'Không probe được OmniVoice',
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }, []);

  const ensureStart = useCallback(async () => {
    setStatus((s) => ({
      ...s,
      starting: true,
      loading: true,
      message: 'Đang tự khởi động OmniVoice engine (lần đầu load model có thể 30–90s)…',
    }));
    try {
      const r = await fetch(API.omnivoiceStatus, {
        method: 'POST',
        cache: 'no-store',
      });
      const j = await r.json().catch(() => ({}));
      const online = !!j?.online || !!j?.ok;
      const detail =
        (!online && (j?.error || j?.spawnError || j?.python))
          ? [
              j?.error || j?.message || 'Chưa sẵn sàng',
              j?.spawnError ? `spawn: ${j.spawnError}` : '',
              j?.python ? `python: ${j.python}` : '',
              j?.logPath ? `log: ${j.logPath}` : '',
            ]
              .filter(Boolean)
              .join(' · ')
          : String(j?.message || (j?.ok ? 'Engine online' : 'Chưa sẵn sàng'));
      setStatus({
        online,
        ready: j?.ready !== false && online,
        modelLoaded: j?.modelLoaded !== false && online,
        baseUrl: j?.baseUrl || null,
        message: detail,
        loading: false,
        starting: false,
        error: j?.error ? String(j.error) : j?.spawnError ? String(j.spawnError) : undefined,
      });
      return online;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus({
        ...idle,
        loading: false,
        starting: false,
        message: msg,
        error: msg,
      });
      return false;
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    void refresh();
    const t = window.setInterval(() => {
      if (document.hidden) return;
      void refresh();
    }, 12_000);
    return () => window.clearInterval(t);
  }, [active, refresh]);

  return { status, refresh, ensureStart };
}
