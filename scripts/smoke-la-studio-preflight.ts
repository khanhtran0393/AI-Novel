/**
 * Pre-ship: LA Studio connection + pack integrity + sample bake safety.
 * npx tsx scripts/smoke-la-studio-preflight.ts
 */
import fs from 'fs';
import path from 'path';
import {
  resolveLaStudioExe,
  ensureLaStudioApiEnabledInSettings,
  ensureLaStudioApiReady,
  isKokoroCliReady,
  resolveKokoroViRuntime,
  loadLocalKokoroViVoices,
  probeLaStudioHealth,
  getLastLaStudioSpawnError,
} from '../src/lib/laStudioLocal';
import { ensureFamilySamplePack } from '../src/lib/laStudioSampleVoices';
import { discoverVoicesForFamily } from '../src/lib/laStudioVoiceDiscover';

async function main() {
  const root = process.cwd();
  const voicesJson = path.join(root, 'bin/la-studio-kokoro/models/voices.json');
  const errors: string[] = [];

  console.log('=== LA Studio preflight ===');
  const exe = resolveLaStudioExe();
  console.log('[exe]', exe || 'MISSING');
  if (!exe) errors.push('LA Studio.exe not found');

  const settings = ensureLaStudioApiEnabledInSettings();
  console.log('[settings]', settings);

  console.log('[kokoroCli]', isKokoroCliReady());
  const rt = resolveKokoroViRuntime();
  console.log('[runtime]', rt && { source: rt.source, voices: rt.voices.length });
  if (!rt || rt.voices.length < 10) {
    errors.push(`Kokoro runtime voices < 10 (got ${rt?.voices.length ?? 0})`);
  }

  const local = loadLocalKokoroViVoices();
  console.log('[loadLocalKokoro]', local.length);
  if (local.length < 10) errors.push(`loadLocalKokoro ${local.length} < 10`);

  if (fs.existsSync(voicesJson)) {
    const j = JSON.parse(fs.readFileSync(voicesJson, 'utf8')) as {
      voices?: Array<{ id?: string; file?: string }>;
    };
    const n = Array.isArray(j.voices) ? j.voices.length : 0;
    const firstFile = String(j.voices?.[0]?.file || '');
    console.log('[voices.json]', n, 'firstFile=', firstFile);
    if (n < 10) errors.push(`voices.json only ${n} entries`);
    if (firstFile.includes('samples/')) {
      errors.push('voices.json corrupted (points to samples/*.wav)');
    }
  } else {
    errors.push('voices.json missing');
  }

  // Bake must NOT shrink/corrupt kokoro voices.json
  await ensureFamilySamplePack('kokoro-vietnamese');
  if (fs.existsSync(voicesJson)) {
    const j2 = JSON.parse(fs.readFileSync(voicesJson, 'utf8')) as {
      voices?: Array<{ file?: string }>;
    };
    const n2 = Array.isArray(j2.voices) ? j2.voices.length : 0;
    const f2 = String(j2.voices?.[0]?.file || '');
    console.log('[voices.json after bake]', n2, f2);
    if (n2 < 10 || f2.includes('samples/')) {
      errors.push('ensureFamilySamplePack overwrote Kokoro voices.json');
    }
  }

  const disc = discoverVoicesForFamily('kokoro-vietnamese');
  console.log('[discover]', disc.voices.length);

  const ready = await ensureLaStudioApiReady({
    spawnApp: true,
    hidden: true,
    pollMs: 18_000,
  });
  console.log('[apiReady]', {
    online: ready.online,
    ttsLoaded: ready.ttsLoaded,
    error: ready.error,
    spawnError: getLastLaStudioSpawnError() || undefined,
  });
  const probe = await probeLaStudioHealth(undefined, 3000);
  console.log('[probe]', {
    online: probe.online,
    ttsLoaded: probe.ttsLoaded,
    family: probe.ttsFamily,
    error: probe.error,
  });

  // Ship gen path works offline even if desktop API offline
  if (!isKokoroCliReady()) errors.push('Kokoro CLI not ready (ship blocker)');

  // Headers regression note for UI (manual)
  console.log(
    '[ui] LaStudioStudioTab must send buildClientApiHeaders() on all /api/la-studio/*',
  );
  console.log(
    '[entitlement] enforce mode: status needs Trial/Pro token (x-ainovel-entitlement)',
  );

  if (errors.length) {
    console.error('[RESULT] PREFLIGHT_FAIL');
    for (const e of errors) console.error(' -', e);
    process.exit(2);
  }

  // Soft warn only if API offline (CLI still ships)
  if (!probe.online && !ready.online) {
    console.warn(
      '[WARN] Desktop API offline after spawn — gen still OK via Kokoro CLI. User can open LA Studio.exe once.',
    );
  }

  console.log('[RESULT] PREFLIGHT_OK CLI_SHIP_READY');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
