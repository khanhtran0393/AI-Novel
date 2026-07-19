/**
 * Activation codes vault — seller pre-issues codes; buyer redeems once with HWID.
 * File: data/licenses/activation-codes.json
 *
 * Code format: AINOVEL-XXXX-XXXX-XXXX (Crockford-ish uppercase)
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { issueEntitlementToken } from '@/lib/entitlement';

export type ActivationCodeRecord = {
  code: string;
  plan: 'pro' | 'vip';
  expSeconds: number;
  createdAt: number;
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

export function createActivationCodes(options: {
  count?: number;
  plan?: 'pro' | 'vip';
  expSeconds?: number;
  note?: string;
  orderId?: string;
}): ActivationCodeRecord[] {
  const count = Math.max(1, Math.min(100, options.count ?? 1));
  const plan = options.plan === 'vip' ? 'vip' : 'pro';
  const expSeconds = options.expSeconds ?? 60 * 60 * 24 * 365;
  const vault = loadVault();
  const out: ActivationCodeRecord[] = [];
  for (let i = 0; i < count; i++) {
    let code = generateActivationCode();
    while (vault.codes[code]) code = generateActivationCode();
    const rec: ActivationCodeRecord = {
      code,
      plan,
      expSeconds,
      createdAt: Math.floor(Date.now() / 1000),
      note: options.note,
      orderId: options.orderId,
    };
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
  plan?: 'pro' | 'vip';
  error?: string;
  alreadyRedeemedSameMachine?: boolean;
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
  if (rec.redeemedAt && rec.redeemedHwid) {
    if (rec.redeemedHwid === id) {
      // Re-issue token for same machine (reinstall)
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
      };
    }
    return {
      ok: false,
      error: 'Mã đã gắn máy khác. Liên hệ seller để chuyển license.',
    };
  }

  rec.redeemedAt = Math.floor(Date.now() / 1000);
  rec.redeemedHwid = id;
  vault.codes[code] = rec;
  saveVault(vault);

  const token = issueEntitlementToken({
    is_pro: true,
    is_vip: false,
    plan: 'pro',
    hwid: id,
    expSeconds: rec.expSeconds,
  });
  return { ok: true, token, plan: 'pro' };
}

export function listActivationCodes(limit = 50): ActivationCodeRecord[] {
  const vault = loadVault();
  return Object.values(vault.codes)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, Math.max(1, Math.min(500, limit)));
}
