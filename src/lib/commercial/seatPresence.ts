/**
 * Concurrent multi-seat presence (local + optional cloud stamp).
 *
 * On packaged Pro heartbeat success, record (license_id, hwid, lastSeen).
 * If same license_id has more distinct hwids online within window than maxSeats,
 * deny (share abuse).
 *
 * maxSeats defaults to 1; token may carry max_seats / seats claim if seller sets it.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import type { EntitlementClaims } from '@/lib/entitlement';
import { getHwid } from '@/lib/entitlement';
import { isPackagedCustomerRuntime } from '@/lib/commercial/packagedAttestation';
import { AppError } from '@/lib/errors';

/** Concurrent seat window — default **10 min** (was 15). Override: AINOVEL_SEAT_PRESENCE_WINDOW_SEC */
const PRESENCE_WINDOW_SEC = (() => {
  const n = Number(process.env.AINOVEL_SEAT_PRESENCE_WINDOW_SEC || 10 * 60);
  return Number.isFinite(n) && n >= 60 ? Math.floor(n) : 10 * 60;
})();

type SeatRow = {
  hwid: string;
  lastSeenAt: number;
  licenseId: string;
};

type PresenceFile = {
  rows: SeatRow[];
};

function presencePath(): string {
  const base =
    process.env.AI_NOVEL_USER_DATA ||
    process.env.AINOVEL_DATA_ROOT ||
    path.join(os.homedir(), '.ainovel-license');
  try {
    fs.mkdirSync(base, { recursive: true });
  } catch {
    /* ignore */
  }
  return path.join(base, 'seat-presence.json');
}

function readPresence(): PresenceFile {
  try {
    const raw = fs.readFileSync(presencePath(), 'utf8');
    const j = JSON.parse(raw) as PresenceFile;
    if (!j || !Array.isArray(j.rows)) return { rows: [] };
    return j;
  } catch {
    return { rows: [] };
  }
}

function writePresence(data: PresenceFile): void {
  try {
    fs.writeFileSync(presencePath(), JSON.stringify(data), 'utf8');
  } catch {
    /* non-fatal */
  }
}

function maxSeatsFromClaims(claims: EntitlementClaims | null | undefined): number {
  const raw = claims as EntitlementClaims & {
    max_seats?: number;
    maxSeats?: number;
    seats?: number;
  };
  const n = Number(raw?.max_seats ?? raw?.maxSeats ?? raw?.seats ?? 1);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(32, Math.floor(n));
}

function licenseKey(claims: EntitlementClaims, token: string): string {
  if (claims.license_id && String(claims.license_id).trim()) {
    return String(claims.license_id).trim().toLowerCase();
  }
  // Stable fingerprint of token so single-seat licenses still track concurrent hwids
  return (
    'tok:' +
    crypto.createHash('sha256').update(token, 'utf8').digest('hex').slice(0, 24)
  );
}

/**
 * Call after successful packaged heartbeat for paid claims.
 * Throws if concurrent HWIDs for this license exceed max seats.
 */
export function enforceSeatPresence(
  claims: EntitlementClaims,
  token: string,
): void {
  if (!isPackagedCustomerRuntime()) return;
  if (!claims.is_pro && !claims.is_vip && !claims.is_trial) return;
  if (!token) return;

  // Optional kill-switch
  if (
    process.env.AINOVEL_SEAT_PRESENCE === '0' ||
    process.env.AINOVEL_SEAT_PRESENCE === 'false'
  ) {
    return;
  }

  const hwid = getHwid().toLowerCase();
  const lid = licenseKey(claims, token);
  const maxSeats = maxSeatsFromClaims(claims);
  const now = Math.floor(Date.now() / 1000);
  const file = readPresence();

  // Drop stale rows
  let rows = file.rows.filter((r) => now - r.lastSeenAt <= PRESENCE_WINDOW_SEC);

  // Upsert this machine
  const idx = rows.findIndex((r) => r.licenseId === lid && r.hwid === hwid);
  if (idx >= 0) {
    rows[idx] = { hwid, lastSeenAt: now, licenseId: lid };
  } else {
    rows.push({ hwid, lastSeenAt: now, licenseId: lid });
  }

  const peers = rows.filter((r) => r.licenseId === lid);
  const distinct = new Set(peers.map((r) => r.hwid));
  if (distinct.size > maxSeats) {
    // Do not write overflow peer — deny share + local deny breadcrumb (no token)
    try {
      const base =
        process.env.AI_NOVEL_USER_DATA ||
        process.env.AINOVEL_DATA_ROOT ||
        path.join(os.homedir(), '.ainovel-license');
      fs.mkdirSync(base, { recursive: true });
      fs.appendFileSync(
        path.join(base, 'deny-events.jsonl'),
        JSON.stringify({
          at: new Date().toISOString(),
          reason: 'seat_overflow',
          detail: `n=${distinct.size}/max=${maxSeats}`,
          hwid8: hwid.slice(0, 8),
        }) + '\n',
        'utf8',
      );
    } catch {
      /* ignore */
    }
    throw new AppError(
      `License đang dùng trên ${distinct.size} máy (tối đa ${maxSeats} seat). ` +
        'Ngắt máy khác hoặc liên hệ seller transfer seat.',
      { code: 'AUTH', status: 403 },
    );
  }

  writePresence({ rows });
}

export function getSeatPresencePublicStatus(): {
  windowSec: number;
  activeRows: number;
} {
  const now = Math.floor(Date.now() / 1000);
  const rows = readPresence().rows.filter(
    (r) => now - r.lastSeenAt <= PRESENCE_WINDOW_SEC,
  );
  return { windowSec: PRESENCE_WINDOW_SEC, activeRows: rows.length };
}
