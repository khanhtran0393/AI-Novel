/**
 * Smoke: psych formulas for Hook / SEO Title / Thumbnail / Description
 * + High-CTR packaging (5 formulas · 4 composition · mobile ≤70 · overlay)
 * Run: npx tsx scripts/smoke-psych-seo.mts
 */
import {
  extractHookFromScript,
  buildSeoTitleFromHook,
  buildClickThumbnailLine,
  buildSeoDescription,
  buildThumbnailPrompt,
  scorePsychologicalPull,
  buildFiveTitleFormulas,
  enforceMobileTitle,
  evaluateHighCtrPack,
  scoreTitleMobileDiscipline,
  suggestThumbOverlayTexts,
  THUMB_COMPOSITION_PRESETS,
  YOUTUBE_MOBILE_TITLE_MAX,
  compositionPromptBlock,
} from '../src/lib/youtubeSafe';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error('ASSERT FAIL: ' + msg);
}

const sample = `
[CẢNH 1]
Gió thổi nhẹ qua cánh đồng.
Hắn siết chặt lưỡi dao. Máu vẫn còn ấm trên tay. Không ai biết cô gái đó còn sống — hay đã bị chúng kéo đi từ nửa đêm.
"Đừng tin hắn," cô thì thầm. "Bí mật trong hầm sẽ giết tất cả chúng ta."
Nếu hắn mở cửa, cả trại mất sạch. Nếu không mở, cô ấy chết.
`;

const result = extractHookFromScript(sample, { targetSec: 30, wpm: 140 });
console.log('--- HOOK ---');
console.log(result.hook);
console.log('--- TITLE ---');
console.log(result.seoTitle);
console.log('--- THUMB ---');
console.log(result.thumbnailLine);
console.log('--- DESC (head) ---');
console.log(result.seoDescription.slice(0, 400));

assert(result.hook.length > 40, 'hook non-empty');
assert(!/^Gió thổi nhẹ/i.test(result.hook), 'hook skips flat poetic open (pattern interrupt)');
assert(/…|\?|không|bí mật|chết|mất/i.test(result.hook), 'hook has tension/open loop');
assert(result.seoTitle.length > 10 && result.seoTitle.length <= 100, 'title 1-100 chars');
assert(result.thumbnailLine.length > 0 && result.thumbnailLine.length <= 40, 'thumb <=40');
assert(/CÂU CHUYỆN|Subscribe|Comment|Timeline/i.test(result.seoDescription), 'desc PAS structure');

const title2 = buildSeoTitleFromHook(result.hook, result.thumbnailLine, 'Truyện Audio Đêm');
console.log('--- TITLE+SERIES ---');
console.log(title2, title2.length);
assert(title2.length <= 100, 'title+series <=100');

const thumb2 = buildClickThumbnailLine(result.hook);
console.log('--- THUMB2 ---', thumb2, thumb2.length);
assert(thumb2.length <= 40, 'thumb2 <=40');

const scoreHigh = scorePsychologicalPull('Bí mật trong hầm sẽ giết tất cả. Không ai dám nói.');
const scoreLow = scorePsychologicalPull('Mặt trời lên trên bầu trời xanh, gió nhẹ thổi.');
console.log('score high', scoreHigh, 'score low', scoreLow);
assert(scoreHigh > scoreLow, 'psych score ranks threat > landscape');

const desc = buildSeoDescription({
  hook: result.hook,
  thumbnailLine: result.thumbnailLine,
  tags: '#truyenaudio #kichban',
  chaptersText: '0:00 Hook\n0:30 Cảnh 1',
  novelTitle: 'Truyện Audio Đêm',
  chapter: 1,
});
assert(desc.includes('Like') || desc.includes('Subscribe'), 'CTA present');
assert(
  desc.includes('Càng nghe') ||
    desc.includes('sai một bước') ||
    desc.includes('CÂU CHUYỆN') ||
    desc.includes('Phần còn lại') ||
    desc.includes('Timeline') ||
    desc.includes('thức khuya'),
  'PAS agitate / retention cues',
);

// ── High-CTR packaging ─────────────────────────────────────────────
const formulas = buildFiveTitleFormulas({
  hook: result.hook,
  novelTitle: 'Truyện Audio Đêm',
  seed: 42,
});
console.log('--- 5 TITLE FORMULAS ---');
for (const f of formulas) {
  console.log(f.id, f.title.length, f.title);
  assert(f.title.length >= 12, `formula ${f.id} non-empty`);
  assert(f.title.length <= YOUTUBE_MOBILE_TITLE_MAX, `formula ${f.id} mobile ≤${YOUTUBE_MOBILE_TITLE_MAX}`);
}
assert(formulas.length === 5, 'exactly 5 title formulas');

const longTitle =
  'Chê hắn là phế vật hủy hôn cả tông môn cười nhạo rồi ba năm sau cả thiên hạ phải quỳ xin hắn tha mạng xem đến cuối không bỏ lỡ';
const mobileTitle = enforceMobileTitle(longTitle, YOUTUBE_MOBILE_TITLE_MAX);
console.log('--- MOBILE CLIP ---', mobileTitle.length, mobileTitle);
assert(mobileTitle.length <= YOUTUBE_MOBILE_TITLE_MAX, 'enforceMobileTitle clips');
assert(scoreTitleMobileDiscipline(mobileTitle).mobileOk, 'mobile discipline ok after clip');

assert(THUMB_COMPOSITION_PRESETS.length === 4, '4 composition presets');
const dna = 'cinematic dark fantasy, neon rim light, high contrast faces';
const composed = buildThumbnailPrompt({
  hook: result.hook,
  thumbnailLine: result.thumbnailLine,
  visualDna: dna,
  compositionId: 'split_before_after',
});
console.log('--- COMPOSED THUMB (head) ---', composed.slice(0, 180));
assert(
  composed.includes('COMPOSITION LOCK') ||
    composed.includes(compositionPromptBlock('split_before_after').slice(0, 20)),
  'composition block in thumb prompt',
);
assert(/text-safe|2-4 word|overlay/i.test(composed), 'overlay discipline in prompt');

const overlays = suggestThumbOverlayTexts({
  seoTitle: formulas[0]?.title || title2,
  hook: result.hook,
  thumbnailLine: result.thumbnailLine,
});
console.log('--- OVERLAYS ---', overlays);
assert(overlays.length >= 2, 'overlay suggestions ≥2');
for (const o of overlays) {
  assert(o.split(/\s+/).length <= 4, `overlay ≤4 words: ${o}`);
}

const pack = evaluateHighCtrPack({
  seoTitle: mobileTitle,
  thumbnailLine: overlays[0] || 'ĐỪNG MỞ!',
  thumbnailPrompt: composed,
  compositionId: 'split_before_after',
  seoTitleVariantsCount: 5,
});
console.log('--- PACK ---', pack.summary);
assert(pack.total >= 5, 'pack checks present');
assert(pack.passCount >= 3, 'pack mostly ready');

// Prefer mobile on buildSeoTitleFromHook
assert(title2.length <= 100, 'title+series still ≤100 hard');
if (title2.length > YOUTUBE_MOBILE_TITLE_MAX) {
  console.log('note: series title longer than mobile soft max', title2.length);
}

console.log('PASS: psych SEO formulas + high-CTR packaging ok');
