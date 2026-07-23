/**
 * Smoke: active platforms registered; removed platforms hard-fail.
 * Run: npx tsx scripts/smoke-tts-platforms.ts
 */
import { TTS_PROVIDERS } from '../src/app/api/generate-tts/ttsRegistry';
import {
  ACTIVE_TTS_PLATFORMS,
  REMOVED_TTS_PLATFORMS,
  isActiveTtsPlatform,
  removedTtsPlatformMessage,
} from '../src/lib/tts/activePlatforms';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

async function main() {
  for (const p of ACTIVE_TTS_PLATFORMS) {
    assert(TTS_PROVIDERS[p], `missing active provider ${p}`);
    assert(isActiveTtsPlatform(p), `isActive failed for ${p}`);
    const pr = TTS_PROVIDERS[p];
    console.log(
      `[active] ${p} · nativeSpeed=${pr.supportsNativeSpeed} nativePitch=${pr.supportsNativePitch}`,
    );
  }

  for (const p of REMOVED_TTS_PLATFORMS) {
    if (p === 'google_tts') {
      // alias message only — no separate registry key
      assert(
        /gỡ|go/i.test(removedTtsPlatformMessage(p)),
        'google_tts message',
      );
      continue;
    }
    const pr = TTS_PROVIDERS[p];
    assert(pr, `missing removed stub ${p}`);
    try {
      await pr.generate('hi', {
        voice: 'x',
        speed: 1.2,
        pitch: 2,
        tiktokSessionId: '',
        api_url_vieneu: '',
        apiKeys: [],
      });
      throw new Error(`${p} should hard-fail`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      assert(
        /đã gỡ|da go|gỡ/i.test(msg),
        `${p} bad hard-fail msg: ${msg}`,
      );
      console.log(`[removed] ${p} hard-fail OK`);
    }
  }

  // Prosody strategy sanity for active engines
  const expect: Record<
    string,
    { s: boolean; p: boolean }
  > = {
    edge_tts: { s: false, p: false }, // FFmpeg both
    piper: { s: true, p: false },
    omnivoice_local: { s: true, p: false },
    vina_voice: { s: true, p: true },
    capcut_tts: { s: true, p: false },
    tiktok_tts: { s: false, p: false },
    gemini_tts: { s: false, p: false },
  };
  for (const [id, exp] of Object.entries(expect)) {
    const pr = TTS_PROVIDERS[id];
    assert(pr.supportsNativeSpeed === exp.s, `${id} supportsNativeSpeed`);
    assert(pr.supportsNativePitch === exp.p, `${id} supportsNativePitch`);
  }

  console.log(JSON.stringify({ ok: true, active: ACTIVE_TTS_PLATFORMS.length }, null, 2));
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
