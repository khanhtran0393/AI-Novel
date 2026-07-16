import { NextResponse } from 'next/server';
import {
  createFlowProject,
  ensureBridgeStarted,
  getBridgeSnapshot,
  setProjectId,
  syncAccountIdentity,
} from '@/lib/flow-bridge';
import { loadAccounts } from '@/lib/flow-bridge/accountStore';
import {
  loadProjects,
  removeProject,
  upsertProject,
} from '@/lib/flow-bridge/projectStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function accountProjects(accountId?: string | null) {
  const aid = String(accountId || '').trim();
  if (!aid) return [];
  const acc = loadAccounts().find((a) => a.id === aid);
  return acc?.projects || [];
}

function accountProjectId(accountId?: string | null) {
  const aid = String(accountId || '').trim();
  if (!aid) return null;
  const acc = loadAccounts().find((a) => a.id === aid);
  return acc?.projectId || null;
}

export async function GET() {
  await ensureBridgeStarted();
  const snap = getBridgeSnapshot();
  return NextResponse.json({
    projectId: snap.projectId || null,
    projects: loadProjects(),
    identity: snap.identity || null,
    accounts: snap.accounts,
  });
}

export async function POST(req: Request) {
  await ensureBridgeStarted();
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || 'list');

  if (action === 'list' || action === 'sync') {
    // sync: re-harvest projects + identity from browser → bind to THIS profile
    if (action === 'sync' || body.refresh) {
      const accountId = body.accountId ? String(body.accountId) : undefined;
      const sync = await syncAccountIdentity(accountId);
      const snap = getBridgeSnapshot();
      const aid = sync.accountId || accountId || null;
      // Prefer per-account list; fall back to global catalog only if empty
      const perAcc = accountProjects(aid);
      const projects = perAcc.length ? perAcc : loadProjects();
      return NextResponse.json({
        ok: sync.ok,
        error: sync.error,
        steps: sync.steps,
        accountId: aid,
        projectId: accountProjectId(aid) || snap.projectId || null,
        projects,
        accountProjects: perAcc,
        identity: snap.identity || null,
        snapshot: snap,
      });
    }
    const snap = getBridgeSnapshot();
    const accountId = body.accountId ? String(body.accountId) : undefined;
    const perAcc = accountProjects(accountId);
    return NextResponse.json({
      projectId: accountProjectId(accountId) || snap.projectId || null,
      projects: perAcc.length ? perAcc : loadProjects(),
      accountProjects: perAcc,
      identity: snap.identity || null,
      accounts: snap.accounts,
    });
  }

  if (action === 'select') {
    const id = String(body.projectId || body.id || '').trim();
    if (!id) {
      return NextResponse.json({ error: 'projectId required' }, { status: 400 });
    }
    const title = body.title ? String(body.title) : undefined;
    const accountId = body.accountId ? String(body.accountId) : undefined;
    try {
      const row = setProjectId(id, title, accountId);
      const perAcc = accountProjects(accountId);
      return NextResponse.json({
        ok: true,
        project: row,
        projectId: id,
        accountId,
        projects: perAcc.length ? perAcc : loadProjects(),
        accountProjects: perAcc,
        snapshot: getBridgeSnapshot(),
      });
    } catch (e) {
      return NextResponse.json(
        {
          ok: false,
          error: e instanceof Error ? e.message : String(e),
          projects: accountProjects(accountId),
        },
        { status: 400 },
      );
    }
  }

  if (action === 'create') {
    const title = body.title ? String(body.title) : undefined;
    const accountId = body.accountId ? String(body.accountId) : undefined;
    const result = await createFlowProject(title, accountId);
    const perAcc = accountProjects(accountId);
    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: result.error || 'createProject failed',
          projects: perAcc.length ? perAcc : loadProjects(),
          accountProjects: perAcc,
          snapshot: getBridgeSnapshot(),
        },
        { status: 502 },
      );
    }
    return NextResponse.json({
      ok: true,
      project: result.project,
      projectId: result.project?.id,
      accountId,
      projects: perAcc.length ? perAcc : loadProjects(),
      accountProjects: perAcc,
      snapshot: getBridgeSnapshot(),
    });
  }

  if (action === 'manual') {
    const id = String(body.projectId || body.id || '').trim();
    if (!id) {
      return NextResponse.json({ error: 'projectId required' }, { status: 400 });
    }
    const title = body.title ? String(body.title) : id.slice(0, 8);
    const accountId = body.accountId ? String(body.accountId) : undefined;
    upsertProject({ id, title, source: 'manual' });
    const row = setProjectId(id, title, accountId);
    const perAcc = accountProjects(accountId);
    return NextResponse.json({
      ok: true,
      project: row,
      projectId: id,
      accountId,
      projects: perAcc.length ? perAcc : loadProjects(),
      accountProjects: perAcc,
      snapshot: getBridgeSnapshot(),
    });
  }

  if (action === 'delete') {
    const id = String(body.projectId || body.id || '').trim();
    const ok = removeProject(id);
    return NextResponse.json({
      ok,
      projects: loadProjects(),
      snapshot: getBridgeSnapshot(),
    });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
