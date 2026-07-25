/**
 * Re-verify edited P0–P2 surfaces after integration.
 * Run: npx tsx scripts/smoke-pipeline-edited-verify.mts
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  evaluateChapterQuality,
  assertTtsMediaPreflight,
  createStageBatchJob,
  evaluateMediaPreflight,
  buildLayeredRouteExtras,
  ensureChapterQuality,
  setChapterQuality,
  getChapterQuality,
  lorebookWithMemoryPack,
  enrichMemoryAfterCommit,
  subscribePipelineStore,
  getPipelineStoreVersion,
  readStageMeta,
  wordBandFromSetupGoal,
  exportPipelineSnapshot,
  importPipelineSnapshot,
  clearPipelineStore,
} from '../src/lib/pipeline/index.ts';
import {
  buildPortableProject,
  applyPortablePipelineSnapshot,
  parsePortableProject,
} from '../src/lib/projectPortable.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// --- files exist ---
const required = [
  'src/lib/pipeline/qualityGate.ts',
  'src/lib/pipeline/memoryAfterCommit.ts',
  'src/lib/pipeline/mediaPreflight.ts',
  'src/lib/pipeline/ttsMediaPreflight.ts',
  'src/lib/pipeline/sceneStageQueue.ts',
  'src/lib/pipeline/longformArc.ts',
  'src/lib/pipeline/ensureQuality.ts',
  'src/lib/pipeline/pipelineStore.ts',
  'src/app/workspace/features/script/QualityGateBadge.tsx',
  'src/app/workspace/features/script/ChapterList.tsx',
  'src/app/workspace/features/script/SceneCard.tsx',
  'src/app/workspace/hooks/useImagePromptActions.ts',
  'src/app/workspace/hooks/useTTSActions.ts',
  'src/app/workspace/hooks/chapterTtsActions.ts',
  'src/app/workspace/hooks/writeChapterFinish.ts',
  'src/app/workspace/hooks/writeChapterHelpers.ts',
  'src/lib/novel-engine/runner.ts',
  'src/lib/novel-engine/tools/writerTools.ts',
  'src/lib/novel-engine/tools/editorTools.ts',
];
for (const rel of required) {
  assert.ok(fs.existsSync(path.join(root, rel)), `missing ${rel}`);
}

// --- wire strings in edited call-sites ---
function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}
assert.match(read('src/app/workspace/hooks/useTTSActions.ts'), /assertTtsMediaPreflight/);
assert.match(read('src/app/workspace/hooks/chapterTtsActions.ts'), /assertTtsMediaPreflight/);
assert.match(read('src/app/workspace/hooks/chapterTtsActions.ts'), /createStageBatchJob/);
assert.match(read('src/app/workspace/hooks/useImagePromptActions.ts'), /createStageBatchJob/);
assert.match(read('src/app/workspace/hooks/useImagePromptActions.ts'), /runStageBatch/);
assert.match(read('src/app/workspace/hooks/useImagePromptActions.ts'), /evaluateMediaPreflight/);
assert.doesNotMatch(
  read('src/app/workspace/hooks/useImagePromptActions.ts'),
  /createBatchJob\(/,
);
assert.match(read('src/app/workspace/hooks/writeChapterFinish.ts'), /evaluateChapterQuality/);
assert.match(read('src/app/workspace/hooks/writeChapterHelpers.ts'), /enrichMemoryAfterCommit/);
assert.match(read('src/app/workspace/modules/writeModule.ts'), /lorebookWithMemoryPack/);
assert.match(read('src/lib/novel-engine/runner.ts'), /buildLayeredRouteExtras/);
assert.match(read('src/app/workspace/features/script/SceneCard.tsx'), /QualityGateBadge/);
assert.match(read('src/app/workspace/features/script/ChapterList.tsx'), /QualityGateBadge/);

// --- runtime ---
let emits = 0;
const unsub = subscribePipelineStore(() => {
  emits += 1;
});

const parts: string[] = [];
for (let i = 1; i <= 3; i++) {
  parts.push(`[CẢNH ${i}: NGOẠI – TEST]`);
  parts.push(Array(1400).fill('từ').join(' '));
}
const fat = parts.join('\n');

const q = evaluateChapterQuality({
  chapter: 7,
  content: fat,
  editorVerdict: 'accept',
  wordGoal: 4250,
});
setChapterQuality(q);
assert.strictEqual(q.mediaReady, true);
assert.ok(emits >= 1, 'subscribe must fire on setChapterQuality');

const qRewrite = evaluateChapterQuality({
  chapter: 7,
  content: fat,
  editorVerdict: 'rewrite',
});
assert.strictEqual(qRewrite.mediaReady, false);

const pack = enrichMemoryAfterCommit({
  chapter: 7,
  content: `${fat} Hắn còn một bí mật chưa biết.`,
  scrollSummary: 'Tóm tắt test',
  shortTerm: ['ch6 done'],
  characterNames: ['Hàn Dực'],
});
assert.ok(pack.promptBlock.includes('CUỐN CHIẾU'));
assert.ok(lorebookWithMemoryPack('Luật A').includes('Luật A'));

const pfImg = evaluateMediaPreflight({
  stage: 'image',
  chapter: 7,
  chu_de: 'Kiếm',
  phong_cach: 'Hành động',
  style: 'cinematic',
  hasImagePrompt: true,
  requireQualityGate: true,
});
assert.strictEqual(pfImg.ok, true, pfImg.summary);

const pfPromptBlock = evaluateMediaPreflight({
  stage: 'prompt',
  chapter: 7,
  chu_de: '',
  phong_cach: '',
  style: '',
  wpm: 0,
  secondsPerBeat: 0,
  duration: 0,
  sceneText: '',
  requireQualityGate: true,
});
assert.strictEqual(pfPromptBlock.ok, false);
const blockCodes = pfPromptBlock.issues
  .filter((i) => i.level === 'block')
  .map((i) => i.code);
assert.ok(blockCodes.includes('setup_genre'));
assert.ok(blockCodes.includes('duration') || blockCodes.includes('empty_scene'));

const tts = assertTtsMediaPreflight({
  chapter: 7,
  sceneText: 'Thoại thử',
  platform: 'edge_tts',
  voice: 'vi-VN-HoaiMyNeural',
  chapterContent: fat,
  chu_de: 'Kiếm',
  phong_cach: 'Hành động',
});
assert.strictEqual(tts.ok, true);

let ttsBlocked = false;
try {
  assertTtsMediaPreflight({
    chapter: 7,
    sceneText: 'x',
    platform: '',
    voice: 'v',
  });
} catch {
  ttsBlocked = true;
}
assert.ok(ttsBlocked, 'TTS empty platform must hard-fail');

const job = createStageBatchJob({
  stage: 'video',
  chapter: 7,
  items: [{ label: 'v1', chapter: 7, sceneIndex: 0, promptIndex: 0 }],
});
assert.strictEqual(job.kind, 'video');
assert.strictEqual(job.items[0].meta?.stage, 'video');
const meta = readStageMeta(job.items[0]);
assert.ok(meta);
assert.strictEqual(meta?.stage, 'video');
assert.strictEqual(meta?.chapter, 7);

const layered = buildLayeredRouteExtras(
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  40,
  {
    layered: true,
    chaptersPerArc: 10,
    arcsPerVolume: 5,
    forceArcSummaryEvery: 10,
  },
);
assert.strictEqual(layered.layered, true);
assert.strictEqual(layered.arcBoundary?.isArcEnd, true);

const lazy = ensureChapterQuality({
  chapter: 8,
  content: fat,
  editorVerdict: 'accept',
});
assert.ok(lazy?.mediaReady);
assert.ok(getChapterQuality(7)?.mediaReady);

// Word band unify
const band = wordBandFromSetupGoal(4250);
assert.strictEqual(band.min, Math.round(4250 * 0.92));
assert.strictEqual(band.max, Math.round(4250 * 1.2));
assert.ok(
  !q.findings.some((f) => f.code === 'rules_chapter_words'),
  'no dual rules word hard findings',
);

// Portable pipeline snapshot round-trip
const snap = exportPipelineSnapshot();
assert.ok(snap.quality[7] || snap.quality['7'] || Object.keys(snap.quality).length >= 1);
clearPipelineStore();
assert.strictEqual(getChapterQuality(7), null);
importPipelineSnapshot(snap);
assert.ok(getChapterQuality(7)?.mediaReady);

const portable = buildPortableProject({
  ten_tac_pham: 'Test Pack',
  setup: { chu_de: 'Kiếm', phong_cach: 'Hành', so_chuong: 10, so_tu_chuong: 4250 },
  danh_sach_chuong: [],
});
assert.ok(portable.pipelineSnapshot);
clearPipelineStore();
applyPortablePipelineSnapshot(portable);
assert.ok(getChapterQuality(7)?.mediaReady, 'portable apply restores quality');

const reparsed = parsePortableProject(JSON.stringify(portable));
assert.ok(reparsed.pipelineSnapshot);

unsub();

console.log(
  JSON.stringify(
    {
      ok: true,
      emits,
      version: getPipelineStoreVersion(),
      qualityWords: q.wordCount,
      foreshadowOpen: pack.foreshadowOpen.length,
      promptBlockCodes: blockCodes,
      jobId: job.id,
      arc: layered.arcBoundary,
      wordBand: band,
      portableHasPipeline: !!portable.pipelineSnapshot,
    },
    null,
    2,
  ),
);
console.log('PASS smoke-pipeline-edited-verify');
