/**
 * Owner / CISO local build vs commercial customer build.
 *
 * - open entitlement mode → treat as full Pro (dev DX)
 * - AINOVEL_OWNER_UNLIMITED=1 → force unlimited (CISO machine only; never ship)
 * - packaged + enforce → never owner unlimited
 */

import { getEntitlementMode, isPackagedPublishHint } from '@/lib/entitlement';

export function isOwnerUnlimitedEnv(): boolean {
  const v = (process.env.AINOVEL_OWNER_UNLIMITED || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

/**
 * Server truth: should this process grant unlimited Pro without a customer token?
 */
export function shouldGrantOwnerUnlimited(): boolean {
  if (isOwnerUnlimitedEnv()) {
    // Even owner flag is ignored when packaged publish unless explicitly open
    if (isPackagedPublishHint() && getEntitlementMode() === 'enforce') {
      return false;
    }
    return true;
  }
  return getEntitlementMode() === 'open';
}
