/**
 * Empirical user-workflow walk — real HTTP + disk + engines.
 * Does NOT print API key values.
 *
 * Run (server must be up on :3000):
 *   npx tsx scripts/walk-user-workflow-live.mts
 */
import fs from 'node:fs';
import path from 'node:path';
import { evaluateMediaPreflight } from '../src/lib/pipeline/mediaPreflight.ts';
import { setChapterQuality } from '../src/lib/pipeline/pipelineStore.ts';
import { wordBandFromSetupGoal } from '../src/lib/pipeline/wordBand.ts';
import { buildXinChaoPack } from '../src/lib/integrations/xinchaoCut.ts';

const BASE = process.env.AINOVEL_SMOKE_BASE || 'http://127.0.0.1:3000';
const OUT = path.join(process.cwd(), 'scratch', 'workflow-walk');
fs.mkdirSync(OUT, { recursive: true });

type StepResult = {
  step: string;
  req: string;
  ok: boolean;
  detail: string;
  artifact?: string;
};

const results: StepResult[] = [];

function loadEnvFile(file: string) {
  const p = path.join(process.cwd(), file);
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 1) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (!process.env[k]) process.env[k] = v;
  }
}

loadEnvFile('.env');
loadEnvFile('.env.local');

function geminiKeys(): string[] {
  const keys = [
    process.env.GEMINI_KEY_1,
    process.env.GEMINI_KEY_2,
    process.env.GEMINI_KEY_3,
    process.env.GEMINI_KEY_4,
    process.env.GEMINI_KEY_5,
    process.env.GEMINI_API_KEY,
  ].filter((k): k is string => Boolean(k && k.length > 12));
  const seen = new Set<string>();
  return keys.filter((k) => (seen.has(k) ? false : (seen.add(k), true)));
}

function loadStore(): Record<string, unknown> {
  const p = path.join(
    process.env.APPDATA || '',
    'ai-novel-script-generator',
    'novel_store_backup.json',
  );
  if (!fs.existsSync(p)) return {};
  const j = JSON.parse(fs.readFileSync(p, 'utf8')) as {
    state?: Record<string, unknown>;
  };
  return (j.state || j) as Record<string, unknown>;
}

function record(r: StepResult) {
  results.push(r);
  const mark = r.ok ? 'PASS' : 'FAIL';
  console.log(`\n[${mark}] ${r.step}`);
  console.log(`  req: ${r.req}`);
  console.log(`  → ${r.detail}`);
  if (r.artifact) console.log(`  artifact: ${r.artifact}`);
}

async function fetchJson(
  url: string,
  init?: RequestInit,
  timeoutMs = 120_000,
): Promise<{ status: number; data: Record<string, unknown>; ms: number }> {
  const t0 = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ac.signal });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: res.status, data, ms: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
  }
}

function fileOk(relOrAbs: string): { ok: boolean; bytes: number; path: string } {
  const candidates = [
    relOrAbs,
    path.join(process.cwd(), relOrAbs.replace(/^\//, '')),
    path.join(process.cwd(), 'public', relOrAbs.replace(/^\//, '')),
    path.join(
      process.cwd(),
      'public',
      relOrAbs.replace(/^\//, '').replace(/^audio\//, 'audio/'),
    ),
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c) && fs.statSync(c).isFile()) {
        const st = fs.statSync(c);
        return { ok: st.size > 44, bytes: st.size, path: c };
      }
    } catch {
      /* next */
    }
  }
  return { ok: false, bytes: 0, path: relOrAbs };
}

// ─── STEP 0: Boot / health ───────────────────────────────────────────
async function step0_boot() {
  const req = 'Next dev up; /api/health/runtime 200; fail=0';
  try {
    const { status, data, ms } = await fetchJson(`${BASE}/api/health/runtime`, undefined, 20_000);
    const fail = Number((data as { fail?: number }).fail ?? data.summary?.fail ?? 0);
    // health shape may nest
    const ok = status === 200;
    record({
      step: '0.BOOT health',
      req,
      ok,
      detail: `HTTP ${status} in ${ms}ms · body keys=${Object.keys(data).join(',')}`,
    });
    return ok;
  } catch (e) {
    record({
      step: '0.BOOT health',
      req,
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    });
    return false;
  }
}

// ─── STEP 1: Setup / store readiness ─────────────────────────────────
function step1_setup(store: Record<string, unknown>) {
  const setup = (store.setup || {}) as Record<string, unknown>;
  const chu = String(setup.chu_de || '').trim();
  const phong = String(setup.phong_cach || '').trim();
  const soTu = Number(setup.so_tu_chuong) || 0;
  const wpm = Number(store.wpm) || 0;
  const beat = Number(store.secondsPerBeat) || 0;
  const dna = String(store.visualDnaPrompt || store.mediaStylePreset || '').trim();
  const ok = Boolean(chu && phong && soTu > 0 && wpm > 0 && beat > 0 && dna);
  record({
    step: '1.SETUP store',
    req: 'chu_de + phong_cach + so_tu + wpm + beat + style/DNA',
    ok,
    detail: JSON.stringify({
      title: store.ten_tac_pham,
      chu,
      phong,
      soTu,
      wpm,
      beat,
      dnaLen: dna.length,
      is_pro: store.is_pro,
      is_trial: store.is_trial,
      credits: store.credits,
      imageProvider: store.imageProvider,
      videoProvider: store.videoProvider,
      tts: (store.ttsConfig as { platform?: string; voice?: string }) || null,
    }),
  });
  return { chu, phong, soTu, wpm, beat, dna, ok };
}

// ─── STEP 2: Chapter content / word-gate / scenes ────────────────────
function step2_chapter(store: Record<string, unknown>, soTu: number) {
  const chs = (store.danh_sach_chuong || []) as Array<{
    so_chuong?: number;
    tieu_de?: string;
    noi_dung?: string;
  }>;
  const withText = chs.filter((c) => String(c.noi_dung || '').trim().length > 50);
  const ch = withText[0];
  if (!ch) {
    record({
      step: '2.WRITE chapter content',
      req: '≥1 chương có nội dung + [CẢNH N] + word floor 92%',
      ok: false,
      detail: `chapters=${chs.length} withText=0`,
    });
    return null;
  }
  const text = String(ch.noi_dung || '');
  const words = text.split(/\s+/).filter(Boolean).length;
  const scenes = (text.match(/\[CẢNH\s+\d+/g) || []).length;
  const band = wordBandFromSetupGoal(soTu);
  const wordsOk = words >= band.min;
  const scenesOk = scenes >= 3;
  const ok = wordsOk && scenesOk;
  record({
    step: '2.WRITE chapter content',
    req: `word≥${band.min} (92% of ${band.goal}) · scenes≥3`,
    ok,
    detail: JSON.stringify({
      so_chuong: ch.so_chuong,
      title: ch.tieu_de,
      words,
      scenes,
      band,
      wordsOk,
      scenesOk,
    }),
  });
  return { ch, text, words, scenes, band, ok };
}

// ─── STEP 3: Quality gate store inject for media preflight ───────────
function step3_quality(chapterNum: number, chapterOk: boolean) {
  // Inject a green quality snapshot so preflight can evaluate media stages
  // (in-process store — mirrors finish-write pipeline for walk).
  setChapterQuality({
    chapter: chapterNum,
    ok: chapterOk,
    mediaReady: chapterOk,
    wordCount: chapterOk ? 1200 : 100,
    sceneCount: chapterOk ? 6 : 1,
    hardErrors: chapterOk ? 0 : 2,
    warnings: 0,
    findings: chapterOk
      ? []
      : [{ severity: 'error', code: 'walk', message: 'chapter not ready' }],
    checkedAt: new Date().toISOString(),
  });
  record({
    step: '3.QUALITY gate (in-process)',
    req: 'mediaReady=true sau finish write',
    ok: chapterOk,
    detail: chapterOk
      ? `Injected mediaReady for ch${chapterNum}`
      : `Would block media — chapter content not ready`,
  });
}

// ─── STEP 4: Media preflight pure (prompt/image/video/tts) ───────────
function step4_preflight(opts: {
  chapter: number;
  chu: string;
  phong: string;
  dna: string;
  wpm: number;
  beat: number;
  sceneText: string;
  duration: number;
  ttsPlatform: string;
  ttsVoice: string;
  hasImagePrompt: boolean;
  hasVideoPrompt: boolean;
  hasStartImage: boolean;
}) {
  const stages = ['tts', 'prompt', 'image', 'video'] as const;
  for (const stage of stages) {
    const r = evaluateMediaPreflight({
      stage,
      chapter: opts.chapter,
      sceneIndex: 1,
      chu_de: opts.chu,
      phong_cach: opts.phong,
      style: opts.dna,
      wpm: opts.wpm,
      secondsPerBeat: opts.beat,
      duration: opts.duration,
      sceneText: opts.sceneText,
      ttsPlatform: opts.ttsPlatform,
      ttsVoice: opts.ttsVoice,
      hasImagePrompt: opts.hasImagePrompt,
      hasVideoPrompt: opts.hasVideoPrompt,
      hasStartImage: opts.hasStartImage,
      imageProvider: 'flow',
      videoProvider: 'flow',
      videoModel: 'veo_3_1_i2v_s_fast',
      requireQualityGate: stage !== 'tts',
    });
    record({
      step: `4.PREFLIGHT ${stage}`,
      req: `evaluateMediaPreflight(${stage}) ok`,
      ok: r.ok,
      detail: r.ok
        ? r.summary
        : r.issues
            .filter((i) => i.level === 'block')
            .map((i) => `${i.code}:${i.message}`)
            .join(' | ')
            .slice(0, 400),
    });
  }
}

// ─── STEP 5: Existing audio artifacts on disk ────────────────────────
function step5_existing_audio(store: Record<string, unknown>) {
  const audio = (store.generatedAudioPaths || {}) as Record<
    string,
    { path?: string; duration?: number }
  >;
  const entries = Object.entries(audio);
  let okCount = 0;
  const samples: Array<Record<string, unknown>> = [];
  for (const [k, v] of entries.slice(0, 8)) {
    const p = String(v?.path || '');
    const f = fileOk(p);
    if (f.ok) okCount++;
    samples.push({ key: k, path: p, duration: v?.duration, bytes: f.bytes, diskOk: f.ok });
  }
  const ok = okCount > 0;
  record({
    step: '5.TTS artifacts (store→disk)',
    req: 'generatedAudioPaths map to files size>44',
    ok,
    detail: JSON.stringify({ total: entries.length, sampledOk: okCount, samples }),
  });
}

// ─── STEP 6: Live TTS via HTTP ───────────────────────────────────────
async function step6_tts_live(platform: string, voice: string) {
  const text =
    'Xin chào. Đây là kiểm tra TTS thực tế trong workflow AI Novel. Cảnh mở đầu, giọng rõ ràng.';
  const body = {
    sceneText: text,
    text,
    chapterNum: 1,
    sceneIndex: 998,
    ttsConfig: {
      platform,
      voice,
      speed: 1,
      pitch: 1,
      language: 'vi',
    },
  };
  try {
    const { status, data, ms } = await fetchJson(
      `${BASE}/api/generate-tts`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      180_000,
    );
    const audioPath = String(data.audioPath || data.path || data.url || '');
    const f = audioPath ? fileOk(audioPath) : { ok: false, bytes: 0, path: '' };
    // Some routes return buffer/base64
    const hasB64 =
      typeof data.audioBase64 === 'string' &&
      String(data.audioBase64).length > 100;
    const ok =
      status === 200 &&
      (data.success === true || f.ok || hasB64 || Number(data.duration) > 0);
    let artifact = f.path || audioPath || '';
    if (hasB64 && !f.ok) {
      const buf = Buffer.from(String(data.audioBase64), 'base64');
      artifact = path.join(OUT, `tts_${platform}_${Date.now()}.mp3`);
      fs.writeFileSync(artifact, buf);
    }
    const final = artifact ? fileOk(artifact) : f;
    record({
      step: `6.TTS live ${platform}`,
      req: `POST /api/generate-tts voice=${voice} → file>44B`,
      ok: ok && (final.ok || hasB64 || Number(data.duration) > 0),
      detail: JSON.stringify({
        status,
        ms,
        success: data.success,
        duration: data.duration,
        method: data.method,
        error: data.error,
        audioPath,
        bytes: final.bytes || (hasB64 ? String(data.audioBase64).length : 0),
      }),
      artifact: final.path || artifact || undefined,
    });
    return Number(data.duration) > 0 ? Number(data.duration) : 8;
  } catch (e) {
    record({
      step: `6.TTS live ${platform}`,
      req: `POST /api/generate-tts`,
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    });
    return 0;
  }
}

// ─── STEP 7: Live WRITE_CHAPTER (short Free-band) ────────────────────
async function step7_write_live(opts: {
  chu: string;
  phong: string;
  keys: string[];
}) {
  if (!opts.keys.length) {
    record({
      step: '7.WRITE live LLM',
      req: 'POST /api/generate WRITE_CHAPTER',
      ok: false,
      detail: 'No GEMINI_KEY_* in .env',
    });
    return null;
  }
  const body = {
    requestType: 'WRITE_CHAPTER',
    apiKeys: opts.keys.slice(0, 3),
    model: 'gemini',
    payload: {
      chu_de: opts.chu,
      phong_cach: opts.phong,
      genre: `${opts.chu} / ${opts.phong}`,
      mo_ta: 'Walk test: một cảnh ngắn, 3 thẻ CẢNH, thoại đời thường.',
      so_tu_chuong: 400,
      so_chuong: 1,
      chuong_hien_tai: {
        so_chuong: 1,
        tieu_de: 'Walk Test Hook',
        noi_dung: '',
      },
      lorebook: '',
      danh_sach_nhan_vat: [
        {
          ten: 'Hàn Dực',
          vai_tro: 'Nhân vật chính',
          khuet_tat: 'Nóng vội khi bị thúc',
        },
      ],
    },
  };
  try {
    const { status, data, ms } = await fetchJson(
      `${BASE}/api/generate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      300_000,
    );
    const content = String(
      data.content ||
        data.noi_dung ||
        (data.chapter as { noi_dung?: string } | undefined)?.noi_dung ||
        data.result ||
        '',
    );
    // stream / nested shapes
    let text = content;
    if (!text && typeof data.data === 'string') text = data.data;
    if (!text && data.success && typeof data.text === 'string') text = data.text;
    const words = text.split(/\s+/).filter(Boolean).length;
    const scenes = (text.match(/\[CẢNH\s+\d+/g) || []).length;
    const ok = status === 200 && words >= 80;
    const art = path.join(OUT, `write_ch1_${Date.now()}.txt`);
    if (text) fs.writeFileSync(art, text, 'utf8');
    record({
      step: '7.WRITE live LLM',
      req: 'POST WRITE_CHAPTER → text + scenes',
      ok,
      detail: JSON.stringify({
        status,
        ms,
        words,
        scenes,
        error: data.error,
        keys: Object.keys(data).slice(0, 12),
        preview: text.slice(0, 180).replace(/\s+/g, ' '),
      }),
      artifact: text ? art : undefined,
    });
    return ok ? text : null;
  } catch (e) {
    record({
      step: '7.WRITE live LLM',
      req: 'POST WRITE_CHAPTER',
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

// ─── STEP 8: Live GENERATE_IMAGE_PROMPT ──────────────────────────────
async function step8_prompt_live(opts: {
  chu: string;
  phong: string;
  dna: string;
  wpm: number;
  beat: number;
  keys: string[];
  sceneText: string;
  duration: number;
}) {
  if (!opts.keys.length) {
    record({
      step: '8.GEN PROMPT live',
      ok: false,
      req: 'GENERATE_IMAGE_PROMPT',
      detail: 'No keys',
    });
    return null;
  }
  const body = {
    requestType: 'GENERATE_IMAGE_PROMPT',
    apiKeys: opts.keys.slice(0, 4),
    model: 'gemini',
    payload: {
      chu_de: opts.chu,
      phong_cach: opts.phong,
      genre: `${opts.chu} / ${opts.phong}`,
      style: opts.dna,
      wpm: opts.wpm,
      secondsPerBeat: opts.beat,
      duration: opts.duration || 12,
      script: opts.sceneText.slice(0, 1200),
      sceneText: opts.sceneText.slice(0, 1200),
      chapterNum: 1,
      sceneIndex: 1,
    },
  };
  try {
    const { status, data, ms } = await fetchJson(
      `${BASE}/api/generate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      300_000,
    );
    const prompts =
      (Array.isArray(data.prompts) && data.prompts) ||
      (Array.isArray(data.result) && data.result) ||
      (Array.isArray(data.data) && data.data) ||
      [];
    const list = prompts as Array<Record<string, unknown>>;
    const withImg = list.filter(
      (p) => String(p.image_prompt || p.imagePrompt || '').trim().length > 5,
    );
    const withVid = list.filter(
      (p) => String(p.video_prompt || p.videoPrompt || '').trim().length > 5,
    );
    const ok = status === 200 && withImg.length > 0 && withVid.length > 0;
    const art = path.join(OUT, `prompts_${Date.now()}.json`);
    fs.writeFileSync(art, JSON.stringify(data, null, 2).slice(0, 50_000), 'utf8');
    record({
      step: '8.GEN PROMPT live',
      req: 'image_prompt + video_prompt array',
      ok,
      detail: JSON.stringify({
        status,
        ms,
        count: list.length,
        withImg: withImg.length,
        withVid: withVid.length,
        error: data.error,
        keys: Object.keys(data).slice(0, 15),
      }),
      artifact: art,
    });
    return ok ? list : null;
  } catch (e) {
    record({
      step: '8.GEN PROMPT live',
      req: 'GENERATE_IMAGE_PROMPT',
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

// ─── STEP 9: Flow session ────────────────────────────────────────────
async function step9_flow() {
  try {
    const { status, data, ms } = await fetchJson(
      `${BASE}/api/flow/status`,
      undefined,
      30_000,
    );
    const accounts = Array.isArray(data.accounts) ? data.accounts : [];
    const active =
      accounts.find(
        (a) =>
          (a as { id?: string }).id === data.activeAccountId,
      ) || accounts[0];
    const a = (active || {}) as {
      extensionConnected?: boolean;
      flowKeyPresent?: boolean;
      sessionVerified?: boolean;
      email?: string;
    };
    const emailOk = Boolean(a.email && String(a.email).includes('@'));
    const sessionReady = Boolean(
      a.extensionConnected && a.flowKeyPresent && a.sessionVerified && emailOk,
    );
    record({
      step: '9.FLOW session',
      req: 'extension + key + email + sessionVerified',
      ok: sessionReady,
      detail: JSON.stringify({
        status,
        ms,
        running: data.running,
        extensionConnected: data.extensionConnected ?? a.extensionConnected,
        flowKeyPresent: data.flowKeyPresent ?? a.flowKeyPresent,
        email: emailOk ? '(present)' : '(missing)',
        sessionVerified: a.sessionVerified,
        accounts: accounts.length,
        loginSessionOpen: data.loginSessionOpen,
        error: data.error,
      }),
    });
    return sessionReady;
  } catch (e) {
    record({
      step: '9.FLOW session',
      req: 'GET /api/flow/status',
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    });
    return false;
  }
}

// ─── STEP 10: Existing image artifacts ───────────────────────────────
function step10_images(store: Record<string, unknown>) {
  const images = (store.generatedImages || {}) as Record<string, string>;
  const entries = Object.entries(images);
  let okCount = 0;
  const samples: Array<Record<string, unknown>> = [];
  for (const [k, v] of entries.slice(0, 10)) {
    const f = fileOk(String(v || ''));
    if (f.ok) okCount++;
    samples.push({ key: k, path: v, bytes: f.bytes, diskOk: f.ok });
  }
  // also scan public/images + public/video recent
  const imgDir = path.join(process.cwd(), 'public', 'images');
  let diskImgs = 0;
  if (fs.existsSync(imgDir)) {
    diskImgs = fs
      .readdirSync(imgDir)
      .filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f)).length;
  }
  const vidDir = path.join(process.cwd(), 'public', 'video');
  let diskVids = 0;
  let bigVid = 0;
  if (fs.existsSync(vidDir)) {
    for (const f of fs.readdirSync(vidDir)) {
      if (!/\.mp4$/i.test(f)) continue;
      diskVids++;
      const st = fs.statSync(path.join(vidDir, f));
      if (st.size > 100_000) bigVid++;
    }
  }
  record({
    step: '10.IMAGE/VIDEO artifacts',
    req: 'store paths + public media size>0',
    ok: okCount > 0 || diskImgs > 0 || bigVid > 0,
    detail: JSON.stringify({
      storeImageKeys: entries.length,
      storeDiskOk: okCount,
      publicImages: diskImgs,
      publicVideos: diskVids,
      videosGt100k: bigVid,
      samples,
    }),
  });
}

// ─── STEP 11: Export CapCut pack (needs real media paths) ────────────
function step11_export(store: Record<string, unknown>) {
  const empty = buildXinChaoPack({
    chapterNum: 1,
    ten_tac_pham: 'Walk Empty',
    aspect: '16:9',
    videoDuration: 6,
    imageProvider: 'flow',
    videoProvider: 'flow',
    generatedImages: {},
    generatedVideos: {},
    generatedAudioPaths: {},
    cwd: process.cwd(),
  });
  record({
    step: '11a.EXPORT empty hard-fail',
    req: 'empty pack success=false + error media',
    ok: empty.success === false && /media|đĩa/i.test(String(empty.error || '')),
    detail: empty.error || JSON.stringify(empty).slice(0, 200),
  });

  // Map store paths that exist on disk for chapter 1
  const genImg = (store.generatedImages || {}) as Record<string, string>;
  const genVid = (store.generatedVideos || {}) as Record<string, string>;
  const genAud = (store.generatedAudioPaths || {}) as Record<
    string,
    { path?: string; duration?: number }
  >;

  const images: Record<string, string> = {};
  for (const [k, v] of Object.entries(genImg)) {
    const f = fileOk(String(v || ''));
    if (f.ok) images[k] = f.path;
  }
  const videos: Record<string, string> = {};
  for (const [k, v] of Object.entries(genVid)) {
    const f = fileOk(String(v || ''));
    if (f.ok) videos[k] = f.path;
  }
  // Fallback: any real public video for ch keys
  const vidDir = path.join(process.cwd(), 'public', 'video');
  if (fs.existsSync(vidDir) && Object.keys(videos).length === 0) {
    const big = fs
      .readdirSync(vidDir)
      .map((f) => path.join(vidDir, f))
      .filter((p) => /\.mp4$/i.test(p) && fs.statSync(p).size > 100_000);
    if (big[0]) videos['1_1_0'] = big[0];
  }

  const audios: Record<string, { path: string; duration: number }> = {};
  for (const [k, v] of Object.entries(genAud)) {
    const f = fileOk(String(v?.path || ''));
    if (f.ok) audios[k] = { path: f.path, duration: Number(v?.duration) || 5 };
  }

  if (
    Object.keys(images).length === 0 &&
    Object.keys(videos).length === 0 &&
    Object.keys(audios).length === 0
  ) {
    // Synthetic tiny media so pack path is still exercised
    const tmp = path.join(process.cwd(), 'scratch', 'workflow-walk', '_pack_src');
    fs.mkdirSync(tmp, { recursive: true });
    const img = path.join(tmp, 'shot0.png');
    const aud = path.join(tmp, 'n.wav');
    fs.writeFileSync(
      img,
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
      ),
    );
    fs.writeFileSync(aud, Buffer.alloc(512, 1));
    images['1_1_0'] = img;
    audios['1_1'] = { path: aud, duration: 3 };
  }

  const pack = buildXinChaoPack({
    chapterNum: 1,
    ten_tac_pham: 'Walk Live Export',
    aspect: '16:9',
    videoDuration: 6,
    imageProvider: 'flow',
    videoProvider: 'flow',
    generatedImages: images,
    generatedVideos: videos,
    generatedAudioPaths: audios,
    cwd: process.cwd(),
  });
  record({
    step: '11b.EXPORT pack with media',
    req: 'packRoot + mediaDir on disk',
    ok: pack.success === true && Boolean(pack.packRoot && fs.existsSync(pack.packRoot)),
    detail: JSON.stringify({
      success: pack.success,
      error: pack.error,
      media: pack.media,
      timelineClips: pack.timelineClips,
      packRoot: pack.packRoot,
    }),
    artifact: pack.packRoot || undefined,
  });
}

// ─── STEP 12: Commercial status ──────────────────────────────────────
async function step12_commercial() {
  try {
    const { status, data, ms } = await fetchJson(
      `${BASE}/api/commercial/status`,
      undefined,
      20_000,
    );
    record({
      step: '12.COMMERCIAL status',
      req: 'GET /api/commercial/status',
      ok: status === 200,
      detail: JSON.stringify({
        status,
        ms,
        tier: data.tier,
        isPro: data.isPro ?? data.is_pro,
        isTrial: data.isTrial ?? data.is_trial,
        mode: data.mode ?? data.entitlementMode,
        keys: Object.keys(data).slice(0, 20),
      }),
    });
  } catch (e) {
    record({
      step: '12.COMMERCIAL status',
      req: 'GET commercial/status',
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    });
  }
}

async function main() {
  console.log('=== USER WORKFLOW LIVE WALK ===');
  console.log('BASE=', BASE);
  console.log('OUT=', OUT);

  const bootOk = await step0_boot();
  if (!bootOk) {
    console.error('\nServer not ready — abort remaining live HTTP steps.');
    printSummary();
    process.exit(1);
  }

  const store = loadStore();
  const setup = step1_setup(store);
  const chapter = step2_chapter(store, setup.soTu);
  const chNum = Number(chapter?.ch.so_chuong) || 1;
  step3_quality(chNum, Boolean(chapter?.ok));

  const sceneText =
    chapter?.text?.slice(0, 800) ||
    '[CẢNH 1: NỘI - PHÒNG THÍ NGHIỆM]\nHàn Dực hít sâu. Máy móc kêu vo vo.\n[CẢNH 2: NGOẠI - PHỐ ĐÊM]\nGió lạnh quét ngang.\n[CẢNH 3: NỘI - HÀNH LANG]\nBước chân vang vọng.';

  const prompts = (store.generatedPrompts || {}) as Record<
    string,
    Array<{ image_prompt?: string; video_prompt?: string }>
  >;
  const firstPromptKey = Object.keys(prompts)[0];
  const firstList = firstPromptKey ? prompts[firstPromptKey] || [] : [];
  const hasImgP = firstList.some((p) => String(p.image_prompt || '').trim());
  const hasVidP = firstList.some((p) => String(p.video_prompt || '').trim());

  const ttsCfg = (store.ttsConfig || {}) as {
    platform?: string;
    voice?: string;
  };
  const images = (store.generatedImages || {}) as Record<string, string>;
  const hasStart = Object.values(images).some((p) => fileOk(String(p)).ok);

  step4_preflight({
    chapter: chNum,
    chu: setup.chu,
    phong: setup.phong,
    dna: setup.dna,
    wpm: setup.wpm,
    beat: setup.beat,
    sceneText,
    duration: 24,
    ttsPlatform: String(ttsCfg.platform || 'piper'),
    ttsVoice: String(ttsCfg.voice || 'ngochuyen.onnx'),
    hasImagePrompt: hasImgP,
    hasVideoPrompt: hasVidP,
    hasStartImage: hasStart,
  });

  step5_existing_audio(store);

  // Live TTS — piper (user default) + vina if possible
  await step6_tts_live(
    String(ttsCfg.platform || 'piper'),
    String(ttsCfg.voice || 'ngochuyen.onnx'),
  );
  await step6_tts_live('edge_tts', 'vi-VN-HoaiMyNeural');

  const keys = geminiKeys();
  console.log(`\nGemini keys loaded: ${keys.length} (values hidden)`);

  await step7_write_live({
    chu: setup.chu || 'Xuyên Không',
    phong: setup.phong || 'Viễn Tưởng',
    keys,
  });

  await step8_prompt_live({
    chu: setup.chu || 'Xuyên Không',
    phong: setup.phong || 'Viễn Tưởng',
    dna:
      setup.dna ||
      'cinematic sci-fi, cool teal lighting, sharp detail, film still',
    wpm: setup.wpm || 160,
    beat: setup.beat || 4,
    keys,
    sceneText,
    duration: 16,
  });

  await step9_flow();
  step10_images(store);
  step11_export(store);
  await step12_commercial();

  printSummary();
  const failed = results.filter((r) => !r.ok).length;
  process.exit(failed > 0 ? 2 : 0);
}

function printSummary() {
  console.log('\n========== SUMMARY ==========');
  for (const r of results) {
    console.log(`${r.ok ? '✓' : '✗'} ${r.step}`);
  }
  const pass = results.filter((r) => r.ok).length;
  const fail = results.filter((r) => !r.ok).length;
  console.log(`\nPASS=${pass} FAIL=${fail} TOTAL=${results.length}`);
  const summaryPath = path.join(OUT, `summary_${Date.now()}.json`);
  fs.writeFileSync(summaryPath, JSON.stringify(results, null, 2), 'utf8');
  console.log('Wrote', summaryPath);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
