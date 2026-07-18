/**
 * Import real TS pipeline modules.
 * Run: npx tsx scripts/smoke-pipeline-import.mts
 */
import assert from 'assert';
import {
  evaluateChapterQuality,
  computeArcBoundary,
  extractForeshadowCandidates,
  evaluateMediaPreflight,
  resolveLongformConfig,
  ensureChapterQuality,
  setChapterQuality,
  createStageBatchJob,
  assertTtsMediaPreflight,
  getChapterQuality,
} from '../src/lib/pipeline/index.ts';

const parts: string[] = [];
for (let i = 1; i <= 3; i++) {
  parts.push(`[CẢNH ${i}: NGOẠI – THUNG LŨNG]`);
  parts.push(Array(1400).fill('từ').join(' '));
}
const fat = parts.join('\n');

const q = evaluateChapterQuality({
  chapter: 1,
  content: fat,
  characterNames: ['Hàn Dực'],
  wordGoal: 4250,
  editorVerdict: 'accept',
});
console.log('quality', {
  ok: q.ok,
  mediaReady: q.mediaReady,
  words: q.wordCount,
  scenes: q.sceneCount,
  hard: q.hardErrors,
});
assert.ok(q.sceneCount >= 3);
assert.ok(q.wordCount >= 3900);
assert.strictEqual(q.mediaReady, true);
// Unified band: no dual rules_chapter_words hard error when Setup goal set
assert.ok(
  !q.findings.some((f) => f.code === 'rules_chapter_words'),
  'rules chapter_words must be stripped when wordGoal set',
);

setChapterQuality(q);
const pf = evaluateMediaPreflight({
  stage: 'prompt',
  chapter: 1,
  chu_de: 'Kiếm hiệp',
  phong_cach: 'Hành động',
  style: 'cinematic wuxia',
  wpm: 150,
  secondsPerBeat: 6,
  duration: 12,
  sceneText: 'Mở đầu',
  requireQualityGate: true,
});
assert.strictEqual(pf.ok, true, pf.summary);

const b = computeArcBoundary(
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  40,
  { layered: true, chaptersPerArc: 10, arcsPerVolume: 5, forceArcSummaryEvery: 10 },
);
assert.strictEqual(b.isArcEnd, true);
assert.strictEqual(b.needsExpansion, true);

const fs = extractForeshadowCandidates(
  1,
  'Hắn còn một bí mật chưa biết. Ngày mai sẽ phải trả giá. Trời xanh.',
);
assert.ok(fs.length >= 1);

const lf = resolveLongformConfig(40, { layered: true });
assert.strictEqual(lf.layered, true);

const lazy = ensureChapterQuality({ chapter: 99, content: fat, editorVerdict: 'accept' });
assert.ok(lazy?.mediaReady);

// P1 stage batch job
const stageJob = createStageBatchJob({
  stage: 'image',
  chapter: 1,
  items: [
    { label: 'p1', chapter: 1, sceneIndex: 0, promptIndex: 0 },
    { label: 'p2', chapter: 1, sceneIndex: 0, promptIndex: 1 },
  ],
});
assert.strictEqual(stageJob.kind, 'image');
assert.strictEqual(stageJob.items.length, 2);
assert.strictEqual(stageJob.items[0].meta?.stage, 'image');

// P1 TTS preflight OK
setChapterQuality(q);
const ttsPf = assertTtsMediaPreflight({
  chapter: 1,
  sceneText: 'Nội dung cảnh thử TTS.',
  platform: 'edge_tts',
  voice: 'vi-VN-HoaiMyNeural',
  chapterContent: fat,
});
assert.strictEqual(ttsPf.ok, true);

// TTS blocks without platform
let blocked = false;
try {
  assertTtsMediaPreflight({
    chapter: 1,
    sceneText: 'x',
    platform: '',
    voice: 'v',
  });
} catch {
  blocked = true;
}
assert.ok(blocked, 'TTS without platform must hard-fail');

assert.ok(getChapterQuality(1)?.mediaReady);

console.log('OK smoke-pipeline-import (+ stage batch + TTS preflight)');
