/**
 * Public commercial status: mode, trial, feature matrix, pricing.
 * **When Supabase admin configured → licenses table by HWID is sole truth.**
 * No active row (delete / revoked / expired / never issued) → Free; clear local token.
 * No self-heal INSERT from offline Ed25519 token.
 */
import { NextResponse } from 'next/server';
import {
  claimsIsTrial,
  extractEntitlementToken,
  getEntitlementPublicStatus,
  getHwid,
  getHwidCandidates,
  verifyEntitlementToken,
} from '@/lib/entitlement';
import {
  FEATURE_MATRIX,
  PRICING_PLANS,
  resolvePlanTier,
} from '@/lib/commercial/featureMatrix';
import { getTrialStatus } from '@/lib/commercial/trial';
import { shouldGrantOwnerUnlimited } from '@/lib/commercial/ownerMode';
import { getUpdatePublicStatus } from '@/lib/commercial/updateChannel';
import { telegramConfigured } from '@/lib/commercial/telegramNotify';
import {
  isSupabaseAdminConfigured,
  supabaseConfigPublic,
} from '@/lib/supabase/env';
import { createServiceSupabase } from '@/lib/supabase/server';
import { resolveLicenseByHwid } from '@/lib/cloud/licenseBridge';
import { getLicenseTrustStatus } from '@/lib/commercial/licenseTrust';
import { getAntiTamperPublicStatus } from '@/lib/commercial/antiTamper';
import {
  getBypassProbePublicStatus,
  getLabyrinthPublicStatus,
} from '@/lib/commercial/labyrinth';
import { getPackagedAttestationPublicStatus } from '@/lib/commercial/packagedAttestation';
import { getSeatPresencePublicStatus } from '@/lib/commercial/seatPresence';
import { getHeartbeatPublicStatus } from '@/lib/commercial/licenseHeartbeat';
import { getLicenseOnePathPublicStatus } from '@/lib/commercial/licenseOnePath';
import { FREE_LIMITS } from '@/lib/commercial/freeLimitsPolicy';
import { readFreeUsageForHwid } from '@/lib/commercial/freeQuota';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const pub = getEntitlementPublicStatus();
  const trial = getTrialStatus();
  const token = extractEntitlementToken(req);
  const hwid = getHwid().toLowerCase();

  let claims = token
    ? verifyEntitlementToken(token, { requireHwidMatch: true })
    : null;
  let cloudRevoked = false;
  let authority: 'supabase' | 'local' | 'owner' | 'open' = 'local';
  let cloudLicenseId: string | null = null;
  let cloudStatus: string | null = null;

  const ownerUnlimited = shouldGrantOwnerUnlimited();
  const openMode = pub.mode === 'open';
  const sb = supabaseConfigPublic();

  // ── Supabase = sole authority for UI tier when configured ──
  // Missing / revoked / expired row ⇒ Free (ban or expired). Never grant from
  // offline token alone; never INSERT self-heal on status poll.
  if (isSupabaseAdminConfigured() && !ownerUnlimited) {
    try {
      const service = createServiceSupabase();
      const cloud = await resolveLicenseByHwid(service, hwid);
      authority = 'supabase';
      cloudStatus = cloud.status || null;

      if (cloud.found && cloud.claims) {
        claims = cloud.claims;
        cloudLicenseId = cloud.licenseId || null;
        cloudRevoked = false;
      } else if (cloud.status === 'revoked') {
        claims = null;
        cloudRevoked = true;
      } else {
        // none | expired | deleted — Free until seller re-issues licenses row
        claims = null;
        cloudRevoked = false;
        cloudStatus = cloud.status || 'none';
      }
    } catch {
      // Fail closed: cannot read ledger → Free (do not trust offline Pro)
      claims = null;
      authority = 'supabase';
      cloudStatus = 'error';
      cloudRevoked = false;
    }
  } else if (token) {
    authority = 'local';
  }

  if (ownerUnlimited) authority = 'owner';
  if (openMode && !ownerUnlimited && authority === 'local' && !claims) {
    // open mode: status still shows free unless token; routes allow pro separately
  }

  const tokenIsTrial = claimsIsTrial(claims);
  const paidPro =
    !!claims &&
    !tokenIsTrial &&
    !!(claims.is_pro || claims.is_vip);

  // Local vault trial only when Supabase is NOT authority
  const vaultTrial =
    authority !== 'supabase' &&
    trial.active &&
    !claims?.is_vip &&
    !paidPro;

  const tier = resolvePlanTier({
    openMode: false,
    ownerUnlimited,
    is_vip: false,
    is_trial: tokenIsTrial || vaultTrial,
    is_pro: paidPro || (!!claims?.is_vip && !tokenIsTrial),
    trialActive: tokenIsTrial || vaultTrial,
  });

  const effectiveTrial = tier === 'trial';

  // tokenValid for UI: when supabase authority, valid = active cloud claims only
  const tokenValid =
    authority === 'supabase'
      ? Boolean(claims && (claims.is_pro || claims.is_vip || claimsIsTrial(claims)))
      : Boolean(claims);

  const licenseTrust = getLicenseTrustStatus();
  const antiTamper = getAntiTamperPublicStatus();
  const labyrinth = getLabyrinthPublicStatus();
  const bypassProbe = getBypassProbePublicStatus();
  const heartbeat = getHeartbeatPublicStatus();
  const packagedAttestation = getPackagedAttestationPublicStatus();
  const seatPresence = getSeatPresencePublicStatus();

  return NextResponse.json({
    ok: true,
    /** Canonical license architecture — docs/LICENSE_ONE_PATH.md */
    onePath: getLicenseOnePathPublicStatus(),
    entitlement: pub,
    licenseTrust,
    antiTamper,
    /** Expanded multi-signal bypass detection — docs/LABYRINTH.md */
    bypassProbe,
    /** Multi-layer tamper cascade status (no secrets) — docs/LABYRINTH.md */
    labyrinth,
    packagedAttestation,
    seatPresence,
    heartbeat,
    hwidVersions: {
      preferred: 'v3',
      /** Number of dual-accept fingerprints (v3/v2/v1) — not raw values */
      candidateCount: getHwidCandidates().length,
    },
    hwid: hwid.toUpperCase(),
    authority,
    cloudLicenseId,
    cloudStatus,
    trial: {
      enabled: trial.enabled,
      active: effectiveTrial || (authority !== 'supabase' && trial.active),
      used: trial.used,
      days: trial.days,
      endsAt: trial.record?.endsAt ?? (claims?.is_trial ? claims.exp : null),
      endsIso: trial.record
        ? new Date(trial.record.endsAt * 1000).toISOString()
        : claimsIsTrial(claims) && claims
          ? new Date(claims.exp * 1000).toISOString()
          : null,
      fromToken: tokenIsTrial,
      fromVault: authority !== 'supabase' && trial.active,
      fromSupabase: authority === 'supabase' && tokenIsTrial,
    },
    ownerUnlimited,
    openMode,
    tier,
    claims: claims
      ? {
          is_pro: !!claims.is_pro || !!claims.is_vip,
          is_vip: false,
          is_trial: claimsIsTrial(claims),
          plan: claimsIsTrial(claims)
            ? 'trial'
            : claims.is_pro || claims.is_vip
              ? 'pro'
              : claims.plan || 'pro',
          exp: claims.exp,
          expIso: new Date(claims.exp * 1000).toISOString(),
        }
      : null,
    tokenPresent: Boolean(token),
    tokenValid,
    /** True when UI should drop localStorage token (no active cloud license) */
    clearLocalToken: authority === 'supabase' && !tokenValid,
    cloudRevoked,
    supabase: sb,
    features: FEATURE_MATRIX,
    pricing: PRICING_PLANS,
    /** Free product caps + daily remaining (server vault; Pro metering still off) */
    freeLimits: (() => {
      const snap = readFreeUsageForHwid(hwid);
      return {
        ...FREE_LIMITS,
        applies: tier === 'free',
        day: snap.day,
        used: snap.used,
        remaining: snap.remaining,
      };
    })(),
    update: getUpdatePublicStatus(),
    ops: {
      telegramConfigured: telegramConfigured(),
      paymentWebhookConfigured: Boolean(
        (process.env.AINOVEL_PAYMENT_WEBHOOK_SECRET || '').trim(),
      ),
      multiSeat: true,
      autoUpdate: getUpdatePublicStatus().configured,
      licenseAuthority: authority,
    },
    model: {
      name: 'Supabase licenses (HWID) sole truth · no offline self-heal',
      byok: true,
      payment: 'Telegram / Zalo → issue licenses row → app reads HWID plan only',
      cloud: sb.adminConfigured,
      multiSeat: true,
      ledgerRule:
        'No active licenses row = Free (ban / expired / not issued). Token alone cannot grant or re-insert.',
    },
  });
}
