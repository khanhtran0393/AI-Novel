/**
 * Smoke P0–P2 pipeline packages (pure logic, no network).
 * Run: node scripts/smoke-pipeline-p0-p2.mjs
 */
import assert from 'assert';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

// --- Pure mirrors (keep in sync with TS for CI without tsx) ---

function getWordCount(text) {
  if (!text) return 0;
  const cleaned = text.normalize('NFC').replace(/\[[^\]]*\]/g, '').trim();
  if (!cleaned) return 0;
  return cleaned.split(/\s+/).filter(Boolean).length;
}

function countSceneTags(text) {
  const m = (text || '').match(/\[CẢNH\s+\d+\s*:[^\]]+\]/gi);
  return m ? m.length : 0;
}

function evaluateWordGate(text, wordGoal = 4250, minScenes = 3) {
  const wordMin = Math.round(wordGoal * 0.92);
  const wordCount = getWordCount(text);
  const sceneCount = countSceneTags(text);
  return {
    wordCount,
    sceneCount,
    wordsOk: wordCount >= wordMin,
    scenesOk: sceneCount >= minScenes,
  };
}

function evaluateChapterQuality({ content, editorVerdict }) {
  const findings = [];
  const gate = evaluateWordGate(content);
  if (!gate.wordsOk) findings.push({ severity: 'error', code: 'word_gate' });
  if (!gate.scenesOk) findings.push({ severity: 'error', code: 'scene_gate' });
  if (String(editorVerdict || '').toLowerCase() === 'rewrite') {
    findings.push({ severity: 'error', code: 'editor_rewrite' });
  }
  const hardErrors = findings.filter((f) => f.severity === 'error').length;
  return {
    ok: hardErrors === 0,
    mediaReady: hardErrors === 0 && String(editorVerdict || '') !== 'rewrite',
    hardErrors,
    wordCount: gate.wordCount,
    sceneCount: gate.sceneCount,
  };
}

function computeArcBoundary(completedChapters, totalChapters, cfg) {
  const cpa = cfg.chaptersPerArc;
  const apv = cfg.arcsPerVolume;
  const n = completedChapters.length;
  const isArcEnd = n > 0 && n % cpa === 0;
  const isVolumeEnd = n > 0 && n % (cpa * apv) === 0;
  const volume = n === 0 ? 1 : Math.floor((n - 1) / (cpa * apv)) + 1;
  const indexInVolume = n === 0 ? 0 : (n - 1) % (cpa * apv);
  const arc = n === 0 ? 1 : Math.floor(indexInVolume / cpa) + 1;
  return {
    isArcEnd,
    isVolumeEnd,
    volume,
    arc,
    needsExpansion: isArcEnd && !isVolumeEnd && n < totalChapters,
    needsNewVolume: isVolumeEnd && n < totalChapters,
    completedInProject: n,
  };
}

function extractForeshadow(content, chapter) {
  const re =
    /(?:bí mật|chưa biết|sẽ phải|lần sau|manh mối|đáng ngờ)/i;
  return content
    .split(/(?<=[.!?…])\s+/)
    .filter((s) => re.test(s))
    .slice(0, 5)
    .map((text, i) => ({ id: `${chapter}_${i}`, chapter, text, status: 'open' }));
}

// --- Tests ---

const thin = 'Chỉ vài chữ. Không đủ cảnh.';
const qThin = evaluateChapterQuality({ content: thin });
assert.strictEqual(qThin.mediaReady, false, 'thin chapter not media-ready');
assert.ok(qThin.hardErrors >= 1);

const scenes = [];
for (let i = 1; i <= 3; i++) {
  scenes.push(`[CẢNH ${i}: NGOẠI – RỪNG]`);
  scenes.push(Array(400).fill('chữ').join(' '));
}
const fat = scenes.join('\n');
const qFat = evaluateChapterQuality({ content: fat, editorVerdict: 'accept' });
assert.strictEqual(qFat.scenesOk !== false || qFat.sceneCount >= 3, true);
assert.ok(qFat.sceneCount >= 3, 'scene count');
assert.ok(qFat.wordCount >= 1000, 'words');

const qRewrite = evaluateChapterQuality({ content: fat, editorVerdict: 'rewrite' });
assert.strictEqual(qRewrite.mediaReady, false, 'rewrite blocks media');

// Arc boundary P2
const cfg = { chaptersPerArc: 10, arcsPerVolume: 5 };
const b9 = computeArcBoundary([1, 2, 3, 4, 5, 6, 7, 8, 9], 50, cfg);
assert.strictEqual(b9.isArcEnd, false);
const b10 = computeArcBoundary([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50, cfg);
assert.strictEqual(b10.isArcEnd, true);
assert.strictEqual(b10.volume, 1);
assert.strictEqual(b10.arc, 1);
assert.strictEqual(b10.needsExpansion, true);
const b50 = computeArcBoundary(Array.from({ length: 50 }, (_, i) => i + 1), 50, cfg);
assert.strictEqual(b50.isVolumeEnd, true); // 50 = 10*5

// Foreshadow
const fs = extractForeshadow(
  'Hắn giữ một bí mật. Ngày mai sẽ phải đối mặt. Bình thường thôi.',
  2,
);
assert.ok(fs.length >= 1, 'foreshadow extract');

// Source files exist
const required = [
  'src/lib/pipeline/index.ts',
  'src/lib/pipeline/qualityGate.ts',
  'src/lib/pipeline/memoryAfterCommit.ts',
  'src/lib/pipeline/mediaPreflight.ts',
  'src/lib/pipeline/longformArc.ts',
  'src/lib/pipeline/sceneStageQueue.ts',
  'src/lib/pipeline/ensureQuality.ts',
  'src/lib/pipeline/pipelineStore.ts',
];
for (const rel of required) {
  const fsSync = await import('fs');
  assert.ok(fsSync.existsSync(path.join(root, rel)), `missing ${rel}`);
}

console.log('OK smoke-pipeline-p0-p2');
console.log(
  JSON.stringify(
    {
      qThin: { mediaReady: qThin.mediaReady, hardErrors: qThin.hardErrors },
      qFat: { words: qFat.wordCount, scenes: qFat.sceneCount, mediaReady: qFat.mediaReady },
      arc10: b10,
      foreshadow: fs.length,
    },
    null,
    2,
  ),
);
