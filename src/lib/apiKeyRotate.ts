/**
 * Continuous API key rotation + preventive quotas (tránh chạm trần, không burst).
 *
 * Design principle: **stay under ceiling** — pace evenly, keep headroom, rotate
 * load across keys. Only block+wait when continuing would hit provider 429.
 *
 * IRON B10: only rotate keys of the SAME provider — never change model/platform as fallback.
 *
 * Layers:
 * 1) Round-robin + prefer keys with most remaining budget
 * 2) Even spacing (min gap = 60s / RPM) — no burst 10 calls in 1s
 * 3) Soft headroom (~85% RPM/RPD) before treating key as "hot"
 * 4) Hard ceiling: never exceed RPM/RPD hard limits
 * 5) Reactive cooldown after real 429 / invalid key
 *
 * HTTP 400 is usually payload/model — NOT RPM/RPD. Only rotate on auth-like 400.
 */

export type KeyLimitKind = 'rpm' | 'rpd' | 'auth' | 'payload' | 'other';

export type KeyWaitReason = 'rpm' | 'rpd' | 'cooldown' | 'empty' | 'pacing';

export type KeyWaitInfo = {
  reason: KeyWaitReason;
  waitMs: number;
  waitSec: number;
  message: string;
  /** fingerprint of the soonest-ready key (if any) */
  nextFp?: string;
  poolSize: number;
  rpmLimit: number;
  rpdLimit: number;
};

/** Thrown when pool has no callable key — message is user-facing (toast + countdown). */
export class KeyQuotaWaitError extends Error {
  readonly code = 'QUOTA' as const;
  readonly status = 429;
  readonly details: KeyWaitInfo;

  constructor(wait: KeyWaitInfo) {
    super(wait.message);
    this.name = 'KeyQuotaWaitError';
    this.details = wait;
  }
}

export type KeyQuotaView = {
  fp: string;
  available: boolean;
  rpmUsed: number;
  rpmLimit: number;
  /** ms until one slot frees in the 60s window or pacing gap (0 if ready) */
  rpmResetMs: number;
  rpdUsed: number;
  rpdLimit: number;
  /** ms until UTC day rollover */
  rpdResetMs: number;
  cooling: boolean;
  coolReason?: KeyLimitKind;
  coolUntilMs?: number;
  /** earliest time this key can accept another call */
  nextReadyMs: number;
  /** when this key was first registered in process (for “added” timer) */
  registeredAt?: number;
  ageMs?: number;
  /** under soft headroom (preferred for scheduling) */
  preferred?: boolean;
  /** min gap between calls on this key (pacing) */
  minIntervalMs?: number;
};

type Cooldown = {
  until: number;
  reason: KeyLimitKind;
};

type DayCount = {
  day: string; // YYYY-MM-DD UTC
  count: number;
};

const g = globalThis as unknown as {
  __ainovelKeyRotate?: {
    rr: number;
    cooldowns: Map<string, Cooldown>;
    dayCounts: Map<string, DayCount>;
    /** Sliding window timestamps (ms) of attempts per key fingerprint */
    rpmWindows: Map<string, number[]>;
    /** First time a fingerprint was seen (API “added”) */
    registeredAt: Map<string, number>;
  };
};

function store() {
  if (!g.__ainovelKeyRotate) {
    g.__ainovelKeyRotate = {
      rr: 0,
      cooldowns: new Map(),
      dayCounts: new Map(),
      rpmWindows: new Map(),
      registeredAt: new Map(),
    };
  }
  if (!g.__ainovelKeyRotate.rpmWindows) {
    g.__ainovelKeyRotate.rpmWindows = new Map();
  }
  if (!g.__ainovelKeyRotate.registeredAt) {
    g.__ainovelKeyRotate.registeredAt = new Map();
  }
  return g.__ainovelKeyRotate;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** Hard RPM per key (free-tier safe default). Override: AI_NOVEL_KEY_RPM_LIMIT */
export function getRpmLimit(): number {
  return envInt('AI_NOVEL_KEY_RPM_LIMIT', 10);
}

/** Hard RPD per key. Override: AI_NOVEL_KEY_RPD_LIMIT */
export function getRpdLimit(): number {
  return envInt('AI_NOVEL_KEY_RPD_LIMIT', 250);
}

/**
 * Even spacing so we never burst to the ceiling.
 * e.g. RPM=10 → min 6s between calls on the same key.
 * Override: AI_NOVEL_KEY_MIN_INTERVAL_MS
 */
export function getMinIntervalMs(): number {
  const forced = envInt('AI_NOVEL_KEY_MIN_INTERVAL_MS', 0);
  if (forced > 0) return forced;
  return Math.ceil(RPM_WINDOW_MS / Math.max(1, getRpmLimit()));
}

/**
 * Soft headroom (0.5–1): treat key "hot" before hard ceiling.
 * Default 0.85 → stop preferring key at 85% of RPM/RPD.
 * Override: AI_NOVEL_KEY_HEADROOM (e.g. 0.8)
 */
export function getHeadroomRatio(): number {
  const raw = process.env.AI_NOVEL_KEY_HEADROOM;
  if (raw == null || raw === '') return 0.85;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0.85;
  return Math.min(0.98, Math.max(0.5, n));
}

function softRpmCap(): number {
  return Math.max(1, Math.floor(getRpmLimit() * getHeadroomRatio()));
}

function softRpdCap(): number {
  return Math.max(1, Math.floor(getRpdLimit() * getHeadroomRatio()));
}

/** Soft fingerprints — never log full keys */
export function keyFingerprint(key: string): string {
  const k = String(key || '');
  if (k.length <= 8) return `…${k.slice(-4)}`;
  return `${k.slice(0, 4)}…${k.slice(-4)}`;
}

function utcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

function msUntilUtcMidnight(now = Date.now()): number {
  const d = new Date(now);
  const next = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate() + 1,
    0,
    0,
    0,
    0,
  );
  return Math.max(0, next - now);
}

/** RPM soft cooldown after 429 rate-limit */
const RPM_COOLDOWN_MS = 70_000;
/** RPD / daily quota soft cooldown */
const RPD_COOLDOWN_MS = 45 * 60_000;
/** Invalid / revoked key */
const AUTH_COOLDOWN_MS = 6 * 60 * 60_000;
const RPM_WINDOW_MS = 60_000;

/** Register keys when user adds them (starts age timer; no-op if already known). */
export function registerKeys(keys: string | string[]): void {
  const list = (Array.isArray(keys) ? keys : [keys])
    .map((k) => String(k || '').trim())
    .filter(Boolean);
  const s = store();
  const now = Date.now();
  for (const k of list) {
    const fp = keyFingerprint(k);
    if (!s.registeredAt.has(fp)) {
      s.registeredAt.set(fp, now);
      console.log(`[KeyRotate] registered key ${fp} (timer start)`);
    }
  }
}

export function classifyLimitMessage(msg: string, status?: number): KeyLimitKind {
  const m = String(msg || '');
  const st = status ?? 0;

  if (
    st === 401 ||
    st === 403 ||
    /API[_ ]?key.*(invalid|not valid|expired|revoked)|PERMISSION_DENIED|UNAUTHENTICATED|invalid.?api.?key|key.*disabled/i.test(
      m,
    )
  ) {
    return 'auth';
  }

  if (st === 400) {
    if (/API[_ ]?key|PERMISSION|UNAUTHENTICATED|invalid.?api.?key/i.test(m)) {
      return 'auth';
    }
    return 'payload';
  }

  if (
    /per\s*day|daily|RPD|GenerateRequestsPerDay|RequestsPerDay|quota.*day|day.*quota/i.test(
      m,
    )
  ) {
    return 'rpd';
  }
  if (
    st === 429 ||
    /429|rate|RPM|per\s*minute|RequestsPerMinute|resource.exhausted|quota|limit/i.test(
      m,
    )
  ) {
    return 'rpm';
  }
  return 'other';
}

export function markKeyLimited(
  key: string,
  message = '',
  status?: number,
): KeyLimitKind {
  if (!key) return 'other';
  registerKeys(key);
  const kind = classifyLimitMessage(message, status);
  if (kind === 'payload') {
    console.warn(
      `[KeyRotate] payload/400 on ${keyFingerprint(key)} — not cooling key (fix request, not key pool)`,
    );
    return kind;
  }
  const ms =
    kind === 'rpd'
      ? RPD_COOLDOWN_MS
      : kind === 'rpm'
        ? RPM_COOLDOWN_MS
        : kind === 'auth'
          ? AUTH_COOLDOWN_MS
          : 30_000;
  const s = store();
  s.cooldowns.set(keyFingerprint(key), {
    until: Date.now() + ms,
    reason: kind,
  });
  console.warn(
    `[KeyRotate] cooldown ${keyFingerprint(key)} ${kind} ~${Math.round(ms / 1000)}s`,
  );
  return kind;
}

function rpmWindow(key: string, now = Date.now()): number[] {
  const fp = keyFingerprint(key);
  const win = (store().rpmWindows.get(fp) || []).filter(
    (t) => now - t < RPM_WINDOW_MS,
  );
  store().rpmWindows.set(fp, win);
  return win;
}

function rpmRecent(key: string, now = Date.now()): number {
  return rpmWindow(key, now).length;
}

function rpdCount(key: string, now = Date.now()): number {
  const day = utcDay();
  const dc = store().dayCounts.get(keyFingerprint(key));
  if (!dc || dc.day !== day) return 0;
  return dc.count;
}

function isCooling(key: string, now = Date.now()): boolean {
  const cd = store().cooldowns.get(keyFingerprint(key));
  return Boolean(cd && cd.until > now);
}

/** Last attempt timestamp for pacing (most recent in window). */
function lastAttemptAt(key: string, now = Date.now()): number | null {
  const win = rpmWindow(key, now);
  if (!win.length) return null;
  return Math.max(...win);
}

/** ms until even-spacing allows the next call on this key. */
function pacingWaitMs(key: string, now = Date.now()): number {
  const last = lastAttemptAt(key, now);
  if (last == null) return 0;
  const gap = getMinIntervalMs();
  return Math.max(0, last + gap - now);
}

/** ms until oldest attempt in window ages out (room for 1 more RPM). */
function rpmResetMs(key: string, now = Date.now()): number {
  const limit = getRpmLimit();
  const win = rpmWindow(key, now);
  if (win.length < limit) return 0;
  const sorted = [...win].sort((a, b) => a - b);
  const needDrop = win.length - limit + 1;
  const target = sorted[needDrop - 1];
  if (target == null) return 0;
  return Math.max(0, target + RPM_WINDOW_MS - now);
}

export function getKeyQuota(key: string, now = Date.now()): KeyQuotaView {
  const fp = keyFingerprint(key);
  const s = store();
  const rpmLimit = getRpmLimit();
  const rpdLimit = getRpdLimit();
  const rpmUsed = rpmRecent(key, now);
  const rpdUsed = rpdCount(key, now);
  const cd = s.cooldowns.get(fp);
  const cooling = Boolean(cd && cd.until > now);
  const coolUntilMs = cooling && cd ? cd.until - now : undefined;
  // Soft headroom: stop scheduling on this key before hard ceiling
  const softRpm = softRpmCap();
  const softRpd = softRpdCap();
  const overSoftRpm = rpmUsed >= softRpm;
  const overSoftRpd = rpdUsed >= softRpd;
  const overHardRpm = rpmUsed >= rpmLimit;
  const overHardRpd = rpdUsed >= rpdLimit;
  const paceMs = pacingWaitMs(key, now);
  const rpmMs = overHardRpm ? rpmResetMs(key, now) : 0;
  const rpdMs = overHardRpd ? msUntilUtcMidnight(now) : 0;
  let nextReadyMs = 0;
  if (cooling && coolUntilMs != null) nextReadyMs = Math.max(nextReadyMs, coolUntilMs);
  if (paceMs > 0) nextReadyMs = Math.max(nextReadyMs, paceMs);
  if (rpmMs > 0) nextReadyMs = Math.max(nextReadyMs, rpmMs);
  if (rpdMs > 0) nextReadyMs = Math.max(nextReadyMs, rpdMs);
  // Soft-only: still "available" if under hard limit and pacing ok, but scored colder
  // Hard unavailable: cooling / hard RPM / hard RPD / pacing not ready
  const available =
    !cooling && !overHardRpm && !overHardRpd && paceMs === 0;
  const preferred =
    available && !overSoftRpm && !overSoftRpd;
  const registeredAt = s.registeredAt.get(fp);
  return {
    fp,
    available,
    preferred,
    minIntervalMs: getMinIntervalMs(),
    rpmUsed,
    rpmLimit,
    rpmResetMs: rpmMs > 0 ? rpmMs : paceMs,
    rpdUsed,
    rpdLimit,
    rpdResetMs: msUntilUtcMidnight(now),
    cooling,
    coolReason: cooling ? cd?.reason : undefined,
    coolUntilMs,
    nextReadyMs,
    registeredAt,
    ageMs: registeredAt != null ? now - registeredAt : undefined,
  };
}

export function isKeyAvailable(key: string, now = Date.now()): boolean {
  return getKeyQuota(key, now).available;
}

function formatDuration(ms: number): string {
  const sec = Math.max(1, Math.ceil(ms / 1000));
  if (sec < 60) return `${sec} giây`;
  const min = Math.ceil(sec / 60);
  if (min < 60) return `${min} phút`;
  const hr = Math.floor(min / 60);
  const rem = min % 60;
  return rem ? `${hr} giờ ${rem} phút` : `${hr} giờ`;
}

export function formatQuotaWaitMessage(wait: KeyWaitInfo): string {
  const t = formatDuration(wait.waitMs);
  if (wait.reason === 'empty') {
    return 'Chưa có API key trong pool. Thêm ít nhất 1 key rồi thử lại.';
  }
  if (wait.reason === 'pacing') {
    return (
      `[Giữ nhịp an toàn] App dãn lượt gọi để tránh chạm trần RPM ` +
      `(≤${wait.rpmLimit}/phút/key, khoảng cách tối thiểu giữa 2 lần gọi). ` +
      `Vui lòng CHỜ ${t} — không force-call.`
    );
  }
  if (wait.reason === 'rpd') {
    return (
      `[Sắp/đã chạm RPD] Toàn bộ ${wait.poolSize} API key đã hết ngân sách ngày ` +
      `(≤${wait.rpdLimit} req/ngày/key). Vui lòng CHỜ ${t} (reset UTC midnight) ` +
      `hoặc thêm key mới cùng provider — app chặn để tránh 429.`
    );
  }
  if (wait.reason === 'rpm') {
    return (
      `[Sắp/đã chạm RPM] Toàn bộ ${wait.poolSize} API key đang full ngân sách phút ` +
      `(≤${wait.rpmLimit} req/phút/key). Vui lòng CHỜ ${t} — ` +
      `app đã chặn gọi tiếp để tránh chạm trần provider.`
    );
  }
  return (
    `[API tạm khóa] Pool ${wait.poolSize} key đang cooldown/limit. ` +
    `Vui lòng CHỜ ${t} trước khi gọi tiếp.` +
    (wait.nextFp ? ` (key sớm nhất: ${wait.nextFp})` : '')
  );
}

/**
 * Compute pool wait if NO key is currently callable.
 */
export function getPoolWaitInfo(keys: string | string[]): KeyWaitInfo | null {
  const clean = (Array.isArray(keys) ? keys : [keys])
    .map((k) => String(k || '').trim())
    .filter(Boolean);
  if (clean.length === 0) {
    return {
      reason: 'empty',
      waitMs: 0,
      waitSec: 0,
      message: formatQuotaWaitMessage({
        reason: 'empty',
        waitMs: 0,
        waitSec: 0,
        message: '',
        poolSize: 0,
        rpmLimit: getRpmLimit(),
        rpdLimit: getRpdLimit(),
      }),
      poolSize: 0,
      rpmLimit: getRpmLimit(),
      rpdLimit: getRpdLimit(),
    };
  }

  registerKeys(clean);
  const now = Date.now();
  let soonest = Number.POSITIVE_INFINITY;
  let soonestFp = '';
  let anyAvailable = false;
  let dominant: KeyWaitReason = 'cooldown';

  for (const k of clean) {
    const q = getKeyQuota(k, now);
    if (q.available) {
      anyAvailable = true;
      break;
    }
    if (q.nextReadyMs < soonest) {
      soonest = q.nextReadyMs;
      soonestFp = q.fp;
      if (q.rpdUsed >= q.rpdLimit) dominant = 'rpd';
      else if (q.rpmUsed >= q.rpmLimit) dominant = 'rpm';
      else if ((q.rpmResetMs || 0) > 0 && q.rpmUsed < q.rpmLimit) {
        // waiting on even spacing, not hard ceiling
        dominant = 'pacing';
      } else dominant = 'cooldown';
    }
  }

  if (anyAvailable) return null;

  const waitMs =
    Number.isFinite(soonest) && soonest > 0 ? Math.ceil(soonest) : 60_000;
  const info: KeyWaitInfo = {
    reason: dominant,
    waitMs,
    waitSec: Math.max(1, Math.ceil(waitMs / 1000)),
    message: '',
    nextFp: soonestFp || undefined,
    poolSize: clean.length,
    rpmLimit: getRpmLimit(),
    rpdLimit: getRpdLimit(),
  };
  info.message = formatQuotaWaitMessage(info);
  return info;
}

/**
 * Hard gate: throw KeyQuotaWaitError if pool exhausted.
 * Call before issuing provider requests. UI should toast message + waitSec countdown.
 */
export function assertPoolHasCapacity(keys: string | string[]): void {
  const wait = getPoolWaitInfo(keys);
  if (!wait) return;
  throw new KeyQuotaWaitError(wait);
}

/**
 * Pick one available key (RR-ranked). Returns null + wait if none.
 */
export function acquireKeySlot(keys: string | string[]):
  | { ok: true; key: string }
  | { ok: false; wait: KeyWaitInfo } {
  const clean = (Array.isArray(keys) ? keys : [keys])
    .map((k) => String(k || '').trim())
    .filter(Boolean);
  if (clean.length === 0) {
    const wait = getPoolWaitInfo([])!;
    return { ok: false, wait };
  }
  registerKeys(clean);
  const ordered = orderKeysRoundRobin(clean);
  for (const k of ordered) {
    if (isKeyAvailable(k)) {
      return { ok: true, key: k };
    }
  }
  const wait = getPoolWaitInfo(clean)!;
  return { ok: false, wait };
}

/**
 * Record outbound attempt — counts toward hard RPM + RPD.
 * Returns false if key is already over budget (caller must not call provider).
 */
export function markKeyAttempt(key: string): boolean {
  if (!key) return false;
  registerKeys(key);
  if (!isKeyAvailable(key)) {
    console.warn(
      `[KeyRotate] refuse markKeyAttempt on ${keyFingerprint(key)} — over budget / cooling`,
    );
    return false;
  }
  const s = store();
  const fp = keyFingerprint(key);
  const now = Date.now();
  const win = rpmWindow(key, now);
  win.push(now);
  s.rpmWindows.set(fp, win);

  const day = utcDay();
  const prev = s.dayCounts.get(fp);
  if (!prev || prev.day !== day) {
    s.dayCounts.set(fp, { day, count: 1 });
  } else {
    s.dayCounts.set(fp, { day, count: prev.count + 1 });
  }
  return true;
}

export function markKeySuccess(key: string): void {
  if (!key) return;
  const s = store();
  const fp = keyFingerprint(key);
  const cd = s.cooldowns.get(fp);
  if (cd && cd.reason === 'rpm' && cd.until > Date.now()) {
    s.cooldowns.delete(fp);
  }
}

/**
 * Order keys for THIS request (preventive load-spread):
 * 1) Prefer preferred (under soft headroom) + available
 * 2) Then available (under hard ceiling, pacing ok)
 * 3) Lowest RPM/RPD usage first
 * 4) Round-robin as weak tie-break
 * If all blocked, still returns list (caller must assertPoolHasCapacity first).
 */
export function orderKeysRoundRobin(keys: string | string[]): string[] {
  const clean = (Array.isArray(keys) ? keys : [keys])
    .map((k) => String(k || '').trim())
    .filter(Boolean);
  if (clean.length === 0) return [];
  registerKeys(clean);
  if (clean.length === 1) return clean;

  const s = store();
  const start = s.rr % clean.length;
  s.rr = (s.rr + 1) % 1_000_000;
  const rotated = [...clean.slice(start), ...clean.slice(0, start)];

  const now = Date.now();
  const score = (k: string) => {
    const q = getKeyQuota(k, now);
    let sc = 0;
    if (!q.available) sc += 50_000 + q.nextReadyMs / 1000;
    else if (!q.preferred) sc += 5_000; // hot but still under hard ceiling
    // spread load: fewer recent + fewer day uses first
    sc += q.rpmUsed * 100;
    sc += q.rpdUsed;
    return sc;
  };

  return [...rotated].sort((a, b) => score(a) - score(b));
}

/** Only keys currently under hard budgets (for safe loops). */
export function filterAvailableKeys(keys: string | string[]): string[] {
  return orderKeysRoundRobin(keys).filter((k) => isKeyAvailable(k));
}

/** Snapshot for diagnostics / UI (no full keys). */
export function getKeyRotateSnapshot(keys: string[]): {
  rr: number;
  rpmLimit: number;
  rpdLimit: number;
  minIntervalMs: number;
  headroom: number;
  poolBlocked: boolean;
  wait: KeyWaitInfo | null;
  keys: KeyQuotaView[];
} {
  const clean = keys.filter(Boolean);
  registerKeys(clean);
  const wait = getPoolWaitInfo(clean);
  return {
    rr: store().rr,
    rpmLimit: getRpmLimit(),
    rpdLimit: getRpdLimit(),
    minIntervalMs: getMinIntervalMs(),
    headroom: getHeadroomRatio(),
    poolBlocked: Boolean(wait),
    wait,
    keys: clean.map((k) => getKeyQuota(k)),
  };
}
