/**
 * REAL check — call live APIs + write real artifacts under exports/real-check/
 * Not a unit mock: fails if files missing / empty / quality gates fail.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'exports', 'real-check', `run_${Date.now()}`);
const base = process.env.AINOVEL_BASE || 'http://127.0.0.1:3000';

fs.mkdirSync(outDir, { recursive: true });

const log = [];
function line(msg) {
  log.push(msg);
  console.log(msg);
}

const SCRIPT = `[CẢNH 1: Hầm tối]
Hàn Dực đặt tay lên tường đá ẩm. Lớp rêu lạnh dính vào lòng bàn tay. Tiếng nước nhỏ giọt đếm nhịp trong tối. Bỗng vết nứt trên tường cổ nở ra, ánh sáng lạnh tràn vào như lưỡi dao. Hắn lùi nửa bước — sau lưng còn tiếng chân thứ hai, không phải của hắn.

[CẢNH 2: Hành lang sụp]
Không ai kịp gọi tên. Mùi sắt tanh nổi lên từ khe đá. Liễu Yên níu cổ tay hắn nhưng không nói một lời. Cả hai biết nếu đứng thêm một giây, cánh cửa đá sẽ khép và chôn họ dưới lòng đất. Hắn siết chặt mảnh kim loại trong túi — manh mối cuối cùng từ bức tường cổ.`;

let fails = 0;
function must(name, cond, detail = '') {
  if (!cond) {
    fails++;
    line(`FAIL  ${name}${detail ? ' — ' + detail : ''}`);
  } else {
    line(`OK    ${name}${detail ? ' — ' + detail : ''}`);
  }
}

// ── 1) Live server ────────────────────────────────────────────
const health = await fetch(`${base}/api/system-info`).catch((e) => ({ ok: false, statusText: e.message }));
must('server up', health.ok, `status=${health.status || health.statusText}`);

// ── 2) Real meta pack (same as Kịch Bản Làm Việc / YouTube Studio) ──
const y = await import('../src/lib/youtubeSafe.ts');
const pack = y.generateYoutubeMetaWithQA({
  script: SCRIPT,
  novelTitle: 'Tiếng Vọng Tường Cổ',
  chapter: 12,
  maxRounds: 5,
});
const metaPath = path.join(outDir, 'chapter_12_youtube_meta.json');
fs.writeFileSync(metaPath, JSON.stringify(pack, null, 2), 'utf8');
must('meta json written', fs.existsSync(metaPath) && fs.statSync(metaPath).size > 200, metaPath);
must('title ≤100', pack.seoTitle.length <= 100, String(pack.seoTitle.length));
must('thumb ≤30', pack.thumbnailLine.length <= 30, `"${pack.thumbnailLine}" len=${pack.thumbnailLine.length}`);
must('no double-why', !/tại\s+sao[\s\S]{0,40}vì\s+sao/i.test(pack.seoTitle), pack.seoTitle);
must('no làm gì nếu dump', !/^Bạn sẽ làm gì nếu\s+/i.test(pack.seoTitle), pack.seoTitle);
must('hook ≥40 chars', pack.hook.length >= 40);
must('score ≥7', pack.scores?.average >= 7, String(pack.scores?.average));
must(
  'thumb prompt has curiosity bias',
  /click-curiosity bias/i.test(pack.thumbnailPrompt),
);
line(`      TITLE: ${pack.seoTitle}`);
line(`      THUMB: ${pack.thumbnailLine}`);
line(`      LAW:   ${pack.titleLawId} ${pack.titleLawName || ''}`);

// ── 3) Real scene parse + director prompts (Gen Prompt Studio path) ──
const { parseScenes } = await import('../src/lib/storyWriting.ts');
const { enforceShotGraphOnPrompts } = await import('../src/lib/youtubeSafe.ts');
const { applyDirectorFormulasToPromptPair } = await import('../src/lib/integrations/seedance.ts');
const scenes = parseScenes(SCRIPT);
must('scenes parsed ≥2', scenes.length >= 2, `n=${scenes.length}`);
const promptPairs = scenes.map((sc, i) => {
  const rawImg = `cinematic epic 8k shot of scene: ${sc.content.slice(0, 80)}`;
  const rawVid = `cinematic camera move through ${sc.title}`;
  const shot = enforceShotGraphOnPrompts([{ image_prompt: rawImg, video_prompt: rawVid }])[0];
  const d = applyDirectorFormulasToPromptPair({
    imagePrompt: shot.image_prompt,
    videoPrompt: shot.video_prompt,
    characterHints: ['Hàn Dực', 'Liễu Yên'],
    styleHint: 'dark survival realism',
    durationSec: 5,
  });
  return {
    scene: sc.title,
    image_prompt: d.image_prompt,
    video_prompt: d.video_prompt,
  };
});
const promptsPath = path.join(outDir, 'scene_prompts_directed.json');
fs.writeFileSync(promptsPath, JSON.stringify(promptPairs, null, 2), 'utf8');
must('prompts file written', fs.existsSync(promptsPath));
must(
  'directed image no 8k/cinematic',
  promptPairs.every((p) => !/\b(8k|cinematic|masterpiece)\b/i.test(p.image_prompt)),
);
must(
  'directed video has I2V',
  promptPairs.every((p) => /Preserve @Image1/i.test(p.video_prompt)),
);

// ── 4) Real TTS for 2 scenes via live API (chapter queue content) ──
const ttsResults = [];
for (let i = 0; i < scenes.length; i++) {
  if (i > 0) await new Promise((r) => setTimeout(r, 1500)); // avoid Edge TTS rate burst
  const text = scenes[i].content.slice(0, 400);
  const res = await fetch(`${base}/api/generate-tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sceneText: text,
      chapterNum: 12,
      sceneIndex: i,
      voiceName: 'vi-VN-HoaiMyNeural',
      ten_tac_pham: 'Tiếng Vọng Tường Cổ',
      ttsConfig: {
        platform: 'edge_tts',
        voice: 'vi-VN-HoaiMyNeural',
        language: 'vi',
        speed: 1,
        pitch: 0,
      },
    }),
    signal: AbortSignal.timeout(120000),
  });
  const body = await res.json().catch(() => ({}));
  const audioPath = body.audioPath || '';
  const disk = path.join(root, 'public', String(audioPath).replace(/^\//, '').split('?')[0]);
  const exists = fs.existsSync(disk);
  const size = exists ? fs.statSync(disk).size : 0;
  ttsResults.push({ scene: i, http: res.status, audioPath, disk, size, duration: body.duration });
  must(
    `TTS scene ${i} HTTP 200 + file`,
    res.ok && exists && size > 2000,
    `http=${res.status} path=${audioPath} size=${size}`,
  );
  must(
    `TTS scene ${i} filename chapter_12`,
    /chapter_12_scene_/.test(audioPath) && !/undefined/.test(audioPath),
    audioPath,
  );
  // copy into real-check folder as evidence (only real files)
  if (exists && size > 0) {
    try {
      fs.copyFileSync(disk, path.join(outDir, path.basename(disk)));
    } catch (e) {
      line(`WARN  copy TTS evidence: ${e?.message || e}`);
    }
  }
}

// ── 5) FableCut timeline from real TTS (if we had images we'd use them) ──
// Create minimal 1x1 pngs as scene images for timeline build
const imgDir = path.join(outDir, 'fake_shots');
fs.mkdirSync(imgDir, { recursive: true });
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const imgPaths = [];
for (let i = 0; i < 2; i++) {
  const p = path.join(imgDir, `shot_${i}.png`);
  fs.writeFileSync(p, png);
  imgPaths.push(p);
}
const audioDisk = ttsResults[0]?.disk;
const { buildFromChapterAssets } = await import('../src/lib/integrations/fablecut.ts');
const fc = buildFromChapterAssets({
  name: 'RealCheck_c12',
  imagePaths: imgPaths,
  audioPath: fs.existsSync(audioDisk) ? audioDisk : undefined,
  secondsPerImage: 4,
  aspect: '9:16',
  liveEditor: false,
  title: 'Chương 12 Real Check',
});
must('fablecut project built', fc.success, fc.error || fc.projectPath);
if (fc.success && fc.projectPath && fs.existsSync(fc.projectPath)) {
  fs.copyFileSync(fc.projectPath, path.join(outDir, 'fablecut_project.json'));
  must('fablecut project.json in real-check', fs.existsSync(path.join(outDir, 'fablecut_project.json')));
}

// ── Summary file ──────────────────────────────────────────────
const summary = {
  at: new Date().toISOString(),
  base,
  outDir,
  fails,
  meta: {
    title: pack.seoTitle,
    thumb: pack.thumbnailLine,
    law: pack.titleLawName,
    score: pack.scores,
  },
  tts: ttsResults,
  fablecut: { success: fc.success, path: fc.projectPath, clips: fc.clipCount },
  files: fs.readdirSync(outDir),
};
fs.writeFileSync(path.join(outDir, 'SUMMARY.json'), JSON.stringify(summary, null, 2));
fs.writeFileSync(path.join(outDir, 'LOG.txt'), log.join('\n'), 'utf8');

line('');
line(`OUT DIR: ${outDir}`);
line(`FILES: ${summary.files.join(', ')}`);
line(fails === 0 ? 'REAL CHECK: ALL PASSED' : `REAL CHECK: ${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
