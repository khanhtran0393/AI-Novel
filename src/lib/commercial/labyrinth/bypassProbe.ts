/**
 * Expanded bypass / tamper probes — multi-signal detection beyond keyring pin.
 *
 * Honest model: client can still be patched; these raise cost and feed labyrinth.
 * Legitimate Free/Pro users with clean installs must pass all probes.
 *
 * Used by evaluateAntiTamper + commercial/status diagnostics.
 */
import {
  getEntitlementMode,
  resolveEntitlementVerificationKeys,
  verifyEntitlementToken,
} from '@/lib/entitlement';
import { isPackagedCustomerRuntime } from '@/lib/commercial/packagedAttestation';
import { getPinnedLicenseHosts } from '@/lib/commercial/licenseTrust';
import { canAccessFeature } from '@/lib/commercial/featureMatrix';
import { FORBIDDEN_UNLOCK_PATTERNS } from '@/lib/commercial/licenseOnePath';
import { unlockProLocal } from './decoyUnlock';
import { detectDecoyCrackEnv } from './decoyUnlock';

export type BypassProbeFinding = {
  id: string;
  severity: 1 | 2 | 3 | 4;
  reason: string;
};

export type BypassProbeReport = {
  ok: boolean;
  packaged: boolean;
  findings: BypassProbeFinding[];
  /** Distinct probe families that fired */
  categories: string[];
  score: number;
};

function b64url(buf: Buffer | string): string {
  const b = typeof buf === 'string' ? Buffer.from(buf, 'utf8') : buf;
  return b
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function envTruthy(name: string): boolean {
  const v = String(process.env[name] || '')
    .trim()
    .toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function push(
  findings: BypassProbeFinding[],
  id: string,
  severity: 1 | 2 | 3 | 4,
  reason: string,
): void {
  findings.push({ id, severity, reason });
}

/** Canary tokens that must never verify as Pro/Trial. */
function probeVerifyCanaries(findings: BypassProbeFinding[]): void {
  const samples: Array<{ label: string; token: string }> = [
    {
      label: 'garbage-deadbeef',
      token: 'AINOVEL2.deadbeefdeadbeef.e30.AAAA',
    },
    {
      label: 'empty-body',
      token: 'AINOVEL2.deadbeefdeadbeef..SIG',
    },
    {
      label: 'jwt-lookalike',
      token:
        'eyJhbGciOiJub25lIn0.eyJpc19wcm8iOnRydWUsImlzX3RyaWFsIjpmYWxzZX0.',
    },
    {
      label: 'wrong-prefix',
      token: 'AINOVEL.v1.pro.free',
    },
  ];

  // Well-formed body claiming Pro with invalid signature (uses real kid if available)
  try {
    const verifier = resolveEntitlementVerificationKeys();
    const kid = [...verifier.keys.keys()][0] || '3ac9c18a6691a09e';
    const body = b64url(
      JSON.stringify({
        ver: 2,
        is_pro: true,
        is_vip: true,
        is_trial: false,
        exp: Math.floor(Date.now() / 1000) + 86400 * 365,
        iat: Math.floor(Date.now() / 1000),
        hwid: 'bypass-probe-fake-hwid',
        plan: 'pro',
      }),
    );
    samples.push({
      label: 'pro-claims-bad-sig',
      token: `AINOVEL2.${kid}.${body}.AAAA_INVALID_SIG`,
    });
    // Truncated signature
    samples.push({
      label: 'pro-claims-trunc-sig',
      token: `AINOVEL2.${kid}.${body}.YQ`,
    });
  } catch {
    /* ignore */
  }

  for (const s of samples) {
    try {
      const claims = verifyEntitlementToken(s.token, { requireHwidMatch: false });
      if (claims && (claims.is_pro || claims.is_trial || claims.is_vip)) {
        push(
          findings,
          'canary_verify_nop',
          4,
          `CANARY FAIL: verify chấp nhận token rác (${s.label})`,
        );
      }
    } catch {
      // throw is acceptable for garbage
    }
  }

  // Dual-call consistency: same garbage twice must stay null
  try {
    const a = verifyEntitlementToken('AINOVEL2.deadbeefdeadbeef.e30.AAAA', {
      requireHwidMatch: false,
    });
    const b = verifyEntitlementToken('AINOVEL2.deadbeefdeadbeef.e30.AAAA', {
      requireHwidMatch: false,
    });
    if (a !== b && !!(a && (a.is_pro || a.is_trial))) {
      push(
        findings,
        'canary_verify_inconsistent',
        3,
        'CANARY FAIL: verify kết quả không ổn định trên token rác',
      );
    }
  } catch {
    /* ok */
  }
}

/** Packaged runtime must stay enforce; detect mode/env escapes. */
function probePackagedPolicy(findings: BypassProbeFinding[]): void {
  const packaged = isPackagedCustomerRuntime();
  if (!packaged) return;

  const mode = getEntitlementMode();
  // OPEN app (free cho mọi user): mode 'open' trên packaged là chính sách sản phẩm,
  // không phải dấu hiệu bị crack — không flag.
  if (mode !== 'open' && mode !== 'enforce') {
    push(
      findings,
      'mode_split_brain',
      4,
      `SPLIT_BRAIN: mode bất thường ${mode}`,
    );
  }


  if (envTruthy('AINOVEL_OWNER_UNLIMITED')) {
    push(findings, 'packaged_owner', 4, 'Packaged OWNER_UNLIMITED bị bật');
  }

  const host = String(process.env.AINOVEL_HOST_BINDING || '').toLowerCase();
  if (host === 'open' || host === 'off' || host === '0' || host === 'false') {
    push(findings, 'packaged_host_open', 3, 'Packaged HOST_BINDING=open');
  }

  // Seller secrets must not be on customer process
  const secretEnvs = [
    'AINOVEL_ENTITLEMENT_PRIVATE_KEY',
    'AINOVEL_ENTITLEMENT_PRIVATE_KEY_FILE',
    'AINOVEL_ENTITLEMENT_ADMIN_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'AINOVEL_SELLER_PRIVATE_KEY',
    'ENTITLEMENT_PRIVATE_KEY',
  ];
  for (const name of secretEnvs) {
    if (String(process.env[name] || '').trim()) {
      push(
        findings,
        'packaged_secret_leak',
        4,
        `Phát hiện secret seller env=${name}`,
      );
      break;
    }
  }

  // Debugger / inject surfaces common in cracks
  const nodeOpts = String(process.env.NODE_OPTIONS || '');
  if (
    /(?:^|\s)(-r|--require|--import|--experimental-loader)\b/i.test(nodeOpts) ||
    /inspector|inspect-brk|inspect-port/i.test(nodeOpts)
  ) {
    push(
      findings,
      'node_options_inject',
      3,
      'NODE_OPTIONS inject/inspect trên packaged (nghi bypass)',
    );
  }

  if (envTruthy('ELECTRON_RUN_AS_NODE')) {
    push(
      findings,
      'electron_run_as_node',
      3,
      'ELECTRON_RUN_AS_NODE trên packaged (nghi bypass)',
    );
  }

  try {
    const args = process.execArgv || [];
    if (args.some((a) => /inspect|heapdump|prof/i.test(a))) {
      push(
        findings,
        'exec_argv_inspect',
        2,
        'process.execArgv chứa inspect/prof trên packaged',
      );
    }
  } catch {
    /* ignore */
  }
}

/** License API URL must stay on pinned hosts when packaged. */
function probeLicenseEndpoint(findings: BypassProbeFinding[]): void {
  if (!isPackagedCustomerRuntime()) return;
  const raw = String(
    process.env.AINOVEL_LICENSE_API_URL ||
      process.env.NEXT_PUBLIC_LICENSE_API_URL ||
      '',
  ).trim();
  if (!raw) return;
  try {
    const u = new URL(raw.includes('://') ? raw : `https://${raw}`);
    const host = u.hostname.toLowerCase();
    const pinned = new Set(getPinnedLicenseHosts().map((h) => h.toLowerCase()));
    if (host && !pinned.has(host)) {
      push(
        findings,
        'license_host_unpinned',
        4,
        `License API host lạ (không pin): ${host}`,
      );
    }
    if (u.protocol === 'http:' && host !== 'localhost' && host !== '127.0.0.1') {
      push(
        findings,
        'license_host_http',
        3,
        'License API dùng HTTP không an toàn trên packaged',
      );
    }
  } catch {
    push(findings, 'license_host_malformed', 2, 'LICENSE_API_URL malformed');
  }
}

/** Feature matrix must not grant video to free tier. */
function probeFeatureMatrix(findings: BypassProbeFinding[]): void {
  try {
    // OPEN app (free cho mọi user): free tier được dùng mọi tính năng — không flag.
    for (const f of ['gen_video', 'export_capcut', 'ship_pack', 'toolbox_labs'] as const) {
      canAccessFeature('free', f);
    }

  } catch (e) {
    push(
      findings,
      'matrix_probe_error',
      2,
      `Feature matrix probe error: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

/** One-path policy + decoy unlock must stay closed. */
function probeOnePathAndDecoy(findings: BypassProbeFinding[]): void {
  if (!FORBIDDEN_UNLOCK_PATTERNS.length) {
    push(
      findings,
      'one_path_empty',
      3,
      'FORBIDDEN_UNLOCK_PATTERNS rỗng (policy bị xóa?)',
    );
  }
  try {
    const u = unlockProLocal('probe', { silent: true });
    if (u.ok || u.pro) {
      push(
        findings,
        'decoy_unlock_open',
        4,
        'CANARY FAIL: unlockProLocal trả Pro (decoy bị patch)',
      );
    }
  } catch {
    // throw is ok for decoy
  }

  const decoyEnv = detectDecoyCrackEnv();
  if (decoyEnv) {
    push(
      findings,
      'decoy_env',
      3,
      `Decoy env hit: ${decoyEnv} (crack env canary)`,
    );
  }
}

/** Keyring structural probes (complement antiTamper pin loop). */
function probeKeyringShape(findings: BypassProbeFinding[]): void {
  const verifier = resolveEntitlementVerificationKeys();
  if (!verifier.ok || verifier.keys.size === 0) {
    if (isPackagedCustomerRuntime()) {
      push(findings, 'keyring_empty', 4, 'FAIL-CLOSED: packaged thiếu public keyring');
    } else {
      push(findings, 'keyring_empty_dev', 1, 'Thiếu public keyring (dev)');
    }
    return;
  }
  // Key object must be Ed25519 / asymmetric
  for (const [kid, key] of verifier.keys) {
    try {
      const t = key.asymmetricKeyType;
      if (t && t !== 'ed25519') {
        push(
          findings,
          'keyring_wrong_type',
          4,
          `Keyring kid=${kid} type=${t} (cần ed25519)`,
        );
      }
      // SPKI export must work
      const der = key.export({ type: 'spki', format: 'der' });
      if (!der || der.length < 20) {
        push(findings, 'keyring_export_fail', 3, `Keyring export yếu kid=${kid}`);
      }
    } catch (e) {
      push(
        findings,
        'keyring_export_error',
        3,
        `Keyring export error kid=${kid}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}

/** Clock sanity — extreme skew breaks exp checks and is a known crack trick. */
function probeClock(findings: BypassProbeFinding[]): void {
  const now = Date.now();
  // Before 2020-01-01 or after ~2100
  if (now < 1577836800000) {
    push(findings, 'clock_past', 2, 'Đồng hồ hệ thống quá khứ (nghi time-tamper)');
  }
  if (now > 4102444800000) {
    push(findings, 'clock_future', 2, 'Đồng hồ hệ thống quá tương lai (nghi time-tamper)');
  }
}

/** Critical exports still look like functions (nop-patch to constant). */
function probeExportShapes(findings: BypassProbeFinding[]): void {
  if (typeof verifyEntitlementToken !== 'function') {
    push(findings, 'export_verify_missing', 4, 'verifyEntitlementToken không còn là function');
  }
  if (typeof getEntitlementMode !== 'function') {
    push(findings, 'export_mode_missing', 4, 'getEntitlementMode không còn là function');
  }
  // OPEN app (free cho mọi user): mode 'open' trên packaged là chính sách — không flag.

}

/**
 * Full expanded bypass probe suite.
 */
export function evaluateBypassProbes(): BypassProbeReport {
  const findings: BypassProbeFinding[] = [];
  const packaged = isPackagedCustomerRuntime();

  probeExportShapes(findings);
  probeKeyringShape(findings);
  probeVerifyCanaries(findings);
  probePackagedPolicy(findings);
  probeLicenseEndpoint(findings);
  probeFeatureMatrix(findings);
  probeOnePathAndDecoy(findings);
  probeClock(findings);

  // Dev: empty keyring is mild; don't fail whole anti-tamper on keyring_empty_dev alone
  const hard = findings.filter((f) => {
    if (!packaged && f.id === 'keyring_empty_dev') return false;
    return f.severity >= 2;
  });

  const categories = [...new Set(hard.map((f) => f.id.split('_')[0] || f.id))];
  const score = hard.reduce((s, f) => s + f.severity, 0);

  return {
    ok: hard.length === 0,
    packaged,
    findings: hard,
    categories,
    score,
  };
}

export function getBypassProbePublicStatus(): {
  ok: boolean;
  packaged: boolean;
  findingCount: number;
  categories: string[];
  score: number;
  topReasons: string[];
} {
  const r = evaluateBypassProbes();
  return {
    ok: r.ok,
    packaged: r.packaged,
    findingCount: r.findings.length,
    categories: r.categories.slice(0, 12),
    score: r.score,
    topReasons: r.findings.slice(0, 6).map((f) => f.reason),
  };
}

/** Map probe findings → anti-tamper reason strings (for classifyAntiTamperReasons). */
export function bypassFindingsAsReasons(report: BypassProbeReport): string[] {
  return report.findings.map((f) => f.reason);
}
