/**
 * Single source for UI-facing app version (package.json).
 * Electron packaged builds also use package.json via app.getVersion().
 */
import pkg from '../../package.json';

export const APP_VERSION: string = String(
  (pkg as { version?: string }).version || '0.0.0',
).trim();

export function formatAppVersionLabel(version: string = APP_VERSION): string {
  const v = String(version || '').trim();
  if (!v) return 'v?';
  return v.startsWith('v') || v.startsWith('V') ? v : `v${v}`;
}
