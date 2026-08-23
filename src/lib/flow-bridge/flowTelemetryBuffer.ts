/**
 * Flow Telemetry Buffer for AI Novel.
 * Exact reference implementation from SuperAutoTools.
 *
 * Real Flow flushes telemetry events periodically in single accumulated POSTs
 * (every 6s or 12 events). Sending 4 POSTs per generation (2 pre + 2 post) produces
 * a telemetry signature that Google reCAPTCHA Enterprise flags as bot behavior.
 *
 * This buffer coalesces back-to-back telemetry events into period flush POSTs.
 */

import { googleFetch } from './googleFetch';

interface TelemetryBuffer {
  appEvents: any[];
  frontendEvents: any[];
  flushTimer: NodeJS.Timeout | null;
  lastFlushAt: number;
  baseUrl: string | null;
  headers: Record<string, string> | null;
}

const buffers = new Map<string, TelemetryBuffer>();

const FLUSH_DELAY_MS = Number(process.env.FLOW_TELEMETRY_FLUSH_DELAY_MS) || 6000;
const FLUSH_MAX_EVENTS = Number(process.env.FLOW_TELEMETRY_FLUSH_MAX_EVENTS) || 12;
const MIN_FLUSH_SPACING_MS = Number(process.env.FLOW_TELEMETRY_MIN_SPACING_MS) || 1500;

function getOrCreate(profileId: string): TelemetryBuffer {
  let b = buffers.get(profileId);
  if (!b) {
    b = {
      appEvents: [],
      frontendEvents: [],
      flushTimer: null,
      lastFlushAt: 0,
      baseUrl: null,
      headers: null,
    };
    buffers.set(profileId, b);
  }
  return b;
}

export interface PushTelemetryParams {
  profileId: string;
  baseUrl: string;
  headers?: Record<string, string>;
  appEvents?: any[];
  frontendEvents?: any[];
}

export function pushFlowTelemetry(params: PushTelemetryParams): void {
  const { profileId, baseUrl, headers, appEvents = [], frontendEvents = [] } = params;
  if (!profileId) return;
  if (appEvents.length === 0 && frontendEvents.length === 0) return;

  const buf = getOrCreate(profileId);
  buf.baseUrl = baseUrl;
  buf.headers = headers ?? null;

  if (appEvents.length > 0) buf.appEvents.push(...appEvents);
  if (frontendEvents.length > 0) buf.frontendEvents.push(...frontendEvents);

  if (buf.appEvents.length >= FLUSH_MAX_EVENTS || buf.frontendEvents.length >= FLUSH_MAX_EVENTS) {
    void flushNow(profileId);
    return;
  }

  if (buf.flushTimer) return;

  buf.flushTimer = setTimeout(() => {
    buf.flushTimer = null;
    void flushNow(profileId);
  }, FLUSH_DELAY_MS);
}

export async function flushNow(profileId: string): Promise<void> {
  const buf = buffers.get(profileId);
  if (!buf) return;

  if (buf.flushTimer) {
    clearTimeout(buf.flushTimer);
    buf.flushTimer = null;
  }

  if (buf.appEvents.length === 0 && buf.frontendEvents.length === 0) return;
  if (!buf.baseUrl || !buf.headers) return;

  const sinceLast = Date.now() - buf.lastFlushAt;
  if (sinceLast < MIN_FLUSH_SPACING_MS) {
    const wait = MIN_FLUSH_SPACING_MS - sinceLast;
    await new Promise((r) => setTimeout(r, wait));
  }

  const appEvents = buf.appEvents.splice(0);
  const frontendEvents = buf.frontendEvents.splice(0);
  const baseUrl = buf.baseUrl;
  const headers = buf.headers;

  buf.lastFlushAt = Date.now();

  if (appEvents.length > 0) {
    googleFetch({
      profileId,
      url: `${baseUrl}:batchLog`,
      method: 'POST',
      headers,
      body: JSON.stringify({ appEvents }),
    }).catch((err) => {
      console.debug(`[FlowTelemetry] batchLog flush failed (non-fatal): ${err?.message || err}`);
    });
  }

  if (frontendEvents.length > 0) {
    googleFetch({
      profileId,
      url: `${baseUrl}/flow:batchLogFrontendEvents`,
      method: 'POST',
      headers,
      body: JSON.stringify({ events: frontendEvents }),
    }).catch((err) => {
      console.debug(`[FlowTelemetry] frontendEvents flush failed (non-fatal): ${err?.message || err}`);
    });
  }
}
