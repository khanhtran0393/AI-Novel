/**
 * 15-Minute Account Cooldown Auto-Recovery Engine for AI Novel.
 * Exact reference implementation from SuperAutoTools.
 *
 * Runs a periodic 60s background scanner that inspects accounts in `cooldown` state.
 * Once `Date.now() > cooldownUntil` (after 15 minutes), automatically recovers the account
 * back to `active` / `idle` status and places it back into the rotation pool.
 */

import { loadAccounts, updateAccount } from './accountStore';

export class CooldownAutoRecovery {
  private timer: NodeJS.Timeout | null = null;
  private readonly CHECK_INTERVAL_MS = 60 * 1000; // 60 seconds

  startScanner() {
    if (this.timer) return;

    console.log('[CooldownAutoRecovery] Starting 60s background account recovery scanner...');
    this.timer = setInterval(() => {
      this.checkAndRecoverAccounts();
    }, this.CHECK_INTERVAL_MS);
  }

  stopScanner() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  checkAndRecoverAccounts(): number {
    const accounts = loadAccounts();
    if (!accounts || accounts.length === 0) return 0;

    let recoveredCount = 0;
    const now = Date.now();

    for (const acc of accounts) {
      const cooldownUntil = (acc as any).cooldownUntil || 0;
      const isCooldown = acc.status === 'cooldown' || cooldownUntil > 0;

      if (isCooldown && now >= cooldownUntil) {
        console.log(`[CooldownAutoRecovery] 15m Cooldown expired for account ${acc.id} (${acc.email || acc.name}). Auto-recovering to ACTIVE...`);
        updateAccount(acc.id, {
          status: 'idle',
          cooldownUntil: null,
        } as any);
        recoveredCount++;
      }
    }

    return recoveredCount;
  }
}

export const cooldownAutoRecovery = new CooldownAutoRecovery();
