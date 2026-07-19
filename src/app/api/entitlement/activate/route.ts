/**
 * Activate: paste Ed25519 token OR redeem AINOVEL-**** activation code.
 * Body: { token?: string, code?: string, hwid?: string }
 *
 * Telegram keys are AINOVEL2.<kid>.<payload>.<sig> bound to HWID.
 * When Supabase is authority, a valid offline token may self-heal insert
 * if Telegram issued the key but DB write failed (dbOk:false).
 */
import { NextResponse } from 'next/server';
import {
  claimsIsTrial,
  getEntitlementPublicStatus,
  getHwid,
  verifyEntitlementToken,
} from '@/lib/entitlement';
import { redeemActivationCode } from '@/lib/commercial/activationVault';
import {
  assertLicenseSignerConfigured,
  isPackagedCustomerRuntime,
} from '@/lib/commercial/sellerRuntime';
import { proxyLicenseApiPost } from '@/lib/commercial/licenseApiProxy';
import { AppError, httpStatusFromError, toErrorJson } from '@/lib/errors';
import { isSupabaseAdminConfigured } from '@/lib/supabase/env';
import { createServiceSupabase } from '@/lib/supabase/server';
import {
  claimsArePaidPro,
  hashToken,
  promoteHwidLicenseToPaidPro,
  redeemCloudActivationCode,
  verifyLicenseCloud,
} from '@/lib/cloud/licenseBridge';

export const runtime = 'nodejs';

/** Pull AINOVEL2 token or AINOVEL- code out of a Telegram paste blob. */
function normalizeCredential(raw: string): { kind: 'code' | 'token'; value: string } | null {
  const s = String(raw || '').trim().replace(/\s+/g, '');
  if (!s) return null;
  // Full-line token (no spaces)
  if (/^AINOVEL2\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(s)) {
    return { kind: 'token', value: s };
  }
  // Code
  const codeHit = s.toUpperCase().match(/\bAINOVEL-[A-Z0-9]+(?:-[A-Z0-9]+){1,4}\b/);
  if (codeHit && !s.includes('AINOVEL2.')) {
    return { kind: 'code', value: codeHit[0] };
  }
  // Token embedded in Telegram message body (also tolerate newlines/spaces mid-token)
  const tokenHit = s.match(
    /AINOVEL2\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
  );
  if (tokenHit) return { kind: 'token', value: tokenHit[0] };
  // Fallback: treat whole string as token if starts with AINOVEL2
  if (s.startsWith('AINOVEL2.')) return { kind: 'token', value: s.split(/\s+/)[0] };
  if (s.toUpperCase().startsWith('AINOVEL-')) {
    return { kind: 'code', value: s.toUpperCase().split(/\s+/)[0] };
  }
  return null;
}

/**
 * Human diagnosis when Ed25519 verify fails.
 * Legacy Telegram HMAC keys look like base64url(payload).base64url(hmac32) — 2 dots parts, sig ~43 chars.
 */
function diagnoseFailedToken(
  token: string,
  knownKids: string[],
): string {
  const compact = token.trim().replace(/\s+/g, '');
  const parts = compact.split('.');
  const known = knownKids.join(', ') || 'none';

  // Legacy HMAC: payload.sig (no AINOVEL2.kid)
  if (
    parts.length === 2 &&
    parts[0].startsWith('eyJ') &&
    parts[1].length >= 40 &&
    parts[1].length <= 50
  ) {
    return (
      'Key này là định dạng HMAC cũ (payload.sig) — app chỉ nhận Ed25519 AINOVEL2.<kid>.…. ' +
      'Admin: redeploy telegram-bridge với AINOVEL_ENTITLEMENT_PRIVATE_KEY_B64 cùng cặp public key app, ' +
      'rồi bấm Cấp Key lại (key phải bắt đầu bằng AINOVEL2.).'
    );
  }

  if (!compact.startsWith('AINOVEL2.')) {
    return (
      'Key phải là 1 dòng bắt đầu AINOVEL2.… (4 phần cách bởi dấu chấm). ' +
      'Không dán JWT/HMAC cũ bắt đầu bằng eyJ…, không dán cả tin Telegram.'
    );
  }

  if (parts.length !== 4 || parts[0] !== 'AINOVEL2') {
    return (
      `Token AINOVEL2 không đủ 4 phần (có ${parts.length}). ` +
      'Copy trọn dòng từ Telegram — Telegram có thể xuống dòng giữa token.'
    );
  }

  const kid = parts[1] || '?';
  if (kid && knownKids.length > 0 && !knownKids.includes(kid)) {
    return (
      `kid=${kid} không khớp keyring app [${known}]. ` +
      'Bridge/Vercel đang ký bằng private key khác cặp. ' +
      'Đồng bộ PRIVATE_KEY_B64 (seller) với resources/license/public-keys, redeploy bridge, cấp key lại.'
    );
  }

  return (
    `Token không verify được (hết hạn / dán sai / kid=${kid} keyring=[${known}]). ` +
    'Chỉ dán 1 dòng AINOVEL2.… Admin cấp lại sau khi PRIVATE+PUBLIC cùng cặp, restart app.'
  );
}

async function ensureCloudLicenseFromToken(input: {
  token: string;
  hwid: string;
  exp: number;
  isTrial: boolean;
}): Promise<{ ok: boolean; licenseId?: string; error?: string }> {
  if (!isSupabaseAdminConfigured()) return { ok: true };
  try {
    const service = createServiceSupabase();
    const hwidNorm = input.hwid.trim().toLowerCase();
    const expAt = new Date(Math.max(input.exp, 0) * 1000).toISOString();
    const tokenHash = hashToken(input.token);
    // Prefer existing active row for this HWID
    const { data: existing } = await service
      .from('licenses')
      .select('id,status')
      .eq('hwid', hwidNorm)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();
    if (existing?.id) {
      await service
        .from('licenses')
        .update({
          token_hash: tokenHash,
          exp_at: expAt,
          plan: input.isTrial ? 'trial' : 'pro',
        })
        .eq('id', existing.id);
      return { ok: true, licenseId: String(existing.id) };
    }
    const { data, error } = await service
      .from('licenses')
      .insert({
        user_id: null,
        order_id: null,
        plan: input.isTrial ? 'trial' : 'pro',
        hwid: hwidNorm,
        status: 'active',
        exp_at: expAt,
        token_hash: tokenHash,
        activation_code: null,
      })
      .select('id')
      .single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, licenseId: data?.id ? String(data.id) : undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      token?: string;
      code?: string;
      hwid?: string;
    };
    const machineHwid = getHwid().toLowerCase();
    const hwid =
      (typeof body.hwid === 'string' && body.hwid.trim().toLowerCase()) ||
      machineHwid;

    // Prefer explicit fields; also accept messy Telegram paste in either field
    const fromCodeField =
      typeof body.code === 'string' ? normalizeCredential(body.code) : null;
    const fromTokenField =
      typeof body.token === 'string' ? normalizeCredential(body.token) : null;
    const cred = fromCodeField || fromTokenField;

    if (cred?.kind === 'code' || (typeof body.code === 'string' && body.code.trim() && !cred)) {
      const code = (cred?.kind === 'code' ? cred.value : String(body.code || '').trim()).toUpperCase();
      if (isPackagedCustomerRuntime()) {
        const remote = await proxyLicenseApiPost('/api/entitlement/activate', {
          code,
          hwid,
        });
        if (remote.status < 200 || remote.status >= 300) {
          throw new AppError(
            String(
              remote.payload.error ||
                remote.payload.message ||
                `Activation HTTP ${remote.status}`,
            ),
            {
              code:
                remote.status === 401 || remote.status === 403
                  ? 'AUTH'
                  : 'INFRA',
              status: remote.status,
            },
          );
        }
        return NextResponse.json(remote.payload, { status: remote.status });
      }
      assertLicenseSignerConfigured();
      if (isSupabaseAdminConfigured()) {
        const cloud = await redeemCloudActivationCode({
          service: createServiceSupabase(),
          code,
          hwid,
        });
        return NextResponse.json({
          ok: true,
          kind: 'code',
          token: cloud.token,
          plan: cloud.claims.plan,
          claims: {
            is_pro: cloud.claims.is_pro,
            is_vip: false,
            is_trial: !!cloud.claims.is_trial,
            plan: cloud.claims.plan,
            exp: cloud.claims.exp,
            expIso: new Date(cloud.claims.exp * 1000).toISOString(),
          },
          licenseId: cloud.licenseId,
          hwid: hwid.toUpperCase(),
          storeHint: 'Lưu token vào localStorage.ainovel.entitlementToken',
        });
      }
      const redeemed = redeemActivationCode(code, hwid);
      if (!redeemed.ok || !redeemed.token) {
        throw new AppError(redeemed.error || 'Redeem thất bại', {
          code: 'AUTH',
          status: 400,
        });
      }
      const claims = verifyEntitlementToken(redeemed.token, {
        requireHwidMatch: true,
      });
      if (!claims || (!claims.is_pro && !claims.is_vip && !claims.is_trial)) {
        throw new AppError(
          'Đã redeem mã nhưng token không verify trên máy này (HWID / public key).',
          { code: 'AUTH', status: 401 },
        );
      }
      return NextResponse.json({
        ok: true,
        kind: 'code',
        token: redeemed.token,
        plan: redeemed.plan,
        alreadyRedeemedSameMachine: !!redeemed.alreadyRedeemedSameMachine,
        claims: {
          is_pro: claims.is_pro,
          is_vip: claims.is_vip,
          is_trial: !!claims.is_trial,
          plan: claims.plan,
          exp: claims.exp,
          expIso: new Date(claims.exp * 1000).toISOString(),
        },
        hwid: hwid.toUpperCase(),
        storeHint: 'Lưu token vào localStorage.ainovel.entitlementToken',
      });
    }

    const token =
      (cred?.kind === 'token' ? cred.value : '') ||
      (typeof body.token === 'string' ? body.token.trim() : '');
    if (!token) {
      throw new AppError(
        'Cần dán License Key (dòng bắt đầu AINOVEL2.… từ Telegram) hoặc mã AINOVEL-… — không dán cả tin nhắn.',
        { code: 'VALIDATION', status: 400 },
      );
    }

    // Diagnose signature / HWID before hard-fail
    const verifier = (
      await import('@/lib/entitlement')
    ).resolveEntitlementVerificationKeys();
    if (!verifier.ok) {
      throw new AppError(
        'App chưa nạp public key license (thiếu resources/license/public-keys hoặc AINOVEL_ENTITLEMENT_PUBLIC_KEY_FILE). Restart dev server sau khi cấu hình key.',
        { code: 'INFRA', status: 503 },
      );
    }
    const claimsAnyHwid = verifyEntitlementToken(token, {
      requireHwidMatch: false,
    });
    if (!claimsAnyHwid || (!claimsAnyHwid.is_pro && !claimsAnyHwid.is_vip && !claimsAnyHwid.is_trial)) {
      throw new AppError(diagnoseFailedToken(token, [...verifier.keys.keys()]), {
        code: 'AUTH',
        status: 401,
      });
    }
    const tokenHwid = (claimsAnyHwid.hwid || '').toLowerCase();
    if (tokenHwid && tokenHwid !== machineHwid) {
      throw new AppError(
        `Key gắn HWID ${tokenHwid.toUpperCase()} — máy này là ${machineHwid.toUpperCase()}. ` +
          'Key chỉ kích hoạt đúng máy đã bấm «Đã thanh toán» / HWID gửi admin. Không dùng key máy khác.',
        { code: 'AUTH', status: 401 },
      );
    }

    let claims = verifyEntitlementToken(token, { requireHwidMatch: true });
    if (!claims || (!claims.is_pro && !claims.is_vip && !claims.is_trial)) {
      throw new AppError(
        'Token không khớp HWID máy này.',
        { code: 'AUTH', status: 401 },
      );
    }

    // Paid Pro token must never collapse to trial claims for the UI response
    const paidToken = claimsArePaidPro(claims);
    if (paidToken) {
      claims = {
        ...claims,
        is_pro: true,
        is_vip: false,
        is_trial: false,
        plan: 'pro',
      };
    }

    let authority: 'local' | 'supabase' = 'local';
    let licenseId: string | undefined;

    if (isSupabaseAdminConfigured()) {
      try {
        const service = createServiceSupabase();

        // Paid Pro: always promote trial→pro in DB; keep paid claims for client
        if (paidToken) {
          const promoted = await promoteHwidLicenseToPaidPro({
            service,
            token,
            hwid: machineHwid,
            exp: claims.exp,
          });
          if (!promoted.ok) {
            throw new AppError(
              `Key Pro hợp lệ nhưng ghi Supabase thất bại: ${promoted.error || 'unknown'}. ` +
                'Admin kiểm tra SERVICE_ROLE / bảng licenses.',
              { code: 'INFRA', status: 503 },
            );
          }
          authority = 'supabase';
          licenseId = promoted.licenseId;
        } else {
          const cloud = await verifyLicenseCloud({
            service,
            token,
            hwid: machineHwid,
          });
          if (cloud.valid && cloud.claims) {
            claims = cloud.claims;
            authority = 'supabase';
            licenseId = cloud.cloud.licenseId;
          } else if (cloud.cloud.revoked) {
            throw new AppError('License đã bị thu hồi trên Supabase.', {
              code: 'AUTH',
              status: 403,
            });
          } else {
            // Trial/self-heal path
            const healed = await ensureCloudLicenseFromToken({
              token,
              hwid: machineHwid,
              exp: claims.exp,
              isTrial: claimsIsTrial(claims),
            });
            if (!healed.ok) {
              throw new AppError(
                `Key hợp lệ offline nhưng ghi Supabase thất bại: ${healed.error || 'unknown'}. ` +
                  'Admin kiểm tra SERVICE_ROLE / bảng licenses.',
                { code: 'INFRA', status: 503 },
              );
            }
            authority = 'supabase';
            licenseId = healed.licenseId;
          }
        }
      } catch (e) {
        if (e instanceof AppError) throw e;
        throw new AppError(
          e instanceof Error ? e.message : String(e),
          { code: 'INFRA', status: 503 },
        );
      }
    }

    const trialOut = claimsIsTrial(claims);
    return NextResponse.json({
      ok: true,
      kind: 'token',
      token,
      claims: {
        is_pro: !!claims.is_pro || !!claims.is_vip || trialOut,
        is_vip: false,
        is_trial: trialOut,
        plan: trialOut ? 'trial' : 'pro',
        exp: claims.exp,
        expIso: new Date(claims.exp * 1000).toISOString(),
      },
      hwid: machineHwid.toUpperCase(),
      licenseId,
      authority,
      storeHint: 'Lưu token vào localStorage.ainovel.entitlementToken',
    });
  } catch (err: unknown) {
    return NextResponse.json(toErrorJson(err), {
      status: httpStatusFromError(err),
    });
  }
}

export async function GET() {
  const status = getEntitlementPublicStatus();
  return NextResponse.json({
    ok: true,
    ...status,
    activate: {
      token: 'POST { token }',
      code: 'POST { code: "AINOVEL-…" }',
    },
  });
}
