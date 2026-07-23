/**
 * Integration smoke: Style Engine usable end-to-end
 * (Setup labels → soft setSetup → WRITE payload → SEO meta → shot durations)
 * Run: npx tsx scripts/smoke-style-engine-integration.mts
 */
import {
  STYLE_ENGINE_PROFILES,
  buildStyleCtrTitleCandidates,
  buildStyleEngineOutlineBlock,
  buildStyleEngineShotHintBlock,
  buildStyleEngineWriteBlock,
  resolveStyleEngineFromSetupPayload,
  resolveStyleEngineProfile,
  styleEngineMediaSoftPatch,
  styleEngineTitleScoreBoost,
} from '../src/lib/styleEngineProfiles';
import {
  buildSeoTitleFromHook,
  buildThumbnailPrompt,
  generateYoutubeMetaWithQA,
  pickBestSeoTitle,
} from '../src/lib/youtubeSafe';
import { allocateShotDurationsByMode } from '../src/lib/scriptMode';
import { MATRIX_THEMES, MATRIX_STYLES } from '../src/lib/matrixEngine/catalog';
import {
  buildMatrixWriteBlock,
  composeMatrixFromPayload,
} from '../src/lib/matrixEngine';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error('ASSERT FAIL: ' + msg);
}

console.log('=== smoke-style-engine-integration ===');

// ── 1) Exact SetupPhase labels must resolve ──────────────────────────
const setupCombos: Array<[string, string, string]> = [
  ['Linh Khí Khôi Phục', 'Tu Tiên / Tiên Hiệp', 'tu_tien'],
  ['Hệ Thống', 'Huyền Huyễn', 'tu_tien'],
  ['Trùng Sinh', 'Đô Thị', 'do_thi_va_mat'],
  ['Báo Thù', 'Đô Thị', 'do_thi_va_mat'],
  ['Sinh Tồn', 'Dystopia', 'mat_the_sinh_ton'],
  ['Game / Vô Hạn Lưu', 'Dystopia', 'mat_the_sinh_ton'],
  ['Kinh Dị', 'Huyền Nghi', 'kinh_di_huyen_nghi'],
  ['Trinh Thám', 'Thriller', 'kinh_di_huyen_nghi'],
  ['Cung Đấu', 'Cổ Đại', 'cung_dau_ngon_tinh'],
  ['Ngôn Tình', 'Romantasy', 'cung_dau_ngon_tinh'],
];
for (const [cd, pc, exp] of setupCombos) {
  const p = resolveStyleEngineProfile(cd, pc);
  assert(p?.id === exp, `combo ${cd}/${pc} expected ${exp} got ${p?.id}`);
  console.log('OK setup', cd, '+', pc, '→', exp);
}

// Labels live in matrixEngine/catalog (SetupPhase imports MATRIX_THEMES/STYLES)
const themeNames = new Set(MATRIX_THEMES.map((t) => t.name));
const styleNames = new Set(MATRIX_STYLES.map((s) => s.name));
for (const label of [
  'Tu Tiên / Tiên Hiệp',
  'Huyền Huyễn',
  'Đô Thị',
  'Dystopia',
  'Huyền Nghi',
  'Cổ Đại',
  'Romantasy',
  'Linh Khí Khôi Phục',
  'Trùng Sinh',
  'Sinh Tồn',
  'Kinh Dị',
  'Cung Đấu',
  'Ngôn Tình',
]) {
  const inCatalog = themeNames.has(label) || styleNames.has(label);
  assert(inCatalog, `MATRIX catalog has ${label}`);
}
// Every smoke combo must resolve both sides from live catalog
for (const [cd, pc] of setupCombos) {
  assert(themeNames.has(cd), `theme catalog ${cd}`);
  assert(styleNames.has(pc), `style catalog ${pc}`);
}
const setupSrc = readFileSync(
  join(process.cwd(), 'src/app/workspace/features/script/SetupPhase.tsx'),
  'utf8',
);
assert(setupSrc.includes('MATRIX_THEMES') && setupSrc.includes('MATRIX_STYLES'), 'Setup uses matrix catalog');
assert(setupSrc.includes('style-engine-chip'), 'UI chip data-testid');
assert(setupSrc.includes('activeStyleEngineId') || setupSrc.includes('resolveStyleEngineProfile'), 'UI style engine');
console.log('OK MATRIX catalog labels + SetupPhase chip wired');

// Handlers inject style engine
const chapterSrc = readFileSync(
  join(process.cwd(), 'src/app/api/generate/handlers/chapter.ts'),
  'utf8',
);
assert(chapterSrc.includes('buildStyleEngineWriteBlock'), 'chapter inject');
assert(chapterSrc.includes('buildMatrixWriteBlock'), 'chapter also injects matrix');
const sceneSrc = readFileSync(
  join(process.cwd(), 'src/app/api/generate/handlers/scene.ts'),
  'utf8',
);
assert(sceneSrc.includes('buildStyleEngineWriteBlock'), 'scene inject');
const outlineSrc = readFileSync(
  join(process.cwd(), 'src/app/api/generate/handlers/outline.ts'),
  'utf8',
);
assert(outlineSrc.includes('buildStyleEngineOutlineBlock'), 'outline inject');
const imgSrc = readFileSync(
  join(process.cwd(), 'src/app/api/generate/handlers/imagePrompt.ts'),
  'utf8',
);
assert(imgSrc.includes('styleShot'), 'imagePrompt styleShot');
const storySrc = readFileSync(
  join(process.cwd(), 'src/store/storyActions.ts'),
  'utf8',
);
assert(storySrc.includes('styleEngineMediaSoftPatch'), 'setSetup soft patch');
const writeSrc = readFileSync(
  join(process.cwd(), 'src/app/workspace/modules/writeModule.ts'),
  'utf8',
);
assert(writeSrc.includes('chu_de') && writeSrc.includes('phong_cach'), 'write sends setup');
console.log('OK source wiring (handlers + store + writeModule)');

// Coexist with Matrix Engine: both blocks non-empty for same Setup combo
const matrixComp = composeMatrixFromPayload({
  chu_de: 'Trùng Sinh',
  phong_cach: 'Đô Thị',
});
const matrixBlock = buildMatrixWriteBlock(matrixComp);
assert(matrixBlock.length > 50, 'matrix write block');
const styleBlock = buildStyleEngineWriteBlock(
  resolveStyleEngineProfile('Trùng Sinh', 'Đô Thị'),
  { scriptMode: 'sang_van' },
);
assert(styleBlock.includes('do_thi_va_mat') || styleBlock.includes('STYLE ENGINE'), 'style block with matrix coexists');
console.log('OK matrix+style coexist', {
  matrixBytes: matrixBlock.length,
  styleBytes: styleBlock.length,
});

// ── 2) Simulate setSetup soft-apply (mirrors storyActions) ───────────
type SimState = {
  setup: { chu_de: string; phong_cach: string };
  wpm: number;
  secondsPerBeat: number;
  visualDnaPrompt: string;
  mediaStylePreset: string;
  activeStyleEngineId: string | null;
  scriptMode: string;
};

function simSetSetup(prev: SimState, data: Partial<SimState['setup']>): SimState {
  const newSetup = { ...prev.setup, ...data };
  const profile = resolveStyleEngineProfile(newSetup.chu_de, newSetup.phong_cach);
  const soft = styleEngineMediaSoftPatch(profile, {
    wpm: prev.wpm,
    secondsPerBeat: prev.secondsPerBeat,
    visualDnaPrompt: prev.visualDnaPrompt,
    mediaStylePreset: prev.mediaStylePreset,
    activeStyleEngineId: prev.activeStyleEngineId,
    scriptMode: prev.scriptMode,
  });
  return {
    setup: newSetup,
    activeStyleEngineId:
      soft.activeStyleEngineId !== undefined
        ? soft.activeStyleEngineId
        : profile?.id ?? null,
    wpm: soft.wpm ?? prev.wpm,
    secondsPerBeat: soft.secondsPerBeat ?? prev.secondsPerBeat,
    visualDnaPrompt: soft.visualDnaPrompt ?? prev.visualDnaPrompt,
    mediaStylePreset: soft.mediaStylePreset ?? prev.mediaStylePreset,
    scriptMode: prev.scriptMode,
  };
}

let st: SimState = {
  setup: { chu_de: '', phong_cach: '' },
  wpm: 140,
  secondsPerBeat: 6,
  visualDnaPrompt: '',
  mediaStylePreset:
    'cinematic natural realism, grounded production design, expressive lighting, tactile materials, varied shot scale (wide medium close insert), no generic quality tags, no stock-photo look',
  activeStyleEngineId: null,
  scriptMode: 'sang_van',
};

st = simSetSetup(st, { chu_de: 'Trùng Sinh' });
assert(st.activeStyleEngineId === null, 'only chu_de Trùng Sinh → no match (score 1)');
st = simSetSetup(st, { phong_cach: 'Đô Thị' });
assert(st.activeStyleEngineId === 'do_thi_va_mat', 'after PC → do_thi');
assert(st.wpm === 160, `wpm 160 urban, got ${st.wpm}`);
assert(
  /urban|neon/i.test(st.visualDnaPrompt),
  'visual urban/neon',
);
console.log('OK setSetup soft', {
  id: st.activeStyleEngineId,
  wpm: st.wpm,
  beat: st.secondsPerBeat,
});

// ── 3) WRITE payload path (writeModule → chapter handler) ────────────
const writePayload = {
  chu_de: st.setup.chu_de,
  phong_cach: st.setup.phong_cach,
  genre: [st.setup.chu_de, st.setup.phong_cach].join(' / '),
  scriptMode: st.scriptMode,
};
const writeProf = resolveStyleEngineFromSetupPayload(writePayload);
assert(writeProf?.id === 'do_thi_va_mat', 'write payload resolve');
const writeBlock = buildStyleEngineWriteBlock(writeProf, {
  scriptMode: 'sang_van',
});
assert(writeBlock.includes('STYLE ENGINE'), 'write block header');
assert(writeBlock.includes('COLD OPEN'), 'cold open section');
assert(/160|WPM/i.test(writeBlock), 'wpm in block');
assert(
  writeBlock.length > 200 && writeBlock.length < 2500,
  `block size usable ${writeBlock.length}`,
);
assert(buildStyleEngineOutlineBlock(writeProf).includes('OUTLINE'), 'outline');
assert(
  buildStyleEngineShotHintBlock(writeProf, 'sang_van').includes('SHOT'),
  'shot hint',
);
console.log('OK write/outline/shot blocks', writeBlock.length, 'chars');

// ── 4) Shot durations with styleShot ─────────────────────────────────
const durs = allocateShotDurationsByMode({
  mode: 'sang_van',
  totalDurationSec: 24,
  count: 8,
  styleShot: { min: writeProf!.shotSecMin, max: writeProf!.shotSecMax },
});
assert(durs.reduce((a, b) => a + b, 0) === 24, 'duration sum 24');
assert(durs.length === 8, '8 shots');
console.log('OK shot durations', durs);

// ── 5) SEO CTR niche ─────────────────────────────────────────────────
const hook =
  'Cô ném đơn hủy hôn vào mặt hắn và chê hắn nghèo. Ba phút sau cả thành phố gọi hắn là Chủ tịch.';
const picked = pickBestSeoTitle(hook, 'Truyện Đô Thị', {
  seed: 42,
  chu_de: 'Trùng Sinh',
  phong_cach: 'Đô Thị',
  styleEngineId: 'do_thi_va_mat',
});
assert(picked.title.length >= 16 && picked.title.length <= 100, 'title length');
console.log('SEO pickBest', picked.title);

const cands = buildStyleCtrTitleCandidates(writeProf, hook);
assert(
  cands.some((t) => /hủy hôn|nghèo|chủ tịch|tỷ phú/i.test(t)),
  'ctr candidates urban motifs',
);

const titleFromStyle = buildSeoTitleFromHook(
  hook,
  'CHÊ TÔI NGHÈO?',
  'Truyện Đô Thị',
  {
    seed: 7,
    styleEngineId: 'do_thi_va_mat',
    chu_de: 'Trùng Sinh',
    phong_cach: 'Đô Thị',
  },
);
assert(titleFromStyle.length > 10, 'seo title non-empty');
console.log('SEO buildSeoTitleFromHook', titleFromStyle);

// ── 6) Full youtube meta with style ──────────────────────────────────
const meta = generateYoutubeMetaWithQA({
  script: `[CẢNH 1]\n${hook} Hắn mở app ngân hàng: 100 tỷ. Xe sang vây quanh.`,
  novelTitle: 'Truyện Đô Thị',
  visualDna: st.visualDnaPrompt,
  chapter: 1,
  maxRounds: 3,
  chu_de: 'Trùng Sinh',
  phong_cach: 'Đô Thị',
  styleEngineId: 'do_thi_va_mat',
});
assert(meta.seoTitle.length > 10, 'meta title');
assert(meta.thumbnailLine.length > 0, 'meta thumb line');
assert(meta.thumbnailPrompt.length > 80, 'meta thumb prompt');
assert(
  /STYLE ENGINE COMPOSITION|neon|urban|luxury/i.test(meta.thumbnailPrompt),
  'meta thumb has style cues',
);
console.log('META title', meta.seoTitle);
console.log('META thumb', meta.thumbnailLine);
console.log('META scores avg', meta.scores.average);
console.log('META prompt head', meta.thumbnailPrompt.slice(0, 140));

const tp = buildThumbnailPrompt({
  hook,
  thumbnailLine: 'CHÊ TÔI NGHÈO?',
  visualDna: st.visualDnaPrompt,
  styleEngine: { styleEngineId: 'do_thi_va_mat' },
});
assert(/STYLE ENGINE COMPOSITION|neon|urban/i.test(tp), 'thumb composition wired');
console.log('OK thumbnail style composition');

// ── 7) All 5 profiles × 3 scriptModes produce usable blocks ──────────
for (const p of STYLE_ENGINE_PROFILES) {
  for (const mode of ['chuyen_sau', 'sang_van', 'short_manhua'] as const) {
    const b = buildStyleEngineWriteBlock(p, { scriptMode: mode });
    assert(b.includes('STYLE ENGINE'), `${p.id} ${mode}`);
    if (mode === 'chuyen_sau') {
      assert(/KHÔNG \[CẢNH 0\]|TẮT/i.test(b), `${p.id} cold off`);
    }
    if (mode === 'short_manhua') {
      assert(/CẢNH 0|BẮT BUỘC/i.test(b), `${p.id} cold on`);
    }
  }
  const boost = styleEngineTitleScoreBoost(
    p.ctr.titlePatterns[0] || '',
    p,
  );
  assert(boost > 0, `${p.id} title motif boost`);
  console.log('OK profile modes', p.id, 'boost', boost.toFixed(2));
}

// ── 8) Switch profile re-applies ─────────────────────────────────────
st = simSetSetup(st, { chu_de: 'Kinh Dị', phong_cach: 'Huyền Nghi' });
assert(st.activeStyleEngineId === 'kinh_di_huyen_nghi', 'switch horror');
assert(st.wpm === 128, `horror wpm got ${st.wpm}`);
assert(/low-key|horror|fog/i.test(st.visualDnaPrompt), 'horror dna');
console.log('OK switch', st.activeStyleEngineId, st.wpm);

// Tu tiên from empty visual after switch
st = simSetSetup(st, {
  chu_de: 'Linh Khí Khôi Phục',
  phong_cach: 'Tu Tiên / Tiên Hiệp',
});
assert(st.activeStyleEngineId === 'tu_tien', 'switch tu_tien');
assert(st.wpm === 140, `tu_tien wpm ${st.wpm}`);
assert(/cultivation|qi|sword/i.test(st.visualDnaPrompt), 'tu_tien dna');
console.log('OK switch tu_tien', st.wpm, st.secondsPerBeat);

// ── 9) short_manhua does not force slow horror WPM ───────────────────
const horror = resolveStyleEngineProfile('Kinh Dị', 'Huyền Nghi')!;
const softShort = styleEngineMediaSoftPatch(horror, {
  wpm: 170,
  secondsPerBeat: 3.5,
  visualDnaPrompt: '',
  mediaStylePreset: '',
  scriptMode: 'short_manhua',
});
assert(softShort.wpm === undefined, 'short keeps 170 WPM');
console.log('OK short_manhua format WPM preserved');

console.log('INTEGRATION_STYLE_ENGINE_USABLE_OK');
