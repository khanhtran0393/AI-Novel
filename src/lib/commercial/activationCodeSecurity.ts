import crypto from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '@/lib/errors';

/**
 * Telegram/Admin activation codes are generated from hex segments only.
 * Keep this exact so arbitrary AINOVEL-* text never reaches the license lookup.
 */
export const ACTIVATION_CODE_PATTERN =
  /^AINOVEL-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}$/;

const ACTIVATION_CODE_IN_TEXT_PATTERN =
  /(?:^|[^A-Z0-9])(AINOVEL-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4})(?=$|[^A-Z0-9])/i;

export const ACTIVATION_ATTEMPT_WINDOW_MS = 15 * 60_000;
export const ACTIVATION_ATTEMPT_MAX = 5;
const ATTEMPT_ACTION = 'license.activation.attempt';
const OUTCOME_ACTION = 'license.activation.outcome';

export function normalizeActivationCode(raw: string): string {
  return String(raw || '').trim().toUpperCase();
}

export function isActivationCodeFormat(raw: string): boolean {
  return ACTIVATION_CODE_PATTERN.test(normalizeActivationCode(raw));
}

/** Extract one exact code from a short Telegram paste without accepting partial guesses. */
export function extractActivationCode(raw: string): string | null {
  const value = String(raw || '');
  if (!value || value.length > 4096) return null;
  const match = value.toUpperCase().match(ACTIVATION_CODE_IN_TEXT_PATTERN);
  return match?.[1] || null;
}

export function activationCodeFingerprint(raw: string): string {
  return crypto
    .createHash('sha256')
    .update(String(raw || '').slice(0, 512).trim().toUpperCase(), 'utf8')
    .digest('hex')
    .slice(0, 16);
}

function activationRatePepper(): string {
  return (
    process.env.AINOVEL_ACTIVATION_RATE_SECRET ||
    process.env.AINOVEL_TELEGRAM_WEBHOOK_SECRET ||
    process.env.AINOVEL_ENTITLEMENT_ADMIN_KEY ||
    'ainovel-activation-rate-v1'
  );
}

function hashNetworkIdentity(value: string): string {
  return crypto
    .createHmac('sha256', activationRatePepper())
    .update(value, 'utf8')
    .digest('hex')
    .slice(0, 24);
}

export function activationRequestIpHash(req: Request): string | null {
  const forwarded =
    req.headers.get('x-vercel-forwarded-for') ||
    req.headers.get('x-forwarded-for') ||
    req.headers.get('x-real-ip') ||
    '';
  const ip = forwarded.split(',')[0]?.trim().slice(0, 80) || '';
  return ip ? hashNetworkIdentity(ip) : null;
}

async function countRecentAttempts(
  service: SupabaseClient,
  field: 'hwid' | 'ip_hash',
  value: string,
  sinceIso: string,
): Promise<number> {
  const { count, error } = await service
    .from('audit_logs')
    .select('id', { count: 'exact', head: true })
    .eq('action', ATTEMPT_ACTION)
    .eq(`meta->>${field}`, value)
    .gte('created_at', sinceIso);
  if (error) {
    throw new AppError(`Không kiểm tra được giới hạn kích hoạt: ${error.message}`, {
      code: 'INFRA',
      status: 503,
    });
  }
  return Number(count || 0);
}

/**
 * Durable Vercel-safe limiter. It records the attempt before counting, so
 * parallel guesses also converge on the same Supabase-backed window.
 */
export async function consumeActivationAttempt(input: {
  service: SupabaseClient;
  req: Request;
  hwid: string;
  rawCode: string;
}): Promise<{ attemptId: string; codeFingerprint: string; ipHash: string | null }> {
  const hwid = String(input.hwid || '').trim().toLowerCase();
  if (!/^[a-z0-9:_-]{8,128}$/i.test(hwid)) {
    throw new AppError('HWID kích hoạt không hợp lệ.', {
      code: 'VALIDATION',
      status: 400,
    });
  }

  const attemptId = crypto.randomUUID();
  const codeFingerprint = activationCodeFingerprint(input.rawCode);
  const ipHash = activationRequestIpHash(input.req);
  const meta = {
    attempt_id: attemptId,
    hwid,
    ip_hash: ipHash,
    code_fingerprint: codeFingerprint,
  };
  const { error: insertError } = await input.service
    .from('audit_logs')
    .insert({ actor_id: null, action: ATTEMPT_ACTION, meta });
  if (insertError) {
    throw new AppError(
      `Không ghi được nhật ký kích hoạt: ${insertError.message}`,
      { code: 'INFRA', status: 503 },
    );
  }

  const sinceIso = new Date(Date.now() - ACTIVATION_ATTEMPT_WINDOW_MS).toISOString();
  const [hwidCount, ipCount] = await Promise.all([
    countRecentAttempts(input.service, 'hwid', hwid, sinceIso),
    ipHash
      ? countRecentAttempts(input.service, 'ip_hash', ipHash, sinceIso)
      : Promise.resolve(0),
  ]);
  if (
    hwidCount > ACTIVATION_ATTEMPT_MAX ||
    (ipHash && ipCount > ACTIVATION_ATTEMPT_MAX)
  ) {
    throw new AppError(
      'Bạn đã nhập sai quá nhiều lần. Hãy đợi 15 phút rồi thử lại bằng mã Telegram nguyên vẹn.',
      {
        code: 'QUOTA',
        status: 429,
        details: {
          retryAfterSec: Math.ceil(ACTIVATION_ATTEMPT_WINDOW_MS / 1000),
        },
      },
    );
  }
  return { attemptId, codeFingerprint, ipHash };
}

export async function recordActivationOutcome(input: {
  service: SupabaseClient;
  attemptId: string;
  hwid: string;
  codeFingerprint: string;
  ok: boolean;
  reason?: string;
  licenseId?: string;
}): Promise<void> {
  await input.service
    .from('audit_logs')
    .insert({
      actor_id: null,
      action: OUTCOME_ACTION,
      meta: {
        attempt_id: input.attemptId,
        hwid: input.hwid,
        code_fingerprint: input.codeFingerprint,
        ok: input.ok,
        reason: String(input.reason || '').slice(0, 120) || null,
        license_id: input.licenseId || null,
      },
    })
    .then(() => undefined, () => undefined);
}
