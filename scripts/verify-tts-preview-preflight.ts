/**
 * Empirical: client preflight for Global TTS «Nghe thử» blocks known failure modes.
 * Run: npx tsx scripts/verify-tts-preview-preflight.ts
 */
import assert from 'assert';
import { assertPreviewPreflight } from '../src/app/workspace/modules/tts/previewPreflight';
import fs from 'fs';
import path from 'path';

function expectThrow(fn: () => void, re: RegExp, label: string) {
  let threw = false;
  try {
    fn();
  } catch (e) {
    threw = true;
    const msg = e instanceof Error ? e.message : String(e);
    assert.ok(re.test(msg), `${label}: got «${msg}»`);
  }
  assert.ok(threw, `${label}: expected throw`);
}

function main() {
  // 1) Missing voice
  expectThrow(
    () =>
      assertPreviewPreflight({
        platform: 'edge_tts',
        voiceId: '',
        isPro: true,
      }),
    /Chưa chọn giọng/,
    'empty voice',
  );

  // 2) Free + premium platform
  expectThrow(
    () =>
      assertPreviewPreflight({
        platform: 'vina_voice',
        voiceId: 'Some Profile',
        isPro: false,
        isTrial: false,
        isVip: false,
      }),
    /Gói Free|premium|Trial\/Pro|đã gỡ|không fallback|LA Studio/i,
    'free blocks vina',
  );

  // 3) Free + edge OK
  const freeEdge = assertPreviewPreflight({
    platform: 'edge_tts',
    voiceId: 'vi-VN-NamMinhNeural',
    isPro: false,
  });
  assert.ok(freeEdge.ttsConfigPatch);

  // 4) Gemini missing key
  expectThrow(
    () =>
      assertPreviewPreflight({
        platform: 'gemini_tts',
        voiceId: 'Kore',
        apiKeys: [],
        isPro: true,
      }),
    /Gemini API Key/i,
    'gemini no key',
  );

  // 5) TikTok missing session
  expectThrow(
    () =>
      assertPreviewPreflight({
        platform: 'tiktok_tts',
        voiceId: 'BV074_streaming',
        ttsConfig: { tiktokSessionId: '' },
        tiktokSessionIds: [],
        isPro: true,
      }),
    /Session ID/i,
    'tiktok no session',
  );

  // 6) TikTok multi-session backfill
  const tk = assertPreviewPreflight({
    platform: 'tiktok_tts',
    voiceId: 'BV074_streaming',
    ttsConfig: { tiktokSessionId: '' },
    tiktokSessionIds: ['sess_abc'],
    isPro: true,
  });
  assert.strictEqual(tk.ttsConfigPatch.tiktokSessionId, 'sess_abc');

  // 7) CapCut diag fail
  expectThrow(
    () =>
      assertPreviewPreflight({
        platform: 'capcut_tts',
        voiceId: 'BV001',
        isPro: true,
        capcutOk: false,
        capcutMessage: 'Thiếu sscronet.dll',
      }),
    /sscronet|CapCut/i,
    'capcut diag fail',
  );

  // 8) Server route: isPreview must not consume free quota
  const routeSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/app/api/generate-tts/route.ts'),
    'utf8',
  );
  assert.ok(
    /if\s*\(\s*!isPreview\s*\)/.test(routeSrc) &&
      routeSrc.includes('assertAndConsumeFreeQuota'),
    'route.ts must skip freeQuota when isPreview',
  );
  // Quota block must be gated by !isPreview (not only comment)
  const quotaBlock = routeSrc.slice(
    routeSrc.indexOf('assertAndConsumeFreeQuota') - 400,
    routeSrc.indexOf('assertAndConsumeFreeQuota') + 80,
  );
  assert.ok(
    /!isPreview/.test(quotaBlock),
    `quota call must sit inside !isPreview gate:\n${quotaBlock}`,
  );

  // 9) Modal + preview modules wire preflight
  const modal = fs.readFileSync(
    path.join(
      process.cwd(),
      'src/app/workspace/features/tts/TTSConfigModal.tsx',
    ),
    'utf8',
  );
  assert.ok(modal.includes('assertPreviewPreflight'));
  assert.ok(modal.includes('ttsConfigPatch'));
  const previewMod = fs.readFileSync(
    path.join(process.cwd(), 'src/app/workspace/modules/tts/preview.ts'),
    'utf8',
  );
  assert.ok(previewMod.includes('assertPreviewPreflight'));

  console.log(
    JSON.stringify(
      {
        ok: true,
        checks: [
          'empty_voice',
          'free_blocks_vina',
          'free_edge_ok',
          'gemini_key',
          'tiktok_session',
          'tiktok_backfill',
          'capcut_diag',
          'server_skip_quota_preview',
          'modal_wire',
          'preview_module_wire',
        ],
      },
      null,
      2,
    ),
  );
}

main();
