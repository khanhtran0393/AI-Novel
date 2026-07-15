/**
 * Rebuild every non-underscore ship pack under exports/ship-packs with current criteria DNA.
 * Run: npx tsx scripts/rebuild-all-ship-packs.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packsRoot = path.join(root, 'exports', 'ship-packs');

const { createChannelProfile } = await import('../src/lib/channelModel.ts');
const { buildShipPack } = await import('../src/lib/shipPack.ts');
const {
  mergeLiveSettingsIntoChannel,
  resolveOutputCriteria,
} = await import('../src/lib/outputCriteria.ts');
const { countSceneTags, getWordCount, evaluateWordGate } = await import(
  '../src/lib/storyWriting.ts'
);

if (!fs.existsSync(packsRoot)) {
  console.error('No ship-packs dir');
  process.exit(1);
}

const dirs = fs
  .readdirSync(packsRoot, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
  .map((d) => d.name);

if (!dirs.length) {
  console.log('No legacy packs to rebuild (only _* folders). Creating synthetic demo pack.');
}

const report = [];
let fails = 0;

function rebuildOne(packName, script, meta) {
  const mode = meta.mode || 'short';
  let ch = createChannelProfile(meta.channelName || packName.slice(0, 24) || 'Kênh', {
    niche: meta.niche || 'Truyện / Drama',
    defaultShipMode: mode,
    language: meta.language || 'vi',
    narratorVoiceId: meta.narratorVoiceId || 'vi-VN-HoaiMyNeural',
    ttsPlatform: meta.ttsPlatform || 'edge_tts',
    visualDna: meta.visualDna || '',
    aspectRatio: meta.aspectRatio || (mode === 'short' ? '9:16' : '16:9'),
  });

  ch = mergeLiveSettingsIntoChannel(
    ch,
    {
      imageProvider: meta.imageProvider || 'gemini',
      imageModel: meta.imageModel || 'banana',
      imageAspectRatio: meta.imageAspectRatio || (mode === 'short' ? '9:16' : '16:9'),
      imageCount: meta.imageCount || 1,
      videoProvider: meta.videoProvider || 'veo',
      videoModel: meta.videoModel || 'veo',
      videoAspectRatio: meta.videoAspectRatio || (mode === 'short' ? '9:16' : '16:9'),
      videoDuration: meta.videoDuration || 6,
      mediaStylePreset: meta.mediaStylePreset,
      visualDnaPrompt: meta.visualDna || '',
    },
    {
      platform: meta.ttsPlatform || 'edge_tts',
      voice: meta.narratorVoiceId || 'vi-VN-HoaiMyNeural',
      language: meta.language || 'vi',
      speed: meta.ttsSpeed ?? 1,
      pitch: meta.ttsPitch ?? 0,
    },
  );

  const criteria = resolveOutputCriteria(ch, mode);
  const pack = buildShipPack({
    channel: ch,
    mode,
    ten_tac_pham: meta.workTitle || 'Untitled',
    chapter: {
      so_chuong: meta.chapterNum || 1,
      tieu_de: meta.chapterTitle || 'Chương 1',
      dan_y: '',
      noi_dung: script,
    },
    chapterHooks: meta.hooks || null,
    generatedAudioPaths: meta.audio || {},
    generatedImages: meta.images || {},
    generatedVideos: meta.videos || {},
  });

  const outDir = path.join(packsRoot, packName);
  // Archive old manifest once
  const oldManifest = path.join(outDir, 'manifest.json');
  if (fs.existsSync(oldManifest)) {
    const archive = path.join(outDir, '_pre_rebuild_manifest.json');
    if (!fs.existsSync(archive)) {
      fs.copyFileSync(oldManifest, archive);
    }
  }

  for (const f of pack.files) {
    const abs = path.join(outDir, f.relativePath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, f.content, 'utf8');
  }

  const q = pack.manifest.quality || {};
  const row = {
    pack: packName,
    scenes: pack.manifest.stats?.scenes,
    wordGate: q.wordGate,
    seo: q.seo,
    settingsPass: q.settings?.pass,
    criteria: pack.manifest.criteria,
    capCutAspect: criteria.capCutAspect,
    files: pack.files.length,
  };
  const hardOk =
    Number(row.scenes) > 0 &&
    Number(row.scenes) <= 40 &&
    q.settings?.pass === true &&
    fs.existsSync(path.join(outDir, 'settings_criteria.json'));
  if (!hardOk) fails++;
  report.push({ ...row, hardOk });
  console.log(
    `${hardOk ? 'OK' : 'FAIL'}  ${packName}  scenes=${row.scenes} settings=${q.settings?.pass} seo=${q.seo?.average}`,
  );
  return hardOk;
}

for (const name of dirs) {
  const dir = path.join(packsRoot, name);
  const scriptPath = path.join(dir, 'script.txt');
  if (!fs.existsSync(scriptPath)) {
    console.log('SKIP  no script.txt', name);
    continue;
  }
  const script = fs.readFileSync(scriptPath, 'utf8');
  let old = {};
  try {
    old = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  } catch {
    /* empty */
  }
  let seo = {};
  try {
    seo = JSON.parse(fs.readFileSync(path.join(dir, 'seo.json'), 'utf8'));
  } catch {
    /* empty */
  }
  let hookTxt = '';
  try {
    hookTxt = fs.readFileSync(path.join(dir, 'hook.txt'), 'utf8');
  } catch {
    /* empty */
  }

  const words = getWordCount(script);
  const tags = countSceneTags(script);
  const gate = evaluateWordGate(script, 4250);
  console.log(`\n--- ${name} ---`);
  console.log(`input words=${words} sceneTags=${tags} wordOk=${gate.wordsOk}`);

  rebuildOne(name, script, {
    mode: old.mode || seo.mode || 'short',
    channelName: old.channelName || seo.channel || 'Kênh',
    workTitle: old.workTitle || 'Untitled',
    chapterNum: old.chapter?.num || 1,
    chapterTitle: old.chapter?.title || 'Chương',
    niche: old.dna?.niche || seo.niche,
    language: old.dna?.language || seo.language || 'vi',
    narratorVoiceId: old.dna?.narratorVoiceId,
    ttsPlatform: old.dna?.ttsPlatform,
    visualDna: old.dna?.visualDna,
    aspectRatio: old.recipe?.aspectRatio || seo.aspectRatio,
    imageAspectRatio: old.recipe?.aspectRatio || seo.aspectRatio,
    videoAspectRatio: old.recipe?.aspectRatio || seo.aspectRatio,
    hooks: {
      hook: hookTxt.split('[Thumbnail]')[0]?.trim(),
      thumbnailLine: (hookTxt.match(/\[Thumbnail\]\s*([\s\S]*)/) || [])[1]?.trim(),
      seoTitle: seo.title,
      seoDescription: seo.description,
      seoTags: Array.isArray(seo.tags) ? seo.tags.map((t) => '#' + t).join(' ') : '',
    },
  });
}

// Always write a canonical rebuilt demo under _rebuilt_all
const demoScript = `[CẢNH 1: Demo]
Hàn Dực chạm tường đá. Tiếng nứt vọng xa. Liễu Yên kéo tay hắn — phía sau có tiếng chân thứ hai.

[CẢNH 2: Demo 2]
Ánh sáng lạnh tràn vào khe nứt. Họ không còn đường lùi.

[CẢNH 3: Demo 3]
Mảnh kim loại trong túi hắn nóng bỏng. Đây là manh mối cuối.`;
rebuildOne('_rebuilt_all_demo', demoScript, {
  mode: 'short',
  channelName: 'Kênh Rebuild Demo',
  workTitle: 'Demo Criteria Pack',
  chapterNum: 1,
  chapterTitle: 'Demo',
  imageAspectRatio: '9:16',
  videoAspectRatio: '9:16',
  ttsPlatform: 'edge_tts',
  narratorVoiceId: 'vi-VN-HoaiMyNeural',
  audio: { '1_0': { path: 'public/audio/demo.mp3', duration: 8 } },
  images: { '1_0_0': 'public/images/smoke_core_mock.png' },
});

const reportPath = path.join(root, 'exports', 'rebuild-ship-packs-report.json');
fs.writeFileSync(
  reportPath,
  JSON.stringify({ at: new Date().toISOString(), fails, report }, null, 2),
  'utf8',
);
console.log('\nreport:', reportPath);
console.log(fails ? `DONE with ${fails} FAIL` : 'DONE ALL OK');
process.exit(fails ? 2 : 0);
