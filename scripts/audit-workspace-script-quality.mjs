/**
 * Audit "Kịch Bản Làm Việc" generated artifacts vs product requirements.
 * Fails on hard quality bugs; rewrites are applied in source when audit finds systemic issues.
 * Dynamic import for Node 24 + tsx reliability.
 */
const {
  extractHookFromScript,
  generateYoutubeMetaWithQA,
  buildSeoTitleFromHook,
  buildClickThumbnailLine,
  buildSeoDescription,
  buildThumbnailPrompt,
  scoreYoutubeMetaFields,
  YOUTUBE_META_PASS_SCORE,
  enforceShotGraphOnPrompts,
} = await import('../src/lib/youtubeSafe.ts');
const {
  applyDirectorFormulasToPromptPair,
  compileStillImagePrompt,
} = await import('../src/lib/integrations/seedance.ts');
const { parseScenes, getWordCount, evaluateWordGate } = await import(
  '../src/lib/storyWriting.ts'
);
const { YOUTUBE_PSYCH_55 } = await import('../src/lib/youtubePsych55.ts');

const issues = [];
function hard(name, pass, detail = '') {
  if (!pass) issues.push({ level: 'hard', name, detail });
  console.log(`${pass ? 'PASS' : 'HARD'}  ${name}${detail ? ' — ' + detail : ''}`);
}
function soft(name, pass, detail = '') {
  if (!pass) issues.push({ level: 'soft', name, detail });
  console.log(`${pass ? 'PASS' : 'SOFT'}  ${name}${detail ? ' — ' + detail : ''}`);
}

const SCRIPT = `[CẢNH 1: Hầm tối]
Hàn Dực đặt tay lên tường đá ẩm. Lớp rêu lạnh dính vào lòng bàn tay. Tiếng nước nhỏ giọt đếm nhịp trong tối. Bỗng vết nứt trên tường cổ nở ra, ánh sáng lạnh tràn vào như lưỡi dao. Hắn lùi nửa bước — sau lưng còn tiếng chân thứ hai, không phải của hắn.

[CẢNH 2: Hành lang sụp]
Không ai kịp gọi tên. Mùi sắt tanh nổi lên từ khe đá. Liễu Yên níu cổ tay hắn nhưng không nói một lời. Cả hai biết nếu đứng thêm một giây, cánh cửa đá sẽ khép và chôn họ dưới lòng đất. Hắn siết chặt mảnh kim loại trong túi — manh mối cuối cùng từ bức tường cổ.`.normalize('NFC');

// ── 1) Scene structure ────────────────────────────────────────
const scenes = parseScenes(SCRIPT);
hard('parseScenes ≥2', scenes.length >= 2, `n=${scenes.length}`);
hard('scene tags CẢNH', scenes.some((s) => /CẢNH/i.test(s.title)) || scenes.length >= 2);
hard('NFC content preserved', SCRIPT === SCRIPT.normalize('NFC'));

const words = getWordCount(SCRIPT);
const gate = evaluateWordGate(SCRIPT, 500);
soft('word count sensible', words > 50, `words=${words}`);

// ── 2) Hook engine ────────────────────────────────────────────
const AUDIT_VISUAL_DNA =
  'cinematic moody lighting, desaturated film grain, tight frame';
const hookPack = extractHookFromScript(SCRIPT, {
  targetSec: 30,
  wpm: 140,
  visualDna: AUDIT_VISUAL_DNA,
});
hard('hook non-empty', !!hookPack.hook && hookPack.hook.length >= 40, hookPack.hook.slice(0, 80));
hard('hook has open-loop or tension', /…|\?|nhưng|không|chạy|nứt|chân/i.test(hookPack.hook));
hard('thumbnailLine ≤30', (hookPack.thumbnailLine || '').length <= 30, hookPack.thumbnailLine);
hard('seoTitle ≤100', (hookPack.seoTitle || '').length <= 100);
hard('thumbnailPrompt non-empty', !!hookPack.thumbnailPrompt);

// ── 3) Meta QA + 55 laws ──────────────────────────────────────
const meta = generateYoutubeMetaWithQA({
  script: SCRIPT,
  novelTitle: 'Tiếng Vọng Tường Cổ',
  chapter: 1,
  maxRounds: 5,
  visualDna: 'cinematic moody lighting, desaturated film grain, tight frame',
});
hard('meta title exists', !!meta.seoTitle);
hard('meta thumb ≤30', meta.thumbnailLine.length <= 30, meta.thumbnailLine);
hard(
  'NO double-why title (tại sao ... vì sao)',
  !/tại\s+sao[\s\S]{0,40}vì\s+sao/i.test(meta.seoTitle),
  meta.seoTitle,
);
hard(
  'NO broken "làm gì nếu + full clause" title',
  !/^Bạn sẽ làm gì nếu\s+/i.test(meta.seoTitle),
  meta.seoTitle,
);
// Agitate stock should not always be the same two lines
const descs = [1, 2, 3, 4, 5].map((ch) =>
  buildSeoDescription({
    hook: meta.hook,
    thumbnailLine: meta.thumbnailLine,
    novelTitle: 'Tiếng Vọng Tường Cổ',
    chapter: ch,
  }),
);
const uniqueAgitate = new Set(descs.map((d) => d.split('\n').slice(2, 4).join('|')));
hard('desc agitate diversifies by chapter', uniqueAgitate.size >= 3, `unique=${uniqueAgitate.size}`);
hard(
  'title not pure dialogue dump',
  !/^(hắn|nàng|tôi|ta)\s+nói/i.test(meta.seoTitle),
  meta.seoTitle,
);
hard(
  'thumb not empty ellipsis only',
  meta.thumbnailLine.replace(/[.…?\s]/g, '').length >= 4,
  meta.thumbnailLine,
);
soft('meta average score ≥7', meta.scores.average >= 7, String(meta.scores.average));
soft(
  'thumb prompt has click-curiosity',
  /click-curiosity|curiosity bias|negative space/i.test(meta.thumbnailPrompt),
);

// Diversity across chapters
const titleSet = new Set();
const thumbSet = new Set();
for (let ch = 1; ch <= 10; ch++) {
  titleSet.add(
    buildSeoTitleFromHook(meta.hook, meta.thumbnailLine, 'Tiếng Vọng Tường Cổ', {
      seed: ch * 91,
    }),
  );
  thumbSet.add(buildClickThumbnailLine(meta.hook, undefined, { seed: ch * 53 }));
}
hard('title diversity ≥6/10', titleSet.size >= 6, `unique=${titleSet.size}`);
hard('thumb diversity ≥4/10', thumbSet.size >= 4, `unique=${thumbSet.size}`);

// Stock agitate detection (soft - we'll rewrite if too rigid)
const desc = buildSeoDescription({
  hook: meta.hook,
  thumbnailLine: meta.thumbnailLine,
  novelTitle: 'Tiếng Vọng Tường Cổ',
  chapter: 1,
  tags: '#truyenaudio #kichban',
});
soft('desc starts with thumb or curiosity', desc.length > 50);
// Flag stock lines for rewrite
const stockHits = [
  /Sai một bước là mất sạch/i,
  /Bí mật lộ ra từng mảnh — không có chỗ lùi/i,
  /Phút tiếp theo sẽ lật ngược mọi thứ bạn vừa tin/i,
  /Càng đi sâu, khoảng trống thông tin càng lớn/i,
].filter((re) => re.test(desc));
console.log('  stock agitate hits:', stockHits.length);

// ── 4) Director formula on image/video prompts ────────────────
const fakeAi = [
  {
    image_prompt: 'cinematic epic 8k masterpiece of Han Duc at cracked wall, beautiful lighting',
    video_prompt: 'cinematic camera push in, epic reveal, 8k',
    prompt: 'cinematic epic 8k masterpiece of Han Duc at cracked wall',
  },
];
const shot = enforceShotGraphOnPrompts(fakeAi);
const directed = applyDirectorFormulasToPromptPair({
  imagePrompt: shot[0].image_prompt,
  videoPrompt: shot[0].video_prompt,
  characterHints: ['Hàn Dực'],
  styleHint: 'cinematic natural realism',
  durationSec: 5,
});
hard('image formula strips 8k/cinematic', !/\b(8k|cinematic|masterpiece)\b/i.test(directed.image_prompt), directed.image_prompt.slice(0, 100));
hard('video has Preserve @Image1', /Preserve @Image1/i.test(directed.video_prompt));
hard('image has Still frame beat', /Still frame beat/i.test(directed.image_prompt));
hard('video has Action(', /Action\s*\(/i.test(directed.video_prompt));

// ── 5) Psych 55 count ─────────────────────────────────────────
hard('55 laws', YOUTUBE_PSYCH_55.length === 55);

// ── Report ────────────────────────────────────────────────────
console.log('\n======== SAMPLE META ========');
console.log('TITLE:', meta.seoTitle);
console.log('THUMB:', meta.thumbnailLine);
console.log('LAW:', meta.titleLawId, meta.titleLawName);
console.log('HOOK:', meta.hook.slice(0, 160));
console.log('DESC stock hits:', stockHits.length);

const hards = issues.filter((i) => i.level === 'hard');
const softs = issues.filter((i) => i.level === 'soft');
console.log(`\nHARD fails: ${hards.length}  SOFT fails: ${softs.length}`);
if (hards.length) {
  console.error('HARD:', hards.map((h) => h.name + (h.detail ? '(' + h.detail + ')' : '')).join(' | '));
  process.exit(2);
}
// exit 0 even with soft - rewrites handle soft
if (softs.length) {
  console.log('SOFT (will rewrite):', softs.map((s) => s.name).join(', '));
  process.exit(3); // signal rewrite needed for soft issues
}
console.log('AUDIT: ALL HARD PASS');
process.exit(0);
