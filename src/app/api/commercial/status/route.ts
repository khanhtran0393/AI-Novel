/**
 * Public commercial status: mode, trial, feature matrix, pricing.
 * **When Supabase admin configured → plan from licenses table by HWID (source of truth).**
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
import {
  claimsArePaidPro,
  promoteHwidLicenseToPaidPro,
  resolveLicenseByHwid,
} from '@/lib/cloud/licenseBridge';
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

  // ── Supabase = primary authority for UI tier ──
  // Local Ed25519 token kept as fallback when cloud has no row (Telegram key
  // issued before DB write, or offline). Explicit revoke still forces Free.
  // Paid Pro offline token always beats a leftover cloud trial row.
  const localTokenClaims = claims;
  const localPaidPro = claimsArePaidPro(localTokenClaims);
  if (isSupabaseAdminConfigured() && !ownerUnlimited) {
    try {
      const service = createServiceSupabase();
      const cloud = await resolveLicenseByHwid(service, hwid);
      authority = 'supabase';
      cloudStatus = cloud.status || null;
      if (cloud.found && cloud.claims) {
        // Customer activated paid key while trial row still active → promote
        if (localPaidPro && localTokenClaims && claimsIsTrial(cloud.claims)) {
          const promoted = await promoteHwidLicenseToPaidPro({
            service,
            token: token || '',
            hwid,
            exp: localTokenClaims.exp,
          });
          if (promoted.ok) {
            claims = {
              ...localTokenClaims,
              is_pro: true,
              is_vip: false,
              is_trial: false,
              plan: 'pro',
            };
            cloudLicenseId = promoted.licenseId || cloud.licenseId || null;
            cloudRevoked = false;
            cloudStatus = 'active';
          } else {
            // Still show Pro from offline token if promote fails
            claims = {
              ...localTokenClaims,
              is_pro: true,
              is_vip: false,
              is_trial: false,
              plan: 'pro',
            };
            authority = 'local';
            cloudLicenseId = cloud.licenseId || null;
          }
        } else if (localPaidPro && localTokenClaims && claimsArePaidPro(cloud.claims)) {
          claims = cloud.claims;
          cloudLicenseId = cloud.licenseId || null;
          cloudRevoked = false;
        } else if (localPaidPro && localTokenClaims) {
          // Cloud row exists but not paid pro (legacy) — prefer paid token
          claims = {
            ...localTokenClaims,
            is_pro: true,
            is_vip: false,
            is_trial: false,
            plan: 'pro',
          };
          cloudLicenseId = cloud.licenseId || null;
          authority = 'local';
        } else {
          claims = cloud.claims;
          cloudLicenseId = cloud.licenseId || null;
          cloudRevoked = false;
        }
      } else if (cloud.status === 'revoked') {
        // Paid offline token can still win only if not revoked for this HWID
        // Explicit HWID revoke → Free
        claims = null;
        cloudRevoked = true;
      } else if (
        localTokenClaims &&
        (localTokenClaims.is_pro ||
          localTokenClaims.is_vip ||
          claimsIsTrial(localTokenClaims))
      ) {
        // No active row: honor signed HWID-bound token; self-heal paid Pro
        if (localPaidPro && token) {
          const promoted = await promoteHwidLicenseToPaidPro({
            service,
            token,
            hwid,
            exp: localTokenClaims.exp,
          });
          if (promoted.ok) {
            claims = {
              ...localTokenClaims,
              is_pro: true,
              is_vip: false,
              is_trial: false,
              plan: 'pro',
            };
            authority = 'supabase';
            cloudLicenseId = promoted.licenseId || null;
            cloudStatus = 'active';
          } else {
            claims = localTokenClaims;
            authority = 'local';
            cloudStatus = cloud.status || 'none';
          }
        } else {
          claims = localTokenClaims;
          authority = 'local';
          cloudStatus = cloud.status || 'none';
        }
      } else {
        claims = null;
        cloudRevoked = false;
      }
    } catch {
      // Cloud error: keep local token if still valid (don't wipe Pro offline)
      if (
        localTokenClaims &&
        (localTokenClaims.is_pro ||
          localTokenClaims.is_vip ||
          claimsIsTrial(localTokenClaims))
      ) {
        claims = localTokenClaims;
        authority = 'local';
        cloudStatus = 'error';
      } else {
        claims = null;
        authority = 'supabase';
        cloudStatus = 'error';
      }
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

  // tokenValid for UI: when supabase authority, valid = found cloud claims
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
    /** True when UI should drop localStorage token (no cloud license) */
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
      name: 'Supabase licenses (HWID) primary · Ed25519 offline verification',
      byok: true,
      payment: 'Telegram / Zalo → issue → licenses row → app reads HWID plan',
      cloud: sb.adminConfigured,
      multiSeat: true,
    },
  });
}
