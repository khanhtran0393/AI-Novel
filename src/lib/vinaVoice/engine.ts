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
import {
  getVinaInferScript,
  getVinaOnnxModelsDir,
  inspectVinaOnnxBrain,
  resolveVinaPython,
} from './paths';
import {
  resolveSpeaker,
  speakerToSettings,
  SpeakerResolveError,
} from './speakerRegistry';
import {
  daemonSynth,
  isDaemonEnabled,
  resolveNfeStep,
} from './warmDaemon';

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
  opts?: { provider?: 'auto' | 'cuda' | 'dml' | 'cpu'; nfeStep?: number },
): Promise<{ ok: boolean; method?: string; error?: string }> {
  try {
    // Locked core brain — never tools/, never external Vina-Voice.exe
    const pythonScript = getVinaInferScript(cwd);
    const modelsDir = getVinaOnnxModelsDir(cwd);
    const brain = inspectVinaOnnxBrain(cwd);

    if (!fs.existsSync(pythonScript)) {
      return { ok: false, error: `Python inference script not found: ${pythonScript}` };
    }
    if (!brain.ok) {
      return {
        ok: false,
        error:
          `ONNX brain missing/incomplete under locked core path ${modelsDir}. ` +
          `missing=[${brain.missing.join(', ')}] totalGB=${brain.totalGB}. ` +
          `Restore model-tts_0/1/2.onnx + vocab.txt (~1.46GB).`,
      };
    }
    if (!settings.reference_audio) {
      return { ok: false, error: 'No reference audio for clone' };
    }

    const refText = (settings.reference_text || '').trim();
    if (!refText) {
      console.warn(
        '[VinaVoice] tryNativeEngine: reference_text empty — pass transcript of sample WAV for clean timbre.',
      );
    }
    const speakerSeed = Number.isFinite(settings.speaker_seed)
      ? Math.trunc(settings.speaker_seed)
      : 2336;
    const styleSeed = Number.isFinite(settings.style_seed)
      ? Math.trunc(settings.style_seed)
      : 4125;
    const provider = opts?.provider || 'auto';
    const nfeStep =
      Number.isFinite(opts?.nfeStep) && (opts?.nfeStep as number) > 0
        ? Math.trunc(opts!.nfeStep as number)
        : resolveNfeStep({});

    // ── Fast path: warm daemon (models stay in RAM) ──
    if (isDaemonEnabled()) {
      const warm = await daemonSynth(
        {
          text,
          refText,
          refAudio: settings.reference_audio,
          output: outPath,
          speed: 1.0,
          speakerSeed,
          styleSeed,
          nfeStep,
          provider,
          timeoutMs: 120_000,
        },
        cwd,
      );
      if (warm.ok && fs.existsSync(outPath)) {
        console.log(
          `[VinaVoice] warm-daemon OK nfe=${nfeStep} ${warm.method || ''} brain=${brain.totalGB}GB`,
        );
        return {
          ok: true,
          method:
            warm.method ||
            `VinaDaemon warm-ONNX (brain=${brain.totalGB}GB, seed=${speakerSeed}/${styleSeed}, nfe=${nfeStep})`,
        };
      }
      console.warn(
        `[VinaVoice] warm-daemon miss → one-shot CLI: ${warm.error || 'unknown'}`,
      );
    }

    const { spawn } = require('child_process') as typeof import('child_process');
    const pythonExe = resolveVinaPython(cwd);
    const timeoutMs = 150_000;
    return new Promise((resolve) => {
      console.log(
        `[VinaVoice] Native one-shot py=${pythonExe} brain=${modelsDir} (${brain.totalGB}GB) ` +
          `provider=${provider} nfe=${nfeStep} timeout=${timeoutMs}ms`,
      );
      // Duration planning speed=1; UI speed/pitch applied in finalizeWithProsody
      const args = [
        '-u',
        pythonScript,
        '--text',
        text,
        '--ref_text',
        refText,
        '--ref_audio',
        settings.reference_audio,
        '--output',
        outPath,
        '--speed',
        '1.0',
        '--speaker_seed',
        String(speakerSeed),
        '--style_seed',
        String(styleSeed),
        '--nfe_step',
        String(nfeStep),
        '--provider',
        provider,
        '--models_dir',
        modelsDir,
      ];

      let settled = false;
      const finish = (r: { ok: boolean; method?: string; error?: string }) => {
        if (settled) return;
        settled = true;
        clearTimeout(killer);
        resolve(r);
      };

      const child = spawn(pythonExe, args, {
        cwd,
        windowsHide: true,
        env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONUTF8: '1' },
      });
      let errLog = '';
      let outLog = '';
      child.stderr?.on('data', (d: Buffer | string) => {
        errLog += d.toString();
      });
      child.stdout?.on('data', (d: Buffer | string) => {
        outLog += d.toString();
      });

      const killer = setTimeout(() => {
        try {
          child.kill();
        } catch {
          /* ignore */
        }
        try {
          if (child.pid && process.platform === 'win32') {
            execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore' });
          }
        } catch {
          /* ignore */
        }
        finish({
          ok: false,
          error:
            `Native infer timeout ${timeoutMs}ms (py=${pythonExe}, ep=${provider}, nfe=${nfeStep}). ` +
            `Log: ${(errLog || outLog).slice(-600)}`,
        });
      }, timeoutMs);

      child.on('close', (code: number | null) => {
        if (code === 0 && fs.existsSync(outPath)) {
          finish({
            ok: true,
            method:
              `VinaEngine Python Native (clone, brain=${brain.totalGB}GB, ` +
              `seed=${speakerSeed}/${styleSeed}, nfe=${nfeStep}, ep=${provider}, py=${path.basename(pythonExe)})`,
          });
        } else {
          const tail = (errLog || outLog).slice(-800);
          finish({
            ok: false,
            error: `Python exit ${code ?? 'null'} (py=${pythonExe}, ep=${provider}, models=${modelsDir}). Log: ${tail}`,
          });
        }
      });
      child.on('error', (e: Error) => finish({ ok: false, error: e.message }));
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

/**
 * Universal Zero-Shot synthesizer.
 * Catalog voice = studio WAV mồi; user clone = user WAV mồi — same ONNX brain.
 * No silent Edge TTS when universalBrainMode is on (default).
 */
export async function synthesizeVinaVoice(
  req: VinaSynthesizeRequest,
  opts?: { cwd?: string; outDir?: string },
): Promise<VinaSynthesizeResult> {
  const cwd = opts?.cwd || process.cwd();
  const warnings: string[] = [];
  const brain = inspectVinaOnnxBrain(cwd);
  const universal =
    req.universalBrainMode !== false &&
    !req.forceBuiltin &&
    process.env.VINA_UNIVERSAL_BRAIN !== '0';

  let settings = mergeSettings(req.settings, cwd);

  // Resolve SpeakerRef (catalog / user / ad-hoc / default narrator)
  let speakerId: string | undefined;
  try {
    const speaker = resolveSpeaker({
      cwd,
      profileName: req.profileName,
      settings,
      preferAdHocRef: true,
    });
    speakerId = speaker.id;
    settings = speakerToSettings(speaker, settings, cwd);
    if (!speaker.reference_text) {
      warnings.push(
        `Speaker "${speaker.displayName}" thiếu reference_text — tembre/prosody có thể lệch. ` +
          `Nên gắn transcript khớp file mẫu.`,
      );
    }
    console.log(
      `[UVE] speaker=${speaker.kind}:${speaker.id} ref=${path.basename(speaker.reference_audio)} ` +
        `brain=${brain.totalGB}GB ready=${brain.ok} universal=${universal}`,
    );
  } catch (e) {
    if (e instanceof SpeakerResolveError) {
      // Profile miss: keep legacy apply if name given (warnings only)
      if (req.profileName && e.code === 'CODE_PROFILE_NOT_FOUND') {
        warnings.push(e.message);
      } else if (universal) {
        return {
          ok: false,
          method: 'uve-resolve-failed',
          chunks: 0,
          warnings,
          error: e.message,
          errorCode: e.code as VinaSynthesizeResult['errorCode'],
          speakerId,
        };
      } else {
        warnings.push(e.message);
      }
    } else {
      warnings.push(e instanceof Error ? e.message : String(e));
    }
    // Legacy profile apply when resolve failed non-universally
    if (req.profileName) {
      const profiles = loadVinaProfiles(cwd);
      const hit = profiles.find((p) => p.name === req.profileName);
      if (hit) settings = applyProfileToSettings(settings, hit, cwd);
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
      errorCode: 'CODE_EMPTY_TEXT',
      speakerId,
    };
  }

  const chunks = chunkVinaText(cleaned, settings);
  const outDir =
    opts?.outDir || path.join(cwd, 'scratch', 'vina-voice', String(Date.now()));
  ensureDir(outDir);
  const finalPath = path.join(outDir, 'output.wav');

  console.log(
    `[VinaVoice] synth profile=${req.profileName || speakerId || '-'} ` +
      `speed=${settings.speed} pitch_shift=${settings.pitch_shift} ` +
      `emotion=${settings.emotion} universal=${universal} ref=${!!settings.reference_audio}`,
  );

  // ── Universal / zero-shot path: ONNX brain only ──
  if (!req.forceBuiltin) {
    if (universal && !brain.ok) {
      return {
        ok: false,
        method: 'uve-brain-missing',
        chunks: chunks.length,
        warnings,
        error:
          `CODE_BRAIN_MISSING: Não ONNX không sẵn sàng tại ${brain.modelsDir}. ` +
          `missing=[${brain.missing.join(', ')}] totalGB=${brain.totalGB}. ` +
          `Khôi phục model-tts_0/1/2.onnx + vocab.txt.`,
        errorCode: 'CODE_BRAIN_MISSING',
        speakerId,
      };
    }

    if (universal && !settings.reference_audio) {
      return {
        ok: false,
        method: 'uve-ref-missing',
        chunks: chunks.length,
        warnings,
        error:
          `CODE_REF_MISSING: Universal Zero-Shot cần file mẫu (catalog WAV hoặc user clone). ` +
          `Chọn profile có sample hoặc upload reference_audio.`,
        errorCode: 'CODE_REF_MISSING',
        speakerId,
      };
    }

    const engineRaw = path.join(outDir, 'engine_raw.bin');
    let ext: { ok: boolean; method?: string; error?: string } = { ok: false };

    // NFE: preview 12 / chapter 20 / full 24 (env overrides). Was 32.
    const nfeStep = resolveNfeStep({
      isPreview: !!req.isPreview,
      isChapter: !!req.isChapter && !req.isPreview,
    });

    // Always prefer native ONNX when we have a ref (catalog = clone from studio sample)
    // Daemon already tries CUDA→DML→CPU once; avoid double full-load retry.
    if (settings.reference_audio) {
      ext = await tryNativeEngine(cleaned, settings, engineRaw, cwd, {
        provider: (process.env.VINA_PROVIDER as 'auto' | 'cuda' | 'dml' | 'cpu') || 'auto',
        nfeStep,
      });

      // Only one-shot cold path may need explicit CPU if auto never reached CPU
      if (!ext.ok && !/cpu/i.test(process.env.VINA_PROVIDER || 'auto')) {
        console.warn(
          `[UVE] Primary EP failed — single CPU retry. Error: ${ext.error}`,
        );
        ext = await tryNativeEngine(cleaned, settings, engineRaw, cwd, {
          provider: 'cpu',
          nfeStep,
        });
      }

      // Optional HTTP engine (XTTS :8765) only as secondary true-clone backend
      if (!ext.ok) {
        const httpExt = await tryExternalEngine(cleaned, settings, engineRaw);
        if (httpExt.ok) ext = httpExt;
        else if (httpExt.error) {
          warnings.push(`HTTP engine: ${httpExt.error}`);
        }
      }
    }

    if (ext.ok && fs.existsSync(engineRaw)) {
      try {
        finalizeWithProsody(engineRaw, finalPath, settings, outDir);
        const method =
          `${ext.method || 'UVE'} + ONNX-brain@${brain.totalGB}GB ` +
          `+ prosody(speed=${settings.speed},pitch=${settings.pitch_shift})` +
          (speakerId ? ` speaker=${speakerId}` : '');
        return {
          ok: true,
          method,
          audioPath: finalPath,
          chunks: chunks.length,
          warnings,
          mimeType: 'audio/wav',
          speakerId,
        };
      } catch (ppErr) {
        warnings.push(
          `Post-process speed/pitch sau UVE lỗi: ${
            ppErr instanceof Error ? ppErr.message : String(ppErr)
          }`,
        );
        try {
          fs.copyFileSync(engineRaw, finalPath);
          return {
            ok: true,
            method: `${ext.method || 'UVE'} + ONNX-brain@${brain.totalGB}GB`,
            audioPath: finalPath,
            chunks: chunks.length,
            warnings,
            mimeType: 'audio/wav',
            speakerId,
          };
        } catch {
          /* fall through hard-fail */
        }
      }
    }

    // HARD-FAIL under universal mode — never silent Edge
    if (universal || settings.reference_audio) {
      const detail = ext.error || 'unknown';
      const errMsg =
        `CODE_INFER_FAILED: Universal Zero-Shot (ONNX brain) thất bại — không fallback Edge TTS. ` +
        `Chi tiết: ${detail}. ` +
        `Kiểm tra: transcript mẫu, GPU/DML→CPU log, ${getVinaOnnxModelsDir(cwd)}.`;
      console.error('[UVE] HARD-FAIL:', errMsg);
      return {
        ok: false,
        method: 'uve-infer-failed',
        chunks: chunks.length,
        warnings,
        error: errMsg,
        errorCode: 'CODE_INFER_FAILED',
        speakerId,
      };
    }
  }

  // ── Escape hatch only: forceBuiltin or VINA_EMERGENCY_EDGE=1 ──
  const emergency =
    req.forceBuiltin ||
    process.env.VINA_EMERGENCY_EDGE === '1' ||
    process.env.VINA_EMERGENCY_EDGE === 'true';

  if (!emergency) {
    return {
      ok: false,
      method: 'uve-no-fallback',
      chunks: chunks.length,
      warnings,
      error:
        'Không có path Edge im lặng. Bật forceBuiltin hoặc VINA_EMERGENCY_EDGE=1 nếu cần escape hatch.',
      errorCode: 'CODE_INFER_FAILED',
      speakerId,
    };
  }

  const voice = mapToEdgeVoice(settings);
  const processed: { wav: string; pauseMs: number }[] = [];

  try {
    for (const ch of chunks) {
      const rawPath = path.join(outDir, `raw_${ch.index}.mp3`);
      const wavPath = path.join(outDir, `chunk_${ch.index}.wav`);
      await edgeSynthToFile(ch.text, voice, rawPath);
      const ffmpeg = findFfmpeg();
      const mid = path.join(outDir, `mid_${ch.index}.wav`);
      try {
        execFileSync(
          ffmpeg,
          ['-y', '-i', rawPath, '-ac', '1', '-ar', '44100', mid],
          { stdio: 'pipe' },
        );
      } catch {
        fs.copyFileSync(rawPath, mid);
      }
      postProcessWav(mid, wavPath, settings);
      processed.push({ wav: wavPath, pauseMs: ch.pauseAfterMs });
    }

    concatWithCrossfade(processed, finalPath, settings.cross_fade_duration);

    warnings.push(
      'EMERGENCY_EDGE: không dùng não ONNX — chỉ khi forceBuiltin / VINA_EMERGENCY_EDGE.',
    );
    return {
      ok: true,
      method: `EMERGENCY_EDGE (not ONNX) Edge ${voice} + postprocess`,
      audioPath: finalPath,
      chunks: chunks.length,
      warnings,
      mimeType: 'audio/wav',
      errorCode: 'CODE_EMERGENCY_EDGE',
      speakerId,
    };
  } catch (e) {
    return {
      ok: false,
      method: 'builtin-failed',
      chunks: chunks.length,
      warnings,
      error: e instanceof Error ? e.message : String(e),
      speakerId,
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
  const brain = inspectVinaOnnxBrain(cwd);
  return {
    independent: true,
    dependsOnVinaExe: false,
    dataDir,
    userClonesDir,
    userCloneFiles,
    profilesCount: profiles.length,
    samplesResolved: sampleHits,
    /** Locked ONNX brain under src/python_core/models/vina_voice/ */
    onnxBrain: {
      modelsDir: brain.modelsDir,
      ready: brain.ok,
      totalBytes: brain.totalBytes,
      totalGB: brain.totalGB,
      files: brain.files,
      missing: brain.missing,
      inferScript: getVinaInferScript(cwd),
      inferScriptExists: fs.existsSync(getVinaInferScript(cwd)),
    },
    defaultEngineUrl: process.env.VINA_ENGINE_URL || 'http://127.0.0.1:8765',
    ffmpeg: (() => {
      try {
        execSync(`"${findFfmpeg()}" -version`, { stdio: 'pipe' });
        return true;
      } catch {
        return false;
      }
    })(),
    universalZeroShot: true,
    modelNote:
      'Universal Zero-Shot: catalog + user clone + default narrator → same ONNX brain ' +
      'src/python_core/models/vina_voice/ (~1.46GB). SpeakerRegistry resolves ref WAV. ' +
      'No silent Edge; escape = forceBuiltin | VINA_EMERGENCY_EDGE=1.',
  };
}
