/**
 * GET /api/omnivoice/status — probe OmniVoice Local engine
 * POST /api/omnivoice/status — ensure/start engine (auto-spawn SuperAudioTools python)
 */
import { NextResponse } from 'next/server';
import {
  ensureOmniServer,
  getLastOmniSpawnError,
  getLastSpawnedPid,
  getOmniLogPath,
  probeOmniHealth,
  resolveOmniProfileDir,
  resolveOmniPython,
  resolveOmniServerLauncher,
} from '@/lib/omnivoiceLocal';
import { getGpuTtsGuardStatus } from '@/lib/tts/gpuTtsGuard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** First model load can take 30–120s */
export const maxDuration = 180;

export async function GET() {
  const health = await probeOmniHealth(undefined, 1500);
  const launcher = resolveOmniServerLauncher();
  const gpuGuard = getGpuTtsGuardStatus();
  const soft = gpuGuard.thresholds.omniRssSoftMb;
  const minUp = gpuGuard.thresholds.omniRssMinUptimeS ?? 90;
  const rss = health.memoryRssMb;
  const up = health.uptimeS ?? 0;
  const memoryPressure =
    typeof rss === 'number'
      ? rss >= soft && up >= minUp
        ? 'soft'
        : rss >= soft
          ? 'elevated'
          : 'ok'
      : 'unknown';
  return NextResponse.json({
    ok: health.online,
    online: health.online,
    ready: health.ready ?? health.online,
    modelLoaded: health.modelLoaded ?? health.online,
    baseUrl: health.baseUrl,
    uptimeS: health.uptimeS,
    memoryRssMb: health.memoryRssMb,
    memoryPressure,
    gpuGuard,
    defaultPort: 8880,
    python: resolveOmniPython(),
    launcher: launcher.cmd,
    launcherKind: launcher.kind,
    profileDir: resolveOmniProfileDir(),
    logPath: getOmniLogPath(),
    message: health.online
      ? health.modelLoaded === false
        ? 'OmniVoice đang load model…'
        : memoryPressure === 'soft'
          ? `OmniVoice online — RSS ${Math.round(Number(rss))}MB bloated, sẽ recycle khi gen (soft=${soft}MB).`
          : memoryPressure === 'elevated'
            ? `OmniVoice online — RSS ${Math.round(Number(rss))}MB (chờ uptime ≥${minUp}s mới recycle).`
            : gpuGuard.exclusiveEngine && gpuGuard.exclusiveEngine !== 'omnivoice'
              ? `OmniVoice online — GPU đang exclusive «${gpuGuard.exclusiveEngine}» (đổi sang Omni sẽ unload engine kia).`
              : 'OmniVoice engine sẵn sàng (chỉ Omni khi gen — exclusive GPU).'
      : 'OmniVoice offline — app sẽ tự khởi động khi gen / bấm «Bật engine».',
  });
}

export async function POST() {
  try {
    const healthBefore = await probeOmniHealth(undefined, 1200);
    if (healthBefore.online) {
      return NextResponse.json({
        ok: true,
        started: false,
        alreadyRunning: true,
        online: true,
        ready: healthBefore.ready ?? true,
        modelLoaded: healthBefore.modelLoaded ?? true,
        baseUrl: healthBefore.baseUrl,
        message: 'OmniVoice engine đã chạy.',
      });
    }
    const baseUrl = await ensureOmniServer();
    const health = await probeOmniHealth(baseUrl, 2000);
    return NextResponse.json({
      ok: true,
      started: true,
      alreadyRunning: false,
      online: true,
      ready: health.ready ?? true,
      modelLoaded: health.modelLoaded ?? true,
      baseUrl,
      pid: getLastSpawnedPid(),
      message: `OmniVoice engine online tại ${baseUrl}`,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.info('[OmniVoice status] ensure failed:', msg.slice(0, 200));
    return NextResponse.json({
      ok: false,
      online: false,
      ready: false,
      modelLoaded: false,
      error: msg,
      spawnError: getLastOmniSpawnError() || undefined,
      python: resolveOmniPython(),
      launcher: resolveOmniServerLauncher().cmd,
      profileDir: resolveOmniProfileDir(),
      logPath: getOmniLogPath(),
      message:
        'OmniVoice chưa sẵn sàng — TTS sẽ báo lỗi (không fallback Edge). App đã thử tự bật engine local.',
    });
  }
}
