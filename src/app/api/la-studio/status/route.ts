/**
 * GET  /api/la-studio/status — probe LA Studio local API
 * POST /api/la-studio/status — enable settings.ini + optional spawn app + poll health
 */
import { NextRequest, NextResponse } from 'next/server';
import os from 'os';
import path from 'path';
import {
  ensureLaStudioApiEnabledInSettings,
  ensureLaStudioApiReady,
  getLastLaStudioSpawnError,
  isKokoroCliReady,
  loadLocalKokoroViVoices,
  listLaStudioVoices,
  probeLaStudioHealth,
  readSettingsIni,
  resolveKokoroViRuntime,
  resolveLaStudioApiKey,
  resolveLaStudioBaseUrl,
  resolveLaStudioExe,
  LA_STUDIO_DEFAULT_PORT,
} from '@/lib/laStudioLocal';
import { requireFeature } from '@/lib/commercial/apiGate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  // Trial/Pro only (same as tts_premium / la_studio platform)
  const denied = await requireFeature(req, 'tts_premium');
  if (denied) return denied;
  const url = req.nextUrl.searchParams.get('baseUrl') || undefined;
  const baseUrl = resolveLaStudioBaseUrl(url || undefined);
  const health = await probeLaStudioHealth(baseUrl, 2000);
  const ini = readSettingsIni();
  let voicesCount = 0;
  let voicesError = '';
  if (health.online) {
    try {
      const voices = await listLaStudioVoices(baseUrl, resolveLaStudioApiKey(), 4000);
      voicesCount = voices.length;
    } catch (e) {
      voicesError = e instanceof Error ? e.message : String(e);
    }
  }
  const kokoroLocal = loadLocalKokoroViVoices();
  const cliReady = isKokoroCliReady();
  const rt = resolveKokoroViRuntime();
  /** Can preview/gen now: API model loaded OR Kokoro CLI pack present */
  const canSynth = (health.online && health.ttsLoaded === true) || cliReady;

  return NextResponse.json({
    ok: canSynth,
    online: health.online,
    ready: canSynth,
    canSynth,
    ttsLoaded: health.ttsLoaded ?? null,
    ttsFamily: health.ttsFamily || ini.selectedFamily || null,
    baseUrl: health.baseUrl,
    port: health.port ?? ini.serverPort ?? LA_STUDIO_DEFAULT_PORT,
    settingsEnabled: ini.serverEnabled,
    settingsPath: path.join(os.homedir(), '.lastudio', 'settings.ini'),
    exe: resolveLaStudioExe(),
    voicesCount,
    voicesError: voicesError || undefined,
    kokoroLocalVoices: kokoroLocal.length,
    kokoroCliReady: cliReady,
    kokoroCli: rt
      ? { cli: rt.cli, modelDir: rt.modelDir, voiceCount: rt.voices.length }
      : null,
    message: canSynth
      ? health.online && health.ttsLoaded
        ? `LA Studio API sẵn sàng (${health.baseUrl}).`
        : cliReady
          ? 'Kokoro-VI CLI sẵn sàng (gen TTS thật không cần load GUI). Engine desktop sẽ chạy ẩn nền.'
          : `Sẵn sàng.`
      : `Chưa sẵn sàng TTS. Cần pack Kokoro-Vietnamese trong ~/.lastudio/extensions/backends hoặc load model API. POST status để spawn engine ẩn.`,
    health,
  });
}

export async function POST(req: NextRequest) {
  let body: {
    baseUrl?: string;
    spawnApp?: boolean;
    pollMs?: number;
    /** default true — spawn minimized + hide windows */
    hidden?: boolean;
  } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }

  const denied = await requireFeature(req, 'tts_premium', body);
  if (denied) return denied;

  const settingsOnly = body.spawnApp === false && body.pollMs === 0;
  if (settingsOnly) {
    const settings = ensureLaStudioApiEnabledInSettings();
    const health = await probeLaStudioHealth(
      resolveLaStudioBaseUrl(body.baseUrl),
      2000,
    );
    return NextResponse.json({
      ok: health.online,
      online: health.online,
      started: false,
      settings,
      health,
      message: settings.message,
    });
  }

  const result = await ensureLaStudioApiReady({
    baseUrl: body.baseUrl,
    spawnApp: body.spawnApp !== false,
    hidden: body.hidden !== false,
    pollMs: typeof body.pollMs === 'number' ? body.pollMs : 45_000,
  });

  const cliReady = isKokoroCliReady();
  const canSynth = (result.online && result.ttsLoaded === true) || cliReady;
  const rt = resolveKokoroViRuntime();

  return NextResponse.json({
    ok: canSynth,
    online: result.online,
    ready: canSynth,
    canSynth,
    ttsLoaded: result.ttsLoaded ?? null,
    ttsFamily: result.ttsFamily || null,
    baseUrl: result.baseUrl,
    spawned: result.spawned === true,
    settings: result.settings,
    spawnError: getLastLaStudioSpawnError() || undefined,
    exe: resolveLaStudioExe(),
    kokoroCliReady: cliReady,
    kokoroCli: rt
      ? { cli: rt.cli, modelDir: rt.modelDir, voiceCount: rt.voices.length }
      : null,
    message: canSynth
      ? result.online && result.ttsLoaded
        ? 'LA Studio API sẵn sàng (model loaded).'
        : 'Engine ẩn + Kokoro CLI sẵn sàng — nghe thử / gen TTS được ngay.'
      : result.error ||
        'Chưa sẵn sàng. Tải Kokoro-Vietnamese trong LA Studio một lần, hoặc bật API + load model.',
    health: result,
  });
}
