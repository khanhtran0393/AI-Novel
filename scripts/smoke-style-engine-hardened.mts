/**
 * Hardened adversarial smoke — Style Engine residual bugs.
 * Run: npx tsx scripts/smoke-style-engine-hardened.mts
 */
import {
  STYLE_ENGINE_PROFILES,
  resolveStyleEngineProfile,
  styleEngineMediaSoftPatch,
  buildStyleEngineWriteBlock,
  resolveStyleEngineFromSetupPayload,
  intersectShotBand,
  styleEngineTitleScoreBoost,
  getStyleEngineProfile,
} from '../src/lib/styleEngineProfiles';
import { allocateShotDurationsByMode, SCRIPT_MODES } from '../src/lib/scriptMode';
import { MATRIX_THEMES, MATRIX_STYLES } from '../src/lib/matrixEngine/catalog';
import {
  buildMatrixWriteBlock,
  composeMatrixFromPayload,
} from '../src/lib/matrixEngine';
import { pickBestSeoTitle, generateYoutubeMetaWithQA } from '../src/lib/youtubeSafe';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function assert(c: boolean, m: string): void {
  if (!c) throw new Error('ASSERT FAIL: ' + m);
}

let checks = 0;
function ok(m: string): void {
  checks++;
  console.log('  ✓', m);
}

console.log('=== smoke-style-engine-hardened ===');

// ── 1) NFC / spacing / case match ────────────────────────────────────
const nfcCases: Array<[string, string, string]> = [
  ['Linh Khí Khôi Phục', 'Tu Tiên / Tiên Hiệp', 'tu_tien'],
  ['linh khí khôi phục', 'tu tiên / tiên hiệp', 'tu_tien'], // lower
  ['  Trùng Sinh  ', '  Đô Thị  ', 'do_thi_va_mat'], // trim
  ['Kinh Dị', 'Thriller', 'kinh_di_huyen_nghi'],
  ['Cung Đấu', 'Romantasy', 'cung_dau_ngon_tinh'],
];
for (const [cd, pc, exp] of nfcCases) {
  const p = resolveStyleEngineProfile(cd, pc);
  assert(p?.id === exp, `nfc ${cd}/${pc} → ${p?.id} want ${exp}`);
}
ok(`NFC/case/trim match (${nfcCases.length})`);

// ── 2) No false positives on non-hot combos ──────────────────────────
const noMatch: Array<[string, string]> = [
  ['Hài Hước', 'Slice of Life'],
  ['Ẩm Thực', 'Hard Sci-Fi'],
  ['Học Đường', 'Western'],
  ['Thể Thao', 'Steampunk'],
  ['', ''],
  ['Trùng Sinh', ''], // score 1 only
  ['', 'Viễn Tưởng'], // PC not in 5 profiles
];
for (const [cd, pc] of noMatch) {
  const p = resolveStyleEngineProfile(cd, pc);
  assert(p === null, `false positive ${cd}/${pc} → ${p?.id}`);
}
ok(`no false positives (${noMatch.length})`);

// ── 3) Full catalog: every MATRIX theme×style that hits alias must resolve ─
// Strong PC alone (≥2) or PC+CD
let hit = 0;
let miss = 0;
for (const t of MATRIX_THEMES) {
  for (const s of MATRIX_STYLES) {
    const p = resolveStyleEngineProfile(t.name, s.name);
    if (p) hit++;
    else miss++;
  }
}
assert(hit >= 40, `expected many hot hits, got ${hit}`);
assert(hit + miss === MATRIX_THEMES.length * MATRIX_STYLES.length, 'full matrix scan');
ok(`catalog scan hit=${hit} miss=${miss} total=${hit + miss}`);

// ── 4) Soft patch: clear engine when unmatch; no crash ───────────────
const softNull = styleEngineMediaSoftPatch(null, {
  wpm: 160,
  secondsPerBeat: 3,
  visualDnaPrompt: 'keep me',
  mediaStylePreset: 'keep preset',
  activeStyleEngineId: 'do_thi_va_mat',
  scriptMode: 'sang_van',
});
assert(softNull.activeStyleEngineId === null, 'clear id on null profile');
assert(softNull.wpm === undefined, 'null profile does not stomp wpm');
ok('soft null clears id only');

// Soft: custom DNA preserved when switching profile
const horror = getStyleEngineProfile('kinh_di_huyen_nghi')!;
const softKeep = styleEngineMediaSoftPatch(horror, {
  wpm: 127,
  secondsPerBeat: 6,
  visualDnaPrompt: 'USER LOCKED DNA CUSTOM',
  mediaStylePreset: 'USER LOCKED PRESET',
  activeStyleEngineId: 'tu_tien',
  scriptMode: 'chuyen_sau',
});
assert(softKeep.visualDnaPrompt === undefined, 'custom dna not overwritten');
assert(softKeep.mediaStylePreset === undefined, 'custom preset not overwritten');
assert(softKeep.activeStyleEngineId === 'kinh_di_huyen_nghi', 'id switches');
ok('soft preserves custom DNA on profile switch');

// ── 5) allocateShotDurations — exact sum for all 5 × 3 modes × totals ─
const totals = [12, 20, 24, 30, 48, 60];
const counts = [3, 5, 8, 12];
for (const p of STYLE_ENGINE_PROFILES) {
  for (const mode of SCRIPT_MODES) {
    for (const total of totals) {
      for (const count of counts) {
        const durs = allocateShotDurationsByMode({
          mode,
          totalDurationSec: total,
          count,
          styleShot: { min: p.shotSecMin, max: p.shotSecMax },
        });
        const sum = durs.reduce((a, b) => a + b, 0);
        assert(sum === total, `sum ${p.id} ${mode} total=${total} n=${count} got ${sum} durs=${durs}`);
        assert(durs.length === count, 'count');
        assert(durs.every((d) => d >= 1), 'each ≥1');
      }
    }
  }
}
ok(
  `duration sum exact (${STYLE_ENGINE_PROFILES.length}×${SCRIPT_MODES.length}×${totals.length}×${counts.length})`,
);

// Hard-fail missing total
let threw = false;
try {
  allocateShotDurationsByMode({ mode: 'sang_van', totalDurationSec: 0, count: 4 });
} catch {
  threw = true;
}
assert(threw, 'B10 hard-fail total=0');
ok('B10 duration hard-fail');

// ── 6) Intersect band never inverted ─────────────────────────────────
for (const p of STYLE_ENGINE_PROFILES) {
  for (const mode of SCRIPT_MODES) {
    const b = intersectShotBand(mode, p);
    assert(b.min <= b.max, `band ${p.id} ${mode}`);
    assert(b.min >= 1, 'min≥1');
  }
}
ok('intersect bands valid');

// ── 7) WRITE blocks all modes + continue ─────────────────────────────
for (const p of STYLE_ENGINE_PROFILES) {
  for (const mode of SCRIPT_MODES) {
    const b = buildStyleEngineWriteBlock(p, { scriptMode: mode });
    assert(b.includes('STYLE ENGINE'), p.id + mode);
    assert(b.normalize('NFC') === b, 'NFC block');
    const cont = buildStyleEngineWriteBlock(p, {
      scriptMode: mode,
      isContinue: true,
    });
    assert(cont.includes('CONTINUE'), 'continue');
    assert(!cont.includes('[CẢNH 0]'), 'continue no CẢNH 0 force');
  }
}
ok('write blocks all profiles×modes + continue');

// ── 8) Payload resolve paths ─────────────────────────────────────────
assert(
  resolveStyleEngineFromSetupPayload({
    chu_de: 'Sinh Tồn',
    phong_cach: 'Dystopia',
  })?.id === 'mat_the_sinh_ton',
  'payload fields',
);
assert(
  resolveStyleEngineFromSetupPayload({
    genre: 'Cung Đấu / Cổ Đại',
  })?.id === 'cung_dau_ngon_tinh',
  'genre slash',
);
assert(resolveStyleEngineFromSetupPayload({}) === null, 'empty payload');
ok('payload resolve paths');

// ── 9) SEO + meta for each of 5 niches ───────────────────────────────
const seoHooks: Record<string, string> = {
  tu_tien:
    'Hắn rút thần kiếm. Linh căn phế vật thức tỉnh. Lão tổ quỳ xin tha mạng dưới thiên kiếp.',
  do_thi_va_mat:
    'Cô hủy hôn vì nghèo. Ba phút sau cả thành phố gọi hắn chủ tịch. 100 tỷ trong tài khoản.',
  mat_the_sinh_ton:
    'Còi mạt thế. Hắn trùng sinh tích trữ mười triệu tấn vật tư. Zombie vây pháo đài.',
  kinh_di_huyen_nghi:
    'Quy tắc thứ ba: đừng mở cửa lúc 2 giờ đêm. Ai vi phạm không trở về khách sạn.',
  cung_dau_ngon_tinh:
    'Đêm ban rượu độc. Nàng trọng sinh trả nợ máu. Phượng bào nữ đế dẫm lên ngai vàng.',
};
for (const p of STYLE_ENGINE_PROFILES) {
  const hook = seoHooks[p.id];
  const title = pickBestSeoTitle(hook, 'Test Series', {
    seed: 11,
    styleEngineId: p.id,
    chu_de: p.match.chu_de[0],
    phong_cach: p.match.phong_cach[0],
  });
  assert(title.title.length >= 12 && title.title.length <= 100, `seo ${p.id}`);
  const boost = styleEngineTitleScoreBoost(p.ctr.titlePatterns[0], p);
  assert(boost > 0, `boost ${p.id}`);

  const dna = p.visual.visualDnaEn;
  const meta = generateYoutubeMetaWithQA({
    script: `[CẢNH 1]\n${hook}`,
    novelTitle: 'Test',
    visualDna: dna,
    maxRounds: 2,
    styleEngineId: p.id,
    chu_de: p.match.chu_de[0],
    phong_cach: p.match.phong_cach[0],
  });
  assert(meta.seoTitle.length > 10, `meta title ${p.id}`);
  assert(meta.thumbnailPrompt.length > 40, `meta prompt ${p.id}`);
}
ok('SEO+meta all 5 niches');

// ── 10) Matrix coexist no empty / crash ──────────────────────────────
for (const [cd, pc] of [
  ['Trùng Sinh', 'Đô Thị'],
  ['Linh Khí Khôi Phục', 'Tu Tiên / Tiên Hiệp'],
  ['Kinh Dị', 'Huyền Nghi'],
] as const) {
  const m = buildMatrixWriteBlock(
    composeMatrixFromPayload({ chu_de: cd, phong_cach: pc }),
  );
  const s = buildStyleEngineWriteBlock(resolveStyleEngineProfile(cd, pc), {
    scriptMode: 'sang_van',
  });
  assert(m.length > 40 && s.length > 40, `coexist ${cd}`);
}
ok('matrix+style coexist samples');

// ── 11) Source wiring still intact ───────────────────────────────────
const files = [
  ['src/store/storyActions.ts', 'styleEngineMediaSoftPatch'],
  ['src/app/api/generate/handlers/chapter.ts', 'buildStyleEngineWriteBlock'],
  ['src/app/api/generate/handlers/scene.ts', 'buildStyleEngineWriteBlock'],
  ['src/app/api/generate/handlers/outline.ts', 'buildStyleEngineOutlineBlock'],
  ['src/app/api/generate/handlers/imagePrompt.ts', 'styleShot'],
  ['src/app/workspace/features/script/SetupPhase.tsx', 'style-engine-chip'],
  ['src/app/workspace/modules/writeModule.ts', 'chu_de'],
  ['src/lib/youtube-safe/seoMeta.ts', 'buildStyleCtrTitleCandidates'],
];
for (const [f, needle] of files) {
  const src = readFileSync(join(process.cwd(), f), 'utf8');
  assert(src.includes(needle), `${f} has ${needle}`);
}
ok('source wiring intact');

// ── 12) Initial state has field ──────────────────────────────────────
const init = readFileSync(
  join(process.cwd(), 'src/store/novelInitialState.ts'),
  'utf8',
);
assert(init.includes('activeStyleEngineId: null'), 'initial null');
ok('store initial activeStyleEngineId');

console.log(`HARDENED_STYLE_ENGINE_OK · checks=${checks}`);
