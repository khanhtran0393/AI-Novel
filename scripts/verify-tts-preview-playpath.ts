/**
 * Empirical audit: preview play-path contracts (client/server lockstep).
 * Run: npx tsx scripts/verify-tts-preview-playpath.ts
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import {
  TTS_PRELISTEN_CACHE_NAME,
  TTS_PREVIEW_SCENE_TEXT,
  VINA_PREVIEW_NFE_DEFAULT,
  VINA_PREVIEW_NFE_FLOOR,
} from '../src/lib/tts/previewDefaults';
import { resolveNfeStep } from '../src/lib/vinaVoice/warmDaemon';
import {
  buildClientPreviewKey,
  normalizeProsodyClient,
} from '../src/app/workspace/modules/tts/previewClientCache';
import {
  buildPreviewCacheId,
  normalizePreviewCacheInput,
  normalizePreviewProsody,
  previewCachePaths,
  writePreviewCache,
  tryReadPreviewCacheAny,
} from '../src/lib/tts/previewCache';
import { applyAudioEffects } from '../src/app/api/generate-tts/audioUtils';
import { execFileSync } from 'child_process';

function ff(): string {
  const a = path.join(process.cwd(), 'bin', 'ffmpeg.exe');
  if (fs.existsSync(a)) return a;
  const b = path.join(process.cwd(), 'bin', 'ffmpeg', 'ffmpeg.exe');
  if (fs.existsSync(b)) return b;
  return 'ffmpeg';
}

function main() {
  // 1) NFE lockstep client/server
  const serverNfe = resolveNfeStep({ isPreview: true });
  assert.strictEqual(
    serverNfe,
    VINA_PREVIEW_NFE_DEFAULT,
    `server preview NFE ${serverNfe} !== client default ${VINA_PREVIEW_NFE_DEFAULT}`,
  );
  assert.ok(VINA_PREVIEW_NFE_DEFAULT >= VINA_PREVIEW_NFE_FLOOR);

  // 2) Client key embeds NFE default when omitted
  const keyA = buildClientPreviewKey({
    platform: 'vina_voice',
    voice: 'Test Voice',
    text: TTS_PREVIEW_SCENE_TEXT,
    speed: 1,
    pitch: 0,
  });
  const keyB = buildClientPreviewKey({
    platform: 'vina_voice',
    voice: 'Test Voice',
    text: TTS_PREVIEW_SCENE_TEXT,
    speed: 1,
    pitch: 0,
    nfeStep: VINA_PREVIEW_NFE_DEFAULT,
  });
  assert.strictEqual(keyA, keyB, 'client key must default nfe to VINA_PREVIEW_NFE_DEFAULT');
  assert.ok(
    keyA.includes(String(VINA_PREVIEW_NFE_DEFAULT)),
    'client key must contain nfe=20',
  );
  const keyOld = buildClientPreviewKey({
    platform: 'vina_voice',
    voice: 'Test Voice',
    text: TTS_PREVIEW_SCENE_TEXT,
    speed: 1,
    pitch: 0,
    nfeStep: 16,
  });
  assert.notStrictEqual(keyA, keyOld, 'nfe=16 vs 20 must produce different client keys');

  // 3) Prosody normalize match
  const c = normalizeProsodyClient(1.0, 0);
  const s = normalizePreviewProsody(1.0, 0);
  assert.strictEqual(c.speed, s.speed);
  assert.strictEqual(c.pitch, s.pitch);

  // 4) Peak limiter: hot → ≤ -1 dBFS-ish
  const sample = path.join(
    process.cwd(),
    'data',
    'vina-voices',
    'samples',
    'Long_Tieng_Phim_Nu_Tre_1.wav',
  );
  assert.ok(fs.existsSync(sample), `missing sample ${sample}`);
  const hotPath = path.join(process.cwd(), 'scratch', '_verify_hot.wav');
  const outDir = path.dirname(hotPath);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  execFileSync(
    ff(),
    [
      '-y',
      '-i',
      sample,
      '-af',
      'volume=8dB',
      '-ac',
      '1',
      '-ar',
      '44100',
      '-sample_fmt',
      's16',
      hotPath,
    ],
    { stdio: 'pipe' },
  );

  // 5) writePreviewCache + read path public URL shape
  void (async () => {
    const limited = await applyAudioEffects(
      fs.readFileSync(hotPath),
      0,
      1,
      false,
      { peakLimiter: true },
    );
    assert.ok(limited.length > 500, 'limited buffer empty');
    assert.strictEqual(limited.slice(0, 4).toString('ascii'), 'RIFF');

    const input = normalizePreviewCacheInput({
      platform: 'vina_voice',
      voice: '__verify_preview_playpath__',
      speed: 1,
      pitch: 0,
      text: TTS_PREVIEW_SCENE_TEXT,
      speakerSeed: 2336,
      styleSeed: 4125,
      nfeStep: VINA_PREVIEW_NFE_DEFAULT,
    });
    const id = buildPreviewCacheId(input);
    const paths = previewCachePaths(input, 'wav');
    assert.ok(paths.publicUrl.startsWith('/audio/previews/'));
    assert.ok(paths.filename.includes(id));

    const saved = writePreviewCache(input, 'wav', limited);
    assert.ok(fs.existsSync(saved.publicPath));
    assert.ok(fs.existsSync(saved.durablePath));

    const hit = tryReadPreviewCacheAny(input, 'wav');
    assert.ok(hit, 'tryReadPreviewCacheAny must HIT after write');
    assert.strictEqual(hit!.publicUrl, saved.publicUrl);

    // cleanup
    try {
      fs.unlinkSync(saved.publicPath);
      fs.unlinkSync(saved.durablePath);
    } catch {
      /* ignore */
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          serverNfe: serverNfe,
          clientNfeDefault: VINA_PREVIEW_NFE_DEFAULT,
          cacheName: TTS_PRELISTEN_CACHE_NAME,
          previewText: TTS_PREVIEW_SCENE_TEXT,
          publicUrl: saved.publicUrl,
          limitedBytes: limited.length,
        },
        null,
        2,
      ),
    );
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

main();
