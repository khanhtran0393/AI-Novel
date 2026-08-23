/**
 * Veo 3.1 Remaining Credit Balance Auto-Router for AI Novel.
 * Exact reference implementation from SuperAutoTools.
 *
 * Tracks live `responseData.remainingCredits` from Veo 3.1 responses,
 * automatically updating account store balances and routing new video generation
 * tasks away from low-credit accounts (< 20 credits) to high-credit accounts.
 */

import { loadAccounts, updateAccount } from './accountStore';

export class CreditAutoRouter {
  updateAccountCredits(accountId: string, remainingCredits: number) {
    if (typeof remainingCredits !== 'number' || isNaN(remainingCredits)) return;

    console.log(`[CreditAutoRouter] Account ${accountId} remaining credits updated: ${remainingCredits}`);
    updateAccount(accountId, {
      remainingCredits,
      lastSyncedAt: Date.now(),
    });
  }

  pickOptimalAccount(): string | null {
    const accounts = loadAccounts();
    if (!accounts || accounts.length === 0) return null;

    // Filter accounts with remainingCredits >= 20
    const eligible = accounts.filter((acc) => {
      const credits = (acc as any).remainingCredits ?? 100;
      return credits >= 20 && !acc.disabled;
    });

    if (eligible.length === 0) {
      // Fallback to highest credit account even if below 20
      const sorted = [...accounts].sort((a, b) => ((b as any).remainingCredits ?? 0) - ((a as any).remainingCredits ?? 0));
      return sorted[0]?.id || null;
    }

    // Pick eligible account with highest remaining credits
    eligible.sort((a, b) => ((b as any).remainingCredits ?? 100) - ((a as any).remainingCredits ?? 100));
    return eligible[0].id;
  }
}

export const creditAutoRouter = new CreditAutoRouter();
