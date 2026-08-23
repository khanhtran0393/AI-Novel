/**
 * Paygate Tier HD/4K Task Router for AI Novel.
 * Exact reference implementation from SuperAutoTools.
 *
 * Inspects `paygateTier` (`PAYGATE_TIER_ONE`, `PAYGATE_TIER_PRO`) of registered accounts.
 * Automatically prioritizes high-tier Pro accounts for heavy 1080p and 4K video generation tasks.
 */

import { loadAccounts } from './accountStore';
import type { FlowAccount } from './types';

export class PaygateTierRouter {
  pickBestAccountForQuality(quality?: string): FlowAccount | null {
    const accounts = loadAccounts();
    if (!accounts || accounts.length === 0) return null;

    const isHeavyTask = quality ? /1080|fhd|4k|high|ultra/i.test(quality) : false;
    const activeAccounts = accounts.filter((acc) => acc.status === 'idle' || acc.status === 'active');

    if (activeAccounts.length === 0) {
      return accounts[0] || null;
    }

    if (isHeavyTask) {
      // Prioritize PAYGATE_TIER_PRO / PAYGATE_TIER_ONE
      const proAccounts = activeAccounts.filter((acc) => {
        const tier = (acc.paygateTier || '').toUpperCase();
        return tier.includes('PRO') || tier.includes('ONE') || tier.includes('TIER_1');
      });

      if (proAccounts.length > 0) {
        console.log(`[PaygateTierRouter] Heavy task (${quality}): Assigned to Pro/Tier-1 account ${proAccounts[0].id}`);
        return proAccounts[0];
      }
    }

    return activeAccounts[0];
  }
}

export const paygateTierRouter = new PaygateTierRouter();
