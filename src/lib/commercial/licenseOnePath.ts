/**
 * License One-Path — canonical commercial integration policy.
 *
 * Private key = sign only (seller/bridge). Token = ticket, never AES/content key.
 * Crown IP = cloud execution / server TTL content key.
 *
 * Full narrative: docs/LICENSE_ONE_PATH.md
 */

import { AppError } from '@/lib/errors';

export const LICENSE_ONE_PATH_VERSION = 1 as const;

/** Patterns agents and future code MUST NOT implement. */
export const FORBIDDEN_UNLOCK_PATTERNS = [
  'derive_aes_from_token_text',
  'substring_token_as_module_key',
  'private_key_on_client',
  'request_count_inside_private_key',
  'client_only_request_counter_as_authority',
] as const;

export type ForbiddenUnlockPattern =
  (typeof FORBIDDEN_UNLOCK_PATTERNS)[number];

/** Approved ways to “open” crown-jewel logic after a valid ticket. */
export const APPROVED_CONTENT_UNLOCK = [
  /** Seedance / psych / future: run IP on pinned license host */
  'cloud_ip_execution',
  /** Optional future: server returns short-lived random content key (not f(token)) */
  'server_ttl_content_key',
  /** Free write/prompt/image — local, no crown secret */
  'local_free_or_non_ip',
  /** Gate only: assertFeature / assertPremium — no decrypt */
  'server_gate_only',
] as const;

export type ApprovedContentUnlock =
  (typeof APPROVED_CONTENT_UNLOCK)[number];

export type LicensePathLayerId = 'A_ticket' | 'B_ledger' | 'C_crown_ip';

export const LICENSE_PATH_LAYERS: Record<
  LicensePathLayerId,
  { title: string; owner: string; summary: string }
> = {
  A_ticket: {
    title: 'Vé (ticket)',
    owner: 'src/lib/entitlement.ts',
    summary:
      'Ed25519 AINOVEL2 · public verify · HWID · exp · kid/SPKI pin — private key never on customer',
  },
  B_ledger: {
    title: 'Sổ cái (ledger)',
    owner: 'Supabase + licenseHeartbeat + commercial/status',
    summary:
      'active/revoked/plan/seat by HWID · heartbeat — NO daily request quota (product rejected)',
  },
  C_crown_ip: {
    title: 'IP đắt (crown)',
    owner: 'src/lib/commercial/ip/* + /api/cloud/ip/*',
    summary:
      'Cloud IP execution (seedance/psych) — never f(token_text) / private key bytes',
  },
};

/**
 * Explicit product rejections — agents must not re-introduce these.
 */
export const LICENSE_OUT_OF_SCOPE = {
  daily_request_quota_supabase: {
    status: 'rejected' as const,
    reason:
      'Pro within license term is not metered per-request/day; ledger is active/revoked/plan/seat only',
  },
  token_text_as_content_key: {
    status: 'rejected' as const,
    reason: 'Token is a ticket; deriving AES from token text fails against any Pro holder + RE',
  },
  private_key_on_client: {
    status: 'rejected' as const,
    reason: 'Private key signs only on seller/bridge; never shipped to customer app',
  },
  request_count_inside_private_key: {
    status: 'rejected' as const,
    reason: 'Ed25519 private material is fixed keypair material, not a mutable counter',
  },
} as const;

export const LICENSE_PATH_ENTRYPOINTS = {
  ui: 'src/app/workspace/features/license/LicenseModal.tsx',
  tokenStorage: 'localStorage.ainovel.entitlementToken',
  header: 'x-ainovel-entitlement',
  activate: '/api/entitlement/activate',
  status: '/api/commercial/status',
  gate: 'src/lib/commercial/apiGate.ts + proGateHard.ts',
  cloudIp: '/api/cloud/ip/*',
  docs: 'docs/LICENSE_ONE_PATH.md',
} as const;

export function isForbiddenUnlockPattern(
  id: string,
): id is ForbiddenUnlockPattern {
  return (FORBIDDEN_UNLOCK_PATTERNS as readonly string[]).includes(id);
}

export function isApprovedContentUnlock(
  id: string,
): id is ApprovedContentUnlock {
  return (APPROVED_CONTENT_UNLOCK as readonly string[]).includes(id);
}

/**
 * Call at the start of crown-IP bridges so future code cannot silently
 * switch to token-derived keys without failing smoke/type checks.
 */
export function assertApprovedContentUnlock(
  method: ApprovedContentUnlock,
  context = 'content-unlock',
): void {
  if (!isApprovedContentUnlock(method)) {
    throw new AppError(
      `[license-one-path/${context}] unlock method không được duyệt: ${String(method)}. ` +
        `Xem docs/LICENSE_ONE_PATH.md — cấm f(token) / private trên client.`,
      { code: 'INFRA', status: 500 },
    );
  }
  if (method === 'server_ttl_content_key') {
    // Reserved: implement only with random server secret, never token slice.
    return;
  }
}

/**
 * Hard ban helpers — use when a code path is tempted to treat token bytes as keys.
 */
export function rejectTokenDerivedContentKey(
  attemptedMethod: string,
  context = 'content-unlock',
): never {
  throw new AppError(
    `[license-one-path/${context}] CẤM derive content key từ text token ` +
      `(attempted=${attemptedMethod}). Token = vé; IP = cloud/server secret. ` +
      `docs/LICENSE_ONE_PATH.md`,
    { code: 'INFRA', status: 500 },
  );
}

/** Public JSON for GET /api/commercial/status (debug + agent alignment). */
export function getLicenseOnePathPublicStatus(): {
  version: typeof LICENSE_ONE_PATH_VERSION;
  model: 'ticket_ledger_cloud_ip';
  privateKeyRole: 'sign_only';
  tokenRole: 'ticket_not_content_key';
  /** Daily quota intentionally not part of product */
  dailyQuota: false;
  layers: typeof LICENSE_PATH_LAYERS;
  entryPoints: typeof LICENSE_PATH_ENTRYPOINTS;
  forbidden: readonly ForbiddenUnlockPattern[];
  approvedUnlock: readonly ApprovedContentUnlock[];
  outOfScope: typeof LICENSE_OUT_OF_SCOPE;
  docs: string;
  complete: {
    policyModule: true;
    statusField: true;
    cloudIpBridges: true;
    smoke: true;
    dailyQuota: false;
  };
} {
  return {
    version: LICENSE_ONE_PATH_VERSION,
    model: 'ticket_ledger_cloud_ip',
    privateKeyRole: 'sign_only',
    tokenRole: 'ticket_not_content_key',
    dailyQuota: false,
    layers: LICENSE_PATH_LAYERS,
    entryPoints: LICENSE_PATH_ENTRYPOINTS,
    forbidden: FORBIDDEN_UNLOCK_PATTERNS,
    approvedUnlock: APPROVED_CONTENT_UNLOCK,
    outOfScope: LICENSE_OUT_OF_SCOPE,
    docs: LICENSE_PATH_ENTRYPOINTS.docs,
    complete: {
      policyModule: true,
      statusField: true,
      cloudIpBridges: true,
      smoke: true,
      dailyQuota: false,
    },
  };
}
