/**
 * Server-side TTS Batch SRT runner.
 * Uses TTS_PROVIDERS registry (same engines as /api/generate-tts).
 */

import fs from 'fs';
import path from 'path';
import { TTS_PROVIDERS, type TTSOptions } from '@/app/api/generate-tts/providers';
import { applyAudioEffects } from '@/app/api/generate-tts/audioUtils';
import { resolveTtsBatchConcurrency } from './concurrency';
import { parseSrt } from './parseSrt';
import {
  applyLoudnormMp3,
  concatCuesToMp3,
  probeDurationSec,
} from './timelineConcat';
import { sanitizeTextForTts } from './sanitizeTextForTts';
import type {
  TtsBatchAlignMode,
  TtsBatchCueResult,
  TtsBatchProgressEvent,
  TtsBatchRequest,
  TtsBatchResult,
} from './types';
import { GOOGLE_STUDIO_TTS_PLATFORMS } from './types';

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function normalizeSpeakerKey(name: string): string {
  return String(name || '')
    .normalize('NFC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function normalizeSpeakerVoiceMap(
  raw?: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw)) {
    const key = normalizeSpeakerKey(k);
    const voiceId = String(v || '').trim();
    if (key && voiceId) out[key] = voiceId;
  }
  return out;
}

function buildTtsOptions(
  ttsConfig: Record<string, unknown>,
  voice: string,
  apiKeys: string[],
): TTSOptions & Record<string, unknown> {
  const speedRaw = parseFloat(String(ttsConfig.speed ?? 1));
  const pitchRaw = parseFloat(String(ttsConfig.pitch ?? 0));
  const speed = Number.isFinite(speedRaw) && speedRaw > 0 ? speedRaw : 1;
  const pitch = Number.isFinite(pitchRaw) ? pitchRaw : 0;
  const language = String(ttsConfig.language || 'vi').trim() || 'vi';

  // Full parity with /api/generate-tts single-path options (global config)
  return {
    voice,
    speed,
    pitch,
    language,
    tiktokSessionId: String(ttsConfig.tiktokSessionId || ''),
    api_url_vieneu: String(
      ttsConfig.api_url_vieneu || 'https://api.vieneu.com/tts',
    ),
    apiKeys,
    vinaGender: ttsConfig.vinaGender ?? 'male',
    vinaArea: ttsConfig.vinaArea ?? 'southern',
    vinaGroup: ttsConfig.vinaGroup ?? 'story',
    vinaEmotion: ttsConfig.vinaEmotion ?? 'neutral',
    vinaUseClone: ttsConfig.vinaUseClone !== false,
    vinaReferenceAudio: ttsConfig.vinaReferenceAudio || '',
    vinaReferenceAudioB64: ttsConfig.vinaReferenceAudioB64 || '',
    vinaReferenceText: ttsConfig.vinaReferenceText || '',
    vinaSpeakerSeed:
      typeof ttsConfig.vinaSpeakerSeed === 'number'
        ? ttsConfig.vinaSpeakerSeed
        : 2336,
    vinaStyleSeed:
      typeof ttsConfig.vinaStyleSeed === 'number' ? ttsConfig.vinaStyleSeed : 4125,
    vinaEngineUrl: ttsConfig.vinaEngineUrl || '',
    googleCloudApiKey: ttsConfig.googleCloudApiKey || '',
    vbeeApiKey: ttsConfig.vbeeApiKey || '',
    vbeeAppId: ttsConfig.vbeeAppId || '',
    isPreview: false,
    isChapter: true,
  };
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  onItem?: (index: number, ok: boolean, err?: string) => void,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  let fail: Error | null = null;

  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (!fail) {
        const i = cursor++;
        if (i >= items.length) break;
        try {
          results[i] = await worker(items[i], i);
          onItem?.(i, true);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          fail = e instanceof Error ? e : new Error(msg);
          onItem?.(i, false, msg);
        }
      }
    },
  );

  await Promise.all(runners);
  if (fail) throw fail;
  return results;
}

/**
 * Run full batch. Emits progress events if onProgress provided.
 */
export async function runTtsBatchSrt(
  req: TtsBatchRequest,
  onProgress?: (ev: TtsBatchProgressEvent) => void,
): Promise<TtsBatchResult> {
  // Normalize config once — always prefer explicit voice then ttsConfig.voice
  const cfgIn =
    req.ttsConfig && typeof req.ttsConfig === 'object'
      ? { ...req.ttsConfig }
      : {};
  const platform = String(cfgIn.platform || '').trim();
  if (!platform) {
    throw new Error('Thiếu ttsConfig.platform. Mở TTS Config chọn engine trước.');
  }

  const voice = String(req.voice || cfgIn.voice || '').trim();
  if (!voice) {
    throw new Error(
      'Thiếu voice từ cấu hình TTS toàn cục. Mở Cấu hình giọng đọc → chọn voice/profile.',
    );
  }

  // Cloud-only path: reject local engines (B10: hard-fail, no silent swap)
  const forceCloud = req.forceGoogleStudioCloud !== false;
  const localBlocked = new Set([
    'piper',
    'vina_voice',
    'omnivoice_local',
    'la_studio',
    'capcut_tts',
  ]);
  if (forceCloud && localBlocked.has(platform)) {
    throw new Error(
      `TTS Batch / Google Studio: cấm engine local "${platform}". ` +
        `Chọn gemini_tts (AI Studio) hoặc google (Cloud TTS) trong Cấu hình giọng đọc. ` +
        `Không fallback sang Piper/Vina.`,
    );
  }
  if (
    forceCloud &&
    !(GOOGLE_STUDIO_TTS_PLATFORMS as readonly string[]).includes(platform)
  ) {
    throw new Error(
      `TTS Batch: engine "${platform}" không thuộc Google Studio/Cloud. ` +
        `Chọn gemini_tts (AI Studio) hoặc google (Cloud TTS). Không Edge/Piper/Vina/local.`,
    );
  }

  // Pin resolved voice back into config so every code path sees the same id
  cfgIn.voice = voice;
  cfgIn.platform = platform;
  if (!cfgIn.language) cfgIn.language = 'vi';

  const provider = TTS_PROVIDERS[platform];
  if (!provider) {
    throw new Error(
      `Engine "${platform}" không có trong registry TTS. Chọn engine hợp lệ.`,
    );
  }

  const cues = parseSrt(req.srtText);
  const concurrency = resolveTtsBatchConcurrency(platform, req.concurrency);
  const alignMode: TtsBatchAlignMode =
    req.alignMode === 'timeline' ? 'timeline' : 'sequential';
  const apiKeys = Array.isArray(req.apiKeys)
    ? req.apiKeys.filter(Boolean)
    : [];

  const jobTag =
    String(req.jobName || 'batch')
      .replace(/[^\w\-]+/g, '_')
      .slice(0, 40) || 'batch';
  const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const jobDir = path.join(
    process.cwd(),
    'public',
    'audio',
    'srt-batch',
    `${jobTag}_${stamp}`,
  );
  ensureDir(jobDir);

  // Pin ONE voice / full global profile for the whole batch
  const baseOpts = buildTtsOptions(cfgIn, voice, apiKeys);
  const methods = new Set<string>();

  console.log(
    `[tts-batch-srt] GLOBAL TTS pin platform=${platform} voice="${voice}" ` +
      `speed=${baseOpts.speed} pitch=${baseOpts.pitch} lang=${cfgIn.language} cues=${cues.length}`,
  );

  onProgress?.({
    type: 'start',
    cueCount: cues.length,
    concurrency,
    platform,
    alignMode,
    voice,
  } as TtsBatchProgressEvent);

  console.log(
    `[tts-batch-srt] cloud fan-out platform=${platform} concurrency=${concurrency} cues=${cues.length}`,
  );

  const speakerMap = normalizeSpeakerVoiceMap(req.speakerVoiceMap);

  const speechPaths = await mapPool(
    cues,
    concurrency,
    async (cue, i) => {
      const text = sanitizeTextForTts(cue.text);
      if (!text) throw new Error(`Cue #${cue.index}: text rỗng sau sanitize`);

      // Multi-voice: speaker label → voice id (same platform); else global voice
      const cueVoice =
        (cue.speaker && speakerMap[normalizeSpeakerKey(cue.speaker)]) || voice;

      // Rotate Studio keys across parallel workers
      const rotatedKeys =
        apiKeys.length > 1
          ? [...apiKeys.slice(i % apiKeys.length), ...apiKeys.slice(0, i % apiKeys.length)]
          : apiKeys;

      const result = await provider.generate(text, {
        ...baseOpts,
        voice: cueVoice,
        apiKeys: rotatedKeys,
      } as TTSOptions);

      methods.add(result.method || provider.name);

      // Post FX if provider did not apply speed/pitch natively
      const nativeSpeed =
        result.nativeSpeedApplied !== undefined
          ? !!result.nativeSpeedApplied
          : !!provider.supportsNativeSpeed;
      const nativePitch =
        result.nativePitchApplied !== undefined
          ? !!result.nativePitchApplied
          : !!provider.supportsNativePitch;

      let buffer = result.buffer;
      const speedFx = nativeSpeed ? 1 : Number(baseOpts.speed) || 1;
      const pitchFx = nativePitch ? 0 : Number(baseOpts.pitch) || 0;
      if (pitchFx !== 0 || Math.abs(speedFx - 1) > 0.001) {
        // applyAudioEffects(buf, pitchSemitones, speedFactor)
        buffer = await applyAudioEffects(buffer, pitchFx, speedFx);
      }

      const ext = buffer.slice(0, 4).toString('ascii') === 'RIFF' ? 'wav' : 'mp3';
      const partPath = path.join(
        jobDir,
        `cue_${String(i + 1).padStart(4, '0')}.${ext}`,
      );
      fs.writeFileSync(partPath, buffer);
      return partPath;
    },
    (i, ok, err) => {
      onProgress?.({
        type: 'cue',
        current: i + 1,
        total: cues.length,
        index: cues[i].index,
        ok,
        label: ok
          ? `Cue #${cues[i].index} OK`
          : `Cue #${cues[i].index} FAIL: ${err || ''}`,
      });
    },
  );

  onProgress?.({
    type: 'concat',
    label: `Ghép ${cues.length} cue (${alignMode}${req.fitToCue === false ? '' : ' + fit'})…`,
  });

  const rawOut = path.join(jobDir, 'full_raw.mp3');
  const { duration: rawDur, stretchCount } = concatCuesToMp3({
    cues,
    speechPaths,
    alignMode,
    padToCueEnd: req.padToCueEnd === true,
    fitToCue: req.fitToCue !== false,
    workDir: jobDir,
    outPath: rawOut,
  });

  let finalPath = rawOut;
  let duration = rawDur;

  if (req.applyLoudnorm !== false) {
    const lnOut = path.join(jobDir, 'full.mp3');
    await applyLoudnormMp3(rawOut, lnOut);
    finalPath = lnOut;
    duration = probeDurationSec(lnOut) || rawDur;
    try {
      if (fs.existsSync(rawOut) && rawOut !== lnOut) fs.unlinkSync(rawOut);
    } catch {
      /* ignore */
    }
  } else {
    const renamed = path.join(jobDir, 'full.mp3');
    if (rawOut !== renamed) {
      fs.renameSync(rawOut, renamed);
      finalPath = renamed;
    }
  }

  const rel = path
    .relative(path.join(process.cwd(), 'public'), finalPath)
    .replace(/\\/g, '/');
  const audioPath = `/${rel}`.replace(/\/+/g, '/');

  if (stretchCount > 0) {
    console.log(`[tts-batch-srt] time-stretch fit ${stretchCount}/${cues.length} cues`);
  }

  const publicRoot = path.join(process.cwd(), 'public');
  const cueResults: TtsBatchCueResult[] = cues.map((c, i) => {
    const disk = speechPaths[i];
    const exists = Boolean(disk && fs.existsSync(disk));
    return {
      index: c.index,
      startMs: c.startMs,
      endMs: c.endMs,
      text: c.text,
      speaker: c.speaker,
      diskPath: exists ? disk : undefined,
      audioPath: exists
        ? `/${path.relative(publicRoot, disk).replace(/\\/g, '/')}`
        : undefined,
      durationSec: exists ? probeDurationSec(disk) : undefined,
    };
  });

  const result: TtsBatchResult = {
    ok: true,
    audioPath,
    duration,
    cueCount: cues.length,
    concurrency,
    alignMode,
    platform,
    voice,
    method: [...methods].join(' | ') || provider.name,
    cues: cueResults,
    jobDirAbs: jobDir,
    jobDir: audioPath.replace(/\/[^/]+$/, ''),
    stretchCount,
  };

  onProgress?.({ type: 'done', result });
  return result;
}
