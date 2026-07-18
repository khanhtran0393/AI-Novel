/**
 * CapAssistant Auto Master pipeline — independent AI Novel implementation.
 * Flow: STT → Translate → TTS → FFmpeg Render
 * No CapAssistant.exe / app path dependency.
 */
import fs from 'fs';
import path from 'path';
import { spawn, spawnSync } from 'child_process';
import { callNavGateway } from '@/lib/nav/navPythonBridge';
import {
  buildCapAssistantCommand,
  buildSmartJoinCommand,
  probeVideo,
  resolveFfmpegPath,
} from '@/lib/capassistant/core';
import { compressAudioToMp3, transcribeAudioViaGemini } from '@/app/api/self-heal/media/mediaHelpers';

export type AutoMasterSrtMode = 'auto' | 'untranslated' | 'translated' | 'none';
export type AutoMasterTranslateMethod = 'api' | 'rpa' | 'skip';

export interface AutoMasterRequest {
  videoPath: string;
  videoPaths?: string[];
  outputDir: string;
  finalOutputPath?: string;
  srtMode?: AutoMasterSrtMode;
  srtContent?: string;
  translatedSrtContent?: string;
  audioLang?: string; // zh | vi | en
  targetLang?: string; // vi | en | zh
  translateMethod?: AutoMasterTranslateMethod;
  ruleId?: string;
  apiKey?: string;
  apiKeys?: string[];
  ttsVoice?: string;
  ttsSpeed?: number;
  enableTts?: boolean;
  enableRender?: boolean;
  muteOriginal?: boolean;
  vocalFilter?: boolean;
  gpu?: boolean;
  zoom?: number | string;
  speed?: number | string;
  volume?: number | string;
  flip?: boolean;
  loopVideo?: boolean;
  wmText?: string;
  srtStyle?: number | string;
  srtFont?: string;
  srtSize?: number | string;
  logoPath?: string;
  useLogo?: boolean;
  exportRatio?: string;
  skipTranslateIfSameLang?: boolean;
}

export interface AutoMasterArtifacts {
  workDir: string;
  originSrtPath?: string;
  translatedSrtPath?: string;
  ttsAudioPath?: string;
  joinedVideoPath?: string;
  finalVideoPath?: string;
  originSrt?: string;
  translatedSrt?: string;
}

export type AutoMasterLogFn = (line: string) => void;

function langCode(raw?: string): string {
  const t = String(raw || '').toLowerCase();
  if (t.includes('zh') || t.includes('trung') || t.includes('cn')) return 'zh';
  if (t.includes('en') || t.includes('anh') || t.includes('english')) return 'en';
  if (t.includes('vi') || t.includes('việt') || t.includes('viet')) return 'vi';
  return t.slice(0, 2) || 'vi';
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function baseName(filePath: string) {
  return path.basename(filePath, path.extname(filePath)) || `job_${Date.now()}`;
}

async function extractAudioWav(videoPath: string, outWav: string, log: AutoMasterLogFn): Promise<string> {
  const ffmpeg = resolveFfmpegPath();
  log(`[STT] Extract audio via ${ffmpeg}`);
  const res = spawnSync(
    ffmpeg,
    ['-y', '-i', videoPath, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', outWav],
    { encoding: 'utf8', windowsHide: true, timeout: 300_000 },
  );
  if (res.status !== 0 || !fs.existsSync(outWav)) {
    throw new Error(`Extract audio failed: ${(res.stderr || res.stdout || '').slice(0, 400)}`);
  }
  return outWav;
}

async function runStt(
  videoPath: string,
  workDir: string,
  language: string,
  log: AutoMasterLogFn,
): Promise<{ srtPath: string; srt: string }> {
  const srtPath = path.join(workDir, `${baseName(videoPath)}_origin.srt`);
  ensureDir(workDir);

  // IRON B10: chỉ python_core subtitle — không fallback Gemini STT che lỗi Whisper
  log('[STT] python_core subtitle gateway (no Gemini STT fallback)...');
  try {
    const gateway = await callNavGateway({
      action: 'subtitle',
      payload: {
        video_path: videoPath,
        out_path: srtPath,
        model: 'small',
        language: language === 'zh' ? 'zh' : language === 'en' ? 'en' : language === 'vi' ? 'vi' : 'auto',
      },
      timeoutMs: 600_000,
    });
    if (gateway.success && fs.existsSync(srtPath)) {
      const srt = fs.readFileSync(srtPath, 'utf8');
      if (srt.trim()) {
        log(`[STT] Gateway OK -> ${srtPath}`);
        return { srtPath, srt };
      }
    }
    throw new Error(gateway.error || 'subtitle gateway empty srt');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `CapAssistant STT: python_core/Whisper thất bại — không fallback Gemini online. ${msg}. ` +
        `Sửa Whisper model / video path / python_core gateway.`,
    );
  }
}

async function translateSrtWithGemini(
  srtText: string,
  apiKeys: string[],
  ruleId: string,
  targetLang: string,
  log: AutoMasterLogFn,
): Promise<string> {
  if (apiKeys.length === 0) {
    throw new Error('Thieu Gemini API key de dich SRT. Hay cau hinh API key trong app.');
  }

  const ruleMap: Record<string, string> = {
    modern: 'Tone chan thuc, gan gui, doi song hang ngay.',
    strict: 'Dich 1-1 sat nghia, giu cau truc goc.',
    auto: 'Tu dong doan boi canh va dieu chinh van phong.',
    xianxia: 'Han Viet co kinh, trang trong.',
    comedy: 'Vui tuoi, hai huoc, ngon tu hien dai.',
    action: 'Gon gang, manh me, dut khoat.',
  };
  const ruleDesc = ruleMap[ruleId] || ruleMap.modern;
  const langName = targetLang === 'en' ? 'English' : targetLang === 'zh' ? 'Chinese' : 'Vietnamese';

  const prompt = `You are a professional subtitle translator.
Translate the following SRT subtitles into ${langName}.
Style rule: ${ruleDesc}

HARD RULES:
1. Keep original SRT structure (index, timestamps, blank lines).
2. Do not merge/split cues. Same number of blocks.
3. Return ONLY pure SRT text, no markdown.

--- SRT ---
${srtText}`;

  const models = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'];
  let lastError: Error | null = null;

  for (const apiKey of apiKeys) {
    for (const model of models) {
      try {
        log(`[TRANS] Gemini ${model} key ...${apiKey.slice(-4)}`);
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.4, maxOutputTokens: 8192 },
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          lastError = new Error(data?.error?.message || `HTTP ${res.status}`);
          continue;
        }
        let text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        text = String(text).replace(/```(?:srt|text)?/gi, '').trim();
        if (text.includes('-->')) {
          log('[TRANS] Translate OK');
          return text;
        }
        lastError = new Error('Gemini returned non-SRT content');
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }
  }

  throw lastError || new Error('Translate failed');
}

function extractSpokenFromSrt(srtText: string): string {
  const lines = srtText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^\d+$/.test(l) && !l.includes('-->'));
  return lines.join('. ').replace(/\s+/g, ' ').trim();
}

/**
 * VI voiceover: Universal Zero-Shot ONNX brain (default narrator / profile).
 * IRON B10: không EMERGENCY Edge — return null để caller hard-fail.
 */
async function generateUniversalTtsFromSrt(
  srtText: string,
  outPath: string,
  voice: string,
  speed: number,
  log: AutoMasterLogFn,
): Promise<{ audioPath: string; duration: number } | null> {
  const spoken = extractSpokenFromSrt(srtText);
  if (!spoken) throw new Error('No spoken text extracted from SRT for TTS');
  ensureDir(path.dirname(outPath));

  try {
    const { synthesizeVinaVoice } = await import('@/lib/vinaVoice/engine');
    const { inspectVinaOnnxBrain } = await import('@/lib/vinaVoice/paths');
    const brain = inspectVinaOnnxBrain(process.cwd());
    if (!brain.ok) {
      log(
        `[TTS] UVE brain not ready (${brain.totalGB}GB missing=${(brain.missing || []).join(',')}) — no Edge emergency`,
      );
      return null;
    }
    const isEdgeNeural = /Neural$/i.test(voice || '');
    const profileName = !isEdgeNeural && voice ? voice : undefined;
    log(
      `[TTS] Universal Zero-Shot ONNX brain=${brain.totalGB}GB profile=${profileName || 'DEFAULT_NARRATOR'} speed=${speed}`,
    );
    const wavOut = outPath.replace(/\.[^.]+$/i, '') + '_uve.wav';
    const result = await synthesizeVinaVoice(
      {
        text: spoken,
        profileName,
        universalBrainMode: true,
        settings: {
          speed: Number.isFinite(speed) ? speed : 1,
          pitch_shift: 0,
          use_clone: true,
        },
      },
      {
        cwd: process.cwd(),
        outDir: path.join(path.dirname(outPath), `uve_${Date.now()}`),
      },
    );
    if (!result.ok || !result.audioPath || !fs.existsSync(result.audioPath)) {
      log(`[TTS] UVE failed: ${result.error || 'unknown'}`);
      return null;
    }
    // Convert wav → target path (mp3) via ffmpeg when needed
    if (outPath.toLowerCase().endsWith('.mp3') && !result.audioPath.toLowerCase().endsWith('.mp3')) {
      const ff = resolveFfmpegPath();
      const r = spawnSync(
        ff,
        ['-y', '-i', result.audioPath, '-codec:a', 'libmp3lame', '-q:a', '2', outPath],
        { encoding: 'utf8', windowsHide: true, timeout: 120_000 },
      );
      if (r.status !== 0 || !fs.existsSync(outPath)) {
        fs.copyFileSync(result.audioPath, wavOut);
        // keep wav as deliverable
        return {
          audioPath: result.audioPath,
          duration: 0,
        };
      }
    } else {
      fs.copyFileSync(result.audioPath, outPath);
    }
    log(`[TTS] UVE ok method=${result.method}`);
    return { audioPath: outPath, duration: 0 };
  } catch (e) {
    log(`[TTS] UVE exception: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

async function generateEdgeTtsFromSrt(
  srtText: string,
  outPath: string,
  voice: string,
  speed: number,
  log: AutoMasterLogFn,
): Promise<{ audioPath: string; duration: number }> {
  // Strip SRT to spoken text lines
  const spoken = extractSpokenFromSrt(srtText);
  if (!spoken) throw new Error('No spoken text extracted from SRT for TTS');

  ensureDir(path.dirname(outPath));

  // Prefer Universal ONNX brain for Vietnamese pipeline
  const tgtLooksVi =
    !voice ||
    /vi-VN|vi_|vietnamese|nữ|nam|lồng|truyện|tin tức/i.test(voice) ||
    !/Neural$/i.test(voice);
  // IRON B10: không EMERGENCY_EDGE / CLI fallback ngầm.
  // VI: bắt buộc UVE (ONNX). EN Neural: Edge chỉ khi voice là Edge Neural tường minh.
  if (tgtLooksVi) {
    const uve = await generateUniversalTtsFromSrt(srtText, outPath, voice, speed, log);
    if (uve) return uve;
    throw new Error(
      'CapAssistant TTS: Universal Zero-Shot (UVE/ONNX) thất bại — không fallback Edge. ' +
        'Sửa Vina/ONNX brain, profile sample, hoặc chọn voice Edge Neural tường minh (…Neural).',
    );
  }

  if (!/Neural$/i.test(voice)) {
    throw new Error(
      `CapAssistant TTS: voice "${voice}" không phải Edge Neural và UVE không chạy — không fallback. ` +
        'Chọn voice dạng vi-VN-…Neural hoặc profile Vina hợp lệ.',
    );
  }

  log(`[TTS] Edge TTS (explicit Neural, node-edge-tts only) voice=${voice} speed=${speed}`);

  try {
    const { EdgeTTS } = await import('node-edge-tts');
    const lang = voice.startsWith('vi') ? 'vi-VN' : voice.startsWith('en') ? 'en-US' : 'vi-VN';
    const ratePct = Math.round((speed - 1) * 100);
    const rate = ratePct === 0 ? 'default' : `${ratePct > 0 ? '+' : ''}${ratePct}%`;
    const tts = new EdgeTTS({
      voice,
      lang,
      outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
      rate,
      timeout: 120000,
    });
    await tts.ttsPromise(spoken, outPath);
  } catch (err) {
    // IRON B10: không CLI dự phòng — cùng engine cũng một đường duy nhất
    throw new Error(
      `Edge TTS (node-edge-tts) fail — không fallback CLI. ${err instanceof Error ? err.message : String(err)}. ` +
        `Cài/sửa package node-edge-tts.`,
    );
  }

  if (!fs.existsSync(outPath)) throw new Error('TTS output missing');

  const { resolveFfprobePath } = await import('@/lib/capassistant/core');
  const probe = spawnSync(
    resolveFfprobePath(),
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', outPath],
    { encoding: 'utf8', windowsHide: true },
  );
  const duration = parseFloat(probe.stdout || '') || 0;
  log(`[TTS] OK ${outPath} duration=${duration.toFixed(2)}s`);
  return { audioPath: outPath, duration };
}

function runFfmpegStreaming(
  ffmpegPath: string,
  args: string[],
  log: AutoMasterLogFn,
  totalDuration = 0,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (d) => log(d.toString()));
    child.stderr.on('data', (d) => {
      const str = d.toString();
      log(str);
      if (totalDuration > 0) {
        const m = str.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/);
        if (m) {
          const sec = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
          const pct = Math.min(99, Math.max(1, Math.floor((sec / totalDuration) * 100)));
          log(`PROGRESS:${pct}`);
        }
      }
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg exited with code ${code}`));
    });
  });
}

export async function runAutoMaster(
  request: AutoMasterRequest,
  log: AutoMasterLogFn = console.log,
): Promise<AutoMasterArtifacts> {
  const videoList = (request.videoPaths?.length ? request.videoPaths : [request.videoPath])
    .map(String)
    .filter(Boolean);
  if (videoList.length === 0) throw new Error('Missing videoPath');
  for (const vp of videoList) {
    if (!fs.existsSync(vp)) throw new Error(`Video not found: ${vp}`);
  }

  const outputDir = request.outputDir || path.join(process.cwd(), 'output', 'auto-master');
  ensureDir(outputDir);
  const stamp = Date.now();
  const workDir = path.join(outputDir, `job_${stamp}`);
  ensureDir(workDir);

  const artifacts: AutoMasterArtifacts = { workDir };
  const srtMode: AutoMasterSrtMode = request.srtMode || 'auto';
  const enableTts = request.enableTts !== false;
  const enableRender = request.enableRender !== false;
  const srcLang = langCode(request.audioLang || 'zh');
  const tgtLang = langCode(request.targetLang || 'vi');
  const apiKeys = [
    ...(Array.isArray(request.apiKeys) ? request.apiKeys : []),
    request.apiKey || '',
  ].filter(Boolean);

  log('[START] AI Novel CapAssistant Auto Master (independent)');
  log(`[INFO] videos=${videoList.length} srtMode=${srtMode} ${srcLang}->${tgtLang}`);
  log(`PROGRESS:2`);

  // Join multi-video if needed
  let activeVideo = videoList[0];
  if (videoList.length > 1) {
    log('[JOIN] SmartJoin multiple sources...');
    const joined = path.join(workDir, `joined_${stamp}.mp4`);
    const builtJoin = buildSmartJoinCommand(videoList, joined, request.exportRatio || 'Giữ nguyên');
    await runFfmpegStreaming(builtJoin.ffmpegPath, builtJoin.ffmpegArgs, log);
    if (!fs.existsSync(joined)) throw new Error('SmartJoin failed');
    activeVideo = joined;
    artifacts.joinedVideoPath = joined;
    log(`[JOIN_OK] ${joined}`);
  }
  log(`PROGRESS:8`);

  // ---- STEP 1: SRT origin ----
  let originSrt = '';
  if (srtMode === 'none') {
    log('[STEP 1/4] Skip subtitle (none mode)');
  } else if (srtMode === 'translated' && request.translatedSrtContent?.trim()) {
    originSrt = request.translatedSrtContent;
    artifacts.translatedSrt = originSrt;
    log('[STEP 1/4] Using provided translated SRT');
  } else if ((srtMode === 'untranslated' || srtMode === 'translated') && request.srtContent?.trim()) {
    originSrt = request.srtContent;
    log('[STEP 1/4] Using provided origin SRT');
  } else if (srtMode === 'auto' || !request.srtContent?.trim()) {
    log('[STEP 1/4] STT auto extract...');
    const stt = await runStt(activeVideo, workDir, srcLang, log);
    originSrt = stt.srt;
    artifacts.originSrtPath = stt.srtPath;
  } else {
    originSrt = request.srtContent || '';
  }

  if (originSrt) {
    const originPath = path.join(workDir, 'origin.srt');
    fs.writeFileSync(originPath, originSrt, 'utf8');
    artifacts.originSrtPath = originPath;
    artifacts.originSrt = originSrt;
  }
  log(`PROGRESS:30`);

  // ---- STEP 2: Translate ----
  let translatedSrt = artifacts.translatedSrt || '';
  if (srtMode === 'none') {
    translatedSrt = '';
  } else if (srtMode === 'translated' && request.translatedSrtContent?.trim()) {
    translatedSrt = request.translatedSrtContent;
  } else if (request.skipTranslateIfSameLang !== false && srcLang === tgtLang) {
    translatedSrt = originSrt;
    log('[STEP 2/4] Same language — skip translate');
  } else if (request.translateMethod === 'skip') {
    translatedSrt = originSrt;
    log('[STEP 2/4] Translate skipped by config');
  } else if (originSrt) {
    log('[STEP 2/4] Translating SRT...');
    translatedSrt = await translateSrtWithGemini(
      originSrt,
      apiKeys,
      request.ruleId || 'modern',
      tgtLang,
      log,
    );
  }

  if (translatedSrt) {
    const tPath = path.join(workDir, 'translated.srt');
    fs.writeFileSync(tPath, translatedSrt, 'utf8');
    artifacts.translatedSrtPath = tPath;
    artifacts.translatedSrt = translatedSrt;
  }
  log(`PROGRESS:55`);

  // ---- STEP 3: TTS ----
  let ttsPath = '';
  if (enableTts && (translatedSrt || originSrt) && srtMode !== 'none') {
    log('[STEP 3/4] Generating TTS voiceover...');
    const voice = String(request.ttsVoice || '').trim();
    if (!voice) {
      throw new Error(
        'CapAssistant: thiếu ttsVoice. Không gán vi-VN-HoaiMyNeural dự phòng. Chọn giọng TTS tường minh.',
      );
    }
    const speed = Number(request.ttsSpeed) || 1.2;
    const outAudio = path.join(workDir, `voice_${stamp}.mp3`);
    const tts = await generateEdgeTtsFromSrt(translatedSrt || originSrt, outAudio, voice, speed, log);
    ttsPath = tts.audioPath;
    artifacts.ttsAudioPath = ttsPath;
  } else {
    log('[STEP 3/4] TTS skipped');
  }
  log(`PROGRESS:70`);

  // ---- STEP 4: Render ----
  if (!enableRender) {
    log('[STEP 4/4] Render skipped');
    log('PROGRESS:100');
    return artifacts;
  }

  log('[STEP 4/4] FFmpeg render with CapAssistant engine...');
  const meta = probeVideo(activeVideo);
  const finalName = request.finalOutputPath
    || path.join(outputDir, `AutoMaster_${baseName(videoList[0])}_${stamp}.mp4`);
  ensureDir(path.dirname(finalName));

  const built = buildCapAssistantCommand({
    videoPath: activeVideo,
    outputPath: outputDir,
    finalOutputPath: finalName,
    video: {
      zoom: request.zoom ?? 100,
      speed: request.speed ?? 100,
      mute: request.muteOriginal ?? Boolean(ttsPath),
      vocalFilter: request.vocalFilter ?? false,
      flip: request.flip ?? false,
      loop: request.loopVideo ?? false,
      gpu: request.gpu ?? true,
      volume: request.volume ?? 100,
    },
    sub: {
      enableSub: srtMode !== 'none' && Boolean(translatedSrt || originSrt),
      srtContent: translatedSrt || originSrt || '',
      srtFont: request.srtFont || 'Anton',
      srtSize: request.srtSize ?? 24,
      srtDelay: 0,
      marginV: 40,
    },
    style: {
      srtStyle: request.srtStyle ?? 1,
      bgPadding: true,
      padX: 16,
      padY: 6,
    },
    bgm: {
      items: ttsPath
        ? [{ path: ttsPath, vol: 150, delay: 0, dur: 0, loop: false }]
        : [],
    },
    brand: {
      useLogo: Boolean(request.useLogo && request.logoPath),
      logoPath: request.logoPath || '',
      useWm: Boolean(request.wmText),
      wmText: request.wmText || 'AI Novel',
      useText: false,
    },
    trim: { enableTrim: false, items: [] },
    blur: { items: [] },
    phantom: {},
  });

  log(`[CMD] ${built.commandLine.slice(0, 300)}...`);
  await runFfmpegStreaming(built.ffmpegPath, built.ffmpegArgs, log, meta.duration || 0);

  // cleanup temp srt from builder
  for (const f of built.tempFiles || []) {
    try {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    } catch {
      // ignore
    }
  }

  if (!fs.existsSync(finalName)) throw new Error('Render finished but output file missing');
  artifacts.finalVideoPath = finalName;
  log(`PROGRESS:100`);
  log(`[SUCCESS] ${finalName}`);
  return artifacts;
}
