/**
 * Integration: matrix + style engine + write-like prompt inject + SEO + shot allocator.
 * Run: npx tsx scripts/smoke-matrix-integration.mts
 */
import {
  composeMatrixFromPayload,
  buildMatrixWriteBlock,
  buildWaveRhythmBlock,
  buildCliffhangerBlock,
  buildMatrixTtsHintBlock,
  buildMatrixOutlineBlock,
  buildMatrixShotBlock,
  composeMatrix,
  MATRIX_THEMES,
  MATRIX_STYLES,
  buildEndScreenPromptHint,
} from '../src/lib/matrixEngine';
import { allocateShotDurationsByMode } from '../src/lib/scriptMode';
import {
  resolveStyleEngineFromSetupPayload,
  buildStyleEngineWriteBlock,
} from '../src/lib/styleEngineProfiles';
import { pickBestSeoTitle } from '../src/lib/youtube-safe/seoMeta';
import { buildFiveTitleFormulas } from '../src/lib/youtube-safe/highCtr';
import { requireGenreLabelFromSetup } from '../src/lib/storyWriting';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error('ASSERT FAIL: ' + msg);
  console.log('OK:', msg);
}

console.log('=== smoke-matrix-integration ===');

// 1) WRITE-like payload (writeModule shape)
const payload = {
  chu_de: 'Ẩm Thực',
  phong_cach: 'Gothic',
  mo_ta: 'Đầu bếp nấu trong lâu đài ma — cấm đổi thành tu tiên.',
  lorebook: 'Không dùng linh căn.',
  genre: 'Ẩm Thực / Gothic',
  scriptMode: 'sang_van',
  so_tu_chuong: 3000,
  wpm: 155,
};
const mx = composeMatrixFromPayload(payload);
assert(mx.layers.hasUserOverride, 'payload mo_ta override');
assert(mx.layers.pairGroup === 'contrast', 'gothic food contrast');
const write = buildMatrixWriteBlock(mx, { isContinue: false });
assert(
  write.includes('Đầu bếp') || write.includes('lâu đài'),
  'mo_ta excerpt in write block',
);
const wave = buildWaveRhythmBlock({
  scriptMode: payload.scriptMode,
  wpm: payload.wpm,
  so_tu_chuong: payload.so_tu_chuong,
});
const cliff = buildCliffhangerBlock({ scriptMode: payload.scriptMode });
const tts = buildMatrixTtsHintBlock(mx);
// Gothic alone may still match StyleEngine (kinh_di_huyen_nghi PC score≥2) — OK, matrix still primary for Topic
const seGothic = resolveStyleEngineFromSetupPayload(payload);
const styleBlock = buildStyleEngineWriteBlock(seGothic, {
  scriptMode: 'sang_van',
});
console.log('  styleEngine for Ẩm Thực/Gothic:', seGothic?.id ?? null);
assert(
  write.length > 200 && wave.length > 40 && cliff.length > 20 && tts.length > 40,
  'full inject blocks usable',
);
// Hard Sci-Fi + Ẩm Thực: no StyleEngine (score < 2) — matrix-only path
const hardPair = {
  chu_de: 'Ẩm Thực',
  phong_cach: 'Hard Sci-Fi',
  mo_ta: 'Bếp trên trạm vũ trụ.',
};
assert(
  !resolveStyleEngineFromSetupPayload(hardPair),
  'style engine null for Ẩm Thực/Hard Sci-Fi',
);
assert(
  buildMatrixWriteBlock(composeMatrixFromPayload(hardPair)).length > 100,
  'matrix-only path still rich',
);

// Simulated chapter prompt slice (no LLM)
const chapterPromptSlice = [
  write,
  wave,
  cliff,
  tts,
  styleBlock,
].join('\n');
assert(chapterPromptSlice.includes('DYNAMIC MATRIX'), 'chapter slice has matrix');
assert(
  chapterPromptSlice.includes('WAVE') || chapterPromptSlice.includes('nhịp'),
  'chapter slice has wave',
);
assert(
  !chapterPromptSlice.includes('[SFX:') && !chapterPromptSlice.includes('[BGM:'),
  'no SFX/BGM tags in inject',
);

// 2) Natural + style engine both fire
const p2 = {
  chu_de: 'Linh Khí Khôi Phục',
  phong_cach: 'Tu Tiên / Tiên Hiệp',
  mo_ta: 'Hắn thức tỉnh linh căn thần cấp.',
  scriptMode: 'short_manhua',
};
const mx2 = composeMatrixFromPayload(p2);
const se2 = resolveStyleEngineFromSetupPayload(p2);
assert(!!se2 && se2.id === 'tu_tien', 'style engine hit tu_tien');
const w2 =
  buildMatrixWriteBlock(mx2) +
  buildStyleEngineWriteBlock(se2, { scriptMode: 'short_manhua' });
assert(w2.includes('MATRIX') && w2.includes('STYLE ENGINE'), 'both matrix+style');

// 3) Shot allocator mild chuyen_sau + B10
const d1 = allocateShotDurationsByMode({
  mode: 'chuyen_sau',
  totalDurationSec: 40,
  count: 5,
  emotions: ['action', 'calm', 'tense', 'dialogue', 'shock'],
});
assert(d1.reduce((a, b) => a + b, 0) === 40, 'chuyen_sau durations sum=40');
const d2 = allocateShotDurationsByMode({
  mode: 'short_manhua',
  totalDurationSec: 20,
  count: 5,
  emotions: ['action', 'calm', 'tense', 'dialogue', 'shock'],
});
assert(d2.reduce((a, b) => a + b, 0) === 20, 'short durations sum=20');
let threw = false;
try {
  allocateShotDurationsByMode({
    mode: 'sang_van',
    totalDurationSec: 0,
    count: 3,
  });
} catch {
  threw = true;
}
assert(threw, 'B10 throw without totalDurationSec');

// 4) SEO matrix when style null
const formulas = buildFiveTitleFormulas({
  hook: 'Chê hắn đầu bếp phế, đến khi món súp độc làm cả lâu đài quỳ',
  novelTitle: 'Ẩm Thực Ma',
  seed: 1,
});
assert(formulas.length >= 5, `5 title formulas (got ${formulas.length})`);
const best = pickBestSeoTitle(
  'Chê hắn đầu bếp phế, đến khi món súp độc',
  'Ẩm Thực Ma',
  { chu_de: 'Ẩm Thực', phong_cach: 'Gothic', seed: 2 },
);
assert(best.title.length >= 12, 'pickBest title usable with matrix opts');

// 5) Outline + shot for sample grid
for (const t of MATRIX_THEMES.slice(0, 6)) {
  for (const s of MATRIX_STYLES.slice(0, 6)) {
    const m = composeMatrix({
      chu_de: t.name,
      phong_cach: s.name,
      mo_ta: 'cốt test',
    });
    assert(buildMatrixOutlineBlock(m).length > 20, `outline ${t.name}/${s.name}`);
    assert(buildMatrixShotBlock(m).length > 20, `shot ${t.name}/${s.name}`);
  }
}
assert(true, '36 outline/shot combos');

// 6) requireGenre still hard-fails empty
let genreThrew = false;
try {
  requireGenreLabelFromSetup({ chu_de: '', phong_cach: '' });
} catch {
  genreThrew = true;
}
assert(genreThrew, 'requireGenre hard-fail empty Setup');

// 7) End-screen prompt for store field
const end = buildEndScreenPromptHint({
  genreLabel: 'Ẩm Thực / Gothic',
  visualDna: 'gothic kitchen',
  nextHook: 'poison stew',
});
assert(/end screen|subscribe/i.test(end), 'endScreenPrompt field usable');

// 8) Continue mode skips wave/cliff
assert(buildWaveRhythmBlock({ isContinue: true }) === '', 'wave skip continue');
assert(buildCliffhangerBlock({ isContinue: true }) === '', 'cliff skip continue');
const cont = buildMatrixWriteBlock(mx, { isContinue: true });
assert(cont.includes('CONTINUE'), 'matrix continue mode');

// 9) NFC labels from Setup catalog
const nfcPair = composeMatrix({
  chu_de: 'Trùng Sinh',
  phong_cach: 'Đô Thị',
  mo_ta: 'Hủy hôn → lộ chủ tịch',
});
assert(nfcPair.layers.pairGroup === 'natural', 'trùng sinh × đô thị natural');
assert(nfcPair.topic.fromCatalog && nfcPair.style.fromCatalog, 'catalog flags');

console.log('=== smoke-matrix-integration PASS ===');
