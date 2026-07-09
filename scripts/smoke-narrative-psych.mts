/**
 * Smoke: narrative psych block + local score (script, not SEO)
 * Run: npx tsx scripts/smoke-narrative-psych.mts
 */
import {
  buildNarrativePsychBlock,
  buildHumanizeScriptBlock,
  scoreNarrativePsychScript,
} from '../src/lib/youtubeSafe';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error('ASSERT FAIL: ' + msg);
}

const block = buildNarrativePsychBlock(true);
assert(block.includes('NARRATIVE PSYCH'), 'block header');
assert(block.includes('PATTERN INTERRUPT'), 'pattern interrupt');
assert(block.includes('OPEN LOOP') || block.includes('Zeigarnik'), 'open loop');
assert(block.includes('CẤM chèn slogan'), 'forbid SEO slogans');
assert(!buildNarrativePsychBlock(false), 'disabled empty');

const humanize = buildHumanizeScriptBlock(true);
assert(humanize.includes('NARRATIVE PSYCH'), 'humanize embeds narrative psych');

const weak = scoreNarrativePsychScript(
  'Gió thổi nhẹ qua cánh đồng. Mặt trời lên đỏ ối. Lá rơi chậm rãi trên mặt hồ yên ả.',
);
console.log('weak', weak);
assert(weak.score < 70, 'weak poetic open scores low');
assert(weak.flags.includes('poetic_open') || weak.flags.includes('weak_open_pattern_interrupt'), 'flags weak open');

const strong = scoreNarrativePsychScript(`
[CẢNH 1]
Hắn siết lưỡi dao. Máu còn ấm. Cửa hầm kêu cọt kẹt — ai đó vẫn ở dưới.
"Đừng mở," cô thì thầm. "Nếu mở, cả trại mất sạch."
Hắn đặt tay lên then cửa. Chưa kịp quyết định.
`);
console.log('strong', strong);
assert(strong.score > weak.score, 'strong > weak');
assert(strong.openScore >= 2, 'strong open score');

const slogan = scoreNarrativePsychScript(
  'Hắn chạy. Đừng bỏ lỡ phần sau. Like Subscribe ngay.',
);
assert(slogan.flags.includes('seo_slogan_in_prose'), 'detect SEO slogan in prose');
assert(slogan.score < 70, 'slogan penalized');

console.log('PASS: narrative psych integration ok');
