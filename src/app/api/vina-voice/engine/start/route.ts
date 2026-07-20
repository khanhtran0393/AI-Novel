/**
 * Khởi động tools/vina_voice_engine/engine_server.py (port 8765) nếu chưa online.
 * Windows: spawn python detached.
 */
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { probeVinaEngine } from '@/lib/vinaVoice';
import { requireFeature } from '@/lib/commercial/apiGate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function findPython(): string {
  const candidates = [
    process.env.PYTHON_PATH,
    process.env.VINA_PYTHON,
    'python',
    'py',
    'python3',
  ].filter(Boolean) as string[];
  return candidates[0] || 'python';
}

export async function POST(req: NextRequest) {
  try {
    let body: { engineUrl?: string } = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }
    const denied = await requireFeature(req, 'tts_premium', body);
    if (denied) return denied;
    const engineUrl =
      body.engineUrl || process.env.VINA_ENGINE_URL || 'http://127.0.0.1:8765';

    const already = await probeVinaEngine(engineUrl, 1500);
    if (already.online) {
      return NextResponse.json({
        ok: true,
        started: false,
        alreadyRunning: true,
        engine: already,
        message: 'Engine clone đã chạy.',
      });
    }

    const script = path.join(
      process.cwd(),
      'tools',
      'vina_voice_engine',
      'engine_server.py',
    );
    if (!fs.existsSync(script)) {
      return NextResponse.json(
        {
          ok: false,
          error: `Không thấy ${script}. Kiểm tra thư mục tools/vina_voice_engine.`,
        },
        { status: 404 },
      );
    }

    const py = findPython();
    const child = spawn(py, [script], {
      cwd: path.dirname(script),
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: {
        ...process.env,
        VINA_ENGINE_HOST: '127.0.0.1',
        VINA_ENGINE_PORT: '8765',
      },
    });
    child.unref();

    // Chờ tối đa ~8s health
    let engine = await probeVinaEngine(engineUrl, 1200);
    for (let i = 0; i < 6 && !engine.online; i++) {
      await new Promise((r) => setTimeout(r, 1200));
      engine = await probeVinaEngine(engineUrl, 1200);
    }

    return NextResponse.json({
      ok: engine.online,
      started: true,
      pid: child.pid,
      engine,
      message: engine.online
        ? engine.xtts_available
          ? 'Engine online · XTTS sẵn sàng (clone tembre).'
          : 'Engine online · chưa có XTTS. Cài TTS[coqui] để clone HTTP; Zero-Shot ONNX vẫn hard-fail nếu não lỗi (không Edge ngầm).'
        : `Đã spawn python nhưng chưa thấy /health. Chạy tay: ${py} "${script}"`,
      script,
      python: py,
    });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    );
  }
}

export async function GET() {
  const engine = await probeVinaEngine();
  return NextResponse.json({ ok: true, engine });
}
