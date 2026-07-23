/**
 * Empirical usability path: High-CTR YouTube packaging
 * Meta → 5 formulas → composition → overlay → pack checklist
 * Run: npx tsx scripts/smoke-high-ctr-packaging.mts
 */
import {
  extractHookFromScript,
  generateYoutubeMetaWithQA,
  buildFiveTitleFormulas,
  buildThumbnailPrompt,
  enforceMobileTitle,
  evaluateHighCtrPack,
  suggestThumbOverlayTexts,
  isValidThumbOverlay,
  scoreTitleMobileDiscipline,
  scoreYoutubeMetaFields,
  buildYoutubeChecklist,
  THUMB_COMPOSITION_PRESETS,
  YOUTUBE_MOBILE_TITLE_MAX,
  compositionPromptBlock,
  buildSeoTitleFromHook,
} from '../src/lib/youtubeSafe';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error('FAIL: ' + msg);
  console.log('OK:', msg);
}

const script = `
[CẢNH 1: NỘI - TÔNG MÔN - ĐÊM]
Hắn bị cả tông môn chê là phế vật. Hủy hôn công khai trước mặt ngàn người.
[CẢNH 2: NGOẠI - ĐỈNH NÚI - RẠNG]
Ba năm sau hắn thức tỉnh thần cấp. Hệ thống mở. Cả tông môn quỳ xin tha mạng.
[CẢNH 3: NỘI - ĐẠI ĐIỆN - NGÀY]
Quỷ vương xuất hiện. Hắn mới rút kiếm. Bí mật trong hầm lộ ra.
`;

const visualDna =
  'dark xianxia, high contrast faces, neon system UI optional, cinematic 16:9';

console.log('=== 1) Meta QA pipeline ===');
const meta = generateYoutubeMetaWithQA({
  script,
  novelTitle: 'Phế Vật Trọng Sinh',
  chapter: 1,
  visualDna,
  maxRounds: 4,
});
console.log('title:', meta.seoTitle, '| len', meta.seoTitle.length);
console.log('thumbLine:', meta.thumbnailLine);
console.log('scores:', JSON.stringify(meta.scores));
assert(!!meta.hook && meta.hook.length > 20, 'meta.hook non-empty');
assert(!!meta.seoTitle && meta.seoTitle.length >= 16, 'meta.seoTitle');
assert(meta.seoTitle.length <= 100, 'meta title ≤100');
assert(
  meta.thumbnailLine.length > 0 && meta.thumbnailLine.length <= 30,
  'meta thumbnailLine ≤30',
);
assert(!!meta.thumbnailPrompt && meta.thumbnailPrompt.length > 40, 'meta.thumbnailPrompt');

console.log('=== 2) Mobile discipline ===');
const mobile = scoreTitleMobileDiscipline(meta.seoTitle);
console.log(mobile);
if (!mobile.mobileOk) {
  const clipped = enforceMobileTitle(meta.seoTitle, YOUTUBE_MOBILE_TITLE_MAX);
  assert(clipped.length <= YOUTUBE_MOBILE_TITLE_MAX, 'enforceMobileTitle clips');
  console.log('clipped:', clipped);
} else {
  assert(true, 'meta title already mobile-ok');
}

console.log('=== 3) Five title formulas (pick list) ===');
const formulas = buildFiveTitleFormulas({
  hook: meta.hook,
  novelTitle: 'Phế Vật Trọng Sinh',
  seed: 1,
});
assert(formulas.length === 5, 'exactly 5 formulas');
for (const f of formulas) {
  assert(
    f.title.length >= 12 && f.title.length <= YOUTUBE_MOBILE_TITLE_MAX,
    `formula ${f.id} usable len=${f.title.length}`,
  );
  console.log(' ', f.id, f.title.length, f.title);
}
const picked = formulas[0]!.title;
assert(scoreTitleMobileDiscipline(picked).mobileOk, 'user-picked formula mobile OK');

console.log('=== 4) Four composition presets → prompt lock ===');
assert(THUMB_COMPOSITION_PRESETS.length === 4, '4 presets');
for (const p of THUMB_COMPOSITION_PRESETS) {
  const prompt = buildThumbnailPrompt({
    hook: meta.hook,
    thumbnailLine: meta.thumbnailLine,
    visualDna,
    compositionId: p.id,
    characterHint: 'Hàn Dực — cold eyes',
  });
  const block = compositionPromptBlock(p.id);
  assert(
    prompt.includes('COMPOSITION LOCK') || prompt.includes(block.slice(0, 18)),
    `composition ${p.id} locked in prompt`,
  );
  assert(
    /16:9|text-safe|2-4 word|overlay/i.test(prompt),
    `overlay discipline in ${p.id}`,
  );
  console.log(' ', p.id, 'promptLen', prompt.length);
}

console.log('=== 5) Overlay suggestions ===');
const overlays = suggestThumbOverlayTexts({
  seoTitle: picked,
  hook: meta.hook,
  thumbnailLine: meta.thumbnailLine,
  max: 4,
});
assert(overlays.length >= 2, 'overlay suggestions ≥2');
for (const o of overlays) {
  assert(isValidThumbOverlay(o, picked), `overlay valid: ${o}`);
  assert(o.split(/\s+/).length <= 4, `overlay ≤4 words: ${o}`);
}
console.log(' overlays:', overlays);

console.log('=== 6) Full pack after user path ===');
const compositionId = 'split_before_after';
const finalPrompt = buildThumbnailPrompt({
  hook: meta.hook,
  thumbnailLine: overlays[0]!,
  visualDna,
  compositionId,
});
const pack = evaluateHighCtrPack({
  seoTitle: picked,
  thumbnailLine: overlays[0]!,
  thumbnailPrompt: finalPrompt,
  compositionId,
  seoTitleVariantsCount: formulas.length,
});
console.log(pack.summary);
for (const it of pack.items) {
  console.log(it.ok ? '  ✓' : '  ✗', it.label);
}
assert(pack.passCount >= 5, `pack passCount ≥5 (got ${pack.passCount})`);
assert(pack.ready, 'pack.ready after full user path');

console.log('=== 7) Studio checklist high-CTR fields ===');
const checklist = buildYoutubeChecklist({
  hasScript: true,
  wordOk: true,
  sceneCount: 3,
  minScenes: 3,
  hasVisualDna: true,
  hasAudio: false,
  imageCount: 0,
  videoCount: 0,
  enforceEditorGate: false,
  hasHook: true,
  hasSeoTitle: true,
  hasSeoDescription: true,
  hasThumbnailPrompt: true,
  metaScores: scoreYoutubeMetaFields({
    seoTitle: picked,
    thumbnailLine: overlays[0]!,
    seoDescription: meta.seoDescription,
  }),
  seoTitleText: picked,
  hasThumbComposition: true,
  overlayDisciplineOk: true,
});
const mobileItem = checklist.find((i) => i.id === 'title_mobile');
const compItem = checklist.find((i) => i.id === 'thumb_composition');
const overlayItem = checklist.find((i) => i.id === 'overlay_discipline');
assert(!!mobileItem?.ok, 'checklist title_mobile ok');
assert(!!compItem?.ok, 'checklist thumb_composition ok');
assert(!!overlayItem?.ok, 'checklist overlay_discipline ok');
console.log(
  ' items:',
  [mobileItem, compItem, overlayItem].map((i) => i?.label).join(' | '),
);

console.log('=== 8) B10 hard-fail without Visual DNA ===');
let threw = false;
try {
  buildThumbnailPrompt({
    hook: meta.hook,
    thumbnailLine: 'TEST',
    visualDna: '',
  });
} catch {
  threw = true;
}
assert(threw, 'thumb prompt hard-fails without visualDna');

console.log('=== 9) Edge: empty hook / extractHook ===');
const emptyF = buildFiveTitleFormulas({ hook: '' });
assert(Array.isArray(emptyF), 'empty hook → array (no throw)');
const extracted = extractHookFromScript(script, {
  targetSec: 30,
  wpm: 140,
  visualDna,
});
assert(!!extracted.seoTitle, 'extractHook seoTitle');
const fromHook = buildSeoTitleFromHook(extracted.hook, extracted.thumbnailLine, 'Series');
assert(fromHook.length > 10 && fromHook.length <= 100, 'buildSeoTitleFromHook usable');
console.log(' extract title:', extracted.seoTitle.slice(0, 80));
console.log(' fromHook:', fromHook.slice(0, 80), fromHook.length);

// Simulate store chapterHook shape (what UI patches)
const chapterHook = {
  hook: meta.hook,
  thumbnailLine: overlays[0]!,
  seoTitle: picked,
  seoTitleVariants: formulas,
  seoDescription: meta.seoDescription,
  seoTags: meta.seoTags,
  thumbnailPrompt: finalPrompt,
  thumbCompositionId: compositionId,
};
assert(chapterHook.seoTitleVariants.length === 5, 'store-shaped variants=5');
assert(chapterHook.thumbCompositionId === 'split_before_after', 'store composition id');
assert(chapterHook.thumbnailPrompt.includes('COMPOSITION LOCK'), 'store prompt has lock');

console.log('\n=== USABILITY PATH PASS (High-CTR packaging) ===');
