/**
 * Honeypot unlock surfaces — look attractive to RE, never grant Pro.
 * App UI/API must NOT call these for real entitlement.
 * Side-effect import from antiTamper keeps symbols in the commercial graph.
 */
import { recordTamperSignal } from './signals';
import { denyThroughCascade } from './cascade';

let touched = false;

/** Keep decoy graph referenced so bundlers do not DCE the surface entirely. */
export function touchDecoySurface(): void {
  touched = true;
  void unlockProLocal;
  void applyLicenseDatFile;
  void deriveModuleKeyFromToken;
  void forceOpenEntitlementMode;
}

export function isDecoySurfaceTouched(): boolean {
  return touched;
}

/**
 * Honeypot: "local Pro unlock". Always fails closed + records DECOY_UNLOCK_HIT.
 * If patched to return true, real mesh (proGateHard / cloud crown) still denies.
 */
export function unlockProLocal(_code?: string): {
  ok: false;
  pro: false;
  error: string;
} {
  recordTamperSignal({
    code: 'DECOY_UNLOCK_HIT',
    strength: 2,
    detail: 'unlockProLocal',
  });
  return {
    ok: false,
    pro: false,
    error: 'Local unlock path disabled — use License modal (AINOVEL2 ticket).',
  };
}

/**
 * Honeypot: legacy license.dat applicator. Never unlocks.
 */
export function applyLicenseDatFile(_filePath?: string): never {
  recordTamperSignal({
    code: 'DECOY_UNLOCK_HIT',
    strength: 2,
    detail: 'applyLicenseDatFile',
  });
  denyThroughCascade({
    origin: 'anti_tamper',
    sessionKey: 'decoy_license_dat',
    tamperSuspected: true,
    signalCode: 'DECOY_UNLOCK_HIT',
    strength: 2,
    detail: 'license.dat honeypot',
  });
}

/**
 * Honeypot: f(token) style key derivation — forbidden by one-path; always throws.
 */
export function deriveModuleKeyFromToken(_token?: string): never {
  recordTamperSignal({
    code: 'DECOY_UNLOCK_HIT',
    strength: 3,
    detail: 'deriveModuleKeyFromToken',
  });
  throw new Error(
    'FORBIDDEN: token is a ticket only — see docs/LICENSE_ONE_PATH.md',
  );
}

/**
 * Honeypot: force MODE=open from JS. Does not change mode; records signal.
 */
export function forceOpenEntitlementMode(): boolean {
  recordTamperSignal({
    code: 'DECOY_UNLOCK_HIT',
    strength: 2,
    detail: 'forceOpenEntitlementMode',
  });
  return false;
}

/** Env names that look like crack switches — checked by anti-tamper canary. */
export const DECOY_CRACK_ENV_NAMES = [
  'AINOVEL_CRACK_ME',
  'AINOVEL_FORCE_PRO',
  'AINOVEL_BYPASS_LICENSE',
  'AINOVEL_UNLOCK_ALL',
] as const;

export function detectDecoyCrackEnv(): string | null {
  for (const name of DECOY_CRACK_ENV_NAMES) {
    const v = String(process.env[name] || '')
      .trim()
      .toLowerCase();
    if (v === '1' || v === 'true' || v === 'yes') {
      return name;
    }
  }
  return null;
}
