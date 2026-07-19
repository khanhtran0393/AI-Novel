/**
 * Host binding for toolbox / NAV tools — mutual auth with python_core.
 *
 * App (Node) issues a short-lived host-binding HMAC token unrelated to licensing;
 * gateway/scripts refuse to run
 * without a valid token in env AINOVEL_HOST_TOKEN.
 *
 * Modes (AINOVEL_HOST_BINDING):
 * - enforce (default): require valid token
 * - open: skip check (dev emergency only)
 *
 * No binary encryption — binding only. Compile/Nuitka comes later.
 */

import crypto from 'crypto';

export const HOST_APP_NAME = 'AI Novel';

export type HostBindingMode = 'enforce' | 'open';

export function getHostBindingMode(): HostBindingMode {
  const m = (process.env.AINOVEL_HOST_BINDING || 'enforce').toLowerCase();
  return m === 'open' || m === 'off' || m === '0' || m === 'false' ? 'open' : 'enforce';
}

const PROCESS_HOST_BINDING_SECRET = crypto.randomBytes(32).toString('hex');

function hostBindingSecret(): string {
  return process.env.AINOVEL_HOST_BINDING_SECRET || PROCESS_HOST_BINDING_SECRET;
}

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
};

/** Issue a short-lived token for one spawn of a bound tool. */
export function issueHostToken(options?: {
  ttlSeconds?: number;
  action?: string;
}): string {
  const exp =
    Math.floor(Date.now() / 1000) + Math.max(30, options?.ttlSeconds ?? 300);
  const payload: HostTokenClaims = {
    host: HOST_APP_NAME,
    exp,
    action: (options?.action || '*').trim() || '*',
    n: crypto.randomBytes(8).toString('hex'),
  };
  const body = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  const sig = b64url(
    crypto.createHmac('sha256', hostBindingSecret()).update(body).digest(),
  );
  return `${body}.${sig}`;
}

/**
 * Env vars to merge into child process env when spawning bound tools.
 * Token TTL covers process *start*; long jobs may outlive the token after start.
 */
export function hostBindingChildEnv(options?: {
  action?: string;
  /** Process timeout in ms — used to size token TTL. */
  timeoutMs?: number;
}): NodeJS.ProcessEnv {
  const timeoutMs = options?.timeoutMs ?? 600_000;
  const ttlSeconds = Math.max(120, Math.ceil(timeoutMs / 1000) + 60);
  return {
    ...process.env,
    AINOVEL_HOST: '1',
    AINOVEL_HOST_APP: HOST_APP_NAME,
    AINOVEL_HOST_TOKEN: issueHostToken({
      action: options?.action,
      ttlSeconds,
    }),
    AINOVEL_HOST_BINDING: getHostBindingMode(),
    AINOVEL_HOST_BINDING_SECRET: hostBindingSecret(),
  };
}
