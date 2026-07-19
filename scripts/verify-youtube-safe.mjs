/**
 * Empirical checks for YouTube-safe + advanced studio helpers.
 * Dynamic import avoids Node 24 native type-strip issues with static .ts re-exports.
 * Run: npx tsx scripts/verify-youtube-safe.mjs
 */
import assert from 'node:assert/strict';

const {
  resolveUserRules,
  evaluateYoutubeTtsGate,
  buildYoutubeChecklist,
  summarizeChecklist,
  buildHumanizeScriptBlock,
  buildShotDiversityBlock,
  buildSpeechFingerprintBlock,
  buildAudioReadabilityBlock,
  injectBreathPauses,
  emotionPitchOffset,
  applyShotScaleToPrompt,
  enforceShotGraphOnPrompts,
  checkImagePathReuse,
  extractHookFromScript,
  buildYoutubeChapters,
  buildCutPlan,
  motionBudgetScore,
  mergeYoutubeSafe,
  normalizeHashtagField,
  toHashtag,
  buildSeoTitleFromHook,
  buildClickThumbnailLine,
  DEFAULT_FORBIDDEN_WORDS,
} = await import('../src/lib/youtubeSafe.ts');

// resolveUserRules
assert.equal(resolveUserRules({}).forbidden_words, DEFAULT_FORBIDDEN_WORDS);

// human edit gate
const noHuman = evaluateYoutubeTtsGate({
  enforceEditorGate: true,
  requireHumanEdit: true,
  humanEdited: false,
  chapterNumber: 1,
  hasScript: true,
  editorReview: { verdict: 'accept' },
  ttsPlatform: 'gemini_tts',
  ttsPitch: 1,
  ttsSpeed: 0.97,
});
assert.equal(noHuman.hardBlock, true);

const withHuman = evaluateYoutubeTtsGate({
  enforceEditorGate: true,
  requireHumanEdit: true,
  humanEdited: true,
  chapterNumber: 1,
  hasScript: true,
  editorReview: { verdict: 'accept' },
  ttsPlatform: 'gemini_tts',
  ttsPitch: 1,
  ttsSpeed: 0.97,
});
assert.equal(withHuman.ok, true);

// breath pauses
const paused = injectBreathPauses('Xin chào. Tôi là Hàn Dực! Bạn ổn chứ?');
assert.ok(paused.includes('\n\n'));

// emotion pitch
assert.ok(emotionPitchOffset('sợ hãi') > 0);
assert.ok(emotionPitchOffset('buồn bã') < 0);

// shot graph
const scaled = applyShotScaleToPrompt('a man stands in ruins', 0);
assert.ok(/wide/i.test(scaled));
const graph = enforceShotGraphOnPrompts([
  { image_prompt: 'a' },
  { image_prompt: 'b' },
  { image_prompt: 'c' },
]);
assert.ok(/medium/i.test(graph[1].image_prompt || ''));

// anti-reuse
const reuse = checkImagePathReuse('/img/a.png', { '1_0_0': '/img/a.png?t=1' }, '1_0_1');
assert.equal(reuse.reused, true);

// hook + chapters + cut
const longScript = `[CẢNH 1: NGOẠI CẢNH. PHỐ - ĐÊM]
Khói bốc lên từ xác xe. Hàn Dực siết chặt dao gỉ. "Đừng lại gần." Gió mang mùi xăng cháy. Phía cuối phố, bóng người khập khiễng. Hắn nín thở, đếm nhịp tim. Một tiếng sắt cạo nền bê tông. Anh biết mình không còn đường lùi. Liễu Yên thì thầm sau lưng. "Còn ba viên." Họ nhìn nhau. Không ai dám nói từ chết. Ánh đèn đỏ nhấp nháy từ tòa nhà đổ. Bão cát kéo tới trong năm phút. Phải chọn: hầm hoặc chết đói trên đường. Hàn Dực bước tới. Dao run nhưng mắt không.
`;
const hook = extractHookFromScript(longScript, {
  targetSec: 30,
  wpm: 140,
  // B10: Visual DNA must be provided — no invent default
  visualDna: 'cinematic moody lighting, desaturated film grain, tight frame',
});
assert.ok(hook.hook.split(/\s+/).length >= 40);
assert.ok(hook.seoTitle.length > 5);
assert.ok(hook.seoTitle.length <= 100);
assert.ok(!/\s{2}/.test(hook.seoTitle));
assert.ok(hook.thumbnailPrompt.length > 10);
assert.ok(hook.seoDescription.length > 20);
assert.ok(toHashtag('truyện audio') === '#truyệnaudio' || toHashtag('truyen audio') === '#truyenaudio');
assert.ok(normalizeHashtagField('truyện audio, mạt thế').includes('#'));
assert.ok(!normalizeHashtagField('a b').includes(','));
const title = buildSeoTitleFromHook(
  'Hắn chỉ còn ba viên đạn rồi cơn bão cát sẽ nuốt trọn cả phố phường tan hoang trong đêm tối dài dằng dặc không lối thoát',
  'Còn 3 viên đạn',
  'Series Test Dài Tên Rất Dài',
);
assert.ok(title.length <= 100);
assert.ok(title.split(' ').every((w) => w.length > 0));
const thumb = buildClickThumbnailLine(longScript);
assert.ok(thumb.length > 0 && thumb.length <= 40);
const chapters = buildYoutubeChapters([
  { title: 'Cảnh 1', durationSec: 60 },
  { title: 'Cảnh 2', durationSec: 90 },
]);
assert.equal(chapters[1].startSec, 60);
assert.ok(chapters[0].line.startsWith('0:00'));

const cut = buildCutPlan({
  chapter: 1,
  sceneIndex: 0,
  durationSec: 30,
  prompts: [{ emotion: 'tense' }, { emotion: 'fear' }, { emotion: 'calm' }],
});
assert.equal(cut.cuts.length, 3);
assert.ok(cut.cuts[0].shotScale.includes('wide'));

const motion = motionBudgetScore(8, 2);
assert.equal(motion.pct, 20);

// speech fingerprint
assert.ok(
  buildSpeechFingerprintBlock(['Hàn Dực'], {
    'Hàn Dực': { thoi_quen: 'cười lạnh', giong_thoai: 'cộc, câu ngắn' },
  }).includes('Hàn Dực'),
);
assert.ok(buildAudioReadabilityBlock().includes('AUDIO-READABILITY'));
assert.ok(buildHumanizeScriptBlock(true).includes('TÍNH NGƯỜI'));
assert.ok(buildShotDiversityBlock().includes('SHOT'));

const yt = mergeYoutubeSafe({ requireHumanEdit: false });
assert.equal(yt.requireHumanEdit, false);
assert.equal(yt.roomTone, true);

const items = buildYoutubeChecklist({
  hasScript: true,
  wordOk: true,
  sceneCount: 3,
  minScenes: 3,
  editorVerdict: 'accept',
  ttsPlatform: 'gemini_tts',
  ttsPitch: 1,
  ttsSpeed: 0.97,
  hasVisualDna: true,
  hasAudio: true,
  imageCount: 5,
  videoCount: 2,
  enforceEditorGate: true,
  humanEdited: true,
  requireHumanEdit: true,
  hasHook: true,
});
const sum = summarizeChecklist(items);
assert.equal(sum.fail, 0);
assert.equal(sum.ready, true);

console.log('PASS verify-youtube-safe.mjs (advanced studio)');
console.log(
  JSON.stringify(
    {
      humanGateBlocks: noHuman.hardBlock,
      breathOk: paused.split('\n\n').length >= 2,
      chapters: chapters.length,
      cuts: cut.cuts.length,
      checklistPass: sum.pass,
    },
    null,
    2,
  ),
);
