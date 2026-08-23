import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export const runtime = 'nodejs';

// Lazy-load heavy modules to prevent OOM during cold-start compilation
async function getCallNavGateway() {
  const mod = await import('@/lib/nav/navPythonBridge');
  return { callNavGateway: mod.callNavGateway, ALL_NAV_GATEWAY_ACTIONS: mod.ALL_NAV_GATEWAY_ACTIONS, type: null as never };
}
type NavGatewayAction = import('@/lib/nav/navPythonBridge').NavGatewayAction;

export async function GET(req: NextRequest) {
  const { requireFeature } = await import('@/lib/commercial/apiGate');
  const denied = await requireFeature(req, 'toolbox_labs');
  if (denied) return denied;
  const { callNavGateway } = await getCallNavGateway();
  const result = await callNavGateway({ action: 'capabilities', timeoutMs: 30_000 });
  const status = result.success ? 200 : 500;
  return NextResponse.json(result, { status });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { requireFeature } = await import('@/lib/commercial/apiGate');
    const denied = await requireFeature(req, 'toolbox_labs', body);
    if (denied) return denied;
    const { callNavGateway, ALL_NAV_GATEWAY_ACTIONS } = await getCallNavGateway();
    const ALLOWED_ACTIONS = new Set<NavGatewayAction>(ALL_NAV_GATEWAY_ACTIONS);
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
