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
 * Production default **48h** (was 72h) — tighter crack+offline window.
 */
export function heartbeatGraceSec(): number {
  const n = Number(process.env.AINOVEL_HEARTBEAT_GRACE_SEC || 48 * 3600);
  return Number.isFinite(n) && n >= 3600 ? Math.floor(n) : 48 * 3600;
}

/**
 * First-run offline allowance if never reached license API.
 * Production default **12h** (was 24h).
 */
export function heartbeatFirstRunSec(): number {
  const n = Number(process.env.AINOVEL_HEARTBEAT_FIRST_RUN_SEC || 12 * 3600);
  return Number.isFinite(n) && n >= 600 ? Math.floor(n) : 12 * 3600;
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
      return res.status >= 500 ? 'offline' : 'offline';
    }
    // Explicit revoke only — missing DB row must NOT kill offline-signed keys
    if (payload.cloud?.revoked === true || payload.cloud?.status === 'revoked') {
      return 'revoked';
    }
    if (payload.valid === true || payload.ok === true) return 'valid';
    if (res.status >= 500) return 'offline';
    // Network/auth edge: treat as offline so local Ed25519 + grace still work
    if (res.status === 401 || res.status === 403) {
      // 403 with revoked already handled; other 403 → offline soft
      return 'offline';
    }
    // valid:false + not revoked (e.g. no cloud row) → still stamp as online-OK
    // Local signature was already verified before probe.
    return 'valid';
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
    throw new AppError(
      'License đã bị thu hồi trên server. Pro đã tắt.',
      { code: 'AUTH', status: 403 },
    );
  }

  // ── offline path ──
  if (stamp?.revoked && stamp.tokenHash === th) {
    throw new AppError(
      'License đã bị thu hồi (cache offline). Cần mạng + key mới.',
      { code: 'AUTH', status: 403 },
    );
  }

  // Same token, had successful online verify → grace window
  if (stamp && stamp.tokenHash === th && stamp.lastOkAt > 0 && !stamp.revoked) {
    const age = now - stamp.lastOkAt;
    if (age <= heartbeatGraceSec()) return;
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
