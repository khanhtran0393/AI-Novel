/**
 * Google Flow runtime recycle (standard).
 * After successful gens: optional hard recycle of Chromium profile to curb
 * session drift + RAM growth. Never kills another account's profile.
 *
 * Soft path: refresh Flow tab only when hard recycle is abandoned (max defers).
 * Hard path: killChromeForProfile when queue idle for that account.
 * Intermediate successes do not thrash refresh_flow_tab mid-batch.
 */
import { FLOW_DEFAULTS } from './config';
import { loadFlowOps } from './opsStore';
import type { FlowTaskKind } from './types';

type Counter = {
  successStreak: number;
  lastSuccessAt: number;
  pendingRecycle: boolean;
  deferCount: number;
};

const MAX_RECYCLE_DEFERS = 30;

const g = globalThis as unknown as {
  __ainovelFlowRecycle?: {
    byAccount: Map<string, Counter>;
    timers: Map<string, ReturnType<typeof setTimeout>>;
    /** Accounts currently executing a gen task */
    busyAccounts: Set<string>;
  };
};

function root() {
  if (!g.__ainovelFlowRecycle) {
    g.__ainovelFlowRecycle = {
      byAccount: new Map(),
      timers: new Map(),
      busyAccounts: new Set(),
    };
  }
  return g.__ainovelFlowRecycle;
}

function counter(accountId: string): Counter {
  const r = root();
  let c = r.byAccount.get(accountId);
  if (!c) {
    c = {
      successStreak: 0,
      lastSuccessAt: 0,
      pendingRecycle: false,
      deferCount: 0,
    };
    r.byAccount.set(accountId, c);
  }
  return c;
}

export function markAccountBusy(accountId: string | undefined): void {
  if (!accountId) return;
  root().busyAccounts.add(accountId);
}

export function markAccountFree(accountId: string | undefined): void {
  if (!accountId) return;
  root().busyAccounts.delete(accountId);
}

export function isAccountBusy(accountId: string): boolean {
  return root().busyAccounts.has(accountId);
}

export function listBusyAccountIds(): string[] {
  return [...root().busyAccounts];
}

/**
 * Whether hard recycle should run after this success.
 * Video: every success when policy on (heavier session).
 * Image/edit: every N successes (default 2).
 * Side-effect: increments success streak when recycle policy is enabled.
 */
export function shouldHardRecycleAfterSuccess(
  kind: FlowTaskKind,
  accountId: string,
): boolean {
  const ops = loadFlowOps();
  if (ops.recycleAfterSuccess === false) return false;
  const everyN = Math.max(
    1,
    Number(ops.recycleEveryNSuccess) || FLOW_DEFAULTS.recycleEveryNSuccess,
  );
  const c = counter(accountId);
  c.successStreak += 1;
  c.lastSuccessAt = Date.now();

  if (kind === 'video' || kind === 'extend') {
    if (ops.recycleEveryVideoSuccess !== false) return true;
    return c.successStreak >= everyN;
  }
  return c.successStreak >= everyN;
}

export function resetSuccessStreak(accountId: string): void {
  const c = counter(accountId);
  c.successStreak = 0;
  c.pendingRecycle = false;
  c.deferCount = 0;
}

/**
 * Schedule hard recycle after delay if account has no busy gen and
 * optional hasPendingForAccount returns false.
 */
export function scheduleFlowRuntimeRecycle(opts: {
  accountId: string;
  kind: FlowTaskKind;
  /** true if queue still has pending/running that may use this account */
  hasMoreWorkForAccount: () => boolean;
}): void {
  const { accountId, kind } = opts;
  if (!accountId) return;
  if (!shouldHardRecycleAfterSuccess(kind, accountId)) {
    // Intermediate successes: do NOT refresh_flow_tab (thrash mid-batch).
    // Soft refresh only on hard-recycle give-up path.
    return;
  }

  // Never hard-kill while more work likely for this account
  if (opts.hasMoreWorkForAccount()) {
    console.log(
      `[FlowRecycle] skip hard schedule (queue work remains) account=${accountId}`,
    );
    return;
  }

  armHardRecycle(accountId, opts.hasMoreWorkForAccount);
}

function armHardRecycle(
  accountId: string,
  hasMoreWorkForAccount: () => boolean,
): void {
  const r = root();
  const existing = r.timers.get(accountId);
  if (existing) clearTimeout(existing);

  const delay = Math.max(0, Number(FLOW_DEFAULTS.recycleDelayMs) || 800);
  console.log(
    `[FlowRecycle] schedule hard recycle account=${accountId} delayMs=${delay}`,
  );

  const timer = setTimeout(() => {
    r.timers.delete(accountId);
    void runHardRecycle(accountId, hasMoreWorkForAccount);
  }, delay);
  r.timers.set(accountId, timer);
  counter(accountId).pendingRecycle = true;
}

async function softRefreshFlowTab(accountId: string): Promise<void> {
  try {
    const bridge = await import('./bridgeServer');
    await bridge.commandExtension('refresh_flow_tab', {}, 20_000, accountId);
    console.log(`[FlowRecycle] soft refresh_flow_tab account=${accountId}`);
  } catch {
    /* ignore — extension may be idle */
  }
}

async function runHardRecycle(
  accountId: string,
  hasMoreWorkForAccount: () => boolean,
): Promise<void> {
  const c = counter(accountId);
  if (isAccountBusy(accountId) || hasMoreWorkForAccount()) {
    c.deferCount += 1;
    if (c.deferCount > MAX_RECYCLE_DEFERS) {
      console.warn(
        `[FlowRecycle] give up hard recycle after ${MAX_RECYCLE_DEFERS} defers account=${accountId}`,
      );
      c.pendingRecycle = false;
      c.deferCount = 0;
      // Soft only — do not thrash kill forever
      void softRefreshFlowTab(accountId);
      return;
    }
    console.log(
      `[FlowRecycle] defer hard recycle (${c.deferCount}/${MAX_RECYCLE_DEFERS}) account=${accountId}`,
    );
    armHardRecycle(accountId, hasMoreWorkForAccount);
    return;
  }

  try {
    const { killChromeForProfile, profileDirForAccount } = await import(
      './chromeSession'
    );
    const dir = profileDirForAccount(accountId);
    const killed = killChromeForProfile(dir);
    resetSuccessStreak(accountId);
    console.log(
      `[FlowRecycle] hard recycle account=${accountId} killed=${killed} dir=${dir}`,
    );
  } catch (e) {
    console.warn(
      `[FlowRecycle] hard recycle failed account=${accountId}`,
      e instanceof Error ? e.message : e,
    );
  }
}

/** Test helper — clear process-local recycle state. */
export function __resetFlowRecycleStateForTests(): void {
  const r = root();
  for (const t of r.timers.values()) clearTimeout(t);
  r.timers.clear();
  r.byAccount.clear();
  r.busyAccounts.clear();
}
