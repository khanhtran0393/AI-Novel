/**
 * Free · Trial · Pro entitlement.
 *
 * Tokens are signed with Ed25519. Customer builds contain public verification
 * keys only; private signing keys stay on the seller machine / hosted backend.
 * This prevents a customer from extracting a shared HMAC secret and minting Pro.
 */

import crypto from 'crypto';
import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { AppError } from '@/lib/errors';
import { getTrialStatus, trialGrantsPro } from '@/lib/commercial/trial';
import {
  canAccessFeature,
  tierAtLeast,
  type CommercialFeatureId,
  type PlanTier,
} from '@/lib/commercial/featureMatrix';

export type EntitlementPlan = 'trial' | 'pro';

export type EntitlementClaims = {
  is_pro: boolean;
  is_vip: boolean;
  /** Trial token — Pro-equivalent for trial-tier features only */
  is_trial?: boolean;
  plan?: EntitlementPlan;
  exp: number; // unix seconds
  iat?: number;
  ver?: 2;
  license_id?: string;
  hwid?: string;
};

export type EntitlementMode = 'open' | 'enforce';

/** Customer packaged / publish builds always enforce — multi-signal (not one env). */
export function isCustomerPackagedRuntime(): boolean {
  // Lazy import avoided: keep sync and light — re-export from packagedAttestation
  // via inline multi-signal (same rules as packagedAttestation.ts).
  const e = (n: string) => {
    const v = String(process.env[n] || '')
      .trim()
      .toLowerCase();
    return v === '1' || v === 'true' || v === 'yes';
  };
  if (e('AI_NOVEL_PACKAGED') || e('AINOVEL_PUBLISH') || e('AINOVEL_ELECTRON_PACKAGED')) {
    return true;
  }
  const attest = String(process.env.AINOVEL_PACKAGED_ATTEST || '').trim();
  if (attest.startsWith('ainovel-pkg-') || /^[0-9a-f]{16,64}$/i.test(attest)) {
    return true;
  }
  return false;
}

export function getEntitlementMode(): EntitlementMode {
  // Defense L3: packaged customer cannot be switched to open via env.
  if (isCustomerPackagedRuntime()) return 'enforce';
  const m = (process.env.AINOVEL_ENTITLEMENT_MODE || 'open').toLowerCase();
  return m === 'enforce' ? 'enforce' : 'open';
}

export function isPackagedPublishHint(): boolean {
  return (
    isCustomerPackagedRuntime() || process.env.NODE_ENV === 'production'
  );
}

function decodeKeyMaterial(value: string): string | Buffer {
  const normalized = String(value || '').trim().replace(/\\n/g, '\n');
  if (!normalized) return '';
  if (normalized.includes('-----BEGIN')) return normalized;
  return Buffer.from(normalized, 'base64');
}

function readKeyFile(filePath: string | undefined): string {
  const p = String(filePath || '').trim();
  if (!p) return '';
  try {
    return fs.readFileSync(path.resolve(p), 'utf8').trim();
  } catch {
    return '';
  }
}

function publicKeyId(key: crypto.KeyObject): string {
  const der = key.export({ type: 'spki', format: 'der' });
  return crypto.createHash('sha256').update(der).digest('hex').slice(0, 16);
}

/** Bundled public keys (dev + packaged). Electron main also sets PUBLIC_KEYS_DIR. */
function defaultPublicKeysDir(): string {
  const candidates = [
    path.join(process.cwd(), 'resources', 'license', 'public-keys'),
    path.join(process.cwd(), 'license', 'public-keys'),
  ];
  for (const d of candidates) {
    try {
      if (fs.existsSync(d) && fs.statSync(d).isDirectory()) return d;
    } catch {
      /* ignore */
    }
  }
  return '';
}

/**
 * Seller private key on this machine (dev/seller only).
 * Never used when AI_NOVEL_PACKAGED=1 (customer app).
 */
function defaultSellerPrivateKeyFile(): string {
  if (
    process.env.AI_NOVEL_PACKAGED === '1' ||
    process.env.AINOVEL_PUBLISH === '1'
  ) {
    return '';
  }
  const localApp =
    process.env.LOCALAPPDATA ||
    process.env.XDG_DATA_HOME ||
    '';
  if (!localApp) return '';
  const p = path.join(localApp, 'AI Novel Seller', 'entitlement-private.pem');
  try {
    if (fs.existsSync(p)) return p;
  } catch {
    /* ignore */
  }
  return '';
}

function loadPublicKeyCandidates(): Array<string | Buffer> {
  const candidates: Array<string | Buffer> = [];
  const single =
    process.env.AINOVEL_ENTITLEMENT_PUBLIC_KEY ||
    readKeyFile(process.env.AINOVEL_ENTITLEMENT_PUBLIC_KEY_FILE);
  if (single) candidates.push(decodeKeyMaterial(single));

  const rawMany = String(process.env.AINOVEL_ENTITLEMENT_PUBLIC_KEYS || '').trim();
  if (rawMany) {
    try {
      const parsed = JSON.parse(rawMany) as unknown;
      const values = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === 'object'
          ? Object.values(parsed as Record<string, unknown>)
          : [];
      for (const value of values) {
        if (typeof value === 'string' && value.trim()) {
          candidates.push(decodeKeyMaterial(value));
        }
      }
    } catch {
      // Invalid key-ring JSON is handled as no usable keys below.
    }
  }

  const dir =
    String(process.env.AINOVEL_ENTITLEMENT_PUBLIC_KEYS_DIR || '').trim() ||
    defaultPublicKeysDir();
  if (dir) {
    try {
      for (const name of fs.readdirSync(path.resolve(dir)).sort()) {
        if (!/\.(pem|pub)$/i.test(name)) continue;
        const value = readKeyFile(path.join(dir, name));
        if (value) candidates.push(value);
      }
    } catch {
      // Missing key directory is surfaced by resolveEntitlementVerificationKeys.
    }
  }

  // Never seed keyring from private key on packaged customer builds
  // (private must not exist; if env leaks, ignore it).
  const packaged =
    process.env.AI_NOVEL_PACKAGED === '1' || process.env.AINOVEL_PUBLISH === '1';
  if (!packaged) {
    const privateValue =
      process.env.AINOVEL_ENTITLEMENT_PRIVATE_KEY ||
      readKeyFile(
        process.env.AINOVEL_ENTITLEMENT_PRIVATE_KEY_FILE ||
          defaultSellerPrivateKeyFile(),
      );
    if (privateValue) {
      try {
        const privateKey = crypto.createPrivateKey(decodeKeyMaterial(privateValue));
        candidates.push(
          crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }),
        );
      } catch {
        // Signing key validation happens separately.
      }
    }
  }
  return candidates;
}

export function resolveEntitlementVerificationKeys(): {
  ok: boolean;
  keys: Map<string, crypto.KeyObject>;
  reason?: string;
} {
  const keys = new Map<string, crypto.KeyObject>();
  for (const candidate of loadPublicKeyCandidates()) {
    try {
      const key = crypto.createPublicKey(candidate);
      if (key.asymmetricKeyType !== 'ed25519') continue;
      keys.set(publicKeyId(key), key);
    } catch {
      // Ignore malformed entries and require at least one valid Ed25519 key.
    }
  }
  if (keys.size === 0) {
    const packaged =
      process.env.AI_NOVEL_PACKAGED === '1' || process.env.AINOVEL_PUBLISH === '1';
    return {
      ok: false,
      keys,
      reason: packaged
        ? 'FAIL-CLOSED: bản packaged thiếu public keyring (resources/license/public-keys). Không xác minh được license — Pro tắt.'
        : 'Thiếu public key Ed25519 xác minh license. Cấu hình AINOVEL_ENTITLEMENT_PUBLIC_KEY_FILE hoặc key ring.',
    };
  }
  return { ok: true, keys };
}

/**
 * Packaged / enforce: refuse Pro path when keyring empty (never soft-open).
 * Call at activate / assert / status health.
 */
export function assertVerificationKeyringReady(): void {
  const verifier = resolveEntitlementVerificationKeys();
  if (verifier.ok) return;
  throw new AppError(
    verifier.reason ||
      'Thiếu public key license — fail-closed, không cấp Pro.',
    { code: 'INFRA', status: 503 },
  );
}

export function resolveEntitlementSigningKey(): {
  ok: boolean;
  key: crypto.KeyObject | null;
  kid?: string;
  reason?: string;
} {
  const raw =
    process.env.AINOVEL_ENTITLEMENT_PRIVATE_KEY ||
    readKeyFile(
      process.env.AINOVEL_ENTITLEMENT_PRIVATE_KEY_FILE ||
        defaultSellerPrivateKeyFile(),
    );
  if (!raw) {
    return {
      ok: false,
      key: null,
      reason:
        'Thiếu private key Ed25519 trên seller/backend. Đặt AINOVEL_ENTITLEMENT_PRIVATE_KEY_FILE hoặc chạy npm run commercial:secrets.',
    };
  }
  try {
    const key = crypto.createPrivateKey(decodeKeyMaterial(raw));
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('not-ed25519');
    return { ok: true, key, kid: publicKeyId(crypto.createPublicKey(key)) };
  } catch {
    return {
      ok: false,
      key: null,
      reason: 'Private key license không hợp lệ hoặc không phải Ed25519.',
    };
  }
}

function b64url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromB64url(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
  return Buffer.from(b64, 'base64');
}

/** Windows MachineGuid (stable across hostname renames). Empty on non-Windows / fail. */
function windowsMachineGuid(): string {
  if (process.platform !== 'win32') return '';
  try {
    const out = execSync(
      'reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid',
      { encoding: 'utf8', windowsHide: true, timeout: 5_000 },
    );
    const m = out.match(/MachineGuid\s+REG_SZ\s+(\S+)/i);
    return (m?.[1] || '').trim();
  } catch {
    return '';
  }
}

/** System volume serial (C: or first fixed disk) — extra anti-spoof signal. */
function windowsVolumeSerial(): string {
  if (process.platform !== 'win32') return '';
  try {
    const out = execSync(
      'wmic logicaldisk where "DeviceID=\'C:\'" get VolumeSerialNumber /value',
      { encoding: 'utf8', windowsHide: true, timeout: 5_000 },
    );
    const m = out.match(/VolumeSerialNumber=(\S+)/i);
    return (m?.[1] || '').trim();
  } catch {
    try {
      const out = execSync('vol C:', {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 5_000,
      });
      const m = out.match(/([0-9A-F]{4}-[0-9A-F]{4})/i);
      return (m?.[1] || '').replace(/-/g, '').trim();
    } catch {
      return '';
    }
  }
}

function cpuModelShort(): string {
  try {
    const c = os.cpus()?.[0]?.model || '';
    return c.replace(/\s+/g, ' ').trim().slice(0, 64);
  } catch {
    return '';
  }
}

function hashHwid(parts: string): string {
  return crypto.createHash('sha256').update(parts, 'utf8').digest('hex').slice(0, 16);
}

/** Legacy v1 fingerprint (hostname-based). Kept for token dual-accept. */
export function getHwidV1(): string {
  const node = os.hostname();
  const processor = os.arch();
  const system = os.type();
  const release = os.release();
  return hashHwid(`${node}|${processor}|${system}|${release}|ainovel-v1`);
}

/** v2 fingerprint (MachineGuid when available). */
export function getHwidV2(): string {
  const guid = windowsMachineGuid();
  const node = os.hostname();
  const processor = os.arch();
  if (guid) {
    return hashHwid(`${guid}|${processor}|ainovel-v2`);
  }
  // Non-Windows / no GUID: salt hostname path as v2 so still distinct from v1 string form
  return hashHwid(`${node}|${processor}|${os.type()}|ainovel-v2`);
}

/**
 * v3 multi-signal fingerprint (preferred for new licenses).
 * MachineGuid + volume serial + arch + CPU model — spoofing one registry value is harder.
 */
export function getHwidV3(): string {
  const guid = windowsMachineGuid() || `noguid:${os.hostname()}`;
  const vol = windowsVolumeSerial() || `novol:${os.homedir().slice(-12)}`;
  const processor = os.arch();
  const cpu = cpuModelShort() || 'nocpu';
  return hashHwid(`${guid}|${vol}|${processor}|${cpu}|ainovel-v3`);
}

/**
 * All HWID strings this machine may present (v3 → v2 → v1).
 * Token verify accepts any candidate so old licenses keep working after HWID upgrade.
 */
export function getHwidCandidates(): string[] {
  const list = [getHwidV3(), getHwidV2(), getHwidV1()].map((h) =>
    h.toLowerCase(),
  );
  return [...new Set(list)];
}

/** Stable device fingerprint for license binding (preferred = v3 multi-signal). */
export function getHwid(): string {
  return getHwidV3();
}

export function hwidMatchesClaim(claim: string | undefined | null): boolean {
  if (!claim || !String(claim).trim()) return true; // unbound token handled by caller policy
  const want = String(claim).trim().toLowerCase();
  return getHwidCandidates().some((c) => c === want);
}

/** Public verification status for UI / health (never exposes key material). */
export function getEntitlementPublicStatus(): {
  mode: EntitlementMode;
  open: boolean;
  publicKeyConfigured: boolean;
  signerConfigured: boolean;
  /** @deprecated compatibility aliases for older UI */
  secretConfigured: boolean;
  secretInsecure: boolean;
  adminKeyConfigured: boolean;
  publishHint: boolean;
  hwid: string;
  readyForCommercial: boolean;
  blockers: string[];
  keyringKids: string[];
  failClosedKeyring: boolean;
} {
  const mode = getEntitlementMode();
  const verifier = resolveEntitlementVerificationKeys();
  const signer = resolveEntitlementSigningKey();
  const publicKeyConfigured = verifier.ok;
  const adminKeyConfigured = Boolean(
    (process.env.AINOVEL_ENTITLEMENT_ADMIN_KEY || '').trim(),
  );
  const packaged = isCustomerPackagedRuntime();
  const blockers: string[] = [];
  if (mode !== 'enforce') {
    blockers.push('MODE chưa enforce (dev open — Pro mở tự do)');
  }
  if (!publicKeyConfigured) {
    blockers.push(verifier.reason || 'Thiếu public key xác minh license');
  }
  return {
    mode,
    open: mode === 'open',
    publicKeyConfigured,
    signerConfigured: signer.ok,
    secretConfigured: publicKeyConfigured,
    secretInsecure: !publicKeyConfigured,
    adminKeyConfigured,
    publishHint: isPackagedPublishHint(),
    hwid: getHwid(),
    readyForCommercial: blockers.length === 0,
    blockers,
    keyringKids: [...verifier.keys.keys()],
    failClosedKeyring: packaged && !publicKeyConfigured,
  };
}

function normalizeClaims(raw: EntitlementClaims): EntitlementClaims {
  // Collapse legacy VIP → Pro (product: Free | Trial | Pro only)
  const legacyPlan = (raw as unknown as { plan?: string }).plan;
  const legacyVip = !!raw.is_vip || legacyPlan === 'vip';
  const is_trial =
    !legacyVip && (!!raw.is_trial || raw.plan === 'trial');
  const is_pro = legacyVip || !!raw.is_pro || is_trial;
  let plan: EntitlementPlan | undefined;
  if (is_trial) plan = 'trial';
  else if (is_pro) plan = 'pro';
  const out: EntitlementClaims = {
    is_pro,
    // Never expose VIP on wire for new tokens; keep false for store/UI
    is_vip: false,
    exp: raw.exp,
  };
  if (raw.iat) out.iat = raw.iat;
  if (raw.ver === 2) out.ver = 2;
  if (raw.license_id) out.license_id = String(raw.license_id);
  if (is_trial) out.is_trial = true;
  if (plan) out.plan = plan;
  if (raw.hwid) out.hwid = String(raw.hwid).trim().toLowerCase();
  return out;
}

/** True when claims represent time-boxed trial (not paid Pro). */
export function claimsIsTrial(claims: EntitlementClaims | null | undefined): boolean {
  if (!claims) return false;
  if (claims.is_vip) return false;
  return !!claims.is_trial || claims.plan === 'trial';
}

/** Sign a v2 token. Private key must exist only on seller/backend. */
export function issueEntitlementToken(
  claims: Omit<EntitlementClaims, 'exp'> & { expSeconds?: number },
): string {
  const signer = resolveEntitlementSigningKey();
  if (!signer.ok || !signer.key || !signer.kid) {
    throw new AppError(signer.reason || 'License signer chưa cấu hình.', {
      code: 'INFRA',
      status: 503,
    });
  }
  const now = Math.floor(Date.now() / 1000);
  const exp = now + (claims.expSeconds ?? 60 * 60 * 24 * 30);
  // Issue: never write is_vip (Pro-only paid product)
  const is_trial = !!claims.is_trial || claims.plan === 'trial';
  const is_pro = !!claims.is_pro || !!claims.is_vip || is_trial;
  const plan: EntitlementPlan | undefined = is_trial
    ? 'trial'
    : is_pro
      ? 'pro'
      : undefined;
  const payload: EntitlementClaims = {
    is_pro,
    is_vip: false,
    exp,
    iat: now,
    ver: 2,
  };
  if (is_trial) payload.is_trial = true;
  if (plan) payload.plan = plan;
  if (claims.hwid && String(claims.hwid).trim()) {
    payload.hwid = String(claims.hwid).trim().toLowerCase();
  }
  if (claims.license_id && String(claims.license_id).trim()) {
    payload.license_id = String(claims.license_id).trim();
  }
  const body = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  const signingInput = `AINOVEL2.${signer.kid}.${body}`;
  const sig = b64url(crypto.sign(null, Buffer.from(signingInput, 'utf8'), signer.key));
  return `${signingInput}.${sig}`;
}

export function verifyEntitlementToken(
  token: string | null | undefined,
  options?: { requireHwidMatch?: boolean },
): EntitlementClaims | null {
  if (!token || typeof token !== 'string') return null;
  const [prefix, kid, body, sig] = token.trim().split('.');
  if (prefix !== 'AINOVEL2' || !kid || !body || !sig) return null;
  const verifier = resolveEntitlementVerificationKeys();
  if (!verifier.ok) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        '[entitlement] verify fail: no public keys loaded —',
        verifier.reason || 'missing PUBLIC_KEY / public-keys dir',
      );
    }
    return null;
  }
  const key = verifier.keys.get(kid);
  if (!key) {
    // Skip log for intentional anti-tamper canary (deadbeef…)
    if (
      process.env.NODE_ENV !== 'production' &&
      !/^deadbeef/i.test(kid)
    ) {
      console.warn(
        `[entitlement] verify fail: kid=${kid} not in keyring (have: ${[...verifier.keys.keys()].join(',') || 'none'}). Token signed by different key pair.`,
      );
    }
    return null;
  }
  const signingInput = `${prefix}.${kid}.${body}`;
  let valid = false;
  try {
    valid = crypto.verify(
      null,
      Buffer.from(signingInput, 'utf8'),
      key,
      fromB64url(sig),
    );
  } catch {
    return null;
  }
  if (!valid) return null;
  try {
    const raw = JSON.parse(fromB64url(body).toString('utf8')) as EntitlementClaims;
    const now = Math.floor(Date.now() / 1000);
    if (!raw || raw.ver !== 2 || typeof raw.exp !== 'number') return null;
    if (raw.exp < now) return null;
    if (raw.iat && raw.iat > now + 300) return null;
    const hwid = raw.hwid ? String(raw.hwid).trim().toLowerCase() : undefined;
    if (hwid && options?.requireHwidMatch !== false) {
      // Dual-accept v1 + v2 fingerprints on this machine
      if (!hwidMatchesClaim(hwid)) return null;
    }
    return normalizeClaims({
      ...raw,
      ...(hwid ? { hwid } : {}),
    });
  } catch {
    return null;
  }
}

export function extractEntitlementToken(req: Request, body?: unknown): string | null {
  const h =
    req.headers.get('x-ainovel-entitlement') ||
    req.headers.get('x-entitlement-token');
  if (h && h.trim()) return h.trim();
  if (body && typeof body === 'object' && body !== null) {
    const t = (body as { entitlementToken?: string }).entitlementToken;
    if (typeof t === 'string' && t.trim()) return t.trim();
  }
  return null;
}

function freeClaims(): EntitlementClaims {
  return {
    is_pro: false,
    is_vip: false,
    exp: Math.floor(Date.now() / 1000),
  };
}

/**
 * Resolve effective plan — **sync local path** (no Supabase).
 * Prefer {@link resolveRequestAccessAsync} so Supabase is authority when configured.
 */
export function resolveRequestAccess(req: Request, body?: unknown): {
  tier: PlanTier;
  claims: EntitlementClaims;
} {
  const nowExp = Math.floor(Date.now() / 1000) + 86400;

  if (getEntitlementMode() === 'open') {
    return {
      tier: 'pro',
      claims: {
        is_pro: true,
        is_vip: false,
        plan: 'pro',
        exp: nowExp,
      },
    };
  }

  try {
    const owner = (process.env.AINOVEL_OWNER_UNLIMITED || '').trim().toLowerCase();
    if (
      (owner === '1' || owner === 'true' || owner === 'yes') &&
      !isPackagedPublishHint()
    ) {
      return {
        tier: 'pro',
        claims: {
          is_pro: true,
          is_vip: false,
          plan: 'pro',
          exp: nowExp,
        },
      };
    }
  } catch {
    /* ignore */
  }

  const verifier = resolveEntitlementVerificationKeys();
  if (!verifier.ok) {
    throw new AppError(
      `License verifier misconfigured: ${verifier.reason} Không cấp Pro cho đến khi cấu hình public key.`,
      { code: 'INFRA', status: 503 },
    );
  }

  const token = extractEntitlementToken(req, body);
  const claims = verifyEntitlementToken(token, { requireHwidMatch: true });
  if (claims && (claims.is_pro || claims.is_vip || claimsIsTrial(claims))) {
    const tier: PlanTier = claimsIsTrial(claims)
      ? 'trial'
      : claims.is_pro || claims.is_vip
        ? 'pro'
        : 'free';
    return { tier, claims };
  }

  if (trialGrantsPro()) {
    const st = getTrialStatus();
    return {
      tier: 'trial',
      claims: {
        is_pro: true,
        is_vip: false,
        is_trial: true,
        plan: 'trial',
        exp: st.record?.endsAt ?? nowExp,
      },
    };
  }

  return { tier: 'free', claims: freeClaims() };
}

/**
 * Resolve plan — **Supabase `licenses` (HWID) is sole truth** when SERVICE_ROLE configured.
 *
 * Rules (LOCKED):
 * - Active row for machine HWID → trial/pro from ledger (not from token body alone)
 * - **No row / deleted / revoked / expired → Free** even if AINOVEL2 token still verifies
 * - Packaged customer without local SERVICE_ROLE: local ticket + remote heartbeat
 *   (LICENSE_API has Supabase); deleted cloud id → Free on next online probe
 * - open mode only: unrestricted Pro for local dev
 */
export async function resolveRequestAccessAsync(
  req: Request,
  body?: unknown,
): Promise<{
  tier: PlanTier;
  claims: EntitlementClaims;
  authority: 'open' | 'owner' | 'supabase' | 'local';
}> {
  const nowExp = Math.floor(Date.now() / 1000) + 86400;

  if (getEntitlementMode() === 'open') {
    return {
      tier: 'pro',
      authority: 'open',
      claims: {
        is_pro: true,
        is_vip: false,
        plan: 'pro',
        exp: nowExp,
      },
    };
  }

  try {
    const owner = (process.env.AINOVEL_OWNER_UNLIMITED || '').trim().toLowerCase();
    if (
      (owner === '1' || owner === 'true' || owner === 'yes') &&
      !isPackagedPublishHint()
    ) {
      return {
        tier: 'pro',
        authority: 'owner',
        claims: {
          is_pro: true,
          is_vip: false,
          plan: 'pro',
          exp: nowExp,
        },
      };
    }
  } catch {
    /* ignore */
  }

  // Dynamic import avoids circular dep with licenseBridge
  try {
    const { isSupabaseAdminConfigured } = await import('@/lib/supabase/env');
    if (isSupabaseAdminConfigured()) {
      const { createServiceSupabase } = await import('@/lib/supabase/server');
      const { resolveLicenseByHwid, verifyLicenseCloud } = await import(
        '@/lib/cloud/licenseBridge'
      );
      const service = createServiceSupabase();
      // Machine HWID only — body-supplied HWID is never authorization.
      const machineHwid = getHwid().toLowerCase();
      const token = extractEntitlementToken(req, body);

      /**
       * Align with GET /api/commercial/status (LICENSE_ONE_PATH ledger):
       * - Active `licenses` row for this HWID ⇒ Pro/Trial on UI **and** API gates
       * - Token is optional client cache; missing token must NOT demote Pro→Free
       *   when ledger still has active row (bug: badge PRO nhưng TTS 403 tts_premium)
       * - **Deleted** ledger row ⇒ Free even if token crypto still OK
       */
      if (token) {
        const cloud = await verifyLicenseCloud({
          service,
          token,
          hwid: machineHwid,
        });
        if (cloud.valid && cloud.claims) {
          const c = cloud.claims;
          const tier: PlanTier = claimsIsTrial(c)
            ? 'trial'
            : c.is_pro || c.is_vip
              ? 'pro'
              : 'free';
          if (tier !== 'free') {
            return { tier, claims: c, authority: 'supabase' };
          }
        }
        // Hard ledger denials only — never Free solely because local ticket hash drifts.
        // token_mismatch / claims_mismatch → fall through to HWID ledger (sole truth).
        const hardDeny =
          cloud.cloud?.revoked === true ||
          cloud.cloud?.status === 'none' ||
          cloud.cloud?.status === 'expired' ||
          cloud.cloud?.status === 'revoked';
        if (hardDeny) {
          return { tier: 'free', claims: freeClaims(), authority: 'supabase' };
        }
      }

      // Primary authority: same as commercial/status — HWID ledger (no token required)
      const byHwid = await resolveLicenseByHwid(service, machineHwid);
      if (byHwid.found && byHwid.claims) {
        const c = byHwid.claims;
        const tier: PlanTier = claimsIsTrial(c)
          ? 'trial'
          : c.is_pro || c.is_vip
            ? 'pro'
            : 'free';
        return { tier, claims: c, authority: 'supabase' };
      }

      // LICENSE_ONE_PATH: Supabase licenses(HWID) is SOLE truth.
      // No active row → Free. Local trial vault is NOT authority (ghost TRIAL badge ban).
      return { tier: 'free', claims: freeClaims(), authority: 'supabase' };
    }
  } catch (e) {
    // Supabase configured but query failed — fail closed in enforce
    if (getEntitlementMode() === 'enforce') {
      throw new AppError(
        `Không đọc được license Supabase: ${e instanceof Error ? e.message : String(e)}`,
        { code: 'INFRA', status: 503 },
      );
    }
  }

  // No SERVICE_ROLE on this process:
  // Packaged: local ticket + heartbeat (remote LICENSE_API has Supabase).
  // Dev/seller: resolveRequestAccess = Ed25519 ticket + local trial vault
  // (do NOT force Free here — that blocked Trial gates after "bật Trial").
  const local = resolveRequestAccess(req, body);
  return { ...local, authority: 'local' };
}

/**
 * Assert minimum plan tier (Supabase-first when configured).
 */
export async function assertTierAtLeast(
  req: Request,
  minTier: PlanTier,
  body?: unknown,
): Promise<EntitlementClaims> {
  // Fail-closed: no public keyring → never grant paid tiers
  if (minTier !== 'free') {
    assertVerificationKeyringReady();
    // Adversarial: pin keyring + packaged enforce + canary (anti-tamper)
    const { assertAntiTamper } = await import('@/lib/commercial/antiTamper');
    assertAntiTamper('assertTier');
  }
  const { tier, claims } = await resolveRequestAccessAsync(req, body);
  if (tierAtLeast(tier, minTier)) {
    if (minTier !== 'free') {
      // Packaged: online revoke heartbeat + offline grace
      const { enforcePackagedHeartbeat } = await import(
        '@/lib/commercial/licenseHeartbeat'
      );
      await enforcePackagedHeartbeat(req, body, claims);
    }
    return claims;
  }
  const need =
    minTier === 'pro'
      ? 'Pro (trả phí) — Trial không đủ'
      : minTier === 'trial'
        ? 'Pro/Trial'
        : 'license';
  throw new AppError(
    `Tính năng cần gói ${need}. Gói hiện tại lấy từ Supabase (HWID). Nhấp logo → Bản quyền / liên hệ admin cấp key.`,
    { code: 'AUTH', status: 403 },
  );
}

/** Assert feature by matrix id (server). */
export async function assertFeatureAccess(
  req: Request,
  featureId: CommercialFeatureId,
  body?: unknown,
): Promise<EntitlementClaims> {
  const row = (
    await import('@/lib/commercial/featureMatrix')
  ).FEATURE_MATRIX.find((f) => f.id === featureId);
  if (row && row.minTier !== 'free') {
    assertVerificationKeyringReady();
    const { assertAntiTamper } = await import('@/lib/commercial/antiTamper');
    assertAntiTamper(`feature:${featureId}`);
  }
  const { tier, claims } = await resolveRequestAccessAsync(req, body);
  if (!canAccessFeature(tier, featureId)) {
    throw new AppError(
      `Tính năng «${featureId}» cần gói cao hơn (hiện: ${tier}, nguồn Supabase/local). Nhấp logo app → Bản quyền.`,
      { code: 'AUTH', status: 403 },
    );
  }
  // Paid / trial features: packaged heartbeat + Phase C strict online for Pro IP
  if (row && row.minTier !== 'free') {
    const { enforcePackagedHeartbeat } = await import(
      '@/lib/commercial/licenseHeartbeat'
    );
    await enforcePackagedHeartbeat(req, body, claims);
    const { enforceStrictOnlineForFeature } = await import(
      '@/lib/commercial/onlineRevalidate'
    );
    await enforceStrictOnlineForFeature(req, featureId, body, claims);
  }
  return claims;
}

/**
 * Assert Pro-equivalent (trial | pro).
 * When Supabase configured: only active licenses row for HWID grants access.
 */
export async function assertProAccess(
  req: Request,
  body?: unknown,
): Promise<EntitlementClaims> {
  return assertTierAtLeast(req, 'trial', body);
}
