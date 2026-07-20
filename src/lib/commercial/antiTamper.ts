/**
 * Adversarial hardening for commercial desktop builds.
 *
 * Honest model: a determined reverse-engineer who patches asar/binary can still
 * break client-side checks. These layers raise cost and block common cracks:
 *  - swap public key → mint own tokens
 *  - force MODE=open / OWNER_UNLIMITED on packaged
 *  - leave seller private key in customer env
 *  - inject extra keyring entries
 *
 * Server/API gates + Ed25519 remain the real product boundary.
 */
import crypto from 'crypto';
import {
  resolveEntitlementVerificationKeys,
  verifyEntitlementToken,
} from '@/lib/entitlement';
import { isPackagedCustomerRuntime } from '@/lib/commercial/sellerRuntime';
import { AppError } from '@/lib/errors';

/**
 * Embedded keyring pins (kid = sha256(SPKI DER).slice(0,16)).
 * Must match resources/license/public-keys/*.pem shipped with the app.
 * Rotate: commercial:secrets → update this list + ship new build.
 */
export const EMBEDDED_KEYRING_KID_PINS: readonly string[] = [
  '3ac9c18a6691a09e',
];

/**
 * SPKI SHA-256 (base64) for the same keys — stronger than kid alone.
 * Generate: node scripts/print-keyring-pins.mjs
 */
export const EMBEDDED_KEYRING_SPKI_PINS: readonly string[] = [
  'OsnBimaRoJ57O4zig+7+jmNzcGRaTNoTbwai7QbbZes=',
];

function publicKeySpkiB64(key: crypto.KeyObject): string {
  const der = key.export({ type: 'spki', format: 'der' });
  return crypto.createHash('sha256').update(der).digest('base64');
}

function publicKeyKid(key: crypto.KeyObject): string {
  const der = key.export({ type: 'spki', format: 'der' });
  return crypto.createHash('sha256').update(der).digest('hex').slice(0, 16);
}

/** Env overrides for seller key rotation without code change (bundled public.env only). */
function kidPins(): Set<string> {
  const extra = String(process.env.AINOVEL_KEYRING_KID_PINS || '')
    .split(/[,\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return new Set([
    ...EMBEDDED_KEYRING_KID_PINS.map((k) => k.toLowerCase()),
    ...extra,
  ]);
}

function spkiPins(): Set<string> {
  const extra = String(process.env.AINOVEL_KEYRING_SPKI_PINS || '')
    .split(/[,\s]+/)
    .map((s) => s.trim().replace(/^sha256\//i, ''))
    .filter(Boolean);
  return new Set([...EMBEDDED_KEYRING_SPKI_PINS, ...extra]);
}

export type AntiTamperReport = {
  ok: boolean;
  packaged: boolean;
  reasons: string[];
  keyringKids: string[];
  expectedKids: string[];
};

/**
 * Full stack check used before granting trial/pro features.
 */
export function evaluateAntiTamper(): AntiTamperReport {
  const reasons: string[] = [];
  const packaged = isPackagedCustomerRuntime();
  const verifier = resolveEntitlementVerificationKeys();
  const keyringKids = [...verifier.keys.keys()];
  const expectedKids = [...kidPins()];

  if (!verifier.ok || verifier.keys.size === 0) {
    reasons.push(
      packaged
        ? 'FAIL-CLOSED: packaged thiếu public keyring'
        : 'Thiếu public keyring',
    );
  } else {
    const allowedKids = kidPins();
    const allowedSpki = spkiPins();
    // Reject unknown keys (attacker-injected public key for self-issued tokens)
    for (const [kid, key] of verifier.keys) {
      if (!allowedKids.has(kid.toLowerCase())) {
        reasons.push(`Keyring kid lạ bị từ chối: ${kid}`);
      }
      const spki = publicKeySpkiB64(key);
      if (allowedSpki.size > 0 && !allowedSpki.has(spki)) {
        reasons.push(`Keyring SPKI pin mismatch kid=${kid}`);
      }
      // Consistency: recomputed kid must match map key
      const recomputed = publicKeyKid(key);
      if (recomputed !== kid) {
        reasons.push(`Keyring map corrupt kid=${kid} recomputed=${recomputed}`);
      }
    }
    // At least one expected pin must be present
    const hasExpected = expectedKids.some((k) =>
      verifier.keys.has(k) ||
      [...verifier.keys.keys()].some((x) => x.toLowerCase() === k),
    );
    if (!hasExpected) {
      reasons.push(
        `Keyring thiếu pin mong đợi [${expectedKids.join(', ')}] — có thể bị thay public key`,
      );
    }
  }

  if (packaged) {
    // MODE open / owner escape must never work on customer builds
    const mode = (process.env.AINOVEL_ENTITLEMENT_MODE || '').toLowerCase();
    if (mode === 'open') {
      reasons.push('Packaged không được MODE=open (anti-tamper)');
    }
    const owner = (process.env.AINOVEL_OWNER_UNLIMITED || '')
      .trim()
      .toLowerCase();
    if (owner === '1' || owner === 'true' || owner === 'yes') {
      reasons.push('Packaged không được OWNER_UNLIMITED');
    }
    // Host-binding open on packaged = toolbox standalone escape
    const hostMode = (process.env.AINOVEL_HOST_BINDING || '').toLowerCase();
    if (
      hostMode === 'open' ||
      hostMode === 'off' ||
      hostMode === '0' ||
      hostMode === 'false'
    ) {
      reasons.push('Packaged không được AINOVEL_HOST_BINDING=open');
    }
    // Seller private material must not exist on customer machine process
    if (
      (process.env.AINOVEL_ENTITLEMENT_PRIVATE_KEY || '').trim() ||
      (process.env.AINOVEL_ENTITLEMENT_PRIVATE_KEY_FILE || '').trim() ||
      (process.env.AINOVEL_ENTITLEMENT_ADMIN_KEY || '').trim() ||
      (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
    ) {
      reasons.push(
        'Phát hiện secret seller trên process packaged — từ chối (leak/tamper)',
      );
    }
  }

  // Canary: verify must reject garbage (detect nop-patched verify returning always-ok)
  try {
    const bogus = verifyEntitlementToken(
      'AINOVEL2.deadbeefdeadbeef.e30.AAAA',
      { requireHwidMatch: false },
    );
    if (bogus && (bogus.is_pro || bogus.is_trial || bogus.is_vip)) {
      reasons.push('CANARY FAIL: verifyEntitlementToken chấp nhận token rác');
    }
  } catch {
    // throw is ok for garbage
  }

  return {
    ok: reasons.length === 0,
    packaged,
    reasons,
    keyringKids,
    expectedKids,
  };
}

export function assertAntiTamper(context = 'license'): void {
  const report = evaluateAntiTamper();
  if (report.ok) return;
  throw new AppError(
    `[anti-tamper/${context}] ${report.reasons.join('; ')}`,
    { code: 'AUTH', status: 403 },
  );
}

/**
 * Lightweight canary for health/status — never throws; returns report.
 */
export function getAntiTamperPublicStatus(): {
  ok: boolean;
  packaged: boolean;
  keyringKids: string[];
  pinCount: number;
  reasons: string[];
} {
  const r = evaluateAntiTamper();
  return {
    ok: r.ok,
    packaged: r.packaged,
    keyringKids: r.keyringKids,
    pinCount: kidPins().size,
    // Don't leak full internal paths; short reasons ok for seller diagnostics
    reasons: r.reasons.slice(0, 5),
  };
}
