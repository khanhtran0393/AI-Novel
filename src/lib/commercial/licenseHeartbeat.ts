/**
 * Packaged Pro: online heartbeat for revoke + offline grace window.
 *
 * - Online + valid → stamp lastOk
 * - Online + invalid/revoked → hard deny (and mark revoked)
 * - Offline → allow only if last successful heartbeat within grace
 * - Never heartbeated + offline → short first-run grace from iat/local stamp
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import {
  extractEntitlementToken,
  getHwid,
  type EntitlementClaims,
  verifyEntitlementToken,
} from '@/lib/entitlement';
import { isPackagedCustomerRuntime } from '@/lib/commercial/sellerRuntime';
import { fetchPinnedLicenseApi, resolvePinnedLicenseApiUrl } from '@/lib/commercial/licenseTrust';
import { AppError } from '@/lib/errors';

/**
 * Max time offline after a successful online verify.
 * Production default **24h** (was 48h → 72h) — tighter crack+offline window.
 * Override: AINOVEL_HEARTBEAT_GRACE_SEC (min 1h).
 */
export function heartbeatGraceSec(): number {
  const n = Number(process.env.AINOVEL_HEARTBEAT_GRACE_SEC || 24 * 3600);
  return Number.isFinite(n) && n >= 3600 ? Math.floor(n) : 24 * 3600;
}

/**
 * First-run offline allowance if never reached license API.
 * Production default **6h** (was 12h → 24h).
 * Override: AINOVEL_HEARTBEAT_FIRST_RUN_SEC (min 10m).
 */
export function heartbeatFirstRunSec(): number {
  const n = Number(process.env.AINOVEL_HEARTBEAT_FIRST_RUN_SEC || 6 * 3600);
  return Number.isFinite(n) && n >= 600 ? Math.floor(n) : 6 * 3600;
}

/**
 * Local deny log (no token plaintext, no PII body).
 * Path: %USER_DATA%/.ainovel-license/deny-events.jsonl
 */
export function appendLicenseDenyEvent(event: {
  reason: string;
  detail?: string;
}): void {
  try {
    const base =
      process.env.AI_NOVEL_USER_DATA ||
      process.env.AINOVEL_DATA_ROOT ||
      path.join(os.homedir(), '.ainovel-license');
    fs.mkdirSync(base, { recursive: true });
    const line = JSON.stringify({
      at: new Date().toISOString(),
      reason: String(event.reason || 'deny').slice(0, 64),
      detail: event.detail ? String(event.detail).slice(0, 160) : undefined,
      hwid8: getHwid().toLowerCase().slice(0, 8),
    });
    fs.appendFileSync(path.join(base, 'deny-events.jsonl'), line + '\n', 'utf8');
  } catch {
    /* non-fatal */
  }
}

type HeartbeatFile = {
  /** Last successful online verify (0 = never). */
  lastOkAt: number;
  /** First local use of this token while offline (starts first-run window). */
  firstSeenAt?: number;
  tokenHash: string;
  hwid: string;
  revoked?: boolean;
  revokedAt?: number;
};

function heartbeatPath(): string {
  const base =
    process.env.AI_NOVEL_USER_DATA ||
    process.env.AINOVEL_DATA_ROOT ||
    path.join(os.homedir(), '.ainovel-license');
  try {
    fs.mkdirSync(base, { recursive: true });
  } catch {
    /* ignore */
  }
  return path.join(base, 'heartbeat.json');
}

function tokenHash(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex').slice(0, 32);
}

function readStamp(): HeartbeatFile | null {
  try {
    const raw = fs.readFileSync(heartbeatPath(), 'utf8');
    const j = JSON.parse(raw) as HeartbeatFile;
    if (!j || typeof j.lastOkAt !== 'number') return null;
    return j;
  } catch {
    return null;
  }
}

function writeStamp(data: HeartbeatFile): void {
  try {
    fs.writeFileSync(heartbeatPath(), JSON.stringify(data), 'utf8');
  } catch {
    /* non-fatal */
  }
}

export function clearHeartbeatStamp(): void {
  try {
    fs.unlinkSync(heartbeatPath());
  } catch {
    /* ignore */
  }
}

/**
 * Online probe against pinned license API (Supabase ledger on seller host).
 *
 * Policy (LICENSE_ONE_PATH · sole ledger = Supabase):
 * - valid:true + active row → valid
 * - valid:false / revoked / expired / **deleted / no row** → revoked (→ Free)
 * - Network / 5xx / parse fail → offline (grace stamp only)
 *
 * Cryptographically valid AINOVEL2 token alone is NOT enough once ledger says none.
 */
async function probeOnlineVerify(
  token: string,
  hwid: string,
): Promise<'valid' | 'revoked' | 'offline'> {
  try {
    const base = resolvePinnedLicenseApiUrl();
    const endpoint = new URL('/api/cloud/license/verify', base).toString();
    const res = await fetchPinnedLicenseApi(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, hwid }),
      timeoutMs: 8_000,
    });
    if (res.status === 0) return 'offline';
    let payload: {
      valid?: boolean;
      ok?: boolean;
      cloud?: { revoked?: boolean; status?: string; checked?: boolean };
    } = {};
    try {
      payload = JSON.parse(res.bodyText) as typeof payload;
    } catch {
      return 'offline';
    }
    if (res.status >= 500) return 'offline';

    const cloudStatus = String(payload.cloud?.status || '')
      .trim()
      .toLowerCase();
    // Explicit ledger kill: revoke, expire, delete, never issued
    if (
      payload.cloud?.revoked === true ||
      cloudStatus === 'revoked' ||
      cloudStatus === 'expired' ||
      cloudStatus === 'none' ||
      cloudStatus === 'deleted'
    ) {
      return 'revoked';
    }
    if (payload.valid === true || payload.ok === true) return 'valid';

    // Online response that is not valid = ledger denies (deleted id / no active row)
    // Do NOT treat as offline grace — that was the stale-PRO bug after Supabase delete.
    if (payload.valid === false || payload.ok === false) {
      return 'revoked';
    }
    if (res.status === 401 || res.status === 403) {
      return 'revoked';
    }
    // Ambiguous 2xx without valid flag → offline soft
    return 'offline';
  } catch {
    return 'offline';
  }
}

/**
 * Call on packaged builds before granting trial/pro API access.
 * Dev/web non-packaged: no-op.
 */
export async function enforcePackagedHeartbeat(
  req: Request,
  body?: unknown,
  claims?: EntitlementClaims | null,
): Promise<void> {
  if (!isPackagedCustomerRuntime()) return;

  // Free tier callers shouldn't hit this; belt if they do
  if (claims && !claims.is_pro && !claims.is_vip && !claims.is_trial) return;

  const token = extractEntitlementToken(req, body);
  if (!token) {
    // No token: local trial vault may still apply — skip heartbeat
    return;
  }

  // Must still be a valid offline signature
  const local = verifyEntitlementToken(token, { requireHwidMatch: true });
  if (!local || (!local.is_pro && !local.is_vip && !local.is_trial)) {
    throw new AppError('Token license không hợp lệ trên máy này (heartbeat).', {
      code: 'AUTH',
      status: 403,
    });
  }

  const hwid = getHwid().toLowerCase();
  const th = tokenHash(token);
  const now = Math.floor(Date.now() / 1000);
  const stamp = readStamp();

  if (stamp?.revoked && stamp.tokenHash === th) {
    appendLicenseDenyEvent({ reason: 'cache_revoked' });
    throw new AppError(
      'License đã bị thu hồi (heartbeat cache). Liên hệ seller hoặc kích hoạt key mới.',
      { code: 'AUTH', status: 403 },
    );
  }

  const online = await probeOnlineVerify(token, hwid);

  if (online === 'valid') {
    writeStamp({
      lastOkAt: now,
      firstSeenAt: stamp?.firstSeenAt || now,
      tokenHash: th,
      hwid,
      revoked: false,
    });
    return;
  }

  if (online === 'revoked') {
    writeStamp({
      lastOkAt: stamp?.lastOkAt || 0,
      firstSeenAt: stamp?.firstSeenAt,
      tokenHash: th,
      hwid,
      revoked: true,
      revokedAt: now,
    });
    appendLicenseDenyEvent({
      reason: 'ledger_deny',
      detail: 'supabase_deleted_or_revoked_or_expired',
    });
    throw new AppError(
      'License không còn active trên sổ cái Supabase (đã xóa / revoke / hết hạn). App về Free.',
      { code: 'AUTH', status: 403 },
    );
  }

  // ── offline path ──
  if (stamp?.revoked && stamp.tokenHash === th) {
    appendLicenseDenyEvent({ reason: 'cache_revoked_offline' });
    throw new AppError(
      'License đã bị gỡ trên sổ cái (cache offline). Cần mạng + key mới từ seller.',
      { code: 'AUTH', status: 403 },
    );
  }

  // Same token, had successful online verify → grace window
  if (stamp && stamp.tokenHash === th && stamp.lastOkAt > 0 && !stamp.revoked) {
    const age = now - stamp.lastOkAt;
    if (age <= heartbeatGraceSec()) return;
    appendLicenseDenyEvent({
      reason: 'offline_grace_expired',
      detail: `ageSec=${age}`,
    });
    throw new AppError(
      `Hết cửa sổ offline license (${Math.floor(heartbeatGraceSec() / 3600)}h). ` +
        'Kết nối mạng để heartbeat với server license, rồi thử lại.',
      { code: 'AUTH', status: 403 },
    );
  }

  // Never online-OK with this token: start/continue first-run offline window from first local use
  if (!stamp || stamp.tokenHash !== th) {
    writeStamp({
      lastOkAt: 0,
      firstSeenAt: now,
      tokenHash: th,
      hwid,
      revoked: false,
    });
    return;
  }

  const first = stamp.firstSeenAt || now;
  if (now - first <= heartbeatFirstRunSec()) return;

  throw new AppError(
    `Packaged Pro: hết ${Math.floor(heartbeatFirstRunSec() / 3600)}h offline lần đầu — cần heartbeat online một lần. ` +
      'Kết nối mạng rồi dùng lại tính năng Pro / kích hoạt lại key.',
    { code: 'AUTH', status: 403 },
  );
}

export function getHeartbeatPublicStatus(): {
  packaged: boolean;
  lastOkAt: number | null;
  graceSec: number;
  firstRunSec: number;
  revoked: boolean;
} {
  const stamp = readStamp();
  return {
    packaged: isPackagedCustomerRuntime(),
    lastOkAt: stamp?.lastOkAt ?? null,
    graceSec: heartbeatGraceSec(),
    firstRunSec: heartbeatFirstRunSec(),
    revoked: !!stamp?.revoked,
  };
}
