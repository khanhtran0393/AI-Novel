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
import { resolveEntitlementVerificationKeys } from '@/lib/entitlement';
import { isPackagedCustomerRuntime } from '@/lib/commercial/sellerRuntime';
import { AppError } from '@/lib/errors';
import {
  bypassFindingsAsReasons,
  classifyAntiTamperReasons,
  evaluateBypassProbes,
  getBypassProbePublicStatus,
  recordTamperSignal,
  touchDecoySurface,
} from '@/lib/commercial/labyrinth';

// Keep honeypot symbols in the commercial module graph (RE surface).
touchDecoySurface();

export { getBypassProbePublicStatus, evaluateBypassProbes };

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
  /** Expanded multi-signal bypass probe score (0 = clean) */
  bypassScore: number;
  bypassCategories: string[];
};

/**
 * Full stack check used before granting trial/pro features.
 * Keyring pins + expanded bypassProbe suite (canary multi-token, matrix, host, inject…).
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

  // Expanded multi-signal bypass detection (canaries, matrix, inject, host, clock…)
  const probes = evaluateBypassProbes();
  for (const r of bypassFindingsAsReasons(probes)) {
    if (!reasons.includes(r)) reasons.push(r);
  }

  return {
    ok: reasons.length === 0,
    packaged,
    reasons,
    keyringKids,
    expectedKids,
    bypassScore: probes.score,
    bypassCategories: probes.categories,
  };
}

export function assertAntiTamper(context = 'license'): void {
  const report = evaluateAntiTamper();
  if (report.ok) return;

  const { codes, strength } = classifyAntiTamperReasons(report.reasons);
  for (const code of codes) {
    recordTamperSignal({
      code,
      strength,
      origin: 'anti_tamper',
      layer: 2,
      detail: report.reasons[0]?.slice(0, 160),
    });
  }

  throw new AppError(
    `[anti-tamper/${context}] ${report.reasons.join('; ')}`,
    {
      code: 'AUTH',
      status: 403,
      details: {
        labyrinth: true,
        root: 'INTEGRITY_OR_BYPASS',
        origin: 'anti_tamper',
        signals: codes,
      },
    },
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
  bypassScore: number;
  bypassCategories: string[];
  bypass: ReturnType<typeof getBypassProbePublicStatus>;
} {
  const r = evaluateAntiTamper();
  const bypass = getBypassProbePublicStatus();
  return {
    ok: r.ok,
    packaged: r.packaged,
    keyringKids: r.keyringKids,
    pinCount: kidPins().size,
    // Don't leak full internal paths; short reasons ok for seller diagnostics
    reasons: r.reasons.slice(0, 8),
    bypassScore: r.bypassScore,
    bypassCategories: r.bypassCategories.slice(0, 12),
    bypass,
  };
}
