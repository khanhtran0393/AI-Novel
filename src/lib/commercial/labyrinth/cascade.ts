/**
 * Multi-layer deny surface: one root (INTEGRITY_OR_BYPASS), progressive messages
 * only when tamper is suspected. Legitimate auth failures stay single-message.
 */
import { AppError } from '@/lib/errors';
import { isPackagedCustomerRuntime } from '@/lib/commercial/packagedAttestation';
import {
  bumpSession,
  getOrCreateSession,
  recordTamperSignal,
  sessionHasTamper,
} from './signals';
import type {
  CascadeLayer,
  FailOrigin,
  TamperRootCode,
  TamperSignalCode,
  TamperStrength,
} from './types';

export const CASCADE_ROOT: TamperRootCode = 'INTEGRITY_OR_BYPASS';

/** Stable VN messages — support-friendly wording, no "you are a cracker". */
export const CASCADE_LAYER_MESSAGES: Record<CascadeLayer, string> = {
  1: 'License token không verify (chữ ký/HWID/hết hạn).',
  2: 'Kiểm tra toàn vẹn license (keyring/canary) thất bại.',
  3: 'Xác thực kép license thất bại.',
  4: 'Phiên bản quyền cần xác thực lại (heartbeat/ledger).',
  5: 'Dịch vụ bản quyền không khả dụng — liên hệ hỗ trợ kèm mã máy (HWID).',
};

const ORIGIN_LAYER: Record<FailOrigin, CascadeLayer> = {
  token_verify: 1,
  pro_access: 1,
  feature_access: 1,
  anti_tamper: 2,
  integrity: 2,
  keyring: 2,
  recheck: 3,
  seat: 3,
  hwid_rebind: 3,
  heartbeat: 4,
};

const TAMPER_ORIGINS = new Set<FailOrigin>([
  'anti_tamper',
  'integrity',
  'keyring',
]);

export function isStickyCascadeContext(): boolean {
  if (
    process.env.AINOVEL_LABYRINTH === '0' ||
    process.env.AINOVEL_LABYRINTH === 'false'
  ) {
    return false;
  }
  if (
    process.env.AINOVEL_LABYRINTH === '1' ||
    process.env.AINOVEL_LABYRINTH === 'force'
  ) {
    return true; // tests / explicit
  }
  return (
    isPackagedCustomerRuntime() ||
    process.env.AINOVEL_ENTITLEMENT_MODE === 'enforce'
  );
}

export function originToLayer(origin: FailOrigin): CascadeLayer {
  return ORIGIN_LAYER[origin] ?? 1;
}

export function isTamperOrigin(origin: FailOrigin): boolean {
  return TAMPER_ORIGINS.has(origin);
}

export function classifyAntiTamperReasons(reasons: string[]): {
  codes: TamperSignalCode[];
  strength: TamperStrength;
} {
  const codes: TamperSignalCode[] = [];
  let strength: TamperStrength = 2;
  for (const r of reasons) {
    const low = r.toLowerCase();
    if (low.includes('canary')) {
      codes.push('CANARY_VERIFY_NOP');
      strength = 4;
    } else if (low.includes('kid lạ') || low.includes('spki')) {
      codes.push('KEYRING_INJECT');
      strength = Math.max(strength, 3) as TamperStrength;
    } else if (low.includes('mong đợi') || low.includes('pin')) {
      codes.push('KEYRING_PIN_MISS');
      strength = Math.max(strength, 3) as TamperStrength;
    } else if (low.includes('mode=open')) {
      codes.push('PACKAGED_MODE_OPEN');
      strength = Math.max(strength, 3) as TamperStrength;
    } else if (low.includes('owner_unlimited')) {
      codes.push('PACKAGED_OWNER');
      strength = Math.max(strength, 3) as TamperStrength;
    } else if (low.includes('secret') || low.includes('seller')) {
      codes.push('PACKAGED_SECRET_LEAK');
      strength = 4;
    } else if (low.includes('host_binding')) {
      codes.push('PACKAGED_HOST_OPEN');
      strength = Math.max(strength, 3) as TamperStrength;
    } else if (low.includes('crack env') || low.includes('decoy env')) {
      codes.push('DECOY_ENV_HIT');
      strength = Math.max(strength, 2) as TamperStrength;
    } else if (low.includes('split_brain') || low.includes('split-brain') || low.includes('split_brain') || low.includes('getentitlementmode')) {
      codes.push('SPLIT_BRAIN');
      strength = 4;
    } else if (low.includes('node_options') || low.includes('electron_run_as_node') || low.includes('execargv')) {
      codes.push('NODE_INJECT');
      strength = Math.max(strength, 3) as TamperStrength;
    } else if (low.includes('license api host') || low.includes('license_api')) {
      codes.push('LICENSE_HOST');
      strength = Math.max(strength, 3) as TamperStrength;
    } else if (low.includes('free tier') || low.includes('matrix')) {
      codes.push('MATRIX_PATCH');
      strength = 4;
    } else if (low.includes('đồng hồ') || low.includes('time-tamper') || low.includes('clock')) {
      codes.push('CLOCK_TAMPER');
      strength = Math.max(strength, 2) as TamperStrength;
    } else if (low.includes('unlockprolocal') || low.includes('decoy bị patch')) {
      codes.push('DECOY_UNLOCK_HIT');
      strength = 4;
    } else {
      codes.push('BYPASS_PROBE');
      strength = Math.max(strength, 2) as TamperStrength;
    }
  }
  if (codes.length === 0) codes.push('ANTI_TAMPER_FAIL');
  return { codes: [...new Set(codes)], strength };
}

/**
 * Surface layer: base from origin; sticky progressive only for tamper sessions
 * in packaged/enforce (or AINOVEL_LABYRINTH=1).
 */
export function resolveCascadeLayer(
  origin: FailOrigin,
  sessionKey: string,
  tamperSuspected: boolean,
): CascadeLayer {
  const base = originToLayer(origin);
  if (!tamperSuspected || !isStickyCascadeContext()) {
    return base;
  }
  const prev = getOrCreateSession(sessionKey);
  // advance by prior attempts so 1st deny = base, 2nd = base+1, …
  const advance = Math.min(4, Math.max(0, prev.attempt));
  return Math.min(5, base + advance) as CascadeLayer;
}

export type CascadeDenyOpts = {
  origin: FailOrigin;
  sessionKey: string;
  /** Force tamper path (anti-tamper / integrity / decoy) */
  tamperSuspected?: boolean;
  /** Prefer original message when not tamper */
  originalError?: unknown;
  detail?: string;
  signalCode?: TamperSignalCode;
  strength?: TamperStrength;
};

/**
 * Throw AppError for gate deny.
 * - Legitimate: preserve original message (single clear error).
 * - Tamper: root INTEGRITY_OR_BYPASS + progressive surface layer message.
 */
export function denyThroughCascade(opts: CascadeDenyOpts): never {
  const tamper =
    opts.tamperSuspected === true ||
    isTamperOrigin(opts.origin) ||
    sessionHasTamper(opts.sessionKey, 1);

  if (!tamper) {
    // Single clear error for legitimate users — never progressive hydra.
    if (opts.originalError instanceof AppError) {
      const prev =
        opts.originalError.details &&
        typeof opts.originalError.details === 'object'
          ? (opts.originalError.details as Record<string, unknown>)
          : {};
      throw new AppError(opts.originalError.message, {
        code: opts.originalError.code,
        status: opts.originalError.status,
        details: {
          ...prev,
          labyrinth: false,
          origin: opts.origin,
        },
        cause: opts.originalError,
      });
    }
    const msg =
      opts.originalError instanceof Error
        ? opts.originalError.message
        : CASCADE_LAYER_MESSAGES[originToLayer(opts.origin)];
    throw new AppError(msg, {
      code: 'AUTH',
      status: 403,
      details: {
        labyrinth: false,
        origin: opts.origin,
      },
    });
  }

  const layer = resolveCascadeLayer(opts.origin, opts.sessionKey, true);
  const strength =
    opts.strength ??
    (isTamperOrigin(opts.origin) ? 3 : 2);
  const code = opts.signalCode ?? 'CASCADE_DENY';

  bumpSession(opts.sessionKey, { strength, layer, code });
  recordTamperSignal({
    code,
    strength,
    origin: opts.origin,
    layer,
    detail: opts.detail?.slice(0, 200),
  });

  const message = CASCADE_LAYER_MESSAGES[layer];
  throw new AppError(message, {
    code: 'AUTH',
    status: 403,
    details: {
      labyrinth: true,
      root: CASCADE_ROOT,
      layer,
      origin: opts.origin,
      // support can correlate without exposing internals to casual UI
      attempt: getOrCreateSession(opts.sessionKey).attempt,
    },
  });
}

/**
 * Coarse session key — never store raw HWID; hash-like prefix from token wire only.
 */
export function sessionKeyFromRequest(req: Request, body?: unknown): string {
  try {
    const header =
      req.headers.get('x-ainovel-entitlement') ||
      req.headers.get('X-Ainovel-Entitlement') ||
      '';
    let token = header.trim();
    if (!token && body && typeof body === 'object') {
      const b = body as Record<string, unknown>;
      token = String(b.entitlementToken || b.token || '').trim();
    }
    if (token.length >= 24) {
      // stable coarse id without full token in memory keys
      let h = 0;
      for (let i = 0; i < Math.min(token.length, 120); i++) {
        h = (Math.imul(31, h) + token.charCodeAt(i)) | 0;
      }
      return `t_${(h >>> 0).toString(16)}`;
    }
  } catch {
    /* ignore */
  }
  if (isPackagedCustomerRuntime()) return 'pkg_local';
  return 'anon';
}

/** Map thrown errors from nested gates into origin for cascade. */
export function originFromErrorMessage(message: string): FailOrigin | null {
  const m = message.toLowerCase();
  if (m.includes('anti-tamper') || m.includes('canary') || m.includes('keyring')) {
    return 'anti_tamper';
  }
  if (m.includes('integrity')) return 'integrity';
  if (m.includes('heartbeat') || m.includes('sổ cái') || m.includes('revoke')) {
    return 'heartbeat';
  }
  if (m.includes('seat') || m.includes('chỗ ngồi')) return 'seat';
  if (m.includes('hwid') && m.includes('rebind')) return 'hwid_rebind';
  if (m.includes('re-check') || m.includes('recheck')) return 'recheck';
  if (m.includes('token') || m.includes('license')) return 'token_verify';
  return null;
}
