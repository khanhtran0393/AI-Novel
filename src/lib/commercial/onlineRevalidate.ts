/**
 * Phase C — stricter online revalidate for expensive Pro features.
 *
 * Stacks on top of enforcePackagedHeartbeat:
 * - Packaged + feature in STRICT_ONLINE_FEATURES
 * - Requires a recent successful online heartbeat (shorter grace)
 * - First-run offline still allowed once (same as heartbeat), then must phone home
 */
import type { CommercialFeatureId } from '@/lib/commercial/featureMatrix';
import { isStrictOnlineFeature } from '@/lib/commercial/ipCatalog';
import {
  enforcePackagedHeartbeat,
  getHeartbeatPublicStatus,
  heartbeatGraceSec,
} from '@/lib/commercial/licenseHeartbeat';
import { isPackagedCustomerRuntime } from '@/lib/commercial/sellerRuntime';
import type { EntitlementClaims } from '@/lib/entitlement';
import { AppError } from '@/lib/errors';

/** Default **6h** for strict Pro IP features (vs 48h general heartbeat grace). */
export function strictOnlineGraceSec(): number {
  const n = Number(process.env.AINOVEL_STRICT_ONLINE_GRACE_SEC || 6 * 3600);
  return Number.isFinite(n) && n >= 600 ? Math.floor(n) : 6 * 3600;
}

/**
 * After normal feature tier check + heartbeat, enforce tighter online window
 * for cataloged Pro IP surfaces.
 */
export async function enforceStrictOnlineForFeature(
  req: Request,
  featureId: CommercialFeatureId,
  body?: unknown,
  claims?: EntitlementClaims | null,
): Promise<void> {
  if (!isStrictOnlineFeature(featureId)) return;
  if (!isPackagedCustomerRuntime()) return;

  // Always run standard heartbeat first (revoke + first-run)
  await enforcePackagedHeartbeat(req, body, claims ?? undefined);

  // Optional kill-switch for support / white-machine debugging
  if (
    process.env.AINOVEL_STRICT_ONLINE === '0' ||
    process.env.AINOVEL_STRICT_ONLINE === 'false'
  ) {
    return;
  }

  const st = getHeartbeatPublicStatus();
  if (st.revoked) {
    throw new AppError(
      'License đã bị thu hồi — không dùng được tính năng Pro IP.',
      { code: 'AUTH', status: 403 },
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const last = st.lastOkAt;

  // Never successfully online: first-run window is owned by enforcePackagedHeartbeat.
  // After that window closes heartbeat throws; if still here with lastOkAt null,
  // allow only when still inside first-run (heartbeat already validated).
  if (last == null || last <= 0) {
    return;
  }

  const age = now - last;
  const grace = Math.min(strictOnlineGraceSec(), heartbeatGraceSec());
  if (age <= grace) return;

  throw new AppError(
    `Tính năng «${featureId}» cần heartbeat online gần đây ` +
      `(≤${Math.floor(grace / 3600)}h). Kết nối mạng rồi thử lại.`,
    { code: 'AUTH', status: 403 },
  );
}
