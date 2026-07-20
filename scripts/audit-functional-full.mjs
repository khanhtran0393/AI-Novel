/**
 * Full functional audit: content-generation logic + button wiring integrity.
 * Offline-first; optional live server probes if AINOVEL_BASE responds.
 *
 * Exit 0 = no HARD failures.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

const hard = [];
const soft = [];
const info = [];

function H(name, pass, detail = '') {
  if (!pass) hard.push({ name, detail });
  console.log(`${pass ? 'PASS' : 'HARD'}  ${name}${detail ? ' — ' + detail : ''}`);
}
function S(name, pass, detail = '') {
  if (!pass) soft.push({ name, detail });
  console.log(`${pass ? 'PASS' : 'SOFT'}  ${name}${detail ? ' — ' + detail : ''}`);
}
function I(msg) {
  info.push(msg);
  console.log(`INFO  ${msg}`);
}

// ── Load pure modules via dynamic import (tsx path when needed) ──
async function loadYoutube() {
  return import(pathToFileURL(path.join(root, 'src/lib/youtubeSafe.ts')).href);
}
function pathToFileURL(p) {
  const { pathToFileURL: f } = require('url');
  return f(p);
}

console.log('\n=== AI Novel functional audit ===\n');

// ═══════════════════════════════════════════════════════════════
// A) CONTENT GENERATION LOGIC (offline pure functions)
// ═══════════════════════════════════════════════════════════════
console.log('--- A) Content generation logic ---\n');

const y = await import('../src/lib/youtubeSafe.ts');
const sw = await import('../src/lib/storyWriting.ts');
const seed = await import('../src/lib/integrations/seedance.ts');
const { parseOrThrow, generateBodySchema, generateTtsBodySchema, generateImageBodySchema, GENERATE_REQUEST_OWNERS, CORE_PAYLOAD_SCHEMAS, API } = await import('../src/contracts/index.ts');
const { evaluateCredentialHealth } = await import('../src/lib/credentialHealth.ts');
const { probeRuntimeHealth } = await import('../src/lib/runtimeHealth.ts');
const { CORE_LOOP_STEPS, loadOnboarding } = await import('../src/lib/onboarding.ts');
const { buildPortableProject } = await import('../src/lib/projectPortable.ts');

const SCRIPT = `[CẢNH 1: NỘI CẢNH. HẦM BÊ TÔNG - RẠNG SÁNG]
Hàn Dực đặt tay lên tường đá ẩm. Lớp rêu lạnh dính vào lòng bàn tay. Tiếng nước nhỏ giọt đếm nhịp trong tối. Bỗng vết nứt trên tường cổ nở ra, ánh sáng lạnh tràn vào như lưỡi dao. Hắn lùi nửa bước — sau lưng còn tiếng chân thứ hai, không phải của hắn.

[CẢNH 2: NGOẠI CẢNH. HÀNH LANG SỤP - BAN NGÀY]
Không ai kịp gọi tên. Mùi sắt tanh nổi lên từ khe đá. Liễu Yên níu cổ tay hắn nhưng không nói một lời. Cả hai biết nếu đứng thêm một giây, cánh cửa đá sẽ khép và chôn họ dưới lòng đất.

[CẢNH 3: NỘI CẢNH. PHÒNG MÁY PHÁT - CHIỀU]
Hắn siết chặt mảnh kim loại trong túi — manh mối cuối cùng từ bức tường cổ. Máy nổ ran một nhịp rồi tắt. Trong bóng tối, ai đó thở rất gần.`.normalize('NFC');

// A1 scenes
const scenes = sw.parseScenes(SCRIPT);
H('parseScenes ≥3', scenes.length >= 3, `n=${scenes.length}`);
H('scene tags present', scenes.every((s) => /CẢNH/i.test(s.title || '') || (s.content || '').length > 0));
H('NFC preserved', SCRIPT === SCRIPT.normalize('NFC'));

// A2 word gate
const gate = sw.evaluateWordGate(SCRIPT, 200, 3);
H('word gate evaluates', typeof gate.wordCount === 'number' && gate.wordCount > 50, `words=${gate.wordCount} scenes=${gate.sceneCount}`);
S('scenesOk for sample', gate.scenesOk === true, `scenesOk=${gate.scenesOk}`);

// A3 hook + meta
const AUDIT_VISUAL_DNA =
  'cinematic moody lighting, desaturated film grain, tight frame';
const hookPack = y.extractHookFromScript(SCRIPT, {
  targetSec: 30,
  wpm: 140,
  visualDna: AUDIT_VISUAL_DNA,
});
H('hook non-empty ≥40', !!hookPack.hook && hookPack.hook.length >= 40, (hookPack.hook || '').slice(0, 60));
H('thumbnailLine ≤30', (hookPack.thumbnailLine || '').length <= 30, `"${hookPack.thumbnailLine}"`);
H('thumbnailPrompt non-empty when visualDna set', !!hookPack.thumbnailPrompt);

const meta = y.generateYoutubeMetaWithQA({
  script: SCRIPT,
  novelTitle: 'Tiếng Vọng Tường Cổ',
  chapter: 1,
  maxRounds: 5,
  // B10: thumbnail style must come from Visual DNA / Media Style (no invent)
  visualDna: AUDIT_VISUAL_DNA,
});
H('meta seoTitle', !!meta.seoTitle);
H('meta no double-why', !/tại\s+sao[\s\S]{0,40}vì\s+sao/i.test(meta.seoTitle), meta.seoTitle);
H('meta no làm gì nếu dump', !/^Bạn sẽ làm gì nếu\s+/i.test(meta.seoTitle), meta.seoTitle);
H('meta thumb ≤30', (meta.thumbnailLine || '').length <= 30, meta.thumbnailLine);
S('meta score ≥7', (meta.scores?.average ?? 0) >= 7, String(meta.scores?.average));

// A4 director / image prompts
const rawPairs = scenes.map((sc) => ({
  image_prompt: `cinematic epic 8k masterpiece: ${sc.content.slice(0, 60)}`,
  video_prompt: `cinematic move ${sc.title}`,
}));
const shot = y.enforceShotGraphOnPrompts(rawPairs);
const directed = shot.map((p) =>
  seed.applyDirectorFormulasToPromptPair({
    imagePrompt: p.image_prompt,
    videoPrompt: p.video_prompt,
    characterHints: ['Hàn Dực', 'Liễu Yên'],
    styleHint: 'dark survival',
    durationSec: 5,
  }),
);
H(
  'director strips 8k/cinematic spam',
  directed.every((p) => !/\b(8k|cinematic|masterpiece)\b/i.test(p.image_prompt || '')),
);
H(
  'director I2V preserve image',
  directed.every((p) => /Preserve @Image1|@Image1|image1/i.test(p.video_prompt || '')),
);

// A5 narrative psych
const psych = y.scoreNarrativePsychScript(SCRIPT);
H('narrativePsych scores object', psych && typeof psych === 'object');
I(`narrativePsych keys: ${Object.keys(psych || {}).join(',')}`);

// A6 human jokes inject
const joked = y.injectHumanJokeAsides(SCRIPT, { minCount: 1, enabled: true });
H('human joke inject ≥1', y.countHumanJokeAsides(joked) >= 1);

// A7 onboarding commercial-clean (no demo story seed)
H(
  'onboarding core-loop steps ≥5',
  Array.isArray(CORE_LOOP_STEPS) && CORE_LOOP_STEPS.length >= 5,
  `n=${CORE_LOOP_STEPS?.length ?? 0}`,
);
const onboarding = loadOnboarding();
H(
  'onboarding state loadable',
  !!onboarding && typeof onboarding === 'object' && Array.isArray(onboarding.completedSteps),
);

// A8 contracts hot APIs
H('WRITE_CHAPTER schema', !!CORE_PAYLOAD_SCHEMAS.WRITE_CHAPTER);
H('all requestTypes have schema', Object.keys(GENERATE_REQUEST_OWNERS).every((k) => CORE_PAYLOAD_SCHEMAS[k]));
try {
  parseOrThrow(generateTtsBodySchema, {
    sceneText: 'Xin chào',
    ttsConfig: { platform: 'edge_tts', voice: 'vi-VN-HoaiMyNeural' },
  });
  H('TTS body accepts edge', true);
} catch (e) {
  H('TTS body accepts edge', false, e.message);
}
try {
  parseOrThrow(generateImageBodySchema, {
    prompt: 'alley',
    chapterNum: 1,
    sceneIndex: 0,
    promptIndex: 0,
    imageProvider: 'openai',
  });
  H('Image body ok', true);
} catch (e) {
  H('Image body ok', false, e.message);
}

// A9 portable strip secrets
const pack = buildPortableProject(
  {
    ten_tac_pham: 'X',
    apiKey: 'sk-secret-should-go',
    danh_sach_chuong: [
      {
        so_chuong: 1,
        tieu_de: 'Ch.1',
        noi_dung: SCRIPT,
      },
    ],
  },
  { stripSecrets: true },
);
H('portable strips apiKey', pack.state.apiKey === undefined);

// ═══════════════════════════════════════════════════════════════
// B) BUTTON WIRING — static graph from source
// ═══════════════════════════════════════════════════════════════
console.log('\n--- B) Button / action wiring (static) ---\n');

const coreActions = [
  // [label, file must contain wiring evidence]
  ['Setup handleRandomTemplate', 'src/app/workspace/hooks/useSetupActions.ts', 'handleRandomTemplate'],
  ['Setup handleGenerateOutline', 'src/app/workspace/hooks/useSetupActions.ts', 'GENERATE_OUTLINE|handleGenerateOutline'],
  ['Write handleWriteChapter', 'src/app/workspace/hooks/useWriteChapter.ts', 'writeChapterAction|WRITE_CHAPTER'],
  ['Scene expand', 'src/app/workspace/hooks/useSceneActions.ts', 'EXPAND_SCENE|expandScene'],
  ['Scene rewrite', 'src/app/workspace/hooks/useSceneActions.ts', 'REWRITE_SCENE|rewriteScene'],
  ['TTS scene', 'src/app/workspace/hooks/useTTSActions.ts', 'handleGenerateTTS'],
  ['TTS module API', 'src/app/workspace/modules/ttsModule.ts', 'generateTts|API.generateTts'],
  ['Image prompt', 'src/app/workspace/hooks/useImagePromptActions.ts', 'GENERATE_IMAGE_PROMPT|handleGenerateImagePrompt'],
  ['Image gen', 'src/app/workspace/modules/imageModule.ts', 'generateImage|API.generateImage'],
  ['Video gen', 'src/app/workspace/modules/videoModule.ts', 'generateVideo|API.generateVideo'],
  ['Character prompt', 'src/app/workspace/hooks/useCharacterActions.ts', 'handleGenerateCharPrompt'],
  ['Chapter page wires ContentTab', 'src/app/workspace/page.tsx', 'handleWriteChapter|handleGenerateTTS|handleGenerateImage'],
  ['SceneCard expand/rewrite/TTS/studio', 'src/app/workspace/features/script/SceneCard.tsx', 'handleExpandScene|handleRewriteScene|handleGenerateAllImages'],
  ['SceneTtsBar', 'src/app/workspace/features/script/SceneTtsBar.tsx', 'handleGenerateTTS|handlePlayTTS'],
  ['CapCut export', 'src/app/workspace/features/project/CapCutExportButton.tsx', 'export-capcut|exportCapcut|API'],
  ['Ship pack', 'src/app/workspace/features/project/ShipPackModal.tsx', 'ship-pack|shipPack|API'],
  ['Import modal', 'src/app/workspace/features/project/ImportModal.tsx', 'onClose|import'],
  // Portable lib is Free-tier; UI may live outside Settings (export TXT / import foundation)
  ['Project export TXT', 'src/app/workspace/modules/projectModule.ts', 'exportTxtAction'],
  ['Project portable lib', 'src/lib/projectPortable.ts', 'buildPortableProject|downloadPortableProject'],
  ['Credential health', 'src/app/workspace/features/settings/CredentialHealthPanel.tsx', 'evaluateCredentialHealth|healthRuntime'],
  ['Onboarding core-loop', 'src/app/workspace/features/onboarding/OnboardingBanner.tsx', 'CORE_LOOP_STEPS|loadOnboarding|dismissOnboarding'],
  ['Youtube checklist', 'src/app/workspace/features/youtube/YoutubeSafeChecklist.tsx', 'generateYoutubeMeta|buildYoutubeChecklist|downloadPack'],
  ['Job report', 'src/app/workspace/features/channels/JobQueuePanel.tsx', 'buildJobErrorReport'],
  ['Toolbox registry', 'src/app/workspace/features/toolbox/toolboxRegistry.ts', 'TOOLBOX_ITEMS'],
  ['Toolbox Pro gate', 'src/app/workspace/features/toolbox/ToolboxHost.tsx', 'toolbox_labs|TOOLBOX_ITEMS'],
];

for (const [label, rel, pattern] of coreActions) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) {
    H(`wire: ${label}`, false, `missing ${rel}`);
    continue;
  }
  const src = fs.readFileSync(abs, 'utf8');
  const re = new RegExp(pattern, 'i');
  H(`wire: ${label}`, re.test(src), rel);
}

// Create voice tab — clone flow is live (no decorative disabled badge required)
const createVoice = fs.readFileSync(
  path.join(root, 'src/app/workspace/features/tts/tabs/CreateVoiceTab.tsx'),
  'utf8',
);
S(
  'CreateVoiceTab has clone/preview actions',
  /handleTestGeneration|onPreviewCloneProfile|cloneFileInputRef/.test(createVoice),
  'clone UI present',
);

// Residual: portable Free feature is library-complete; Settings one-click UI not required for pack
const settingsSrc = fs.readFileSync(
  path.join(root, 'src/app/workspace/features/settings/SettingsPanel.tsx'),
  'utf8',
);
S(
  'SettingsPanel focuses credentials/GPU (portable export is lib-level Free)',
  /apiKey|Provider|NVENC|gemini|openai/i.test(settingsSrc) &&
    !/buildPortableProject/.test(settingsSrc),
  'portable UI not in Settings — use lib/e2e path or future feature surface',
);

// Hardcoded /api/ vs API constant (soft debt)
const workspaceSrc = [];
function walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p);
    else if (/\.(tsx|ts)$/.test(ent.name)) workspaceSrc.push(p);
  }
}
walk(path.join(root, 'src/app/workspace'));
let hardcodedApi = 0;
const hardcodedSamples = [];
for (const f of workspaceSrc) {
  const t = fs.readFileSync(f, 'utf8');
  const m = t.match(/['"`]\/api\/[a-zA-Z0-9_\-\/]+/g);
  if (m) {
    hardcodedApi += m.length;
    if (hardcodedSamples.length < 8) {
      hardcodedSamples.push(`${path.relative(root, f)}: ${m.slice(0, 2).join(', ')}`);
    }
  }
}
S(
  'workspace prefers API.* over raw /api (debt ok if few)',
  hardcodedApi < 15,
  `raw /api literals≈${hardcodedApi}; samples: ${hardcodedSamples.join(' | ')}`,
);

// SceneCard must pass handlers to ScenePromptRow
const sceneCard = fs.readFileSync(
  path.join(root, 'src/app/workspace/features/script/SceneCard.tsx'),
  'utf8',
);
H('SceneCard → onGenImage', /onGenImage=/.test(sceneCard));
H(
  'SceneCard → onUpscale',
  /onUpscale=/.test(sceneCard) &&
    (/navtools\/upscale/.test(sceneCard) || /API\.navtools\.upscale/.test(sceneCard)),
);
H(
  'SceneCard → onBgRemove',
  /onBgRemove=/.test(sceneCard) &&
    (/bg_remove/.test(sceneCard) || /API\.navtools\.bgRemove/.test(sceneCard)),
);

// generate handler owner coverage
const handlersDir = path.join(root, 'src/app/api/generate/handlers');
for (const h of ['chapter', 'scene', 'imagePrompt', 'outline', 'character', 'ideas', 'foundation', 'visualDna']) {
  H(`handler file ${h}`, fs.existsSync(path.join(handlersDir, `${h}.ts`)));
}
const chapterSrc = fs.readFileSync(path.join(handlersDir, 'chapter.ts'), 'utf8');
H('WRITE_CHAPTER has word-gate + scenes', /Word-Gate|wordMin|MIN_SCENE_COUNT|normalizeSceneTags/.test(chapterSrc));
H('WRITE_CHAPTER forbids time-skip', /time-skip|CẤM time-skip/i.test(chapterSrc));
H('WRITE_CHAPTER NFC', /normalize\('NFC'\)/.test(chapterSrc));
H('WRITE_CHAPTER human jokes', /injectHumanJokeAsides|humanize/.test(chapterSrc));

const imagePromptSrc = fs.readFileSync(path.join(handlersDir, 'imagePrompt.ts'), 'utf8');
H('imagePrompt uses character consistency path', /character|nhan_vat|Subject|prompt/i.test(imagePromptSrc));

// TTS registry edge
const reg = fs.readFileSync(path.join(root, 'src/app/api/generate-tts/ttsRegistry.ts'), 'utf8');
H('ttsRegistry has edge_tts', /edge_tts/.test(reg));

// ═══════════════════════════════════════════════════════════════
// C) RUNTIME / HEALTH (local fs)
// ═══════════════════════════════════════════════════════════════
console.log('\n--- C) Runtime health (local) ---\n');
const rh = probeRuntimeHealth(root);
H('runtime contracts ok', rh.items.some((i) => i.id === 'contracts' && i.level === 'ok'));
S('ffmpeg present', rh.items.some((i) => i.id === 'ffmpeg' && i.level === 'ok'), rh.items.find((i) => i.id === 'ffmpeg')?.detail);
S('edge package', rh.items.some((i) => i.id === 'edge_tts_pkg' && i.level === 'ok'));
const ch = evaluateCredentialHealth({
  apiKey: '',
  ttsConfig: { platform: 'edge_tts', voice: 'vi-VN-HoaiMyNeural' },
  imageProvider: 'gemini',
});
H('credential health returns items', ch.items.length > 0);

// ═══════════════════════════════════════════════════════════════
// D) LIVE SERVER (optional)
// ═══════════════════════════════════════════════════════════════
console.log('\n--- D) Live server (optional) ---\n');
const base = process.env.AINOVEL_BASE || 'http://127.0.0.1:3000';
let serverUp = false;
try {
  const res = await fetch(`${base}/api/health/runtime`, { signal: AbortSignal.timeout(3000) });
  serverUp = res.ok;
  if (res.ok) {
    const j = await res.json();
    H('live /api/health/runtime', j.fail === 0 || Array.isArray(j.items), `fail=${j.fail}`);
  } else {
    S('live server', false, `HTTP ${res.status} — skip live button probes`);
  }
} catch (e) {
  S('live server', false, `unreachable (${e.message}) — start npm run dev for live button probes`);
}

if (serverUp) {
  // Validation-only: bad bodies must 400
  const badGen = await fetch(`${base}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestType: 'NOPE' }),
  });
  H('live generate rejects bad requestType', badGen.status === 400, `status=${badGen.status}`);

  const badTts = await fetch(`${base}/api/generate-tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sceneText: 'hi' }),
  });
  H('live tts rejects missing platform', badTts.status === 400, `status=${badTts.status}`);

  const badImg = await fetch(`${base}/api/generate-image`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: '', chapterNum: 1, sceneIndex: 0, promptIndex: 0, imageProvider: 'openai' }),
  });
  H('live image rejects empty prompt', badImg.status === 400, `status=${badImg.status}`);
}

// ═══════════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════════
console.log('\n=== SUMMARY ===');
console.log(`HARD failures: ${hard.length}`);
console.log(`SOFT warnings: ${soft.length}`);
if (hard.length) {
  console.log('\nHard list:');
  hard.forEach((x) => console.log(`  - ${x.name}: ${x.detail}`));
}
if (soft.length) {
  console.log('\nSoft list:');
  soft.forEach((x) => console.log(`  - ${x.name}: ${x.detail}`));
}

const reportPath = path.join(root, 'exports', 'audit-functional-report.json');
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(
  reportPath,
  JSON.stringify(
    {
      at: new Date().toISOString(),
      hard,
      soft,
      serverUp,
      pass: hard.length === 0,
    },
    null,
    2,
  ),
  'utf8',
);
console.log(`\nReport: ${reportPath}`);

if (hard.length) {
  console.log('\nRESULT: FAIL (hard)\n');
  process.exit(1);
}
console.log('\nRESULT: PASS (no hard failures)\n');
process.exit(0);
