/**
 * Activation codes vault — seller pre-issues codes; buyer redeems with HWID.
 * File: data/licenses/activation-codes.json
 *
 * Code format: AINOVEL-XXXX-XXXX-XXXX (Crockford-ish uppercase)
 * Multi-seat: maxSeats (default 1) + seats[] of HWIDs that redeemed.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { issueEntitlementToken } from '@/lib/entitlement';

export type ActivationCodeRecord = {
  code: string;
  plan: 'pro';
  expSeconds: number;
  createdAt: number;
  /** Max concurrent machines (default 1) */
  maxSeats?: number;
  /** HWIDs that have redeemed this code */
  seats?: string[];
  /** Legacy single-seat fields (synced with seats[0]) */
  redeemedAt?: number;
  redeemedHwid?: string;
  note?: string;
  orderId?: string;
};

type CodeVault = {
  version: 1;
  codes: Record<string, ActivationCodeRecord>;
};

function vaultPath(): string {
  const root =
    process.env.AI_NOVEL_ROOT ||
    process.env.AINOVEL_DATA_ROOT ||
    process.cwd();
  return path.join(root, 'data', 'licenses', 'activation-codes.json');
}

function ensureDir(file: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

function loadVault(): CodeVault {
  const p = vaultPath();
  try {
    if (!fs.existsSync(p)) return { version: 1, codes: {} };
    const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as CodeVault;
    if (!raw || raw.version !== 1 || typeof raw.codes !== 'object') {
      return { version: 1, codes: {} };
    }
    return raw;
  } catch {
    return { version: 1, codes: {} };
  }
}

function saveVault(v: CodeVault) {
  const p = vaultPath();
  ensureDir(p);
  fs.writeFileSync(p, JSON.stringify(v, null, 2), 'utf8');
}

function segment(): string {
  return crypto.randomBytes(3).toString('hex').toUpperCase().slice(0, 4);
}

export function generateActivationCode(): string {
  return `AINOVEL-${segment()}-${segment()}-${segment()}`;
}

export function normalizeCode(code: string): string {
  return String(code || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}

/** Normalize legacy redeemedHwid → seats[] */
function normalizeSeats(rec: ActivationCodeRecord): string[] {
  if (Array.isArray(rec.seats) && rec.seats.length > 0) {
    return rec.seats.map((s) => String(s).trim().toLowerCase()).filter(Boolean);
  }
  if (rec.redeemedHwid) {
    return [String(rec.redeemedHwid).trim().toLowerCase()];
  }
  return [];
}

function syncLegacyFields(rec: ActivationCodeRecord): ActivationCodeRecord {
  // Historical VIP records remain redeemable, but the product tier is Pro.
  rec.plan = 'pro';
  const seats = normalizeSeats(rec);
  rec.seats = seats;
  rec.maxSeats = Math.max(1, rec.maxSeats ?? 1);
  if (seats.length > 0) {
    rec.redeemedHwid = seats[0];
    if (!rec.redeemedAt) rec.redeemedAt = Math.floor(Date.now() / 1000);
  } else {
    delete rec.redeemedHwid;
    delete rec.redeemedAt;
  }
  return rec;
}

export function createActivationCodes(options: {
  count?: number;
  plan?: 'pro';
  expSeconds?: number;
  note?: string;
  orderId?: string;
  /** Concurrent machines allowed (1–20). Default 1. */
  maxSeats?: number;
}): ActivationCodeRecord[] {
  const count = Math.max(1, Math.min(100, options.count ?? 1));
  const plan = 'pro' as const;
  const expSeconds = options.expSeconds ?? 60 * 60 * 24 * 365;
  const maxSeats = Math.max(1, Math.min(20, options.maxSeats ?? 1));
  const vault = loadVault();
  const out: ActivationCodeRecord[] = [];
  for (let i = 0; i < count; i++) {
    let code = generateActivationCode();
    while (vault.codes[code]) code = generateActivationCode();
    const rec: ActivationCodeRecord = syncLegacyFields({
      code,
      plan,
      expSeconds,
      createdAt: Math.floor(Date.now() / 1000),
      note: options.note,
      orderId: options.orderId,
      maxSeats,
      seats: [],
    });
    vault.codes[code] = rec;
    out.push(rec);
  }
  saveVault(vault);
  return out;
}

export function redeemActivationCode(
  rawCode: string,
  hwid: string,
): {
  ok: boolean;
  token?: string;
  plan?: 'pro';
  error?: string;
  alreadyRedeemedSameMachine?: boolean;
  /** Present when another machine already owns this single-seat code */
  alreadyBoundHwid?: string;
  seatsUsed?: number;
  maxSeats?: number;
} {
  const code = normalizeCode(rawCode);
  if (!code.startsWith('AINOVEL-')) {
    return { ok: false, error: 'Mã kích hoạt không đúng định dạng AINOVEL-…' };
  }
  const vault = loadVault();
  const rec = vault.codes[code];
  if (!rec) {
    return { ok: false, error: 'Mã không tồn tại hoặc đã bị thu hồi.' };
  }
  const id = String(hwid || '').trim().toLowerCase();
  if (!id) {
    return { ok: false, error: 'Thiếu HWID máy.' };
  }

  const maxSeats = Math.max(1, rec.maxSeats ?? 1);
  const seats = normalizeSeats(rec);

  // Same machine reinstall → re-issue token
  if (seats.includes(id)) {
    const token = issueEntitlementToken({
      is_pro: true,
      is_vip: false,
      plan: 'pro',
      hwid: id,
      expSeconds: rec.expSeconds,
    });
    return {
      ok: true,
      token,
      plan: 'pro',
      alreadyRedeemedSameMachine: true,
      seatsUsed: seats.length,
      maxSeats,
    };
  }

  if (seats.length >= maxSeats) {
    const bound = seats[0] || rec.redeemedHwid || '';
    const boundShort = bound
      ? bound.toUpperCase().slice(0, 16) + (bound.length > 16 ? '…' : '')
      : '?';
    return {
      ok: false,
      error:
        maxSeats <= 1
          ? `Mã đã được nhập rồi — gắn máy HWID ${boundShort}. Mỗi mã chỉ 1 HWID. Liên hệ seller nếu cần chuyển máy.`
          : `Mã đã đủ ${maxSeats} máy (đã gắn ${boundShort}…). Liên hệ seller để chuyển seat / nâng max seats.`,
      seatsUsed: seats.length,
      maxSeats,
      alreadyBoundHwid: bound || undefined,
    };
  }

  seats.push(id);
  rec.seats = seats;
  rec.maxSeats = maxSeats;
  if (!rec.redeemedAt) rec.redeemedAt = Math.floor(Date.now() / 1000);
  rec.redeemedHwid = seats[0];
  vault.codes[code] = rec;
  saveVault(vault);

  const token = issueEntitlementToken({
    is_pro: true,
    is_vip: false,
    plan: 'pro',
    hwid: id,
    expSeconds: rec.expSeconds,
  });
  return {
    ok: true,
    token,
    plan: 'pro',
    seatsUsed: seats.length,
    maxSeats,
  };
}

export function getActivationCode(rawCode: string): ActivationCodeRecord | null {
  const code = normalizeCode(rawCode);
  const vault = loadVault();
  const rec = vault.codes[code];
  if (!rec) return null;
  return syncLegacyFields({ ...rec });
}

/** Release one HWID seat so another machine can redeem. */
export function releaseSeat(
  rawCode: string,
  hwid: string,
): { ok: boolean; record?: ActivationCodeRecord; error?: string } {
  const code = normalizeCode(rawCode);
  const id = String(hwid || '').trim().toLowerCase();
  if (!id) return { ok: false, error: 'Thiếu HWID cần giải phóng.' };
  const vault = loadVault();
  const rec = vault.codes[code];
  if (!rec) return { ok: false, error: 'Mã không tồn tại.' };
  const seats = normalizeSeats(rec);
  if (!seats.includes(id)) {
    return { ok: false, error: 'HWID không có trong danh sách seat của mã này.' };
  }
  rec.seats = seats.filter((s) => s !== id);
  syncLegacyFields(rec);
  vault.codes[code] = rec;
  saveVault(vault);
  return { ok: true, record: { ...rec } };
}

export function setMaxSeats(
  rawCode: string,
  maxSeats: number,
): { ok: boolean; record?: ActivationCodeRecord; error?: string } {
  const code = normalizeCode(rawCode);
  const n = Math.max(1, Math.min(20, Math.floor(maxSeats)));
  const vault = loadVault();
  const rec = vault.codes[code];
  if (!rec) return { ok: false, error: 'Mã không tồn tại.' };
  const seats = normalizeSeats(rec);
  if (n < seats.length) {
    return {
      ok: false,
      error: `Đang có ${seats.length} seat — không hạ maxSeats xuống ${n}. Giải phóng seat trước.`,
    };
  }
  rec.maxSeats = n;
  syncLegacyFields(rec);
  vault.codes[code] = rec;
  saveVault(vault);
  return { ok: true, record: { ...rec } };
}

export function listActivationCodes(limit = 50): ActivationCodeRecord[] {
  const vault = loadVault();
  return Object.values(vault.codes)
    .map((c) => syncLegacyFields({ ...c }))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, Math.max(1, Math.min(500, limit)));
}

/** Human label for expSeconds (seller messages). */
export function formatExpSecondsLabel(expSeconds: number): string {
  const s = Math.max(0, Math.floor(expSeconds));
  const day = 60 * 60 * 24;
  if (s >= day * 365 * 40) return 'trọn đời (~50 năm)';
  if (s >= day * 365) {
    const y = Math.round(s / (day * 365));
    return y <= 1 ? '1 năm' : `${y} năm`;
  }
  if (s >= day) {
    const d = Math.round(s / day);
    return d <= 1 ? '1 ngày' : `${d} ngày`;
  }
  if (s >= 3600) {
    const h = Math.round(s / 3600);
    return h <= 1 ? '1 giờ' : `${h} giờ`;
  }
  return `${s}s`;
}

/**
 * Parse duration tokens used by Telegram/admin CLI:
 * month|year|lifetime | 30d | 12h | 90 (days if bare number ≥1)
 */
export function parseDurationToExpSeconds(
  raw: string | undefined | null,
): number | null {
  const t = String(raw || '')
    .trim()
    .toLowerCase();
  if (!t) return null;
  if (t === 'month' || t === 'm' || t === '1m' || t === 'thang' || t === 'tháng') {
    return 60 * 60 * 24 * 30;
  }
  if (t === 'year' || t === 'y' || t === '1y' || t === 'nam' || t === 'năm') {
    return 60 * 60 * 24 * 365;
  }
  if (
    t === 'lifetime' ||
    t === 'life' ||
    t === 'lt' ||
    t === 'tron' ||
    t === 'trọn' ||
    t === 'vĩnh' ||
    t === 'forever'
  ) {
    return 60 * 60 * 24 * 365 * 50;
  }
  const m = t.match(/^(\d+)\s*([dhm])?$/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 1) return null;
  const unit = (m[2] || 'd').toLowerCase();
  if (unit === 'h') return Math.min(n, 24 * 365 * 50) * 3600;
  if (unit === 'm') return Math.min(n, 60 * 24 * 365 * 50) * 60;
  // days (default)
  return Math.min(n, 365 * 50) * 60 * 60 * 24;
}
