import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { cleanVoiceScript, getWordCount } from '../../workspace/utils/stringUtils';
import {
  injectBreathPauses,
  emotionPitchOffset,
} from '@/lib/youtubeSafe';
import { applyAudioStudioMix, probeDurationSec } from '@/lib/audioStudio';
import {
  applyAudioEffects,
  concatAudioBuffers,
  forceAudioDuration,
} from './audioUtils';
import { TTS_PROVIDERS, type TTSOptions } from './providers';
import {
  driveMediaFilename,
  generateTtsBodySchema,
  localAudioFilename,
  parseOrThrow,
} from '@/contracts';
import { AppError, httpStatusFromError, toErrorJson } from '@/lib/errors';
import {
  correlationIdFromRequest,
  slog,
} from '@/lib/requestContext';
import {
  tryReadPreviewCacheAny,
  writePreviewCache,
  normalizePreviewProsody,
  type PreviewCacheKeyInput,
} from '@/lib/tts/previewCache';
import {
  tryReadSceneCache,
  writeSceneCache,
  type SceneCacheKeyInput,
} from '@/lib/tts/sceneAudioCache';
import { loadVinaProfiles, resolveSamplePath, mergeSettings } from '@/lib/vinaVoice';
import { resolveNfeStep } from '@/lib/vinaVoice/warmDaemon';
import {
  findOmniLibraryEntry,
  resolveOmniRefAudioPath,
} from '@/lib/omnivoiceLocal';
import { buildTtsCacheVariantKey } from '@/lib/tts/prosodyVariant';
import { assertTtsAudioBufferQuality } from '@/lib/tts/audioQuality';
import { requireTtsPlatformAccess } from '@/lib/commercial/apiGate';

export const dynamic = 'force-dynamic';

export const runtime = 'nodejs';

/** OmniVoice first-load model + clone can exceed 60s */
/** Preview Zero-Shot ONNX can take 60–180s/job on low-VRAM GPUs; chapter longer. */
export const maxDuration = 300;

export async function POST(req: Request) {
  const correlationId = correlationIdFromRequest(req);
  const started = Date.now();
  try {
    const raw = await req.json();
    const body = parseOrThrow(generateTtsBodySchema, raw, 'Generate-TTS');
    const {
      sceneText,
      chapterNum: chapterNumRaw,
      chuong_dang_chon,
      sceneIndex: sceneIndexRaw,
      drivePath,
      voiceName,
      voice: voiceAlias, // alias used by some clients
      apiKeys,
      ten_tac_pham,
      ttsConfig,
      isPreview,
      targetDuration,
      syncMode,
      applyLoudnorm,
      injectBreathPauses: wantBreathPauses,
      roomTone,
      bgmMix,
      bgmPath,
      emotion,
      emotionTts,
      /** Đa giọng: [{ speaker?, text, voice }] — nếu có ≥2 voice khác nhau */
      voiceSegments,
    } = body;

    // Coerce aliases — avoid chapter_undefined_scene_0.mp3
    const chapterNum = Number(
      chapterNumRaw ?? chuong_dang_chon ?? body.chapter ?? 0,
    );
    const sceneIndex = Number(sceneIndexRaw ?? body.scene_index ?? 0);
    const resolvedVoiceName =
      voiceName || voiceAlias || ttsConfig?.voice || body.voice || '';

    const publicAudioDir = path.join(process.cwd(), 'public', 'audio');
    if (!fs.existsSync(publicAudioDir)) {
      fs.mkdirSync(publicAudioDir, { recursive: true });
    }

    const platform = String(ttsConfig?.platform || '');
    slog({
      level: 'info',
      msg: 'tts_start',
      correlationId,
      route: '/api/generate-tts',
      chapter: chapterNum,
      scene: sceneIndex,
      provider: platform || 'unknown',
    });
    if (!platform) {
      throw new AppError(
        'Chưa chọn nền tảng TTS. Mở «Cấu Hình Giọng Đọc Toàn Cục» và chọn engine (Não Zero-Shot / Edge / …).',
        { code: 'VALIDATION', status: 400 },
      );
    }
    // Free: edge_tts + piper. Premium engines need trial/pro token (server gate).
    const ttsDenied = await requireTtsPlatformAccess(req, platform, body);
    if (ttsDenied) return ttsDenied;
    const voice = resolvedVoiceName || voiceName || ttsConfig?.voice || '';
    if (!voice && !(Array.isArray(voiceSegments) && voiceSegments.length > 0)) {
      throw new AppError(
        'Chưa chọn giọng đọc. Mở «Cấu Hình Giọng Đọc Toàn Cục» → chọn một giọng trong list (tab Não Zero-Shot hoặc Engine chọn tay) rồi Lưu.',
        { code: 'VALIDATION', status: 400 },
      );
    }

    const parsedSpeed = parseFloat(String(ttsConfig?.speed ?? 1));
    const parsedPitch = parseFloat(String(ttsConfig?.pitch ?? 0));
    // 0 is invalid for speed; pitch may be 0 (neutral)
    const baseSpeed =
      Number.isFinite(parsedSpeed) && parsedSpeed > 0 ? parsedSpeed : 1.0;
    const basePitch = Number.isFinite(parsedPitch) ? parsedPitch : 0;
    const sceneEmotion = typeof emotion === 'string' ? emotion : '';
    // Single-path only: bake scene emotion into pitch. Multi uses per-seg emotion.
    let pitch = basePitch;
    if (emotionTts !== false) {
      pitch = basePitch + emotionPitchOffset(sceneEmotion);
    }
    const speed = baseSpeed;
    const tiktokSessionId = ttsConfig?.tiktokSessionId || '';
    const api_url_vieneu = ttsConfig?.api_url_vieneu || 'http://localhost:3000/api/v1';

    type SegIn = {
      speaker?: string | null;
      text: string;
      voice: string;
      speed?: number;
      pitch?: number;
      emotion?: string;
    };
    const multiSegs: SegIn[] = Array.isArray(voiceSegments)
      ? (voiceSegments as SegIn[]).filter((s) => s && typeof s.text === 'string' && s.text.trim() && s.voice)
      : [];

    const voicesDiffer = multiSegs.length > 0 && new Set(multiSegs.map((s) => s.voice)).size > 1;
    const prosodyDiffer = multiSegs.some((s) => {
      if (typeof s.speed === 'number' && Math.abs(s.speed - baseSpeed) > 0.001) return true;
      if (typeof s.pitch === 'number' && Math.abs(s.pitch - basePitch) > 0.001) return true;
      return false;
    });
    const emotionsDiffer =
      multiSegs.length > 0 &&
      new Set(multiSegs.map((s) => (s.emotion || '').trim())).size > 1;

    const useMulti =
      !isPreview &&
      multiSegs.length > 0 &&
      (voicesDiffer || prosodyDiffer || emotionsDiffer);

    let cleanText = '';
    if (useMulti) {
      cleanText = multiSegs.map((s) => s.text.trim()).join('\n\n');
      if (wantBreathPauses !== false) {
        cleanText = multiSegs
          .map((s) => injectBreathPauses(s.text.trim()))
          .join('\n\n');
      }
    } else {
      cleanText = cleanVoiceScript(sceneText || multiSegs.map((s) => s.text).join('\n'));
      if (wantBreathPauses !== false) {
        cleanText = injectBreathPauses(cleanText);
      }
    }
    if (!cleanText) {
      return NextResponse.json({ error: 'Không có lời thoại nào khả dụng sau khi lọc kịch bản sạch.' }, { status: 400 });
    }

    // Cast active single path: if all segs share one non-empty emotion, use it instead of scene
    if (!useMulti && multiSegs.length > 0 && emotionTts !== false) {
      const ems = [...new Set(multiSegs.map((s) => (s.emotion || '').trim()).filter(Boolean))];
      if (ems.length === 1) {
        pitch = basePitch + emotionPitchOffset(ems[0]);
      }
    }

    const options: TTSOptions & Record<string, unknown> = {
      voice: voice || multiSegs[0]?.voice || '',
      speed,
      pitch,
      tiktokSessionId,
      api_url_vieneu,
      apiKeys: Array.isArray(apiKeys) ? apiKeys : [],
      // VinaVoice extras from store ttsConfig
      vinaGender: ttsConfig?.vinaGender,
      vinaArea: ttsConfig?.vinaArea,
      vinaGroup: ttsConfig?.vinaGroup,
      vinaEmotion: ttsConfig?.vinaEmotion,
      vinaUseClone: ttsConfig?.vinaUseClone,
      vinaReferenceAudio: ttsConfig?.vinaReferenceAudio,
      vinaReferenceAudioB64: ttsConfig?.vinaReferenceAudioB64,
      vinaReferenceText: ttsConfig?.vinaReferenceText,
      vinaSpeakerSeed: ttsConfig?.vinaSpeakerSeed,
      vinaStyleSeed: ttsConfig?.vinaStyleSeed,
      vinaEngineUrl: ttsConfig?.vinaEngineUrl,
      googleCloudApiKey: ttsConfig?.googleCloudApiKey,
      vbeeApiKey: ttsConfig?.vbeeApiKey,
      vbeeAppId: ttsConfig?.vbeeAppId,
      isPreview: !!isPreview,
      isChapter: !isPreview && Number(chapterNum) > 0,
      chapterNum,
    };

    const resolveNativeFlags = (
      prov: (typeof TTS_PROVIDERS)[string],
      result: { method: string; nativeSpeedApplied?: boolean; nativePitchApplied?: boolean },
      plat: string,
    ): { nativeSpeed: boolean; nativePitch: boolean } => {
      if (
        plat === 'vieneu_tts' ||
        plat === 'piper' ||
        /VieNeu|Piper/i.test(result.method || '')
      ) {
        // Piper length_scale is native speed; pitch not native
        return { nativeSpeed: true, nativePitch: false };
      }
      return {
        nativeSpeed:
          result.nativeSpeedApplied !== undefined
            ? !!result.nativeSpeedApplied
            : !!prov.supportsNativeSpeed,
        nativePitch:
          result.nativePitchApplied !== undefined
            ? !!result.nativePitchApplied
            : !!prov.supportsNativePitch,
      };
    };

    // Resolve sample path for Zero-Shot/clone engines so cache invalidates when refs change
    let cacheSamplePath = '';
    if (platform === 'vina_voice' && voice) {
      try {
        const hit = loadVinaProfiles().find((p) => p.name === voice);
        if (hit) {
          cacheSamplePath = resolveSamplePath(hit, mergeSettings({}), process.cwd()) || '';
        }
      } catch {
        /* ignore */
      }
    } else if (platform === 'omnivoice_local' && voice) {
      try {
        const entry = findOmniLibraryEntry(voice, process.cwd());
        cacheSamplePath = resolveOmniRefAudioPath(entry || voice, process.cwd()) || '';
      } catch {
        /* ignore */
      }
    }

    const cleanedSceneText = cleanVoiceScript(String(sceneText || ''));
    const previewTextKey = cleanedSceneText.slice(0, 500);
    const isChapterJob = !isPreview && Number(chapterNum) > 0;
    const nfeForCache =
      platform === 'vina_voice'
        ? resolveNfeStep({ isPreview: !!isPreview, isChapter: isChapterJob })
        : undefined;
    const prosody = normalizePreviewProsody(speed, pitch);
    const variantKey = buildTtsCacheVariantKey({
      platform,
      vinaGender: ttsConfig?.vinaGender,
      vinaArea: ttsConfig?.vinaArea,
      vinaGroup: ttsConfig?.vinaGroup,
      vinaEmotion: ttsConfig?.vinaEmotion,
      vinaReferenceAudio: ttsConfig?.vinaReferenceAudio,
      vinaReferenceAudioB64: ttsConfig?.vinaReferenceAudioB64,
      vinaReferenceText: ttsConfig?.vinaReferenceText,
    });
    const previewCacheInput: PreviewCacheKeyInput = {
      platform,
      voice: voice || 'default',
      speed: prosody.speed,
      pitch: prosody.pitch,
      text: previewTextKey,
      speakerSeed:
        typeof ttsConfig?.vinaSpeakerSeed === 'number'
          ? ttsConfig.vinaSpeakerSeed
          : platform === 'vina_voice'
            ? 2336
            : undefined,
      styleSeed:
        typeof ttsConfig?.vinaStyleSeed === 'number'
          ? ttsConfig.vinaStyleSeed
          : platform === 'vina_voice'
            ? 4125
            : undefined,
      nfeStep: nfeForCache,
      variantKey,
      samplePath: cacheSamplePath || undefined,
    };
    const sceneCacheInput: SceneCacheKeyInput = {
      platform,
      voice: voice || 'default',
      speed,
      pitch,
      text: cleanedSceneText.slice(0, 8000),
      speakerSeed: previewCacheInput.speakerSeed,
      styleSeed: previewCacheInput.styleSeed,
      nfeStep: nfeForCache,
      variantKey,
      samplePath: cacheSamplePath || undefined,
      multiSig: useMulti
        ? multiSegs.map((s) => `${s.voice}:${(s.text || '').slice(0, 40)}`).join('|').slice(0, 500)
        : undefined,
    };
    // forceFull / noCache from client — skip durable scene cache
    const skipSceneCache =
      body?.forceFullMulti === true ||
      body?.noSceneCache === true ||
      body?.force === true;

    if (isPreview) {
      const isWavPreview =
        platform === 'piper' ||
        platform === 'gemini_tts' ||
        platform === 'vieneu_tts' ||
        platform === 'vina_voice' ||
        platform === 'vbee' ||
        platform === 'omnivoice_local';
      // All platforms: reuse existing MP3/WAV — identity already in sample/vector.
      // Zero-Shot: durable forever (key includes sample fingerprint).
      // Cloud/edge: 7d retention. OmniVoice: 24h (model/prompt drift).
      const maxAgeMs =
        platform === 'vina_voice' || platform === 'piper' || platform === 'vieneu_tts'
          ? undefined
          : platform === 'omnivoice_local'
            ? 24 * 60 * 60 * 1000
            : 7 * 24 * 60 * 60 * 1000;
      const hit = tryReadPreviewCacheAny(
        previewCacheInput,
        isWavPreview ? 'wav' : 'mp3',
        { maxAgeMs },
      );
      if (hit) {
        console.log(
          `[TTS Preview] cache HIT (no re-synth): ${hit.filename} age=${Math.round(hit.ageMs / 1000)}s`,
        );
        return NextResponse.json({
          success: true,
          audioPath: hit.publicUrl,
          method: hit.method,
          voice,
          duration: 5,
          driveSaved: false,
          driveFilePath: '',
          filename: hit.filename,
          cached: true,
        });
      }
      console.log(
        `[TTS Preview] cache MISS voice=${String(voice).slice(0, 40)} — will synth + save`,
      );
    } else if (
      !skipSceneCache &&
      !useMulti &&
      (platform === 'vina_voice' ||
        platform === 'piper' ||
        platform === 'edge_tts' ||
        platform === 'omnivoice_local')
    ) {
      // Full scene (kịch bản): reuse WAV if same text+voice already generated
      const isWavScene =
        platform === 'vina_voice' ||
        platform === 'piper' ||
        platform === 'omnivoice_local';
      const sceneHit = tryReadSceneCache(sceneCacheInput, isWavScene ? 'wav' : 'mp3');
      if (sceneHit) {
        const abs = path.join(
          process.cwd(),
          'public',
          sceneHit.publicUrl.replace(/^\//, ''),
        );
        let duration = 0;
        try {
          if (fs.existsSync(abs)) duration = await probeDurationSec(abs);
        } catch {
          duration = 0;
        }
        if (duration > 0.2) {
          console.log(`[TTS Scene] durable cache HIT: ${sceneHit.filename}`);
          return NextResponse.json({
            success: true,
            audioPath: `${sceneHit.publicUrl}?t=${Date.now()}`,
            method: sceneHit.method,
            voice,
            duration,
            driveSaved: false,
            driveFilePath: '',
            filename: sceneHit.filename,
            cached: true,
            sceneCached: true,
          });
        }
      }
    }

    let audioBuffer: Buffer | null = null;
    let methodUsed = 'Unknown';
    const provider = TTS_PROVIDERS[platform];

    if (!provider) {
      console.warn(`[TTS API] Provider ${platform} không tồn tại.`);
      return NextResponse.json({ error: `Provider ${platform} không tồn tại.` }, { status: 400 });
    }

    let nativeSpeedApplied = provider.supportsNativeSpeed;
    let nativePitchApplied = provider.supportsNativePitch;

    try {
      if (useMulti) {
        console.log(
          `[TTS API] Đa giọng: ${multiSegs.length} đoạn, voices=${[...new Set(multiSegs.map((s) => s.voice))].join(', ')}`,
        );
        // Parallel pool (default 2) — preserve segment order in partBuffers
        const concurrencyRaw = Number(
          body?.multiConcurrency ?? process.env.TTS_MULTI_CONCURRENCY ?? 2,
        );
        const concurrency = Math.max(
          1,
          Math.min(4, Number.isFinite(concurrencyRaw) ? concurrencyRaw : 2),
        );
        console.log(
          `[TTS API] Multi concurrency=${concurrency} for ${multiSegs.length} segments`,
        );

        type SegOut = { buffer: Buffer; method: string; index: number };
        type SegFail = {
          index: number;
          speaker: string | null;
          voice: string;
          message: string;
        };
        const results: SegOut[] = new Array(multiSegs.length);
        let cursor = 0;
        const failBox: { err: SegFail | null } = { err: null };

        const runOne = async (i: number) => {
          if (failBox.err) return;
          const seg = multiSegs[i];
          let segText = seg.text.trim();
          if (wantBreathPauses !== false) segText = injectBreathPauses(segText);

          const segSpeed =
            typeof seg.speed === 'number' && Number.isFinite(seg.speed) ? seg.speed : baseSpeed;
          const rolePitch =
            typeof seg.pitch === 'number' && Number.isFinite(seg.pitch) ? seg.pitch : basePitch;
          const emKey = (seg.emotion || '').trim();
          const segPitch =
            rolePitch + (emotionTts !== false ? emotionPitchOffset(emKey) : 0);

          const segOpts: TTSOptions = {
            ...options,
            voice: seg.voice,
            speed: segSpeed,
            pitch: segPitch,
          };
          console.log(
            `[TTS API] Segment ${i + 1}/${multiSegs.length} speaker=${seg.speaker || 'kể'} voice=${seg.voice} speed=${segSpeed} pitch=${segPitch}`,
          );
          try {
            const result = await provider.generate(segText, segOpts);
            const flags = resolveNativeFlags(provider, result, platform);
            let buf = result.buffer;
            const speedViaFFmpeg_i = flags.nativeSpeed ? 1.0 : segSpeed;
            const pitchViaFFmpeg_i = flags.nativePitch ? 0 : segPitch;
            if (speedViaFFmpeg_i !== 1.0 || pitchViaFFmpeg_i !== 0) {
              buf = await applyAudioEffects(buf, pitchViaFFmpeg_i, speedViaFFmpeg_i, false);
            }
            results[i] = { buffer: buf, method: result.method, index: i };
          } catch (segErr: unknown) {
            if (!failBox.err) {
              failBox.err = {
                index: i,
                speaker: seg.speaker || null,
                voice: seg.voice,
                message: (segErr as Error).message || 'unknown',
              };
            }
          }
        };

        const workers = Array.from({ length: Math.min(concurrency, multiSegs.length) }, async () => {
          while (!failBox.err) {
            const i = cursor++;
            if (i >= multiSegs.length) break;
            await runOne(i);
          }
        });
        await Promise.all(workers);

        if (failBox.err) {
          const fe = failBox.err;
          console.error(`[TTS API] Multi fail at segment ${fe.index}: ${fe.message}`);
          return NextResponse.json(
            {
              error: `Lỗi sinh âm thanh segment ${fe.index + 1}/${multiSegs.length} (${fe.speaker || 'kể'}): ${fe.message}`,
              failedSegmentIndex: fe.index,
              speaker: fe.speaker,
              voice: fe.voice,
            },
            { status: 500 },
          );
        }

        const partBuffers = results.map((r) => r.buffer);
        const methods = results.map((r) => r.method);
        const preferWav = methods.some((m) => /Gemini|Piper|VieNeu|Vina|OmniVoice/i.test(m));
        audioBuffer = await concatAudioBuffers(partBuffers, preferWav);
        methodUsed = `Multi-voice (${multiSegs.length} segs×${concurrency}) · ${methods[0] || provider.name}`;
        nativeSpeedApplied = true;
        nativePitchApplied = true;
        console.log(`[TTS API] Nối đa giọng thành công (${multiSegs.length} đoạn, concurrency=${concurrency}).`);
      } else {
        console.log(`[TTS API] Đang sinh giọng ${options.voice} bằng ${provider.name}...`);
        const result = await provider.generate(cleanText, options);
        audioBuffer = result.buffer;
        methodUsed = result.method;
        const flags = resolveNativeFlags(provider, result, platform);
        nativeSpeedApplied = flags.nativeSpeed;
        nativePitchApplied = flags.nativePitch;
        console.log(`[TTS API] ${provider.name} xử lý thành công!`);
      }
    } catch (err: unknown) {
      console.error(`[TTS API] ${provider.name} lỗi: ${(err as Error).message}`);
      return NextResponse.json({ error: `Lỗi sinh âm thanh từ ${provider.name}: ${(err as Error).message || 'unknown'}` }, { status: 500 });
    }

    if (!audioBuffer) {
      return NextResponse.json({ error: 'TTS provider did not return a valid audio buffer.' }, { status: 500 });
    }

    // Multi path: speed/pitch already applied per-seg → only loudnorm here
    // Single path: FFmpeg only for axes the provider did NOT apply natively
    const speedViaFFmpeg = useMulti || nativeSpeedApplied ? 1.0 : speed;
    const pitchViaFFmpeg = useMulti || nativePitchApplied ? 0 : pitch;
    const wantLoudnorm = applyLoudnorm !== false && !isPreview;

    if (
      Math.abs(pitchViaFFmpeg) > 0.001 ||
      Math.abs(speedViaFFmpeg - 1.0) > 0.001 ||
      wantLoudnorm
    ) {
      console.log(
        `[TTS Post-Process] FFmpeg Speed=${speedViaFFmpeg} Pitch=${pitchViaFFmpeg} Loudnorm=${wantLoudnorm} multi=${useMulti} nativeS=${nativeSpeedApplied} nativeP=${nativePitchApplied}...`,
      );
      try {
        audioBuffer = await applyAudioEffects(
          audioBuffer,
          pitchViaFFmpeg,
          speedViaFFmpeg,
          wantLoudnorm,
        );
        console.log(`[TTS Effects] Thành công!`);
      } catch (effErr: unknown) {
        console.error('[TTS Effects] failed:', effErr);
        // Prosody is critical UX — surface error instead of silent wrong speed
        return NextResponse.json(
          { error: `TTS audio effects failed: ${(effErr as Error).message}` },
          { status: 500 },
        );
      }
    } else {
      console.log(
        `[TTS Post-Process] skip FFmpeg (native speed=${nativeSpeedApplied} pitch=${nativePitchApplied} s=${speed} p=${pitch})`,
      );
    }

    if (syncMode === 'force_sync' && targetDuration && targetDuration > 0 && audioBuffer) {
      console.log(`[TTS Sync] Đang ép khớp âm thanh về chính xác ${targetDuration}s...`);
      try {
        audioBuffer = await forceAudioDuration(audioBuffer, targetDuration);
        console.log(`[TTS Sync] Ép khớp thành công!`);
      } catch (syncErr: unknown) {
        return NextResponse.json({ error: `TTS duration sync failed: ${(syncErr as Error).message}` }, { status: 500 });
      }
    }

    // YouTube audio studio: room tone + optional BGM bed + mix loudnorm
    let studioApplied: string[] = [];
    if (!isPreview && audioBuffer && (roomTone !== false || bgmMix === true)) {
      try {
        const mixed = await applyAudioStudioMix(audioBuffer, {
          roomTone: roomTone !== false,
          bgmMix: bgmMix === true,
          bgmPath: typeof bgmPath === 'string' ? bgmPath : '',
          loudnormI: -14,
        });
        audioBuffer = mixed.buffer;
        studioApplied = mixed.applied;
        if (studioApplied.length) {
          console.log(`[TTS AudioStudio] applied: ${studioApplied.join(', ')}`);
        }
      } catch (studioErr) {
        console.warn('[TTS AudioStudio] skipped:', studioErr);
      }
    }

    try {
      const quality = assertTtsAudioBufferQuality(
        audioBuffer,
        `${provider.name} (${voice || 'multi-voice'})`,
      );
      console.log(
        `[TTS Quality] speech-like duration=${quality.durationSec.toFixed(2)}s ` +
          `rms=${quality.rmsDb.toFixed(1)}dBFS peak=${quality.peak.toFixed(3)} ` +
          `zcr=${quality.zeroCrossingRate.toFixed(3)}`,
      );
    } catch (qualityError) {
      const message =
        qualityError instanceof Error ? qualityError.message : String(qualityError);
      console.error(`[TTS Quality] rejected: ${message}`);
      return NextResponse.json(
        {
          error:
            `Giọng đọc sinh ra không đạt kiểm định người/nhiễu: ${message} ` +
            'Hãy kiểm tra mẫu tham chiếu hoặc engine đã chọn.',
        },
        { status: 502 },
      );
    }

    const isWav =
      methodUsed.includes('Gemini') ||
      methodUsed.includes('Piper') ||
      methodUsed.includes('VieNeu') ||
      methodUsed.includes('Vina') ||
      methodUsed.includes('UVE') ||
      methodUsed.includes('ONNX') ||
      methodUsed.includes('OmniVoice') ||
      platform === 'vina_voice' ||
      platform === 'piper' ||
      platform === 'vieneu_tts' ||
      platform === 'omnivoice_local' ||
      platform === 'vbee';
    let filename = '';
    let localSavePath = '';
    let audioPathRet = '';
    
    if (isPreview && audioBuffer) {
      const ext = isWav ? 'wav' : 'mp3';
      const saved = writePreviewCache(previewCacheInput, ext, audioBuffer);
      filename = saved.filename;
      localSavePath = saved.publicPath;
      audioPathRet = saved.publicUrl;
      console.log(`[TTS Preview] durable cache SAVE: ${filename}`);
    } else {
      // Multi partials use high sceneIndex / partTag — keep unique names under multi/
      const partTag =
        typeof body?.partTag === 'string' && body.partTag.trim()
          ? body.partTag.trim().replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 80)
          : '';
      const isMultiPart =
        !!partTag ||
        Number(sceneIndex) >= 800000 ||
        (Number(chapterNum) === 0 && Number(sceneIndex) >= 99000);
      if (isMultiPart) {
        const multiDir = path.join(publicAudioDir, 'multi');
        if (!fs.existsSync(multiDir)) fs.mkdirSync(multiDir, { recursive: true });
        const tag =
          partTag ||
          `c${chapterNum}_s${sceneIndex}_${Date.now().toString(36)}`;
        filename = `part_${tag}.${isWav ? 'wav' : 'mp3'}`;
        localSavePath = path.join(multiDir, filename);
        audioPathRet = `/audio/multi/${filename}`;
      } else {
        filename = localAudioFilename(
          chapterNum,
          sceneIndex,
          isWav ? 'wav' : 'mp3',
        );
        localSavePath = path.join(publicAudioDir, filename);
        audioPathRet = `/audio/${filename}`;
      }
      fs.writeFileSync(localSavePath, audioBuffer);
      // Scene content cache for kịch bản re-run / retry (same text+voice)
      if (
        !skipSceneCache &&
        !useMulti &&
        audioBuffer &&
        (platform === 'vina_voice' ||
          platform === 'piper' ||
          platform === 'edge_tts' ||
          platform === 'omnivoice_local')
      ) {
        try {
          writeSceneCache(sceneCacheInput, isWav ? 'wav' : 'mp3', audioBuffer);
          console.log(`[TTS Scene] durable cache SAVE voice=${String(voice).slice(0, 32)}`);
        } catch (e) {
          console.warn('[TTS Scene] cache write failed', e);
        }
      }
    }

    let driveSaved = false;
    let driveFilePath = '';
    
    if (!isPreview && drivePath && drivePath.trim().length > 0) {
      try {
        const cleanedDrivePath = drivePath.trim();
        let driveFolder = cleanedDrivePath;
        if (chapterNum > 0) {
          driveFolder = path.join(cleanedDrivePath, `Chương ${chapterNum}`);
        }
        if (!fs.existsSync(driveFolder)) {
          fs.mkdirSync(driveFolder, { recursive: true });
        }
          
        const scriptTitle = ten_tac_pham 
          ? ten_tac_pham.replace(/[\/\:\*\?\"<>\|]/g, '_').trim() 
          : 'Kịch Bản';
        const driveFilename = driveMediaFilename(scriptTitle, chapterNum, sceneIndex, {
          kind: 'audio',
          ext: isWav ? 'wav' : 'mp3',
        });
        
        driveFilePath = path.join(driveFolder, driveFilename);
        fs.writeFileSync(driveFilePath, audioBuffer);
        driveSaved = true;
        console.log(`[Drive Service] Đã lưu âm thanh với tên kịch bản: ${driveFilePath}`);
      } catch (driveErr: unknown) {
        console.error(`[Drive Service] Lỗi lưu Drive:`, (driveErr as Error).message);
      }
    }

    let calculatedDuration = Math.max(5, Math.round(getWordCount(cleanText) / 2.5));
    if (isWav && audioBuffer.length > 44) {
      calculatedDuration = Math.max(5, Math.round((audioBuffer.length - 44) / 48000));
    }
    // Ưu tiên đo duration thật từ file (đa giọng / loudnorm)
    try {
      const probed = probeDurationSec(localSavePath);
      if (probed > 0) calculatedDuration = Math.max(1, Math.round(probed));
    } catch { /* ignore */ }

    slog({
      level: 'info',
      msg: 'tts_ok',
      correlationId,
      route: '/api/generate-tts',
      chapter: chapterNum,
      scene: sceneIndex,
      provider: platform,
      durationMs: Date.now() - started,
    });
    return NextResponse.json(
      {
        success: true,
        audioPath: audioPathRet,
        method: methodUsed,
        voice: useMulti
          ? `multi:${[...new Set(multiSegs.map((s) => s.voice))].join('+')}`
          : voice,
        multiVoice: useMulti,
        segmentCount: useMulti ? multiSegs.length : undefined,
        speakers: useMulti ? multiSegs.map((s) => s.speaker || 'kể') : undefined,
        duration: calculatedDuration,
        driveSaved,
        driveFilePath,
        filename,
        studioApplied,
        pitchApplied: pitch,
        correlationId,
      },
      { headers: { 'x-correlation-id': correlationId } },
    );

  } catch (err: unknown) {
    slog({
      level: 'error',
      msg: 'tts_fail',
      correlationId,
      route: '/api/generate-tts',
      durationMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
      code: err instanceof AppError ? err.code : 'UNKNOWN',
    });
    return NextResponse.json(toErrorJson(err, correlationId), {
      status: httpStatusFromError(err),
      headers: { 'x-correlation-id': correlationId },
    });
  }
}
