/**
 * Smoke: Style Engine Profiles — match Setup, soft patch, prompt/CTR blocks.
 * Run: npx tsx scripts/smoke-style-engine.mts
 */
import {
  STYLE_ENGINE_PROFILES,
  buildStyleCtrTitleCandidates,
  buildStyleEngineOutlineBlock,
  buildStyleEngineShotHintBlock,
  buildStyleEngineWriteBlock,
  getStyleEngineProfile,
  intersectShotBand,
  resolveStyleEngineFromSetupPayload,
  resolveStyleEngineProfile,
  styleEngineDefaultBeat,
  styleEngineMediaSoftPatch,
  styleEngineTitleScoreBoost,
} from '../src/lib/styleEngineProfiles';
import { allocateShotDurationsByMode } from '../src/lib/scriptMode';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error('ASSERT FAIL: ' + msg);
}

console.log('=== smoke-style-engine ===');
console.log('profiles', STYLE_ENGINE_PROFILES.length);
assert(STYLE_ENGINE_PROFILES.length === 5, 'exactly 5 profiles');

const cases: Array<{
  chu: string;
  phong: string;
  expect: string | null;
}> = [
  { chu: 'Linh Khí Khôi Phục', phong: 'Tu Tiên / Tiên Hiệp', expect: 'tu_tien' },
  { chu: 'Trùng Sinh', phong: 'Đô Thị', expect: 'do_thi_va_mat' },
  { chu: 'Sinh Tồn', phong: 'Dystopia', expect: 'mat_the_sinh_ton' },
  { chu: 'Kinh Dị', phong: 'Huyền Nghi', expect: 'kinh_di_huyen_nghi' },
  { chu: 'Cung Đấu', phong: 'Cổ Đại', expect: 'cung_dau_ngon_tinh' },
  // PC-only strong
  { chu: '', phong: 'Huyền Huyễn', expect: 'tu_tien' },
  { chu: '', phong: 'Thriller', expect: 'kinh_di_huyen_nghi' },
  // No match
  { chu: 'Hài Hước', phong: 'Slice of Life', expect: null },
  { chu: 'Trùng Sinh', phong: '', expect: null }, // score 1 only
  { chu: 'Ẩm Thực', phong: 'Hard Sci-Fi', expect: null },
];

for (const c of cases) {
  const p = resolveStyleEngineProfile(c.chu, c.phong);
  const id = p?.id ?? null;
  console.log(`match "${c.chu}" / "${c.phong}" → ${id}`);
  assert(id === c.expect, `expected ${c.expect} got ${id}`);
}

// Genre string path
const fromGenre = resolveStyleEngineFromSetupPayload({
  genre: 'Cung Đấu / Cổ Đại',
});
assert(fromGenre?.id === 'cung_dau_ngon_tinh', 'genre slash resolve');

// Soft patch: empty visual → fill; wpm out of band → set
const tu = getStyleEngineProfile('tu_tien')!;
const soft1 = styleEngineMediaSoftPatch(tu, {
  wpm: 200,
  secondsPerBeat: 8,
  visualDnaPrompt: '',
  mediaStylePreset:
    'cinematic natural realism, grounded production design, expressive lighting, tactile materials, varied shot scale (wide medium close insert), no generic quality tags, no stock-photo look',
  activeStyleEngineId: null,
  scriptMode: 'chuyen_sau',
});
console.log('soft tu_tien', soft1);
assert(soft1.wpm === 140, 'wpm soft 140');
assert(soft1.secondsPerBeat === styleEngineDefaultBeat(tu), 'beat mid');
assert(!!soft1.visualDnaPrompt && soft1.visualDnaPrompt.includes('cultivation'), 'dna');
assert(soft1.activeStyleEngineId === 'tu_tien', 'id set');

// Soft: wpm already in band → no stomp
const soft2 = styleEngineMediaSoftPatch(tu, {
  wpm: 142,
  secondsPerBeat: 4.2,
  visualDnaPrompt: 'user custom dna that must stay',
  mediaStylePreset: 'user custom preset',
  activeStyleEngineId: 'tu_tien',
  scriptMode: 'chuyen_sau',
});
assert(soft2.wpm === undefined, 'keep in-band wpm');
assert(soft2.visualDnaPrompt === undefined, 'keep custom dna');
assert(soft2.mediaStylePreset === undefined, 'keep custom preset');

// short_manhua: do not force slow WPM
const soft3 = styleEngineMediaSoftPatch(
  getStyleEngineProfile('kinh_di_huyen_nghi')!,
  {
    wpm: 170,
    secondsPerBeat: 3.5,
    visualDnaPrompt: '',
    mediaStylePreset: '',
    scriptMode: 'short_manhua',
  },
);
assert(soft3.wpm === undefined, 'short keeps format WPM');

// Write blocks
const wb = buildStyleEngineWriteBlock(tu, { scriptMode: 'sang_van' });
assert(wb.includes('STYLE ENGINE'), 'write block');
assert(wb.includes('Tu Tiên') || wb.includes('tu_tien'), 'label in block');
assert(wb.includes('COLD OPEN'), 'cold open section');
const wbOff = buildStyleEngineWriteBlock(tu, { scriptMode: 'chuyen_sau' });
assert(wbOff.includes('TẮT') || wbOff.includes('KHÔNG [CẢNH 0]'), 'cold off');

const ob = buildStyleEngineOutlineBlock(tu);
assert(ob.includes('OUTLINE'), 'outline block');

const sb = buildStyleEngineShotHintBlock(tu, 'sang_van');
assert(sb.includes('SHOT'), 'shot hint');

// Intersect band: sang_van 3.5–5.5 ∩ tu 3.5–5.0 → 3.5–5.0
const band = intersectShotBand('sang_van', tu);
console.log('intersect sang_van × tu_tien', band);
assert(band.min === 3.5 && band.max === 5.0, 'intersect band');

// allocate with styleShot
const durs = allocateShotDurationsByMode({
  mode: 'sang_van',
  totalDurationSec: 20,
  count: 5,
  styleShot: { min: tu.shotSecMin, max: tu.shotSecMax },
});
const sum = durs.reduce((a, b) => a + b, 0);
console.log('durations', durs, 'sum', sum);
assert(sum === 20, 'duration sum');
assert(durs.length === 5, 'count 5');

// CTR
const titles = buildStyleCtrTitleCandidates(tu, 'Linh căn phế vật thức tỉnh');
assert(titles.length >= 3, 'ctr titles');
const boost = styleEngineTitleScoreBoost(
  'Chê Hắn Linh Căn Phế Vật Rút Thần Kiếm Lão Tổ',
  tu,
);
console.log('title boost', boost);
assert(boost > 0.5, 'motif boost');
assert(styleEngineTitleScoreBoost('mưa rơi trên phố dài', tu) === 0, 'no boost');

// NFC
assert(tu.coldOpen.sampleHookLine.normalize('NFC') === tu.coldOpen.sampleHookLine, 'nfc');

console.log('SMOKE_STYLE_ENGINE_OK');
