import { NextResponse } from 'next/server';
import { loadFlowOps, saveFlowOps } from '@/lib/flow-bridge/opsStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ ops: loadFlowOps() });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = {};
  if (typeof body.agentInstructions === 'string') {
    patch.agentInstructions = body.agentInstructions;
  }
  if (typeof body.defaultQuality === 'string') {
    patch.defaultQuality = body.defaultQuality;
  }
  if (typeof body.autoRelogin === 'boolean') {
    patch.autoRelogin = body.autoRelogin;
  }
  if (body.minHealthScore != null && Number.isFinite(Number(body.minHealthScore))) {
    patch.minHealthScore = Number(body.minHealthScore);
  }
  if (body.defaultCreditBudget === null || body.defaultCreditBudget === '') {
    patch.defaultCreditBudget = null;
  } else if (
    body.defaultCreditBudget != null &&
    Number.isFinite(Number(body.defaultCreditBudget))
  ) {
    patch.defaultCreditBudget = Number(body.defaultCreditBudget);
  }
  if (typeof body.globalProxy === 'string') {
    patch.globalProxy = body.globalProxy;
  }
  const ops = saveFlowOps(patch);
  return NextResponse.json({ ok: true, ops });
}
