/**
 * Process-local tamper signal queue + session state.
 * Packaged desktop: sticky cascade per session key.
 * Multi-tenant cloud: short TTL + capped memory; never authority for Pro.
 */
import type {
  CascadeLayer,
  LabyrinthSession,
  TamperSignal,
  TamperSignalCode,
  TamperStrength,
} from './types';

const MAX_SIGNALS = 64;
const SESSION_TTL_MS = 6 * 60 * 60 * 1000; // 6h
const MAX_SESSIONS = 256;

const signals: TamperSignal[] = [];
const sessions = new Map<string, LabyrinthSession>();

export function recordTamperSignal(
  signal: Omit<TamperSignal, 'ts'> & { ts?: number },
): TamperSignal {
  const full: TamperSignal = {
    ...signal,
    ts: signal.ts ?? Date.now(),
  };
  signals.push(full);
  while (signals.length > MAX_SIGNALS) signals.shift();
  return full;
}

export function getRecentTamperSignals(limit = 10): TamperSignal[] {
  return signals.slice(-Math.max(1, limit));
}

export function clearTamperSignalsForTests(): void {
  signals.length = 0;
  sessions.clear();
}

function pruneSessions(now: number): void {
  for (const [k, s] of sessions) {
    if (now - s.updatedAt > SESSION_TTL_MS) sessions.delete(k);
  }
  if (sessions.size <= MAX_SESSIONS) return;
  const ordered = [...sessions.entries()].sort(
    (a, b) => a[1].updatedAt - b[1].updatedAt,
  );
  const drop = sessions.size - MAX_SESSIONS;
  for (let i = 0; i < drop; i++) {
    sessions.delete(ordered[i][0]);
  }
}

export function getOrCreateSession(key: string): LabyrinthSession {
  const now = Date.now();
  pruneSessions(now);
  const k = (key || 'anon').slice(0, 128);
  let s = sessions.get(k);
  if (!s) {
    s = {
      key: k,
      attempt: 0,
      maxStrength: 0,
      lastLayer: 1,
      lastCode: null,
      updatedAt: now,
    };
    sessions.set(k, s);
  }
  return s;
}

export function bumpSession(
  key: string,
  opts: {
    strength: TamperStrength;
    layer: CascadeLayer;
    code: TamperSignalCode;
  },
): LabyrinthSession {
  const s = getOrCreateSession(key);
  s.attempt += 1;
  s.maxStrength = Math.max(s.maxStrength, opts.strength) as TamperStrength;
  s.lastLayer = opts.layer;
  s.lastCode = opts.code;
  s.updatedAt = Date.now();
  return s;
}

export function sessionHasTamper(key: string, minStrength: TamperStrength = 1): boolean {
  const s = sessions.get((key || 'anon').slice(0, 128));
  if (!s) return false;
  if (Date.now() - s.updatedAt > SESSION_TTL_MS) return false;
  return s.maxStrength >= minStrength;
}

export function getLabyrinthPublicStatus(): {
  version: number;
  signalCount: number;
  sessionCount: number;
  recentCodes: TamperSignalCode[];
  stickyCascade: boolean;
  miragePolicy: 'on' | 'off';
} {
  const mirageOff =
    process.env.AINOVEL_MIRAGE === '0' ||
    process.env.AINOVEL_MIRAGE === 'false' ||
    process.env.AINOVEL_MIRAGE === 'off';
  return {
    version: 1,
    signalCount: signals.length,
    sessionCount: sessions.size,
    recentCodes: signals.slice(-5).map((s) => s.code),
    stickyCascade: true,
    miragePolicy: mirageOff ? 'off' : 'on',
  };
}
