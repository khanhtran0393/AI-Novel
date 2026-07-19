/**
 * Empirical unit check for multi-channel model + ship pack builder.
 * Run: node src/scripts/verify-channel-ship.mjs
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { createRequire as cr } from 'module';

// Use dynamic import via tsx if available; else compile-free pure reimplementation smoke via built files.
// Prefer running against TypeScript via npx tsx.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

async function main() {
  let channelModel;
  let shipPack;
  try {
    // Prefer tsx-transpiled relative imports
    channelModel = await import('../lib/channelModel.ts');
    shipPack = await import('../lib/shipPack.ts');
  } catch (e1) {
    try {
      channelModel = await import('../lib/channelModel.js');
      shipPack = await import('../lib/shipPack.js');
    } catch (e2) {
      console.error('FAIL: cannot import channel modules', e1?.message || e1, e2?.message || e2);
      process.exit(1);
    }
  }

  const {
    createChannelProfile,
    defaultChannelsBootstrap,
    getRecipe,
    applyChannelDnaToSnapshot,
    emptyProjectSnapshot,
    pushChannelMemory,
    normalizeChannelProfile,
  } = channelModel;

  const { buildShipPack } = shipPack;

  let failed = 0;
  const assert = (cond, msg) => {
    if (!cond) {
      console.error('✗', msg);
      failed += 1;
    } else {
      console.log('✓', msg);
    }
  };

  // Bootstrap
  const boot = defaultChannelsBootstrap();
  assert(!!boot.activeChannelId, 'bootstrap has activeChannelId');
  assert(Object.keys(boot.channels).length === 1, 'bootstrap has 1 channel');

  // Create + DNA
  const radioCh = createChannelProfile('Kênh Radio Horror', {
    niche: 'Horror audio',
    defaultShipMode: 'radio',
    narratorVoiceId: 'vi-VN-HoaiMyNeural',
    ttsPlatform: 'edge_tts',
    visualDna: 'foggy alley, neon rain',
    aspectRatio: '16:9',
  });
  assert(radioCh.slug.includes('radio') || radioCh.slug.length > 0, 'slug generated');
  assert(radioCh.shipRecipes.length === 3, '3 ship recipes');

  const recipe = getRecipe(radioCh, 'radio');
  assert(recipe.mode === 'radio', 'getRecipe radio');
  assert(recipe.includeVisual === false, 'radio no visual');
  assert(recipe.includeSrt === true, 'radio has srt');

  const shortRecipe = getRecipe(radioCh, 'short');
  assert(shortRecipe.aspectRatio === '9:16', 'short is 9:16');

  const snap = emptyProjectSnapshot({ ten_tac_pham: 'Test Novel' });
  const withDna = applyChannelDnaToSnapshot(radioCh, snap);
  assert(withDna.ttsVoice === 'vi-VN-HoaiMyNeural', 'DNA tts voice applied');
  assert(withDna.visualDnaPrompt === 'foggy alley, neon rain', 'DNA visual applied');
  assert(withDna.imageAspectRatio === '16:9', 'DNA aspect from radio recipe');

  let mem = pushChannelMemory(radioCh, 'hook', 'Đêm ấy cửa sổ kẹt lại…');
  mem = pushChannelMemory(mem, 'hook', 'Đêm ấy cửa sổ kẹt lại…'); // dedupe
  assert(mem.usedHooks.length === 1, 'hook memory deduped');

  const norm = normalizeChannelProfile({ id: 'x', name: 'Y' });
  assert(norm && norm.id === 'x', 'normalizeChannelProfile works');

  // Ship pack build
  const pack = buildShipPack({
    channel: radioCh,
    mode: 'radio',
    ten_tac_pham: 'Test Novel',
    chapter: {
      so_chuong: 1,
      tieu_de: 'Cửa sổ kẹt',
      dan_y: 'Hook mở',
      noi_dung:
        'Cảnh 1\n\nĐêm mưa. Cửa sổ kẹt lại. Hàn Dực nghe tiếng gõ từ phía trong.\n\nCảnh 2\n\nAnh đưa tay chạm khung gỗ lạnh.',
    },
    chapterHooks: {
      hook: 'Đêm ấy cửa sổ kẹt lại — tiếng gõ từ phía trong khiến Hàn Dực không dám thở.',
      // Must pass hooksMeetProductSeoGates + scoreYoutubeMetaFields (all ≥ 8.5)
      thumbnailLine: '3 tiếng gõ — đừng mở…',
      seoTitle:
        'Sự thật sau cửa sổ kẹt: 3 tiếng gõ nửa đêm không ai dám kể… xem đến cuối',
      seoDescription:
        '3 tiếng gõ — đừng mở… Một đêm mưa, cửa sổ kẹt cứng từ phía trong. Hàn Dực lần theo manh mối dưới lớp sơn cũ ' +
        'và phát hiện chuỗi sự kiện không thể giải thích bằng logic thường. ' +
        'Sai một bước là mất sạch manh mối. Bí mật lộ ra từng mảnh khi khung gỗ lạnh run lên. ' +
        '📌 Chapters timeline: 0:00 cold open · 0:30 cửa sổ · 1:20 chữ trên tường. ' +
        '#truyenaudio #kinhditamly #cuasoket Like và đăng ký để theo dõi chương tiếp theo trước khi cửa sổ mở lại.',
      seoTags: 'truyện audio,kinh dị tâm lý,cửa sổ kẹt,đêm mưa,manh mối',
      thumbnailPrompt: 'rainy night stuck window wooden frame cinematic noir',
    },
    voiceCast: {
      enabled: true,
      version: 1,
      roles: [
        {
          id: 'narrator',
          label: 'Narrator',
          kind: 'narrator',
          voiceId: 'vi-VN-HoaiMyNeural',
        },
      ],
      segmentOverrides: {},
      sceneTextHashes: {},
    },
    nhan_vat: ['Hàn Dực'],
    generatedAudioPaths: {
      '1_0': { path: 'D:/tmp/a.mp3', duration: 12 },
    },
  });

  assert(pack.mode === 'radio', 'pack mode radio');
  assert(pack.files.length >= 6, `pack has files (${pack.files.length})`);
  assert(
    pack.files.some((f) => f.relativePath === 'manifest.json'),
    'manifest present',
  );
  assert(
    pack.files.some((f) => f.relativePath === 'settings_criteria.json'),
    'settings_criteria present (Ảnh/Video+TTS+CapCut)',
  );
  const sc = JSON.parse(
    pack.files.find((f) => f.relativePath === 'settings_criteria.json').content,
  );
  assert(!!sc.tts?.platform, 'settings_criteria has tts platform');
  assert(!!sc.image?.aspectRatio, 'settings_criteria has image aspect');
  assert(!!sc.capcut?.aspect, 'settings_criteria has capcut aspect');
  assert(pack.manifest?.criteria?.settingsPass !== false, 'manifest criteria settingsPass');
  assert(
    pack.files.some((f) => f.relativePath === 'subtitles.srt'),
    'srt present',
  );
  assert(
    pack.files.some((f) => f.relativePath === 'seo.json'),
    'seo present',
  );
  assert(
    pack.files.some((f) => f.relativePath === 'cast/roles.json'),
    'cast roles present',
  );
  assert(pack.checklist.length >= 4, 'checklist non-empty');

  const longPack = buildShipPack({
    channel: { ...radioCh, defaultShipMode: 'longform' },
    mode: 'longform',
    ten_tac_pham: 'Test Novel',
    chapter: {
      so_chuong: 1,
      tieu_de: 'Cửa sổ kẹt',
      dan_y: '',
      noi_dung: 'Nội dung dài cho longform chapter one with multiple beats.',
    },
    chapterHooks: {
      hook: 'Đêm ấy cửa sổ kẹt lại — tiếng gõ từ phía trong khiến Hàn Dực không dám thở.',
      thumbnailLine: '3 tiếng gõ — đừng mở…',
      seoTitle:
        'Sự thật sau cửa sổ kẹt: 3 tiếng gõ nửa đêm không ai dám kể… xem đến cuối',
      seoDescription:
        '3 tiếng gõ — đừng mở… Một đêm mưa, cửa sổ kẹt cứng từ phía trong. Hàn Dực lần theo manh mối dưới lớp sơn cũ ' +
        'và phát hiện chuỗi sự kiện không thể giải thích bằng logic thường. ' +
        'Sai một bước là mất sạch manh mối. Bí mật lộ ra từng mảnh khi khung gỗ lạnh run lên. ' +
        '📌 Chapters timeline: 0:00 cold open · 0:30 cửa sổ · 1:20 chữ trên tường. ' +
        '#truyenaudio #kinhditamly #cuasoket Like và đăng ký để theo dõi chương tiếp theo trước khi cửa sổ mở lại.',
      seoTags: 'truyện audio,kinh dị tâm lý,cửa sổ kẹt,đêm mưa,manh mối',
    },
    generatedImages: { '1_0_0': 'D:/tmp/img.png' },
  });
  assert(longPack.recipe.includeVisual === true, 'longform includes visual');
  const mediaIdx = longPack.files.find((f) => f.relativePath === 'media_index.json');
  assert(!!mediaIdx, 'media_index in longform');
  const mediaParsed = JSON.parse(mediaIdx.content);
  assert(mediaParsed.images.length === 1, 'longform indexes image');

  // Write sample pack to exports for physical evidence
  const outDir = path.join(root, 'exports', 'ship-packs', '_verify_smoke');
  fs.mkdirSync(outDir, { recursive: true });
  for (const f of pack.files) {
    const abs = path.join(outDir, f.relativePath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, f.content, 'utf8');
  }
  assert(fs.existsSync(path.join(outDir, 'manifest.json')), 'wrote manifest to disk');

  console.log('\n--- ship pack sample written ---');
  console.log(outDir);
  console.log('files:', pack.files.map((f) => f.relativePath).join(', '));

  if (failed) {
    console.error(`\nFAILED: ${failed} assertion(s)`);
    process.exit(1);
  }
  console.log('\nALL PASS');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
