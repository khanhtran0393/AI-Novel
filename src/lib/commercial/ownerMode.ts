/**
 * Owner / CISO local override vs commercial customer build.
 *
 * - AINOVEL_OWNER_UNLIMITED=1 → force unlimited Pro UI + server (CISO only; never ship)
 * - AINOVEL_ENTITLEMENT_MODE=open → **chỉ** nới server assert (dev API),
 *   **KHÔNG** ép UI Free/Trial/Pro thành Pro (để test trial/free trên dev)
 * - packaged + enforce → never owner unlimited
 */

import { getEntitlementMode, isPackagedPublishHint } from '@/lib/entitlement';

export function isOwnerUnlimitedEnv(): boolean {
  const v = (process.env.AINOVEL_OWNER_UNLIMITED || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

/**
 * Server/UI truth: grant unlimited Pro without a customer token?
 * Explicit env only — MODE=open does **not** count as owner unlimited.
 */
export function shouldGrantOwnerUnlimited(): boolean {
  if (!isOwnerUnlimitedEnv()) return false;
  // Owner flag ignored on packaged enforce (customer builds)
  if (isPackagedPublishHint() && getEntitlementMode() === 'enforce') {
    return false;
  }
  return true;
}
