import { NextResponse } from 'next/server';
import {
  createAccount,
  deleteAccountHard,
  loadAccounts,
  updateAccount,
} from '@/lib/flow-bridge/accountStore';
import {
  ensureBridgeStarted,
  getBridgeSnapshot,
  getLiveAccounts,
  inheritAccountSession,
  syncAccountIdentity,
} from '@/lib/flow-bridge';
/** Direct import — avoids barrel resolution flake during `next build` typecheck. */
import { purgeDeletedAccountRuntime } from '@/lib/flow-bridge/bridgeServer';
import { requireFeature } from '@/lib/commercial/apiGate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  // Free may use a single Flow account (BYOK). Multi-account is Pro-gated on create.
  await ensureBridgeStarted();
  const snap = getBridgeSnapshot();
  return NextResponse.json({
    accounts: getLiveAccounts(),
    identity: snap.identity || null,
    projectId: snap.projectId || null,
    projects: snap.projects || [],
  });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  await ensureBridgeStarted();
  const action = String(body.action || 'create');
  const existing = loadAccounts();

  // Free: single Flow account (BYOK). 2nd+ create or multi-account farm ops → Pro.
  const needsMulti =
    action === 'create'
      ? existing.length >= 1
      : action === 'inherit' || action === 'inherit_session'
        ? true
        : (action === 'delete' || action === 'patch' || action === 'reset_budget') &&
          existing.length > 1;

  if (needsMulti) {
    const denied = await requireFeature(req, 'flow_multi_account', body);
    if (denied) return denied;
  }

  // Full inherit: browser cookies/cache/token/projects → app profile
  if (action === 'inherit' || action === 'inherit_session') {
    const accountId = String(body.accountId || body.id || '').trim();
    if (!accountId) {
      return NextResponse.json(
        { ok: false, error: 'accountId required' },
        { status: 400 },
      );
    }
    const result = await inheritAccountSession(accountId);
    const snap = getBridgeSnapshot();
    return NextResponse.json({
      ok: result.ok,
      error: result.error,
      steps: result.steps,
      accountId: result.accountId,
      identity: result.identity || snap.identity,
      account: result.account,
      browserSession: result.browserSession,
      accounts: getLiveAccounts(),
      snapshot: snap,
    });
  }

  if (action === 'sync' || action === 'sync_identity') {
    const accountId = body.accountId ? String(body.accountId) : undefined;
    // Prefer full inherit when accountId known (session + projects + bundle)
    if (accountId) {
      const result = await inheritAccountSession(accountId);
      const snap = getBridgeSnapshot();
      return NextResponse.json({
        ok: result.ok,
        error: result.error,
        steps: result.steps,
        accountId: result.accountId,
        identity: result.identity || snap.identity,
        account: result.account,
        browserSession: result.browserSession,
        accounts: getLiveAccounts(),
        projects: result.account?.projects || snap.projects,
        snapshot: snap,
      });
    }
    const result = await syncAccountIdentity(accountId);
    const snap = getBridgeSnapshot();
    return NextResponse.json({
      ok: result.ok,
      error: result.error,
      steps: result.steps,
      accountId: result.accountId || accountId || null,
      identity: result.identity || snap.identity,
      accounts: getLiveAccounts(),
      projects: result.projects || snap.projects,
      snapshot: snap,
    });
  }

  if (action === 'create') {
    const acc = createAccount({
      name: String(body.name || ''),
      email: body.email ? String(body.email) : '',
      engine: body.engine === 'mullvad' ? 'mullvad' : 'chromium',
      browserExe: body.browserExe ? String(body.browserExe) : '',
      proxy: body.proxy ? String(body.proxy) : undefined,
      creditBudget:
        body.creditBudget != null && body.creditBudget !== ''
          ? Number(body.creditBudget)
          : null,
      autoRelogin: body.autoRelogin !== false,
    });
    return NextResponse.json({ account: acc, accounts: loadAccounts() });
  }

  if (action === 'delete') {
    const id = String(body.id || '').trim();
    // Hard delete: accounts.json + kill browser + rm accounts_data/<id> + clear bearer
    const disk = deleteAccountHard(id);
    try {
      purgeDeletedAccountRuntime(id);
    } catch {
      /* ignore — disk purge already attempted in deleteAccountHard */
    }
    return NextResponse.json({
      ok: disk.ok,
      accountId: id,
      killed: disk.killed,
      removed: disk.removed,
      errors: disk.errors,
      accounts: loadAccounts(),
    });
  }

  if (action === 'patch') {
    const patch = { ...(body.patch || body) } as Record<string, unknown>;
    delete patch.action;
    delete patch.id;
    // Allow farm fields (P3)
    const allowed = [
      'name',
      'email',
      'engine',
      'browserExe',
      'proxy',
      'projectId',
      'creditBudget',
      'creditsSpent',
      'autoRelogin',
      'status',
      'cooldownUntil',
    ];
    const safe: Record<string, unknown> = {};
    for (const k of allowed) {
      if (patch[k] !== undefined) safe[k] = patch[k];
    }
    if (safe.creditBudget === '') safe.creditBudget = null;
    // Empty proxy string clears per-profile proxy
    if (safe.proxy === '') safe.proxy = undefined;
    const acc = updateAccount(String(body.id || ''), safe as Partial<
      import('@/lib/flow-bridge/types').FlowAccount
    >);
    return NextResponse.json({ account: acc, accounts: loadAccounts() });
  }

  if (action === 'close_login' || action === 'close') {
    const accountId = String(body.accountId || body.id || '').trim();
    const { closeLoginSessionAfterCapture } = await import('@/lib/flow-bridge/chromeSession');
    const result = await closeLoginSessionAfterCapture({
      delayMs: 300,
      accountId,
      keepBackground: true,
    });
    return NextResponse.json({ ok: result.closed, message: result.message });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
