/**
 * Smoke: psych formulas for Hook / SEO Title / Thumbnail / Description
 * Run: npx tsx scripts/smoke-psych-seo.mts
 */
import {
  extractHookFromScript,
  buildSeoTitleFromHook,
  buildClickThumbnailLine,
  buildSeoDescription,
  scorePsychologicalPull,
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

const title2 = buildSeoTitleFromHook(result.hook, result.thumbnailLine, 'Mạt Thế Sinh Tồn');
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
  tags: '#truyenaudio #matthe',
  chaptersText: '0:00 Hook\n0:30 Cảnh 1',
  novelTitle: 'Mạt Thế',
  chapter: 1,
});
assert(desc.includes('Like') || desc.includes('Subscribe'), 'CTA present');
assert(desc.includes('Càng nghe') || desc.includes('sai một bước') || desc.includes('CÂU CHUYỆN'), 'PAS agitate');

console.log('PASS: psych SEO formulas ok');
