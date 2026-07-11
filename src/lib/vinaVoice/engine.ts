/**
 * Vina-Voice independent orchestrator for AI Novel.
 * Does NOT call Vina-Voice.exe — full pipeline owned by this app.
 */
import fs from 'fs';
import path from 'path';
import { execFileSync, execSync } from 'child_process';
import { EdgeTTS } from 'node-edge-tts';
import { applyVinaTextRules } from './textPipeline';
import { chunkVinaText } from './chunking';
import {
  applyProfileToSettings,
  loadVinaProfiles,
  mapToEdgeVoice,
  mergeSettings,
  emotionPitchBias,
} from './profiles';
import type {
  VinaSynthesizeRequest,
  VinaSynthesizeResult,
  VinaVoiceSettings,
  VinaChunk,
} from './types';

function ensureDir(d: string) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

function findFfmpeg(): string {
  const local = path.join(process.cwd(), 'bin', 'ffmpeg', 'ffmpeg.exe');
  if (fs.existsSync(local)) return local;
  return 'ffmpeg';
}

async function edgeSynthToFile(
  text: string,
  voice: string,
  outPath: string,
): Promise<void> {
  const tts = new EdgeTTS({ voice, lang: 'vi-VN' });
  // node-edge-tts API variants
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyTts = tts as any;
  if (typeof anyTts.ttsPromise === 'function') {
    await anyTts.ttsPromise(text, outPath);
    return;
  }
  if (typeof anyTts.toFile === 'function') {
    await anyTts.toFile(outPath, text);
    return;
  }
  throw new Error('node-edge-tts API không tương thích (ttsPromise/toFile missing).');
}

/** Chain atempo (each step must stay in [0.5, 2.0]) */
function buildAtempoChain(tempo: number): string[] {
  let t = Math.max(0.25, Math.min(4, tempo));
  const parts: string[] = [];
  while (t > 2.0 + 1e-6) {
    parts.push('atempo=2.0');
    t /= 2;
  }
  while (t < 0.5 - 1e-6) {
    parts.push('atempo=0.5');
    t /= 0.5;
  }
  if (Math.abs(t - 1) > 0.001 || parts.length === 0) {
    parts.push(`atempo=${Math.max(0.5, Math.min(2.0, t)).toFixed(4)}`);
  }
  return parts;
}

/**
 * Áp speed + pitch (semitone) + treble/formant lên file wav.
 * Đây là chỗ duy nhất đảm bảo slider UI Clone Voice có hiệu lực.
 */
function postProcessWav(
  inPath: string,
  outPath: string,
  settings: VinaVoiceSettings,
): void {
  const ffmpeg = findFfmpeg();
  const pitch = emotionPitchBias(settings);
  const speed = Math.max(0.5, Math.min(2.0, Number(settings.speed) || 1));
  const needPitch = Math.abs(pitch) > 0.01;
  const needSpeed = Math.abs(speed - 1) > 0.01;
  const needTreble =
    !!settings.treble_boost && Math.abs(settings.treble_boost) > 0.01;
  const needFormant =
    !!settings.formant && Math.abs(settings.formant - 1) > 0.01;

  // Không đổi gì → copy thẳng (tránh decode/encode thừa)
  if (!needPitch && !needSpeed && !needTreble && !needFormant) {
    if (path.resolve(inPath) !== path.resolve(outPath)) {
      fs.copyFileSync(inPath, outPath);
    }
    return;
  }

  const filters: string[] = [];
  // Pitch: asetrate + aresample, rồi atempo bù + speed người dùng
  if (needPitch) {
    const rate = Math.round(44100 * Math.pow(2, pitch / 12));
    const tempo = speed * (44100 / rate);
    filters.push(`asetrate=${rate}`, 'aresample=44100');
    filters.push(...buildAtempoChain(tempo));
  } else if (needSpeed) {
    filters.push(...buildAtempoChain(speed));
  }

  if (needTreble) {
    filters.push(`treble=g=${settings.treble_boost}`);
  }
  if (needFormant) {
    const g = ((settings.formant - 1) * 6).toFixed(2);
    filters.push(`equalizer=f=1200:t=q:w=1:g=${g}`);
  }

  const af = filters.join(',');
  console.log(
    `[VinaVoice postProcess] speed=${speed.toFixed(3)} pitch=${pitch.toFixed(2)} af=${af}`,
  );
  execFileSync(
    ffmpeg,
    ['-y', '-i', inPath, '-af', af, '-ac', '1', '-ar', '44100', outPath],
    { stdio: 'pipe' },
  );
}

function silenceWav(ms: number, outPath: string): void {
  const ffmpeg = findFfmpeg();
  const sec = Math.max(0.02, ms / 1000);
  execFileSync(
    ffmpeg,
    [
      '-y',
      '-f',
      'lavfi',
      '-i',
      `anullsrc=r=44100:cl=mono`,
      '-t',
      String(sec),
      outPath,
    ],
    { stdio: 'pipe' },
  );
}

function concatWithCrossfade(
  parts: { wav: string; pauseMs: number }[],
  outPath: string,
  crossfadeSec: number,
): void {
  const ffmpeg = findFfmpeg();
  if (parts.length === 1) {
    fs.copyFileSync(parts[0].wav, outPath);
    return;
  }

  // Build list: audio0, silence0, audio1, silence1, ...
  const files: string[] = [];
  const scratch = path.dirname(outPath);
  parts.forEach((p, i) => {
    files.push(p.wav);
    if (i < parts.length - 1 && p.pauseMs > 30) {
      const sil = path.join(scratch, `sil_${i}.wav`);
      silenceWav(p.pauseMs, sil);
      files.push(sil);
    }
  });

  const listFile = path.join(scratch, `concat_${Date.now()}.txt`);
  fs.writeFileSync(
    listFile,
    files.map((f) => `file '${f.replace(/\\/g, '/')}'`).join('\n'),
    'utf8',
  );
  try {
    // acrossfade is complex for many files; simple concat is stable & Vina-like enough
    execFileSync(
      ffmpeg,
      ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', outPath],
      { stdio: 'pipe' },
    );
  } catch {
    // re-encode fallback
    execFileSync(
      ffmpeg,
      [
        '-y',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        listFile,
        '-ac',
        '1',
        '-ar',
        '44100',
        outPath,
      ],
      { stdio: 'pipe' },
    );
  } finally {
    if (fs.existsSync(listFile)) fs.unlinkSync(listFile);
  }
  void crossfadeSec;
}

async function tryNativeEngine(
  text: string,
  settings: VinaVoiceSettings,
  outPath: string,
  cwd: string,
): Promise<{ ok: boolean; method?: string; error?: string }> {
  try {
    const pythonScript = path.join(cwd, 'src', 'python_core', 'vina_voice_infer.py');
    if (!fs.existsSync(pythonScript)) {
      return { ok: false, error: 'Python inference script not found' };
    }
    if (!settings.reference_audio) {
      return { ok: false, error: 'No reference audio for clone' };
    }

    const { spawn } = require('child_process');
    return new Promise((resolve) => {
      // Vina Voice often uses the same text as ref if not provided
      const refText = settings.reference_text || 'Mình là Ngọc, mình đến từ Hà Nội.';
      const args = [
        pythonScript,
        '--text', text,
        '--ref_text', refText,
        '--ref_audio', settings.reference_audio,
        '--output', outPath
      ];
      
      const child = spawn('python', args, { cwd });
      let errLog = '';
      child.stderr.on('data', (d: any) => { errLog += d.toString(); });
      child.on('close', (code: number) => {
        if (code === 0 && fs.existsSync(outPath)) {
          resolve({ ok: true, method: 'VinaEngine Python Native (clone)' });
        } else {
          // If GPU crashed, it fails. We fallback.
          resolve({ ok: false, error: `Python exit ${code}. Log: ${errLog.slice(-200)}` });
        }
      });
      child.on('error', (e: Error) => resolve({ ok: false, error: e.message }));
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function tryExternalEngine(
  text: string,
  settings: VinaVoiceSettings,
  outPath: string,
): Promise<{ ok: boolean; method?: string; error?: string }> {
  const base = (settings.engine_url || '').replace(/\/$/, '');
  if (!base) return { ok: false, error: 'no engine_url' };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);
    // Gửi speed=1 / pitch=0 cho engine — prosody UI áp sau bằng postProcessWav
    // (tránh engine bỏ qua slider hoặc double-apply không nhất quán).
    const res = await fetch(`${base}/v1/synthesize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        reference_audio: settings.reference_audio,
        reference_audio_b64: settings.reference_audio_b64,
        reference_text: settings.reference_text,
        speed: 1.0,
        pitch_shift: 0,
        speaker_seed: settings.speaker_seed,
        style_seed: settings.style_seed,
        formant: 1.0,
        treble_boost: 0,
        use_clone: settings.use_clone,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      return { ok: false, error: `engine HTTP ${res.status}` };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) return { ok: false, error: 'engine empty body' };
    fs.writeFileSync(outPath, buf);
    return { ok: true, method: 'VinaEngine HTTP (clone)' };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Chuẩn hóa file engine (mp3/wav/…) → wav mono 44.1k rồi áp speed/pitch UI */
function finalizeWithProsody(
  rawPath: string,
  outPath: string,
  settings: VinaVoiceSettings,
  outDir: string,
): void {
  const ffmpeg = findFfmpeg();
  const mid = path.join(outDir, `prosody_mid_${Date.now()}.wav`);
  try {
    execFileSync(
      ffmpeg,
      ['-y', '-i', rawPath, '-ac', '1', '-ar', '44100', mid],
      { stdio: 'pipe' },
    );
  } catch {
    // đã là wav đọc được
    fs.copyFileSync(rawPath, mid);
  }
  postProcessWav(mid, outPath, settings);
  try {
    if (fs.existsSync(mid) && path.resolve(mid) !== path.resolve(outPath)) {
      fs.unlinkSync(mid);
    }
  } catch {
    /* ignore */
  }
}

export async function synthesizeVinaVoice(
  req: VinaSynthesizeRequest,
  opts?: { cwd?: string; outDir?: string },
): Promise<VinaSynthesizeResult> {
  const cwd = opts?.cwd || process.cwd();
  const warnings: string[] = [];
  let settings = mergeSettings(req.settings, cwd);

  if (req.profileName) {
    const profiles = loadVinaProfiles(cwd);
    const hit = profiles.find((p) => p.name === req.profileName);
    if (hit) {
      settings = applyProfileToSettings(settings, hit, cwd);
      if (!settings.reference_audio) {
        warnings.push(
          `Profile "${req.profileName}" không tìm thấy file mẫu ${hit.filename} — dùng backend builtin.`,
        );
      }
    } else {
      warnings.push(`Không thấy profile "${req.profileName}".`);
    }
  }

  const cleaned = applyVinaTextRules(req.text, settings.custom_rules);
  if (!cleaned) {
    return {
      ok: false,
      method: 'none',
      chunks: 0,
      warnings,
      error: 'Văn bản rỗng sau khi chuẩn hóa.',
    };
  }

  const chunks = chunkVinaText(cleaned, settings);
  const outDir =
    opts?.outDir || path.join(cwd, 'scratch', 'vina-voice', String(Date.now()));
  ensureDir(outDir);
  const finalPath = path.join(outDir, 'output.wav');

  console.log(
    `[VinaVoice] synth profile=${req.profileName || '-'} speed=${settings.speed} pitch_shift=${settings.pitch_shift} emotion=${settings.emotion} clone=${settings.use_clone}`,
  );

  // 1) Prefer independent local clone engine if up
  if (!req.forceBuiltin) {
    const engineRaw = path.join(outDir, 'engine_raw.bin');
    let ext: { ok: boolean; method?: string; error?: string } = { ok: false };
    
    // First try Python native direct invocation (independent)
    if (settings.use_clone && settings.reference_audio) {
      ext = await tryNativeEngine(cleaned, settings, engineRaw, cwd);
    }
    
    // Fallback to HTTP (e.g. if Vina-Voice.exe is running on port 8765)
    if (!ext.ok) {
      ext = await tryExternalEngine(cleaned, settings, engineRaw);
    }
    
    if (ext.ok && fs.existsSync(engineRaw)) {
      try {
        finalizeWithProsody(engineRaw, finalPath, settings, outDir);
        return {
          ok: true,
          method: `${ext.method || 'VinaEngine'} + prosody(speed=${settings.speed},pitch=${settings.pitch_shift})`,
          audioPath: finalPath,
          chunks: chunks.length,
          warnings,
          mimeType: 'audio/wav',
        };
      } catch (ppErr) {
        warnings.push(
          `Post-process speed/pitch sau clone engine lỗi: ${
            ppErr instanceof Error ? ppErr.message : String(ppErr)
          }`,
        );
        // vẫn trả raw nếu post fail (không im lặng nuốt)
        try {
          fs.copyFileSync(engineRaw, finalPath);
          return {
            ok: true,
            method: ext.method || 'VinaEngine',
            audioPath: finalPath,
            chunks: chunks.length,
            warnings,
            mimeType: 'audio/wav',
          };
        } catch {
          /* fall through builtin */
        }
      }
    }
    if (settings.use_clone && settings.reference_audio) {
      warnings.push(
        `Engine clone offline không sẵn sàng (${ext.error}). Fallback Edge+postprocess.`,
      );
    }
  }

  // 2) Builtin: Edge TTS per chunk + pause + pitch/speed (Vina-like post)
  const voice = mapToEdgeVoice(settings);
  const processed: { wav: string; pauseMs: number }[] = [];

  try {
    for (const ch of chunks) {
      const rawPath = path.join(outDir, `raw_${ch.index}.mp3`);
      const wavPath = path.join(outDir, `chunk_${ch.index}.wav`);
      await edgeSynthToFile(ch.text, voice, rawPath);
      // mp3/webm → wav + post
      const ffmpeg = findFfmpeg();
      const mid = path.join(outDir, `mid_${ch.index}.wav`);
      try {
        execFileSync(
          ffmpeg,
          ['-y', '-i', rawPath, '-ac', '1', '-ar', '44100', mid],
          { stdio: 'pipe' },
        );
      } catch {
        // edge may already write wav
        fs.copyFileSync(rawPath, mid);
      }
      postProcessWav(mid, wavPath, settings);
      processed.push({ wav: wavPath, pauseMs: ch.pauseAfterMs });
    }

    concatWithCrossfade(processed, finalPath, settings.cross_fade_duration);

    return {
      ok: true,
      method: `VinaVoice Builtin (Edge ${voice} + postprocess)`,
      audioPath: finalPath,
      chunks: chunks.length,
      warnings,
      mimeType: 'audio/wav',
    };
  } catch (e) {
    return {
      ok: false,
      method: 'builtin-failed',
      chunks: chunks.length,
      warnings,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export function previewChunks(
  text: string,
  settingsPartial?: Partial<VinaVoiceSettings>,
  cwd = process.cwd(),
): { cleaned: string; chunks: VinaChunk[] } {
  const settings = mergeSettings(settingsPartial, cwd);
  const cleaned = applyVinaTextRules(text, settings.custom_rules);
  return { cleaned, chunks: chunkVinaText(cleaned, settings) };
}

export function engineStatus(cwd = process.cwd()) {
  const dataDir = path.join(cwd, 'data', 'vina-voices');
  const profiles = loadVinaProfiles(cwd);
  const sampleHits = profiles.filter((p) => {
    const s = applyProfileToSettings(mergeSettings({}, cwd), p, cwd);
    return !!s.reference_audio;
  }).length;
  const userClonesDir = path.join(dataDir, 'user-clones');
  let userCloneFiles = 0;
  try {
    if (fs.existsSync(userClonesDir)) {
      userCloneFiles = fs
        .readdirSync(userClonesDir)
        .filter((f) => /\.(wav|mp3)$/i.test(f) && !/_raw\./i.test(f)).length;
    }
  } catch {
    /* ignore */
  }
  return {
    independent: true,
    dependsOnVinaExe: false,
    dataDir,
    userClonesDir,
    userCloneFiles,
    profilesCount: profiles.length,
    samplesResolved: sampleHits,
    defaultEngineUrl: process.env.VINA_ENGINE_URL || 'http://127.0.0.1:8765',
    ffmpeg: (() => {
      try {
        execSync(`"${findFfmpeg()}" -version`, { stdio: 'pipe' });
        return true;
      } catch {
        return false;
      }
    })(),
    modelNote:
      'Clone đầy đủ: chạy tools/vina_voice_engine (8765). XTTS = tembre thật; không có thì Edge+post. Không cần Vina-Voice.exe.',
  };
}
