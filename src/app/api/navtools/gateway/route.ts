import { NextRequest, NextResponse } from 'next/server';
import {
  ALL_NAV_GATEWAY_ACTIONS,
  callNavGateway,
  type NavGatewayAction,
} from '@/lib/nav/navPythonBridge';
import { requireFeature } from '@/lib/commercial/apiGate';

export const runtime = 'nodejs';

const ALLOWED_ACTIONS = new Set<NavGatewayAction>(ALL_NAV_GATEWAY_ACTIONS);

export async function GET(req: NextRequest) {
  const denied = await requireFeature(req, 'toolbox_labs');
  if (denied) return denied;
  const result = await callNavGateway({ action: 'capabilities', timeoutMs: 30_000 });
  const status = result.success ? 200 : 500;
  return NextResponse.json(result, { status });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const denied = await requireFeature(req, 'toolbox_labs', body);
    if (denied) return denied;
    const action = String(body.action || body.op || '').trim() as NavGatewayAction;

    if (!action || !ALLOWED_ACTIONS.has(action)) {
      return NextResponse.json(
        {
          success: false,
          error: `Unknown or missing action: ${action || '(empty)'}`,
          known_actions: Array.from(ALLOWED_ACTIONS),
          hint: 'Host-bound AI Novel gateway — requires App token; does not require NAVTools.exe',
        },
        { status: 400 },
      );
    }

    // payload may be nested or flat (action-only stripped)
    let payload: Record<string, unknown> = {};
    if (body.payload && typeof body.payload === 'object' && !Array.isArray(body.payload)) {
      payload = { ...(body.payload as Record<string, unknown>) };
    } else {
      payload = { ...(body as Record<string, unknown>) };
      delete payload.action;
      delete payload.op;
      delete payload.timeoutMs;
      delete payload.payload;
    }

    const timeoutMs =
      typeof body.timeoutMs === 'number' && body.timeoutMs > 0 ? body.timeoutMs : undefined;

    const result = await callNavGateway({ action, payload, timeoutMs });
    const status = result.success ? 200 : 500;
    return NextResponse.json(result, { status });
  } catch (error: unknown) {
    const err = error as Error;
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
