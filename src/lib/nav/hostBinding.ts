/**
 * Host binding for toolbox / NAV tools — mutual auth with python_core.
 *
 * App (Node) issues a short-lived host-binding HMAC token unrelated to licensing;
 * gateway/scripts refuse to run without a valid token in env AINOVEL_HOST_TOKEN.
 *
 * Hardening:
 * - Per-spawn secret (not process-long shared secret alone)
 * - Packaged forces enforce (cannot open via env on customer builds)
 * - Child env is a allowlist — does not dump seller secrets into Python
 *
 * Modes (AINOVEL_HOST_BINDING):
 * - enforce (default): require valid token
 * - open: skip check (dev emergency only; blocked when packaged)
 */

import crypto from 'crypto';
import { isPackagedCustomerRuntime } from '@/lib/commercial/packagedAttestation';

export const HOST_APP_NAME = 'AI Novel';

export type HostBindingMode = 'enforce' | 'open';

export function getHostBindingMode(): HostBindingMode {
  // Packaged customer: always enforce — env cannot open toolbox standalone
  if (isPackagedCustomerRuntime()) return 'enforce';
  const m = (process.env.AINOVEL_HOST_BINDING || 'enforce').toLowerCase();
  return m === 'open' || m === 'off' || m === '0' || m === 'false' ? 'open' : 'enforce';
}

/** Process fallback secret when not using per-spawn (tests / legacy). */
const PROCESS_HOST_BINDING_SECRET = crypto.randomBytes(32).toString('hex');

function b64url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export type HostTokenClaims = {
  host: string;
  exp: number;
  action: string;
  n: string;
  /** Bind generation epoch for forensic / anti-replay window */
  iat: number;
};

/** Issue a short-lived token for one spawn of a bound tool. */
export function issueHostToken(options?: {
  ttlSeconds?: number;
  action?: string;
  /** Override secret (per-spawn). Default: process secret. */
  secret?: string;
}): string {
  const secret = options?.secret || PROCESS_HOST_BINDING_SECRET;
  const now = Math.floor(Date.now() / 1000);
  const exp = now + Math.max(30, options?.ttlSeconds ?? 300);
  const payload: HostTokenClaims = {
    host: HOST_APP_NAME,
    exp,
    iat: now,
    action: (options?.action || '*').trim() || '*',
    n: crypto.randomBytes(8).toString('hex'),
  };
  const body = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  const sig = b64url(
    crypto.createHmac('sha256', secret).update(body).digest(),
  );
  return `${body}.${sig}`;
}

/**
 * Minimal env keys safe to forward into toolbox children.
 * Never forward seller private keys / admin / service role.
 */
const CHILD_ENV_ALLOW = new Set([
  'PATH',
  'PATHEXT',
  'SYSTEMROOT',
  'WINDIR',
  'TEMP',
  'TMP',
  'HOME',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMDATA',
  'PROGRAMFILES',
  'PROGRAMFILES(X86)',
  'COMSPEC',
  'NUMBER_OF_PROCESSORS',
  'PROCESSOR_ARCHITECTURE',
  'OS',
  'LANG',
  'LC_ALL',
  'PYTHONPATH',
  'PYTHONIOENCODING',
  'PYTHONUTF8',
  'CUDA_VISIBLE_DEVICES',
  'AINOVEL_DATA_ROOT',
  'AI_NOVEL_USER_DATA',
  'FFMPEG_PATH',
  'FFPROBE_PATH',
]);

function scrubbedParentEnv(): NodeJS.ProcessEnv {
  const out: Record<string, string | undefined> = {
    NODE_ENV: process.env.NODE_ENV,
  };
  for (const [k, v] of Object.entries(process.env)) {
    if (v == null) continue;
    const key = k.toUpperCase();
    if (CHILD_ENV_ALLOW.has(key) || CHILD_ENV_ALLOW.has(k)) {
      out[k] = v;
      continue;
    }
    // Allow AINOVEL_* public switches only (not secrets)
    if (
      key.startsWith('AINOVEL_') &&
      !/SECRET|PRIVATE|ADMIN|SERVICE_ROLE|TOKEN|PASSWORD|KEY_FILE|PRIVATE_KEY/i.test(
        key,
      )
    ) {
      // Still block entitlement private material patterns
      if (
        key.includes('ENTITLEMENT_PRIVATE') ||
        key.includes('ENTITLEMENT_ADMIN') ||
        key.includes('ENTITLEMENT_SECRET')
      ) {
        continue;
      }
      out[k] = v;
    }
  }
  return out as NodeJS.ProcessEnv;
}

/**
 * Env vars to merge into child process env when spawning bound tools.
 * Token TTL covers process *start*; long jobs may outlive the token after start.
 * Uses **per-spawn** HMAC secret so a leaked secret from one tool dies with it.
 */
export function hostBindingChildEnv(options?: {
  action?: string;
  /** Process timeout in ms — used to size token TTL. */
  timeoutMs?: number;
}): NodeJS.ProcessEnv {
  const timeoutMs = options?.timeoutMs ?? 600_000;
  const ttlSeconds = Math.max(120, Math.ceil(timeoutMs / 1000) + 60);
  const spawnSecret = crypto.randomBytes(32).toString('hex');
  const mode = getHostBindingMode();
  return {
    ...scrubbedParentEnv(),
    AINOVEL_HOST: '1',
    AINOVEL_HOST_APP: HOST_APP_NAME,
    AINOVEL_HOST_TOKEN: issueHostToken({
      action: options?.action,
      ttlSeconds,
      secret: spawnSecret,
    }),
    AINOVEL_HOST_BINDING: mode,
    AINOVEL_HOST_BINDING_SECRET: spawnSecret,
  };
}
