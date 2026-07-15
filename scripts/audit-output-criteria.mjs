/**
 * Audit: mọi đầu mục đầu ra có đạt chỉ tiêu không.
 * Run: npx tsx scripts/audit-output-criteria.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const {
  evaluateWordGate,
  getWordCount,
  parseScenes,
  countSceneTags,
  DEFAULT_WORD_GOAL,
} = await import('../src/lib/storyWriting.ts');
const {
  generateYoutubeMetaWithQA,
  scoreYoutubeMetaFields,
  YOUTUBE_META_PASS_SCORE,
  buildClickThumbnailLine,
  extractHookFromScript,
  enforceShotGraphOnPrompts,
} = await import('../src/lib/youtubeSafe.ts');
const { applyDirectorFormulasToPromptPair } = await import(
  '../src/lib/integrations/seedance.ts'
);
const { createChannelProfile } = await import('../src/lib/channelModel.ts');
const { buildShipPack } = await import('../src/lib/shipPack.ts');
const { evaluatePublishReadiness } = await import('../src/lib/publishReadiness.ts');
const {
  mergeLiveSettingsIntoChannel,
  resolveOutputCriteria,
  evaluateSettingsAsCriteria,
  toCapCutAspect,
} = await import('../src/lib/outputCriteria.ts');

let hard = 0;
let soft = 0;
const lines = [];

function hardCheck(name, pass, detail = '') {
  if (!pass) hard++;
  const row = `${pass ? 'PASS' : 'HARD'}  ${name}${detail ? ' — ' + detail : ''}`;
  lines.push(row);
  console.log(row);
}
function softCheck(name, pass, detail = '') {
  if (!pass) soft++;
  const row = `${pass ? 'PASS' : 'SOFT'}  ${name}${detail ? ' — ' + detail : ''}`;
  lines.push(row);
  console.log(row);
}

const SCRIPT = `[CẢNH 1: Hầm tối]
Hàn Dực đặt tay lên tường đá ẩm. Lớp rêu lạnh dính vào lòng bàn tay. Tiếng nước nhỏ giọt đếm nhịp trong tối. Bỗng vết nứt trên tường cổ nở ra, ánh sáng lạnh tràn vào như lưỡi dao. Hắn lùi nửa bước — sau lưng còn tiếng chân thứ hai, không phải của hắn. Mùi sắt tanh nổi lên từ khe đá, thấm vào từng hơi thở. Hắn siết chặt mảnh kim loại trong túi — manh mối cuối cùng từ bức tường cổ, và không ai biết cánh cửa sẽ khép khi nào.

[CẢNH 2: Hành lang sụp]
Không ai kịp gọi tên. Liễu Yên níu cổ tay hắn nhưng không nói một lời. Cả hai biết nếu đứng thêm một giây, cánh cửa đá sẽ khép và chôn họ dưới lòng đất. Tiếng nứt lan dài như sợi chỉ đứt. Bụi đá rơi lộp bộp lên vai. Hắn kéo nàng chạy — phía trước chỉ còn một khe sáng hẹp.

[CẢNH 3: Giếng cổ]
Họ lao xuống giếng đá. Nước đen ngắt phản chiếu mặt Hàn Dực méo mó. Ở đáy, một dấu khắc hình mắt mở ra. Liễu Yên thì thầm: đây không phải giếng — đây là miệng một thứ đang thức.`.normalize('NFC');

// ── 1) Word-gate / scene ──────────────────────────────────────
console.log('\n=== 1. Word-gate & Scene tags ===');
const scenes = parseScenes(SCRIPT);
const sceneTags = countSceneTags(SCRIPT);
hardCheck('parseScenes ≥3', scenes.length >= 3, `n=${scenes.length}`);
hardCheck('countSceneTags ≥3', sceneTags >= 3, `n=${sceneTags}`);
hardCheck('NFC preserved', SCRIPT === SCRIPT.normalize('NFC'));

const padded = (SCRIPT + ' ' + 'chi tiết '.repeat(4200)).normalize('NFC');
const gateOk = evaluateWordGate(padded, DEFAULT_WORD_GOAL);
hardCheck(
  'word-gate 92% of 4250',
  gateOk.wordsOk && gateOk.wordMin === Math.round(4250 * 0.92),
  `${gateOk.wordCount}/${gateOk.wordGoal} min=${gateOk.wordMin}`,
);
const gateFail = evaluateWordGate('ngắn quá', 4250);
hardCheck('word-gate fails short text', !gateFail.wordsOk);

// Ship pack must honor so_tu_chuong (not hardcode 4250)
const customGoal = 2000;
const packGoalProbe = buildShipPack({
  channel: createChannelProfile('Probe Goal', { niche: 'Horror', defaultShipMode: 'radio' }),
  mode: 'radio',
  ten_tac_pham: 'Probe',
  chapter: {
    so_chuong: 1,
    tieu_de: 'P',
    dan_y: '',
    noi_dung: SCRIPT,
  },
  so_tu_chuong: customGoal,
  generatedAudioPaths: { '1_0': { path: 'public/audio/demo.mp3', duration: 12 } },
});
hardCheck(
  'ship pack wordGoal uses so_tu_chuong',
  packGoalProbe.manifest?.quality?.wordGate?.wordGoal === customGoal &&
    packGoalProbe.manifest?.quality?.wordGate?.wordMin === Math.round(customGoal * 0.92),
  `goal=${packGoalProbe.manifest?.quality?.wordGate?.wordGoal} min=${packGoalProbe.manifest?.quality?.wordGate?.wordMin}`,
);

// ── 2) YouTube SEO meta ───────────────────────────────────────
console.log('\n=== 2. YouTube SEO Meta (score ≥8.5) ===');
const meta = generateYoutubeMetaWithQA({
  script: SCRIPT,
  novelTitle: 'Tiếng Vọng Tường Cổ',
  chapter: 1,
  maxRounds: 5,
});
hardCheck('title ≤100', meta.seoTitle.length <= 100, String(meta.seoTitle.length));
hardCheck('thumb ≤30', meta.thumbnailLine.length <= 30, `"${meta.thumbnailLine}"`);
hardCheck('hook ≥40', meta.hook.length >= 40, String(meta.hook.length));
hardCheck(
  'NO double-why',
  !/tại\s+sao[\s\S]{0,40}vì\s+sao/i.test(meta.seoTitle),
  meta.seoTitle,
);
hardCheck(
  'NO "Bạn sẽ làm gì nếu" dump',
  !/^Bạn sẽ làm gì nếu\s+/i.test(meta.seoTitle),
  meta.seoTitle,
);
hardCheck(
  'title not pure dialogue',
  !/^(hắn|nàng|tôi|ta)\s+nói/i.test(meta.seoTitle) && !/^["“]/.test(meta.seoTitle),
  meta.seoTitle,
);
// Soft: generator may return best-of if rounds exhausted
softCheck(
  `meta average ≥${YOUTUBE_META_PASS_SCORE}`,
  meta.scores.average >= YOUTUBE_META_PASS_SCORE || meta.scores.pass,
  `avg=${meta.scores.average} pass=${meta.scores.pass}`,
);
const tags = (meta.seoTags || '').toLowerCase();
hardCheck(
  'tags no stopword fillers',
  !/(#không\b|#muốn\b|#trời\b|#phải\b)/i.test(tags),
  meta.seoTags,
);
hardCheck('buildClickThumbnailLine export', typeof buildClickThumbnailLine === 'function');
hardCheck('extractHookFromScript export', typeof extractHookFromScript === 'function');

// ── 3) Image / video director formulas ─────────────────────────
console.log('\n=== 3. Image/Video director formulas ===');
const shot = enforceShotGraphOnPrompts([
  {
    image_prompt: 'cinematic epic 8k masterpiece of Han Duc at cracked wall',
    video_prompt: 'cinematic camera push in, epic reveal, 8k',
  },
]);
const directed = applyDirectorFormulasToPromptPair({
  imagePrompt: shot[0].image_prompt,
  videoPrompt: shot[0].video_prompt,
  characterHints: ['Hàn Dực'],
  styleHint: 'dark survival realism',
  durationSec: 5,
});
hardCheck(
  'image strips 8k/cinematic/masterpiece',
  !/\b(8k|cinematic|masterpiece)\b/i.test(directed.image_prompt),
  directed.image_prompt.slice(0, 90),
);
hardCheck('video has Preserve @Image1', /Preserve @Image1/i.test(directed.video_prompt));
hardCheck('image Still frame beat', /Still frame beat/i.test(directed.image_prompt));
hardCheck('video Action(', /Action\s*\(/i.test(directed.video_prompt));

// ── 4) Ship pack output criteria ──────────────────────────────
console.log('\n=== 4. Ship pack (scene parse + SEO QA) ===');
const ch = createChannelProfile('Kênh Audit Criteria', {
  niche: 'Horror',
  defaultShipMode: 'short',
  narratorVoiceId: 'vi-VN-HoaiMyNeural',
  ttsPlatform: 'edge_tts',
  visualDna: 'foggy alley',
  language: 'vi',
});
// Intentionally BAD hooks (dialogue dump) — pack must self-heal via Meta QA
const pack = buildShipPack({
  channel: ch,
  mode: 'short',
  ten_tac_pham: 'Tiếng Vọng Tường Cổ',
  chapter: {
    so_chuong: 1,
    tieu_de: 'Hầm tối',
    dan_y: '',
    noi_dung: SCRIPT,
  },
  chapterHooks: {
    hook: '"Kiến, tòa nhà này muốn bay lên trời à?" Khánh Ân nói. "Không... không phải."',
    thumbnailLine: 'Tòa nhà bay',
    seoTitle:
      'Đừng bỏ lỡ: Cô chỉ vào một góc màn hình, nơi Kiến vừa vẽ… Tòa nhà này có muốn bay lên trời',
    seoDescription: 'Sai một bước là mất sạch. Bí mật lộ ra từng mảnh — không có chỗ lùi.',
    seoTags: '#muốn #trời #không #phải #truyenaudio',
  },
  generatedAudioPaths: { '1_0': { path: 'public/audio/demo.mp3', duration: 12 } },
  generatedImages: {
    '1_0_0': 'public/images/a.png',
    '1_0_1': 'public/images/b.png',
    '1_0_2': 'public/images/c.png',
  },
});

const manifest = pack.manifest;
const q = manifest.quality || {};
hardCheck(
  'ship scenes = [CẢNH] count (not blank-line spam)',
  Number(manifest.stats?.scenes) >= 3 && Number(manifest.stats?.scenes) <= 10,
  `scenes=${manifest.stats?.scenes}`,
);
hardCheck(
  'ship SEO self-heal source meta_qa or hooks_pass',
  q.seo?.source === 'meta_qa' || q.seo?.source === 'hooks_pass',
  `source=${q.seo?.source}`,
);
hardCheck('ship title ≤100', (pack.files.find((f) => f.relativePath === 'seo.json')
  ? JSON.parse(pack.files.find((f) => f.relativePath === 'seo.json').content).title.length
  : 999) <= 100);
const seoFile = JSON.parse(pack.files.find((f) => f.relativePath === 'seo.json').content);
hardCheck('ship thumb ≤30', (seoFile.thumbnailLine || '').length <= 30, seoFile.thumbnailLine);
hardCheck(
  'ship tags no stopwords',
  !(seoFile.tags || []).some((t) => /^(muốn|trời|không|phải)$/i.test(String(t))),
  JSON.stringify(seoFile.tags),
);
hardCheck(
  'ship short script_short present',
  pack.files.some((f) => f.relativePath === 'script_short.txt'),
);
const shortBody = pack.files.find((f) => f.relativePath === 'script_short.txt')?.content || '';
hardCheck(
  'ship short script not 100+ micro-chunks',
  shortBody.split('---').length <= 4,
  `chunks=${shortBody.split('---').length}`,
);
softCheck(
  `ship SEO score ≥${YOUTUBE_META_PASS_SCORE}`,
  q.seo?.pass || (q.seo?.average ?? 0) >= YOUTUBE_META_PASS_SCORE - 0.5,
  `avg=${q.seo?.average} pass=${q.seo?.pass}`,
);
hardCheck('ship media audioOk', q.media?.audioOk === true);
hardCheck('ship media visualOk (short requires visual)', q.media?.visualOk === true);

// Write sample under exports for inspection
const outDir = path.join(root, 'exports', 'ship-packs', '_criteria_audit');
fs.mkdirSync(outDir, { recursive: true });
for (const f of pack.files) {
  const p = path.join(outDir, f.relativePath);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, f.content, 'utf8');
}
hardCheck('wrote criteria audit pack', fs.existsSync(path.join(outDir, 'manifest.json')));

// ── 5b) Toolbar settings as criteria (Ảnh/Video + TTS + CapCut) ─
console.log('\n=== 5b. Toolbar settings → output criteria ===');
const baseCh = createChannelProfile('Kênh Criteria DNA', {
  niche: 'Horror',
  defaultShipMode: 'short',
  aspectRatio: '16:9', // recipe-ish legacy
});
// Live toolbar differs from channel defaults — must win
const liveMerged = mergeLiveSettingsIntoChannel(
  baseCh,
  {
    imageProvider: 'grok',
    imageModel: 'grok-imagine',
    imageAspectRatio: '2:3',
    imageCount: 2,
    videoProvider: 'sora',
    videoModel: 'sora',
    videoAspectRatio: '9:16',
    videoDuration: 10,
    mediaStylePreset: 'dark survival realism',
    visualDnaPrompt: 'neon fog alley',
  },
  {
    platform: 'vina_voice',
    voice: 'clone-hero',
    language: 'vi',
    speed: 0.95,
    pitch: 1,
    syncMode: 'pro',
  },
);
const crit = resolveOutputCriteria(liveMerged, 'short');
hardCheck('criteria image from live 2:3', crit.imageAspectRatio === '2:3', crit.imageAspectRatio);
hardCheck('criteria video from live 9:16', crit.videoAspectRatio === '9:16', crit.videoAspectRatio);
hardCheck('criteria CapCut maps 9:16', crit.capCutAspect === '9:16', crit.capCutAspect);
hardCheck('criteria image provider grok', crit.imageProvider === 'grok');
hardCheck('criteria video provider sora', crit.videoProvider === 'sora');
hardCheck('criteria video duration 10', crit.videoDuration === 10, String(crit.videoDuration));
hardCheck('criteria TTS platform vina_voice', crit.tts.platform === 'vina_voice');
hardCheck('criteria TTS voice clone-hero', crit.tts.voice === 'clone-hero');
hardCheck('criteria TTS speed 0.95', crit.tts.speed === 0.95, String(crit.tts.speed));
hardCheck('toCapCutAspect 2:3 → 9:16', toCapCutAspect('2:3') === '9:16');
hardCheck('toCapCutAspect 16:9 → 16:9', toCapCutAspect('16:9') === '16:9');

const settingsEval = evaluateSettingsAsCriteria(crit);
hardCheck('settings eval pass', settingsEval.pass === true);

// Ship pack must embed settings_criteria + not force recipe ratio over user DNA
const dnaPack = buildShipPack({
  channel: liveMerged,
  mode: 'short',
  ten_tac_pham: 'DNA Criteria Novel',
  chapter: {
    so_chuong: 1,
    tieu_de: 'Test',
    dan_y: '',
    noi_dung: SCRIPT,
  },
  generatedAudioPaths: { '1_0': { path: 'a.mp3', duration: 5 } },
  generatedImages: { '1_0_0': 'i.png' },
});
const settingsFile = dnaPack.files.find((f) => f.relativePath === 'settings_criteria.json');
hardCheck('ship writes settings_criteria.json', !!settingsFile);
if (settingsFile) {
  const sc = JSON.parse(settingsFile.content);
  hardCheck('settings_criteria image 2:3', sc.image?.aspectRatio === '2:3', sc.image?.aspectRatio);
  hardCheck('settings_criteria video 9:16', sc.video?.aspectRatio === '9:16');
  hardCheck('settings_criteria CapCut 9:16', sc.capcut?.aspect === '9:16');
  hardCheck('settings_criteria TTS vina', sc.tts?.platform === 'vina_voice');
  hardCheck('settings_criteria TTS voice', sc.tts?.voice === 'clone-hero');
}
hardCheck(
  'manifest.criteria.videoAspectRatio 9:16',
  dnaPack.manifest?.criteria?.videoAspectRatio === '9:16',
  String(dnaPack.manifest?.criteria?.videoAspectRatio),
);
hardCheck(
  'manifest.dna.outputDna.imageProvider grok',
  dnaPack.manifest?.dna?.outputDna?.imageProvider === 'grok',
);
hardCheck(
  'manifest quality.settings.pass',
  dnaPack.manifest?.quality?.settings?.pass === true,
);
// seo/media_index should use user video ratio not only recipe
const mediaIdx = JSON.parse(
  dnaPack.files.find((f) => f.relativePath === 'media_index.json').content,
);
hardCheck(
  'media_index uses user videoAspectRatio',
  mediaIdx.videoAspectRatio === '9:16' || mediaIdx.aspectRatio === '9:16',
  JSON.stringify({ a: mediaIdx.aspectRatio, v: mediaIdx.videoAspectRatio }),
);

// ── 5) Publish readiness gates ────────────────────────────────
console.log('\n=== 5. Publish readiness ===');
const ready = evaluatePublishReadiness({
  chapterNum: 1,
  script: padded,
  soTuChuong: 4250,
  hook: meta.hook,
  thumbnailLine: meta.thumbnailLine,
  seoTitle: meta.seoTitle,
  seoDescription: meta.seoDescription,
  thumbnailPrompt: meta.thumbnailPrompt,
  thumbnailImagePath: 'D:/tmp/thumb.png',
  ttsPlatform: 'vina_voice',
  visualDna: 'foggy alley',
  generatedAudioPaths: { '1_0': { path: 'a.mp3', duration: 12 } },
  generatedImages: {
    '1_0_0': 'img.png',
    '1_0_1': 'img2.png',
    '1_0_2': 'img3.png',
  },
  youtubeSafe: { enforceEditorGate: false, requireHumanEdit: false },
});
hardCheck('publish ready when assets complete', ready.ready === true && ready.fail === 0);

const notReady = evaluatePublishReadiness({
  chapterNum: 1,
  script: 'ngắn',
  youtubeSafe: { enforceEditorGate: false, requireHumanEdit: false },
});
hardCheck('publish not ready without assets', notReady.ready === false && notReady.fail > 0);

// ── 6) Existing real ship pack re-check (informational) ───────
console.log('\n=== 6. Existing artifact (legacy pack, informational) ===');
const legacyDir = path.join(
  root,
  'exports',
  'ship-packs',
);
const legacyCandidates = fs.existsSync(legacyDir)
  ? fs
      .readdirSync(legacyDir)
      .filter((d) => d.includes('short_c1') || d.includes('chính'))
  : [];
if (legacyCandidates.length) {
  const legacy = path.join(legacyDir, legacyCandidates[0], 'manifest.json');
  if (fs.existsSync(legacy)) {
    const m = JSON.parse(fs.readFileSync(legacy, 'utf8'));
    const scenesN = m.stats?.scenes ?? -1;
    softCheck(
      'legacy pack scene count sane (≤40)',
      scenesN > 0 && scenesN <= 40,
      `scenes=${scenesN} (old bug: blank-line split → 155)`,
    );
    softCheck(
      'legacy pack has quality block (new builds only)',
      !!m.quality,
      m.quality ? 'has quality' : 'pre-fix pack — rebuild to get quality',
    );
  }
}

// ── Report ────────────────────────────────────────────────────
console.log('\n======== SUMMARY ========');
console.log(`HARD fails: ${hard}  SOFT fails: ${soft}`);
console.log('META title sample:', meta.seoTitle);
console.log('META thumb sample:', meta.thumbnailLine);
console.log('SHIP seo source:', q.seo?.source, 'avg', q.seo?.average);
console.log('SHIP scenes:', manifest.stats?.scenes);

const reportPath = path.join(root, 'exports', 'audit-output-criteria-report.json');
fs.writeFileSync(
  reportPath,
  JSON.stringify(
    {
      at: new Date().toISOString(),
      hard,
      soft,
      pass: hard === 0,
      lines,
      metaSample: {
        title: meta.seoTitle,
        thumb: meta.thumbnailLine,
        scores: meta.scores,
      },
      shipQuality: q,
    },
    null,
    2,
  ),
  'utf8',
);
console.log('report:', reportPath);

if (hard > 0) {
  process.exit(2);
}
console.log('\nRESULT: ALL HARD CRITERIA PASS');
process.exit(0);
