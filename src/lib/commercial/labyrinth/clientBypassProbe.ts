/**
 * Browser-side bypass heuristics — expand "is app bypassed?" without locking UI.
 * Feeds clientShadow; never grants Pro; never destroys data.
 */

import {
  isLabyrinthClientShadow,
  setLabyrinthClientShadow,
} from './clientShadow';

export type ClientBypassFinding = {
  id: string;
  reason: string;
};

const ENTITLEMENT_LS_KEY = 'ainovel.entitlementToken';

function hasLocalToken(): boolean {
  try {
    if (typeof window === 'undefined') return false;
    return !!(window.localStorage.getItem(ENTITLEMENT_LS_KEY) || '').trim();
  } catch {
    return false;
  }
}

/**
 * Lightweight DOM/storage probes. Call after commercial/status + optional store flags.
 */
export function evaluateClientBypassProbes(opts?: {
  storeIsPro?: boolean;
  storeIsTrial?: boolean;
  storeIsVip?: boolean;
  antiTamperOk?: boolean;
  labyrinthCodes?: string[];
}): {
  ok: boolean;
  findings: ClientBypassFinding[];
  shouldShadow: boolean;
} {
  const findings: ClientBypassFinding[] = [];

  if (opts?.antiTamperOk === false) {
    findings.push({ id: 'server_anti_tamper', reason: 'Server antiTamper.ok=false' });
  }

  const codes = opts?.labyrinthCodes || [];
  if (
    codes.some((c) =>
      /MIRAGE|WRONG_PATH|CANARY|KEYRING|ANTI_TAMPER|DECOY|SPLIT|SECRET/i.test(
        String(c),
      ),
    )
  ) {
    findings.push({
      id: 'server_labyrinth',
      reason: 'Labyrinth recentCodes indicate tamper',
    });
  }

  // Cosmetic Pro without any token → classic local patch
  const cosmeticPro = !!(opts?.storeIsPro || opts?.storeIsVip || opts?.storeIsTrial);
  if (cosmeticPro && !hasLocalToken()) {
    // Trial/Pro without token can be open-mode dev — only flag if also antiTamper failed
    // or explicit crack globals exist. Still record soft finding for shadow when AT failed.
    if (opts?.antiTamperOk === false) {
      findings.push({
        id: 'cosmetic_pro_no_token',
        reason: 'Store Pro/Trial nhưng không có entitlement token',
      });
    }
  }

  // Crack-style globals sometimes injected
  try {
    if (typeof window !== 'undefined') {
      const w = window as unknown as Record<string, unknown>;
      const bait = [
        '__AINOVEL_UNLOCK__',
        '__PRO_UNLOCK__',
        'AINOVEL_FORCE_PRO',
        'crackPro',
        'unlockAllFeatures',
      ];
      for (const k of bait) {
        if (w[k] != null && w[k] !== false && w[k] !== 0 && w[k] !== '') {
          findings.push({
            id: 'global_unlock_hook',
            reason: `Window hook nghi bypass: ${k}`,
          });
          break;
        }
      }
    }
  } catch {
    /* ignore */
  }

  // localStorage crack flags
  try {
    if (typeof window !== 'undefined') {
      const keys = ['ainovel.forcePro', 'ainovel.crack', 'ainovel.bypass', 'pro_unlocked'];
      for (const k of keys) {
        const v = window.localStorage.getItem(k);
        if (v === '1' || v === 'true' || v === 'yes') {
          findings.push({
            id: 'storage_crack_flag',
            reason: `localStorage flag nghi bypass: ${k}`,
          });
          break;
        }
      }
    }
  } catch {
    /* ignore */
  }

  const shouldShadow = findings.length > 0;
  return {
    ok: findings.length === 0,
    findings,
    shouldShadow,
  };
}

/**
 * Apply client probes → shadow mode (UI still visible; wrong-path may run).
 */
export function applyClientBypassProbes(opts?: {
  storeIsPro?: boolean;
  storeIsTrial?: boolean;
  storeIsVip?: boolean;
  antiTamperOk?: boolean;
  labyrinthCodes?: string[];
}): { ok: boolean; findings: ClientBypassFinding[] } {
  const r = evaluateClientBypassProbes(opts);
  if (r.shouldShadow) {
    setLabyrinthClientShadow(true, r.findings[0]?.id || 'client_probe');
  } else if (isLabyrinthClientShadow() && opts?.antiTamperOk === true) {
    // Clear shadow only when server explicitly healthy and no client findings
    setLabyrinthClientShadow(false);
  }
  return { ok: r.ok, findings: r.findings };
}
