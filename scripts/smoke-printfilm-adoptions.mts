/**
 * Smoke: Printfilm adoptions P1–P3 pure helpers.
 * Run: npx tsx scripts/smoke-printfilm-adoptions.mts
 */
import assert from 'node:assert/strict';
import {
  characterWardrobeImageKey,
  sceneLocationImageKey,
} from '../src/contracts/keys';
import {
  emptyNhanVatProfile,
  getActiveWardrobe,
  normalizeNhanVatProfile,
  buildIdentityLockEnglish,
  composeWardrobeSheetPrompt,
} from '../src/lib/characterProfile';
import {
  computeProjectProgress,
  resolveVideoKeyframeRange,
} from '../src/lib/projectProgress';
import {
  composeSceneLocationPrompt,
  emptySceneLocation,
  normalizeSceneLocationAssets,
} from '../src/lib/sceneLocationLibrary';
import { resolveFirstLastModel } from '../src/lib/flow-bridge/modelCatalog';
import { buildProseCraftBlock } from '../src/lib/storyWriting';
import {
  allocateShotDurationsByMode,
  buildScriptModeColdOpenBlock,
  buildScriptModePacingBlock,
  buildScriptModeShotRhythmBlock,
  buildShortManhuaImagePromptBlock,
  buildShortManhuaOutlineBlock,
  buildShortManhuaSceneBlock,
  getScriptModePacing,
  isShortManhuaMode,
  minScenesForScriptMode,
  normalizeScriptMode,
  scriptModeMediaSoftPatch,
  shortManhuaMediaSoftPatch,
  shortManhuaQualityHints,
  SHORT_MANHUA_RECOMMENDED_WORDS,
  SHORT_MANHUA_SECONDS_PER_BEAT,
  shouldNudgeWordGoalForShortManhua,
} from '../src/lib/scriptMode';

// P1 wardrobe
const raw = normalizeNhanVatProfile({
  ...emptyNhanVatProfile(),
  quan_ao: 'Áo đen',
  wardrobe_variants: [
    {
      id: 'battle',
      name: 'Chiến đấu',
      description: 'giáp da, kiếm lưng',
      visualPrompt: 'leather armor, sword on back',
    },
  ],
  active_wardrobe_id: 'battle',
});
assert.equal(raw.wardrobe_variants?.length, 1);
assert.equal(getActiveWardrobe(raw)?.id, 'battle');
const lock = buildIdentityLockEnglish(raw);
assert.match(lock, /Active wardrobe/i);
assert.match(lock, /leather armor/i);
assert.equal(
  characterWardrobeImageKey('Hàn Dực', 'battle'),
  'char_Hàn Dực_wardrobe_battle',
);
assert.equal(sceneLocationImageKey('Phố mưa'), 'loc_Phố mưa');

// P2 keyframe range
const dual = resolveVideoKeyframeRange({
  promptIndex: 1,
  promptsLen: 4,
  useEndFrame: true,
  endImageKey: '3_2_2',
  chapter: 3,
  sceneIndex: 2,
});
assert.equal(dual.startPromptIndex, 1);
assert.equal(dual.endPromptIndex, 2);
assert.equal(dual.dualFrame, true);

const edge = resolveVideoKeyframeRange({
  promptIndex: 0,
  promptsLen: 3,
  useEndFrame: false,
  chapter: 1,
  sceneIndex: 0,
});
assert.equal(edge.startPromptIndex, 0);
assert.equal(edge.endPromptIndex, 0);
assert.equal(edge.dualFrame, false);

// Flow / modern: middle shot is single clip (NOT silent prev→current dual)
const middleSingle = resolveVideoKeyframeRange({
  promptIndex: 1,
  promptsLen: 4,
  useEndFrame: false,
  chapter: 1,
  sceneIndex: 0,
  singleClipPerPrompt: true,
});
assert.equal(middleSingle.startPromptIndex, 1);
assert.equal(middleSingle.endPromptIndex, 1);
assert.equal(middleSingle.dualFrame, false);

// Legacy non-Flow: middle = prev→current interpol
const middleLegacy = resolveVideoKeyframeRange({
  promptIndex: 1,
  promptsLen: 4,
  useEndFrame: false,
  chapter: 1,
  sceneIndex: 0,
  singleClipPerPrompt: false,
});
assert.equal(middleLegacy.startPromptIndex, 0);
assert.equal(middleLegacy.endPromptIndex, 1);
assert.equal(middleLegacy.dualFrame, true);

// P3 progress
const empty = computeProjectProgress({});
assert.equal(empty.doneCount, 0);
assert.equal(empty.total, 8);

const mid = computeProjectProgress({
  setup: { chu_de: 'Kỳ ảo', phong_cach: 'Sáng' },
  dan_y_tong_the: 'A long enough outline for the project progress test.',
  danh_sach_chuong: [
    { so_chuong: 1, noi_dung: 'x'.repeat(250), trang_thai: 'ready' },
  ],
  generatedAudioPaths: { '1_0': { path: '/tmp/a.mp3', duration: 12 } },
  generatedPrompts: { '1_0': [{ timestamp: '0-5s', prompt: 'p' }] },
  generatedImages: { '1_0_0': '/tmp/i.png' },
});
assert.ok(mid.doneCount >= 5, `expected ≥5 done, got ${mid.doneCount}`);
assert.ok(mid.steps.find((s) => s.id === 'setup')?.done);
assert.ok(mid.steps.find((s) => s.id === 'write')?.done);
assert.ok(mid.steps.find((s) => s.id === 'tts')?.done);

// Wardrobe sheet prompt
const wPrompt = composeWardrobeSheetPrompt(
  raw,
  raw.wardrobe_variants![0],
  'Hàn Dực',
);
assert.match(wPrompt, /wardrobe/i);
assert.match(wPrompt, /leather armor/i);

// Scene location library
const loc = emptySceneLocation({
  name: 'Phố mưa',
  atmosphere: 'đêm',
  visualPrompt: 'neon wet asphalt',
});
assert.equal(loc.image_key, 'loc_Phố mưa');
const locPrompt = composeSceneLocationPrompt(loc, 'cinematic teal');
assert.match(locPrompt, /Phố mưa/);
assert.match(locPrompt, /no people/i);
assert.equal(normalizeSceneLocationAssets([loc, null as never]).length, 1);

// Flow FL sibling (not provider swap)
const fl = resolveFirstLastModel('veo_3_1_i2v_s_fast', true);
assert.equal(fl, 'veo_3_1_i2v_s_fast_fl');
assert.equal(
  resolveFirstLastModel('veo_3_1_i2v_s_fast', false),
  'veo_3_1_i2v_s_fast',
);

// P5 short / manhua script mode
assert.equal(normalizeScriptMode('short_manhua'), 'short_manhua');
assert.equal(normalizeScriptMode('nope'), 'chuyen_sau');
const craft = buildProseCraftBlock('short_manhua');
assert.match(craft, /SHORT \/ MANHUA/i);
assert.match(craft, /SHOT-THINKING|nhìn được/i);
assert.match(craft, /\[CẢNH/i);
const outlineHint = buildShortManhuaOutlineBlock(10);
assert.match(outlineHint, /tập short/i);
assert.equal(SHORT_MANHUA_RECOMMENDED_WORDS, 1200);
assert.equal(shouldNudgeWordGoalForShortManhua(4250), true);
assert.equal(shouldNudgeWordGoalForShortManhua(900), false);
assert.equal(minScenesForScriptMode('short_manhua'), 4);
assert.equal(minScenesForScriptMode('chuyen_sau'), 3);
assert.ok(isShortManhuaMode('short_manhua'));
assert.match(buildShortManhuaSceneBlock('expand'), /SHORT \/ MANHUA/i);
assert.match(buildShortManhuaImagePromptBlock(), /GEN PROMPT SHOT/i);
const soft = shortManhuaMediaSoftPatch({
  so_tu_chuong: 4250,
  secondsPerBeat: 6,
  videoDuration: 8,
  wpm: 140,
});
assert.equal(soft.so_tu_chuong, 1200);
assert.equal(soft.secondsPerBeat, SHORT_MANHUA_SECONDS_PER_BEAT);
assert.equal(soft.videoDuration, 6);
assert.equal(soft.wpm, 170);
const hints = shortManhuaQualityHints(
  '[CẢNH 1: NGOẠI. PHỐ - ĐÊM]\nHắn đứng im.\n[CẢNH 2: NỘI. PHÒNG - ĐÊM]\nCô im lặng.',
);
assert.ok(Array.isArray(hints));
assert.ok(hints.some((h) => h.code === 'short_missing_cold_open'));

// Pacing presets per Phong Cách Kịch Bản
assert.equal(getScriptModePacing('chuyen_sau').coldOpen, 'off');
assert.equal(getScriptModePacing('sang_van').coldOpen, 'soft');
assert.equal(getScriptModePacing('short_manhua').coldOpen, 'on');
assert.equal(getScriptModePacing('chuyen_sau').wpm, 130);
assert.equal(getScriptModePacing('sang_van').wpm, 155);
assert.match(buildScriptModeColdOpenBlock('short_manhua'), /CẢNH 0/i);
assert.equal(buildScriptModeColdOpenBlock('short_manhua', { isContinue: true }), '');
assert.match(buildScriptModeColdOpenBlock('chuyen_sau'), /TẮT/i);
assert.match(buildScriptModePacingBlock('sang_van'), /155/);
assert.match(buildScriptModeShotRhythmBlock('short_manhua'), /2\.5/i);

const softSang = scriptModeMediaSoftPatch('sang_van', {
  so_tu_chuong: 3000,
  secondsPerBeat: 7,
  videoDuration: 8,
  wpm: 130,
});
assert.equal(softSang.secondsPerBeat, 4.5);
assert.equal(softSang.wpm, 155);

const softDeep = scriptModeMediaSoftPatch('chuyen_sau', {
  secondsPerBeat: 3.5,
  videoDuration: 6,
  wpm: 170,
});
assert.equal(softDeep.secondsPerBeat, 7);
assert.equal(softDeep.wpm, 130);

const dursShort = allocateShotDurationsByMode({
  mode: 'short_manhua',
  totalDurationSec: 30,
  count: 6,
  emotions: ['action', 'calm', 'fight', 'dialogue', 'shock', 'calm'],
  sentences: ['đánh', 'đứng im', 'đuổi', 'nói', 'nổ', 'nhìn'],
});
assert.equal(dursShort.length, 6);
assert.equal(
  dursShort.reduce((a, b) => a + b, 0),
  30,
);
const dursDeep = allocateShotDurationsByMode({
  mode: 'chuyen_sau',
  totalDurationSec: 42,
  count: 6,
});
assert.equal(dursDeep.reduce((a, b) => a + b, 0), 42);

console.log('[smoke-printfilm-adoptions] PASS');
console.log(
  JSON.stringify(
    {
      wardrobe: getActiveWardrobe(raw)?.name,
      dualFrame: dual.dualFrame,
      progress: `${mid.doneCount}/${mid.total}`,
      flModel: fl,
      locKey: loc.image_key,
      scriptMode: 'short_manhua',
      wordsHint: SHORT_MANHUA_RECOMMENDED_WORDS,
      minScenes: minScenesForScriptMode('short_manhua'),
      softMedia: soft,
      softSang,
      softDeep,
      dursShort,
      pacing: {
        deep: getScriptModePacing('chuyen_sau').coldOpen,
        sang: getScriptModePacing('sang_van').coldOpen,
        short: getScriptModePacing('short_manhua').coldOpen,
      },
    },
    null,
    2,
  ),
);
