/**
 * Desktop / UI helpers for cloud license APIs (Vercel-hosted same origin).
 */
import { API } from '@/contracts';
import { buildClientApiHeaders } from './apiClient';

const SESSION_KEY = 'ainovel.supabase.access_token';

export function getCloudAccessToken(): string {
  if (typeof window === 'undefined') return '';
  try {
    return (
      window.localStorage.getItem(SESSION_KEY) ||
      window.sessionStorage.getItem(SESSION_KEY) ||
      ''
    );
  } catch {
    return '';
  }
}

export function setCloudAccessToken(token: string) {
  try {
    if (token.trim()) {
      window.localStorage.setItem(SESSION_KEY, token.trim());
    } else {
      window.localStorage.removeItem(SESSION_KEY);
    }
  } catch {
    /* ignore */
  }
}

function cloudHeaders(extra?: HeadersInit): Record<string, string> {
  const h = buildClientApiHeaders(extra);
  const t = getCloudAccessToken();
  if (t) h.Authorization = `Bearer ${t}`;
  return h;
}

export async function fetchCloudStatus(): Promise<{
  ok: boolean;
  supabase?: {
    configured: boolean;
    adminConfigured: boolean;
  };
  hybrid?: { note?: string; cloudOrders?: boolean };
  error?: string;
}> {
  try {
    const res = await fetch(API.cloudStatus, {
      headers: cloudHeaders(),
      cache: 'no-store',
    });
    return (await res.json()) as {
      ok: boolean;
      supabase?: { configured: boolean; adminConfigured: boolean };
      hybrid?: { note?: string; cloudOrders?: boolean };
      error?: string;
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function createCloudOrder(input: {
  planId: string;
  hwid: string;
  note?: string;
  notifyTelegram?: boolean;
}) {
  const res = await fetch(API.cloudOrders, {
    method: 'POST',
    headers: cloudHeaders(),
    body: JSON.stringify(input),
  });
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    orderId?: string | null;
    transferContent?: string;
    amountVnd?: number;
    cloud?: boolean;
    message?: string;
  };
  if (!res.ok || !data.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

export async function cloudVerifyLicense(token: string, hwid?: string) {
  const res = await fetch(API.cloudLicenseVerify, {
    method: 'POST',
    headers: cloudHeaders(),
    body: JSON.stringify({ token, hwid }),
  });
  return (await res.json()) as {
    ok?: boolean;
    valid?: boolean;
    claims?: { is_pro?: boolean; is_vip?: boolean; exp?: number };
    cloud?: { checked?: boolean; revoked?: boolean };
    error?: string;
  };
}

export async function cloudStartTrial(hwid: string) {
  const res = await fetch(API.cloudLicenseTrial, {
    method: 'POST',
    headers: cloudHeaders(),
    body: JSON.stringify({ hwid }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    token?: string;
    cloud?: boolean;
    message?: string;
  };
  if (!res.ok || !data.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}
