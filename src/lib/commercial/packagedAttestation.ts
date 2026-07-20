/**
 * Multi-signal packaged-customer detection (defense L3).
 *
 * Attacker must clear *all* signals to fake "dev open" — not just one env var.
 * main.js sets AI_NOVEL_PACKAGED + AINOVEL_PUBLISH + AINOVEL_ELECTRON_PACKAGED
 * + AINOVEL_PACKAGED_ATTEST on customer builds.
 */

import fs from 'fs';
import path from 'path';

/** Expected attest prefix material (not secret — presence + shape check). */
export const PACKAGED_ATTEST_PREFIX = 'ainovel-pkg-';

export type PackagedSignalReport = {
  packaged: boolean;
  signals: string[];
  score: number;
};

function envTruthy(name: string): boolean {
  const v = String(process.env[name] || '')
    .trim()
    .toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/** Layout heuristics: asar / resources next to Electron. */
function detectPackagedLayout(): boolean {
  try {
    const resources =
      String(process.env.ELECTRON_RESOURCES_PATH || '').trim() ||
      // Electron may inject via main
      String((process as NodeJS.Process & { resourcesPath?: string }).resourcesPath || '').trim();
    if (resources) {
      const asar = path.join(resources, 'app.asar');
      if (fs.existsSync(asar)) return true;
      const appDir = path.join(resources, 'app');
      if (fs.existsSync(path.join(appDir, 'package.json'))) {
        // Unpacked asar still under resources/app in some builds
        const pkg = path.join(resources, '..', 'AI Novel.exe');
        if (fs.existsSync(pkg) || fs.existsSync(path.join(resources, '..', 'AINovel.exe'))) {
          return true;
        }
      }
    }
    const cwd = process.cwd();
    if (/[\\/]resources[\\/]app(\.asar)?/i.test(cwd)) return true;
    if (cwd.toLowerCase().includes('app.asar')) return true;
  } catch {
    /* ignore */
  }
  return false;
}

function attestLooksValid(): boolean {
  const raw = String(process.env.AINOVEL_PACKAGED_ATTEST || '').trim();
  if (!raw) return false;
  // main sets ainovel-pkg-<16 hex>
  if (raw.startsWith(PACKAGED_ATTEST_PREFIX) && raw.length >= PACKAGED_ATTEST_PREFIX.length + 8) {
    return true;
  }
  // Accept pure 16-hex build stamp
  if (/^[0-9a-f]{16,64}$/i.test(raw)) return true;
  return false;
}

/**
 * Collect all signals. score >= 1 → treat as packaged customer runtime.
 * Prefer over-flagging packaged (fail closed) rather than under-flagging.
 */
export function evaluatePackagedSignals(): PackagedSignalReport {
  const signals: string[] = [];
  if (envTruthy('AI_NOVEL_PACKAGED')) signals.push('AI_NOVEL_PACKAGED');
  if (envTruthy('AINOVEL_PUBLISH')) signals.push('AINOVEL_PUBLISH');
  if (envTruthy('AINOVEL_ELECTRON_PACKAGED')) signals.push('AINOVEL_ELECTRON_PACKAGED');
  if (attestLooksValid()) signals.push('AINOVEL_PACKAGED_ATTEST');
  if (detectPackagedLayout()) signals.push('layout:asar_or_resources');

  return {
    packaged: signals.length > 0,
    signals,
    score: signals.length,
  };
}

/** True for customer packaged / publish builds — multi-signal. */
export function isPackagedCustomerRuntime(): boolean {
  return evaluatePackagedSignals().packaged;
}

/** Alias used by licenseTrust / entitlement naming. */
export function isCustomerPackagedRuntime(): boolean {
  return isPackagedCustomerRuntime();
}

/**
 * Soft public status for commercial/status diagnostics (no secrets).
 */
export function getPackagedAttestationPublicStatus(): {
  packaged: boolean;
  signalCount: number;
  signals: string[];
} {
  const r = evaluatePackagedSignals();
  return {
    packaged: r.packaged,
    signalCount: r.score,
    signals: r.signals,
  };
}
