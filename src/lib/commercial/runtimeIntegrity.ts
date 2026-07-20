/**
 * Lightweight runtime integrity for packaged builds.
 * Not a full DRM — raises cost of silent nop patches on critical exports.
 */
import crypto from 'crypto';
import {
  EMBEDDED_KEYRING_KID_PINS,
  EMBEDDED_KEYRING_SPKI_PINS,
  evaluateAntiTamper,
} from '@/lib/commercial/antiTamper';
import { BUILTIN_LICENSE_API_HOSTS } from '@/lib/commercial/licenseTrust';
import { isPackagedCustomerRuntime } from '@/lib/commercial/sellerRuntime';
import { AppError } from '@/lib/errors';

/** Build-time-ish fingerprint of embedded pins (must not be empty / zeroed). */
export function embeddedPinsDigest(): string {
  const material = [
    ...EMBEDDED_KEYRING_KID_PINS,
    ...EMBEDDED_KEYRING_SPKI_PINS,
    ...BUILTIN_LICENSE_API_HOSTS,
  ].join('|');
  return crypto.createHash('sha256').update(material, 'utf8').digest('hex').slice(0, 16);
}

const EXPECTED_PIN_DIGEST_PREFIX = 'a'; // non-empty canary — real check is structure

export function evaluateRuntimeIntegrity(): {
  ok: boolean;
  reasons: string[];
  pinsDigest: string;
} {
  const reasons: string[] = [];
  const pinsDigest = embeddedPinsDigest();

  if (!EMBEDDED_KEYRING_KID_PINS.length || !EMBEDDED_KEYRING_SPKI_PINS.length) {
    reasons.push('Embedded keyring pins empty (tamper/build error)');
  }
  if (!BUILTIN_LICENSE_API_HOSTS.length) {
    reasons.push('Builtin license hosts empty');
  }
  // Pins must look like hex kids / base64 spki
  for (const kid of EMBEDDED_KEYRING_KID_PINS) {
    if (!/^[0-9a-f]{16}$/i.test(kid)) {
      reasons.push(`Malformed kid pin: ${kid}`);
    }
  }
  for (const spki of EMBEDDED_KEYRING_SPKI_PINS) {
    if (spki.length < 20) reasons.push('Malformed SPKI pin');
  }
  if (!pinsDigest || pinsDigest.length < 8) {
    reasons.push('pinsDigest invalid');
  }
  if (!EXPECTED_PIN_DIGEST_PREFIX) {
    reasons.push('digest canary corrupted');
  }

  // Cross-check anti-tamper evaluation structure
  try {
    const at = evaluateAntiTamper();
    if (typeof at.ok !== 'boolean' || !Array.isArray(at.reasons)) {
      reasons.push('antiTamper report shape broken');
    }
  } catch (e) {
    reasons.push(
      `antiTamper threw: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  return { ok: reasons.length === 0, reasons, pinsDigest };
}

export function assertRuntimeIntegrity(context = 'runtime'): void {
  if (!isPackagedCustomerRuntime()) {
    // Still validate pin structure in all modes (cheap)
    const r = evaluateRuntimeIntegrity();
    if (!r.ok && r.reasons.some((x) => x.includes('empty') || x.includes('Malformed'))) {
      throw new AppError(`[integrity/${context}] ${r.reasons.join('; ')}`, {
        code: 'INFRA',
        status: 503,
      });
    }
    return;
  }
  const r = evaluateRuntimeIntegrity();
  if (!r.ok) {
    throw new AppError(`[integrity/${context}] ${r.reasons.join('; ')}`, {
      code: 'AUTH',
      status: 403,
    });
  }
}
