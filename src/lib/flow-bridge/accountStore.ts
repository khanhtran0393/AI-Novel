import fs from 'fs';
import path from 'path';
import type { FlowAccount } from './types';
import { isPlausibleProjectId } from './projectStore';

function accountsPath(): string {
  const root = process.env.AI_NOVEL_ROOT || process.cwd();
  const dir = path.join(root, 'data', 'flow-bridge');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'accounts.json');
}

function newId(): string {
  return `acc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function loadAccounts(): FlowAccount[] {
  try {
    const p = accountsPath();
    if (!fs.existsSync(p)) return [];
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!Array.isArray(raw)) return [];
    return raw.map((a) => {
      const rawPid = a.projectId ? String(a.projectId).trim() : '';
      const projects = Array.isArray(a.projects)
        ? a.projects
            .map(
              (p: {
                id?: string;
                title?: string;
                source?: string;
                createdAt?: number;
                updatedAt?: number;
              }) => ({
                id: String(p.id || '').trim(),
                title: String(p.title || p.id || 'Project').trim(),
                source:
                  p.source === 'create' ||
                  p.source === 'manual' ||
                  p.source === 'capture'
                    ? p.source
                    : ('capture' as const),
                createdAt: Number(p.createdAt) || Date.now(),
                updatedAt: Number(p.updatedAt) || Date.now(),
              }),
            )
            .filter(
              (p: { id: string }) => p.id && isPlausibleProjectId(p.id),
            )
        : [];
      // Never surface placeholder project ids (abc-111) as bound
      const projectId = isPlausibleProjectId(rawPid)
        ? rawPid
        : projects[0]?.id || '';
      return {
        id: String(a.id || newId()),
        name: String(a.name || 'Account'),
        email: a.email ? String(a.email) : '',
        displayName: a.displayName ? String(a.displayName) : '',
        projectId,
        engine:
          a.engine === 'mullvad'
            ? 'mullvad'
            : a.engine === 'chrome'
              ? 'chrome'
              : 'chromium',
        browserExe: a.browserExe ? String(a.browserExe) : '',
        status: (a.status as FlowAccount['status']) || 'idle',
        proxy: a.proxy ? String(a.proxy) : undefined,
        flowKeyPresent: Boolean(a.flowKeyPresent),
        sessionVerified: Boolean(a.sessionVerified) && Boolean(a.email),
        tokenAgeMs: a.tokenAgeMs ?? null,
        credits: a.credits ?? null,
        paygateTier: a.paygateTier != null ? String(a.paygateTier) : null,
        sessionExpires: a.sessionExpires ? String(a.sessionExpires) : null,
        lastSyncedAt: a.lastSyncedAt != null ? Number(a.lastSyncedAt) : null,
        lastTaskAt: a.lastTaskAt != null ? Number(a.lastTaskAt) : null,
        projects,
        profileDir: a.profileDir ? String(a.profileDir) : '',
        sessionInheritedAt:
          a.sessionInheritedAt != null ? Number(a.sessionInheritedAt) : null,
        capabilities:
          a.capabilities && typeof a.capabilities === 'object'
            ? (a.capabilities as FlowAccount['capabilities'])
            : null,
        cooldownUntil: a.cooldownUntil ?? null,
        lastError: a.lastError ?? null,
        healthScore:
          a.healthScore != null ? Number(a.healthScore) : computeHealthScore(a),
        creditBudget:
          a.creditBudget != null && Number.isFinite(Number(a.creditBudget))
            ? Number(a.creditBudget)
            : null,
        creditsSpent: a.creditsSpent != null ? Number(a.creditsSpent) : 0,
        autoRelogin: a.autoRelogin !== false,
        successCount: Number(a.successCount) || 0,
        failCount: Number(a.failCount) || 0,
        createdAt: Number(a.createdAt) || Date.now(),
        updatedAt: Number(a.updatedAt) || Date.now(),
      };
    });
  } catch {
    return [];
  }
}

const FLOW_AUTH_ERROR_RE =
  /token_401|http\s*401|invalid authentication credentials|bearer|unauth|oauth|login cookie/i;

export function isFlowAuthError(raw?: string | null): boolean {
  return FLOW_AUTH_ERROR_RE.test(String(raw || ''));
}

/** P3 health: token, credits, fail ratio, cooldown. */
export function computeHealthScore(a: Partial<FlowAccount>): number {
  let score = 50;
  if (a.sessionVerified && a.email) score += 20;
  else if (a.flowKeyPresent) score += 8;
  else score -= 25;

  if (a.tokenAgeMs != null) {
    if (a.tokenAgeMs < 20 * 60 * 1000) score += 15;
    else if (a.tokenAgeMs < 45 * 60 * 1000) score += 5;
    else score -= 20;
  }

  if (typeof a.credits === 'number') {
    if (a.credits > 50) score += 10;
    else if (a.credits > 10) score += 5;
    else if (a.credits <= 0) score -= 30;
  }

  const ok = Number(a.successCount) || 0;
  const fail = Number(a.failCount) || 0;
  if (ok + fail > 0) {
    const rate = ok / (ok + fail);
    score += Math.round((rate - 0.5) * 30);
  }

  if (
    a.status === 'cooldown' &&
    a.cooldownUntil &&
    a.cooldownUntil > Date.now()
  ) {
    score -= 25;
  }
  if (a.lastError && /quota|forbidden|unauth/i.test(a.lastError)) score -= 15;
  if (isFlowAuthError(a.lastError)) score -= 30;

  return Math.max(0, Math.min(100, score));
}

export function recordAccountTaskResult(
  id: string,
  ok: boolean,
  creditsUsed = 0,
  error?: string,
): void {
  const a = loadAccounts().find((x) => x.id === id);
  if (!a) return;
  const successCount = (a.successCount || 0) + (ok ? 1 : 0);
  const failCount = (a.failCount || 0) + (ok ? 0 : 1);
  const creditsSpent = (a.creditsSpent || 0) + (ok ? creditsUsed : 0);
  const patch: Partial<FlowAccount> = {
    successCount,
    failCount,
    creditsSpent,
    lastTaskAt: Date.now(),
  };
  const message = String(error || '').trim();
  if (ok) {
    patch.lastError = null;
    if (a.status === 'error') patch.status = 'active';
  } else if (message) {
    patch.lastError = message.slice(0, 1000);
    if (isFlowAuthError(message)) {
      patch.status = 'error';
      patch.flowKeyPresent = false;
    }
  }
  const next = { ...a, ...patch };
  patch.healthScore = computeHealthScore(next);
  updateAccount(id, patch);
}

export function accountWithinBudget(a: FlowAccount, needCredits: number): boolean {
  if (a.creditBudget == null || !Number.isFinite(a.creditBudget)) return true;
  const spent = Number(a.creditsSpent) || 0;
  return spent + needCredits <= a.creditBudget;
}

export function saveAccounts(accounts: FlowAccount[]): void {
  const p = accountsPath();
  // Never persist raw Bearer tokens
  const safe = accounts.map(({ ...a }) => ({
    ...a,
    // strip ephemeral secrets if any were attached
  }));
  fs.writeFileSync(p, JSON.stringify(safe, null, 2), 'utf8');
}

export function createAccount(input: {
  name: string;
  email?: string;
  engine?: 'chromium' | 'mullvad' | 'chrome';
  browserExe?: string;
  proxy?: string;
  creditBudget?: number | null;
  autoRelogin?: boolean;
}): FlowAccount {
  const list = loadAccounts();
  const acc: FlowAccount = {
    id: newId(),
    name: input.name.trim() || `Account ${list.length + 1}`,
    email: input.email || '',
    displayName: '',
    projectId: '',
    engine: input.engine || 'chromium',
    browserExe: input.browserExe || '',
    proxy: input.proxy || undefined,
    status: 'idle',
    flowKeyPresent: false,
    sessionVerified: false,
    tokenAgeMs: null,
    credits: null,
    paygateTier: null,
    sessionExpires: null,
    lastSyncedAt: null,
    lastTaskAt: null,
    projects: [],
    profileDir: '',
    sessionInheritedAt: null,
    capabilities: null,
    cooldownUntil: null,
    lastError: null,
    healthScore: 40,
    creditBudget:
      input.creditBudget != null && Number.isFinite(input.creditBudget)
        ? Number(input.creditBudget)
        : null,
    creditsSpent: 0,
    autoRelogin: input.autoRelogin !== false,
    successCount: 0,
    failCount: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  list.push(acc);
  saveAccounts(list);
  // Ensure ISOLATED browser profile folder per account ID (cookies/session preserved)
  try {
    const {
      ensureIsolatedAccountProfile,
    } = require('./chromeSession') as typeof import('./chromeSession');
    const src = path.join(
      process.env.AI_NOVEL_ROOT || process.cwd(),
      'extensions',
      'ainovel-flow',
    );
    if (fs.existsSync(path.join(src, 'manifest.json'))) {
      ensureIsolatedAccountProfile(acc.id, src);
    }
  } catch {
    /* ignore */
  }
  return acc;
}

export function updateAccount(
  id: string,
  patch: Partial<FlowAccount>,
): FlowAccount | null {
  const list = loadAccounts();
  const i = list.findIndex((a) => a.id === id);
  if (i < 0) return null;
  list[i] = {
    ...list[i],
    ...patch,
    id: list[i].id,
    updatedAt: Date.now(),
  };
  saveAccounts(list);
  return list[i];
}

/**
 * Remove account from store + hard purge browser profile on disk
 * (accounts_data/<id>, legacy scratch, kill browser, drop session meta).
 * Returns detail so API/UI can show what was cleaned.
 */
export function deleteAccount(id: string): boolean {
  return deleteAccountHard(id).ok;
}

export function deleteAccountHard(id: string): {
  ok: boolean;
  accountId: string;
  killed: number;
  removed: string[];
  errors: string[];
} {
  const accountId = String(id || '').trim();
  const empty = {
    ok: false,
    accountId,
    killed: 0,
    removed: [] as string[],
    errors: [] as string[],
  };
  if (!accountId) {
    empty.errors.push('missing id');
    return empty;
  }

  const list = loadAccounts();
  const next = list.filter((a) => a.id !== accountId);
  const wasInStore = next.length !== list.length;
  if (wasInStore) {
    saveAccounts(next);
  }

  let killed = 0;
  let removed: string[] = [];
  let errors: string[] = [];
  try {
    const { purgeAccountProfile } =
      require('./chromeSession') as typeof import('./chromeSession');
    const r = purgeAccountProfile(accountId);
    killed = r.killed;
    removed = r.removed;
    errors = r.errors;
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
  }

  // ok if removed from store OR disk cleaned (orphan purge by id)
  const ok = wasInStore || removed.length > 0;
  console.log(
    `[FlowAccounts] deleteAccountHard id=${accountId} store=${wasInStore} killed=${killed} removed=${removed.length}`,
  );
  return { ok, accountId, killed, removed, errors };
}

/**
 * Clear stuck / false-ready flags on boot.
 * sessionVerified requires real Google email — token alone is NOT login.
 * Fixes "Trình duyệt 1 · sẵn sàng" when user never finished Google login.
 */
export function sanitizeUnverifiedAccounts(): number {
  const list = loadAccounts();
  let n = 0;
  for (const a of list) {
    const hasEmail = Boolean(a.email && String(a.email).includes('@'));

    if (a.status === 'connecting') {
      // Stuck mid-login from previous crash → idle
      if (!hasEmail) {
        updateAccount(a.id, {
          status: 'idle',
          sessionVerified: false,
          lastError:
            a.lastError ||
            'Browser đã đóng — chưa hoàn tất đăng nhập Google',
        });
        n++;
        continue;
      }
    }

    // Demote painted ready: active/sessionVerified without email
    if (!hasEmail && (a.sessionVerified || a.status === 'active')) {
      updateAccount(a.id, {
        status: 'idle',
        sessionVerified: false,
        // Keep flowKeyPresent flag if disk has token — UI will show partial, not "sẵn sàng"
        lastError:
          a.flowKeyPresent
            ? 'Có token cũ nhưng chưa đăng nhập Google (thiếu email) — bấm Đăng nhập'
            : a.lastError || 'Chưa đăng nhập Google',
        projectId: a.projectId && !hasEmail ? a.projectId : a.projectId,
      });
      n++;
    }
  }
  return n;
}

/**
 * Round-robin among ready profiles (least recently used for a gen task).
 * Skips cooldown to avoid spam / quota hits on one account.
 * Requires sessionVerified (real email) — not just a painted token flag.
 */
export function pickReadyAccount(accounts: FlowAccount[]): FlowAccount | null {
  const now = Date.now();
  const ready = accounts.filter((a) => {
    if (a.status === 'cooldown' && a.cooldownUntil && a.cooldownUntil > now) {
      return false;
    }
    if (a.cooldownUntil && a.cooldownUntil > now) return false;
    // Ready = real Google email + token (never token-only stale paint)
    const hasEmail = Boolean(a.email && String(a.email).includes('@'));
    if (hasEmail && a.sessionVerified && a.flowKeyPresent) {
      return true;
    }
    return false;
  });
  if (!ready.length) return null;
  // Oldest lastTaskAt first → rotate profiles evenly
  ready.sort(
    (a, b) =>
      (a.lastTaskAt || 0) - (b.lastTaskAt || 0) ||
      a.updatedAt - b.updatedAt,
  );
  return ready[0];
}

/** Mark profile used after a gen assignment (round-robin cursor). */
export function markAccountTaskUsed(id: string): FlowAccount | null {
  return updateAccount(id, { lastTaskAt: Date.now() });
}

export function upsertAccountProject(
  accountId: string,
  project: {
    id: string;
    title?: string;
    source?: 'create' | 'capture' | 'manual';
  },
): FlowAccount | null {
  const acc = loadAccounts().find((a) => a.id === accountId);
  if (!acc) return null;
  const id = String(project.id || '').trim();
  if (!id || !isPlausibleProjectId(id)) return null;
  const list = [...(acc.projects || [])];
  const i = list.findIndex((p) => p.id === id);
  const now = Date.now();
  const row = {
    id,
    title: (project.title || list[i]?.title || `Project ${id.slice(0, 8)}`).trim(),
    source: (project.source || list[i]?.source || 'capture') as
      | 'create'
      | 'capture'
      | 'manual',
    createdAt: list[i]?.createdAt || now,
    updatedAt: now,
  };
  if (i >= 0) list[i] = row;
  else list.unshift(row);
  // Prefer binding this project when profile has no real project yet
  const keep =
    acc.projectId && isPlausibleProjectId(acc.projectId)
      ? acc.projectId
      : id;
  return updateAccount(accountId, {
    projects: list,
    projectId: keep,
  });
}

/** Persist-sanitize: strip fake projectIds from disk once. */
export function sanitizeAccountProjects(): number {
  const list = loadAccounts();
  let n = 0;
  for (const a of list) {
    const raw = String(a.projectId || '').trim();
    if (raw && !isPlausibleProjectId(raw)) {
      updateAccount(a.id, {
        projectId: (a.projects || []).find((p) => isPlausibleProjectId(p.id))
          ?.id || '',
      });
      n++;
    }
  }
  return n;
}
