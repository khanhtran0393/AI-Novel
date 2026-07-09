/**
 * Independent VinaVoice runtime status + bootstrap.
 * GET  — full environment status (no Vina.exe dependency)
 * POST — ensure dirs / optional probe engine
 */
import { NextResponse } from 'next/server';
import { ensureVinaEnvironment } from '@/lib/vinaVoice/paths';
import {
  getRuntimeStatus,
  runtimeSaveSettings,
} from '@/lib/vinaVoice/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const status = await getRuntimeStatus();
    return NextResponse.json({ success: true, ...status });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || 'bootstrap');

    if (action === 'bootstrap') {
      const env = ensureVinaEnvironment();
      const status = await getRuntimeStatus();
      return NextResponse.json({
        success: true,
        action: 'bootstrap',
        env,
        status,
      });
    }

    if (action === 'save_settings') {
      const saved = runtimeSaveSettings(body.settings || {});
      return NextResponse.json({ success: true, settings: saved });
    }

    if (action === 'status') {
      const status = await getRuntimeStatus();
      return NextResponse.json({ success: true, ...status });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
