import { NextResponse } from 'next/server';
import {
  createAccount,
  deleteAccount,
  loadAccounts,
  updateAccount,
} from '@/lib/flow-bridge/accountStore';
import { ensureBridgeStarted, getLiveAccounts } from '@/lib/flow-bridge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  await ensureBridgeStarted();
  return NextResponse.json({ accounts: getLiveAccounts() });
}

export async function POST(req: Request) {
  await ensureBridgeStarted();
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || 'create');

  if (action === 'create') {
    const acc = createAccount({
      name: String(body.name || ''),
      email: body.email ? String(body.email) : '',
      engine: body.engine === 'mullvad' ? 'mullvad' : 'chromium',
      browserExe: body.browserExe ? String(body.browserExe) : '',
    });
    return NextResponse.json({ account: acc, accounts: loadAccounts() });
  }

  if (action === 'delete') {
    const ok = deleteAccount(String(body.id || ''));
    return NextResponse.json({ ok, accounts: loadAccounts() });
  }

  if (action === 'patch') {
    const acc = updateAccount(String(body.id || ''), body.patch || body);
    return NextResponse.json({ account: acc, accounts: loadAccounts() });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
