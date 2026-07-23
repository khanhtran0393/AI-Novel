/**
 * Smoke: Dynamic Matrix Engine — 30×30 compose, 3-layer blocks, retention.
 * Run: npx tsx scripts/smoke-matrix-engine.mts
 */
import {
  MATRIX_COMBO_COUNT,
  MATRIX_STYLE_COUNT,
  MATRIX_THEME_COUNT,
  MATRIX_STYLES,
  MATRIX_THEMES,
  buildCliffhangerBlock,
  buildEndScreenPromptHint,
  buildMatrixOutlineBlock,
  buildMatrixShotBlock,
  buildMatrixTtsHintBlock,
  buildMatrixWriteBlock,
  buildWaveRhythmBlock,
  composeMatrix,
  matrixScoreMotifs,
  matrixThumbOverlaySuggestions,
  resolveStyleVector,
  resolveTopicVector,
} from '../src/lib/matrixEngine';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error('ASSERT FAIL: ' + msg);
  console.log('OK:', msg);
}

console.log('=== smoke-matrix-engine ===');
assert(MATRIX_THEME_COUNT === 30, '30 themes');
assert(MATRIX_STYLE_COUNT === 30, '30 styles');
assert(MATRIX_COMBO_COUNT === 900, '900 combos');

// Catalog exact resolve
let catalogOk = 0;
for (const t of MATRIX_THEMES) {
  const v = resolveTopicVector(t.name);
  assert(v.fromCatalog, `topic catalog ${t.name}`);
  catalogOk++;
}
for (const s of MATRIX_STYLES) {
  const v = resolveStyleVector(s.name);
  assert(v.fromCatalog, `style catalog ${s.name}`);
  catalogOk++;
}
assert(catalogOk === 60, '60 catalog vectors');

// Full 900 compose never throws
let groups = { natural: 0, mutant: 0, contrast: 0, freeform: 0 };
for (const t of MATRIX_THEMES) {
  for (const s of MATRIX_STYLES) {
    const m = composeMatrix({ chu_de: t.name, phong_cach: s.name });
    assert(!!m.genreLabel, `label ${t.name}/${s.name}`);
    assert(!!m.topic.conflict && !!m.style.world, `material ${t.name}/${s.name}`);
    groups[m.layers.pairGroup]++;
  }
}
console.log('pair groups', groups);
assert(groups.natural + groups.mutant + groups.contrast + groups.freeform === 900, 'all 900 classified');

// Group spot checks
const natural = composeMatrix({
  chu_de: 'Linh Khí Khôi Phục',
  phong_cach: 'Tu Tiên / Tiên Hiệp',
});
assert(natural.layers.pairGroup === 'natural', 'natural: linh khí × tu tiên');

const mutant = composeMatrix({
  chu_de: 'Nông Trường',
  phong_cach: 'Cyberpunk',
});
assert(mutant.layers.pairGroup === 'mutant' || mutant.layers.pairGroup === 'contrast', 'mutant/contrast: nông × cyber');

const contrast = composeMatrix({
  chu_de: 'Ẩm Thực',
  phong_cach: 'Gothic',
});
assert(contrast.layers.pairGroup === 'contrast', 'contrast: ẩm thực × gothic');

const freeform = composeMatrix({
  chu_de: 'Đồng Nhân',
  phong_cach: 'Noir',
});
assert(freeform.layers.pairGroup === 'freeform', 'freeform: đồng nhân');

// L3 user override
const withMoTa = composeMatrix({
  chu_de: 'Ẩm Thực',
  phong_cach: 'Hard Sci-Fi',
  mo_ta: 'Đầu bếp nấu bằng lò phản ứng sao — cấm đổi thành tu tiên.',
});
assert(withMoTa.layers.hasUserOverride, 'hasUserOverride');
const writeBlock = buildMatrixWriteBlock(withMoTa);
assert(writeBlock.includes('USER INTENT') || writeBlock.includes('TẦNG 3'), 'L3 in write block');
assert(writeBlock.includes('lò phản ứng') || writeBlock.includes('Đầu bếp'), 'mo_ta excerpt in write');
assert(writeBlock.includes('DYNAMIC MATRIX') || writeBlock.includes('MATRIX'), 'matrix header');

const continueBlock = buildMatrixWriteBlock(withMoTa, { isContinue: true });
assert(continueBlock.includes('CONTINUE'), 'continue shorter block');

const outline = buildMatrixOutlineBlock(withMoTa);
assert(outline.includes('OUTLINE') || outline.includes('Conflict'), 'outline block');

const shot = buildMatrixShotBlock(withMoTa);
assert(shot.includes('VISUAL') || shot.includes('DNA'), 'shot block');

const tts = buildMatrixTtsHintBlock(withMoTa);
assert(tts.includes('TTS') || tts.includes('Narrator'), 'tts hint');

const motifs = matrixScoreMotifs(withMoTa);
assert(motifs.length >= 1, 'score motifs');
const overlays = matrixThumbOverlaySuggestions(withMoTa);
assert(overlays.length >= 1, 'thumb overlays');

// Retention
const waveShort = buildWaveRhythmBlock({
  scriptMode: 'short_manhua',
  wpm: 170,
  so_tu_chuong: 1200,
});
assert(waveShort.includes('WAVE') || waveShort.includes('SHORT'), 'wave short');

const waveDeep = buildWaveRhythmBlock({
  scriptMode: 'chuyen_sau',
  wpm: 130,
  so_tu_chuong: 4250,
});
assert(waveDeep.length > 40, 'wave deep non-empty');
assert(!waveDeep.includes('CẢNH 0') || waveDeep.includes('Không trailer'), 'deep no force cold open trailer');

const cliff = buildCliffhangerBlock({ scriptMode: 'sang_van' });
assert(cliff.includes('CLIFFHANGER') || cliff.includes('ĐỈNH'), 'cliffhanger');

const cliffOff = buildCliffhangerBlock({ scriptMode: 'chuyen_sau' });
assert(cliffOff.includes('OPEN LOOP') || cliffOff.length > 20, 'open loop deep');

const end = buildEndScreenPromptHint({
  genreLabel: 'Ẩm Thực / Gothic',
  visualDna: 'gothic kitchen moonlight',
  nextHook: 'poison stew reveal',
});
assert(end.toLowerCase().includes('end screen') || end.includes('subscribe'), 'end screen prompt');
assert(buildWaveRhythmBlock({ isContinue: true }) === '', 'wave skip continue');
assert(buildCliffhangerBlock({ isContinue: true }) === '', 'cliff skip continue');

// Soft free-text
const soft = composeMatrix({ chu_de: 'Thể loại custom XYZ', phong_cach: 'Style lạ 123' });
assert(!soft.topic.fromCatalog || !soft.style.fromCatalog, 'soft vectors for free text');
assert(!!buildMatrixWriteBlock(soft), 'soft still builds block');

console.log('=== smoke-matrix-engine PASS ===');
