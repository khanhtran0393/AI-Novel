import { NextResponse } from 'next/server';
import {
  createAccount,
  deleteAccount,
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

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
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
  await ensureBridgeStarted();
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || 'create');

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
    const ok = deleteAccount(String(body.id || ''));
    return NextResponse.json({ ok, accounts: loadAccounts() });
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
    const acc = updateAccount(String(body.id || ''), safe);
    return NextResponse.json({ account: acc, accounts: loadAccounts() });
  }

  if (action === 'reset_budget') {
    const acc = updateAccount(String(body.id || ''), { creditsSpent: 0 });
    return NextResponse.json({ account: acc, accounts: loadAccounts() });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
