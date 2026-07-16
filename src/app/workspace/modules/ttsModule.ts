import { API, sceneAssetKey } from '@/contracts';
/**
 * Module quan ly giong doc AI va studio thu am.
 */
import { useNovelStore, type TTSConfig } from '@/store/useNovelStore';
import {
  buildCharacterVoiceMap,
  parseScriptVoiceSegments,
  shouldUseMultiVoice,
  type ScriptVoiceSegment,
} from '@/lib/characterVoice';
import {
  isCastActive,
  normalizeVoiceCast,
} from '@/lib/voiceCast';
import {
  resolveSceneCast,
  toApiVoiceSegments,
} from './castModule';
import {
  getDominantPromptEmotion,
  resolveTtsApiKeys,
  resolveTtsDrivePath,
  withRotatedTikTokSession,
} from './tts/generateHelpers';
import { runMultiVoiceTts } from './tts/multiVoiceRunner';
import type { TTSProgressEvent, TtsVoiceSegment } from './tts/types';
import {
  shouldParallelSplitMono,
  splitMonoForParallel,
} from '@/lib/tts/splitMonoForParallel';
export { playTTSAction, type PlayTTSParams } from './tts/preview';
export type { TTSProgressEvent } from './tts/types';

interface GenerateTTSParams {
  apiKey: string;
  apiKeys: string[];
  sceneText: string;
  chuong_dang_chon: number;
  sceneIndex: number;
  savePathTTS: string;
  googleDrivePath: string;
  voice: string;
  ten_tac_pham: string;
  ttsConfig?: TTSConfig;
  targetDuration?: number;
  syncMode?: 'default' | 'force_sync' | 'pro';
  onProgress?: (ev: TTSProgressEvent) => void;
  /** Ignore multi partial cache — regenerate every segment */
  forceFullMulti?: boolean;
  /** Chapter mono mode: ignore Role Cast multi path */
  forceMono?: boolean;
}

export async function generateTTSAction(params: GenerateTTSParams): Promise<{
  audioPath: string;
  duration: number;
  selfRepair?: { message: string };
  multi?: boolean;
  segmentCount?: number;
}> {
  const {
    apiKey,
    apiKeys,
    sceneText,
    chuong_dang_chon,
    sceneIndex,
    savePathTTS,
    googleDrivePath,
    voice,
    ten_tac_pham,
    ttsConfig,
    targetDuration,
    syncMode,
    onProgress,
    forceFullMulti = false,
    forceMono = false,
  } = params;
  const drivePath = resolveTtsDrivePath(savePathTTS, googleDrivePath);

  const postTTS = async (
    activeConfig?: TTSConfig,
    activeVoice = voice,
    activeApiKey = apiKey,
    activeApiKeys = apiKeys,
  ) => {
    const keysToUse = resolveTtsApiKeys(activeApiKey, activeApiKeys);
    const storeState = useNovelStore.getState();
    const yt = storeState.youtubeSafe;
    const applyLoudnorm = yt?.applyLoudnorm !== false;
    // Dominant emotion from storyboard prompts for this scene (emotion TTS)
    const assetKey = sceneAssetKey(chuong_dang_chon, sceneIndex);
    const prompts = (storeState.generatedPrompts?.[assetKey] || []) as Array<{ emotion?: string }>;
    let emotion = getDominantPromptEmotion(prompts);

    // Đa giọng: prefer Role Casting Studio when castActive; else legacy name: lines
    const platform = (activeConfig?.platform || storeState.ttsConfig.platform || '').trim();
    if (!platform) {
      throw new Error('Chua chon engine TTS (platform).');
    }
    const defaultVoice = (activeVoice || activeConfig?.voice || storeState.ttsConfig.voice || '').trim();
    if (!defaultVoice) {
      throw new Error('Chua chon voice TTS. App khong tu gan voice.');
    }
    const charNames = storeState.nhan_vat || [];
    const globalSpeed = activeConfig?.speed ?? storeState.ttsConfig.speed ?? 1;
    const globalPitch = activeConfig?.pitch ?? storeState.ttsConfig.pitch ?? 0;
    const language = (activeConfig?.language || storeState.ttsConfig.language || '').trim();
    if (!language) {
      throw new Error('Chua chon ngon ngu TTS. App khong tu gan language.');
    }
    const cast = normalizeVoiceCast(storeState.voiceCast);
    const castActive = !forceMono && isCastActive(cast);

    let voiceSegments: TtsVoiceSegment[] | undefined;
    let multi = false;

    if (castActive) {
      const resolved = resolveSceneCast({
        sceneText,
        chapter: chuong_dang_chon,
        sceneIndex,
        cast,
        characterNames: charNames,
        nhanVatPrompts: storeState.nhan_vat_prompts || {},
        defaultVoice,
        platform,
        language,
        globalSpeed,
        globalPitch,
      });
      multi = resolved.useMulti;
      // Multi when cast parse ra ≥2 đoạn (kể + NV, hoặc nhiều NV) — luôn gửi segments
      if (multi || resolved.segments.length > 1) {
        multi = true;
        voiceSegments = toApiVoiceSegments(resolved.segments, {
          speed: globalSpeed,
          pitch: globalPitch,
        });
        // Nếu sau diversify vẫn 1 voice nhưng nhiều speaker → vẫn multi (pitch offset đã set)
        if (!voiceSegments || voiceSegments.length < 2) {
          multi = false;
          voiceSegments = undefined;
        }
      } else if (resolved.segments.length > 0) {
        const ems = [
          ...new Set(resolved.segments.map((s) => (s.emotion || '').trim()).filter(Boolean)),
        ];
        if (ems.length === 1) emotion = ems[0];
      }
      if (multi) {
        console.info(
          `[TTS Cast Multi] ${resolved.segments.length} đoạn · speakers=${[
            ...new Set(resolved.segments.map((s) => s.speaker || 'kể')),
          ].join(', ')} · voices=${[
            ...new Set(resolved.segments.map((s) => s.voice)),
          ].join(', ')}`,
        );
      }
    } else {
      const charVoiceMap = buildCharacterVoiceMap(
        charNames,
        storeState.nhan_vat_prompts || {},
        platform,
        false,
        language,
      );
      for (const name of charNames) {
        const explicit = storeState.nhan_vat_prompts?.[name]?.tts_voice?.trim();
        if (explicit) charVoiceMap[name] = explicit;
      }
      const segments: ScriptVoiceSegment[] = parseScriptVoiceSegments({
        sceneText,
        characterNames: charNames,
        characterVoices: charVoiceMap,
        defaultVoice,
      });
      multi = shouldUseMultiVoice(segments, charVoiceMap, defaultVoice);
      voiceSegments = multi
        ? segments.map((s) => ({
            speaker: s.speaker,
            text: s.text,
            voice: s.voice || defaultVoice,
          }))
        : undefined;
      if (multi) {
        console.info(
          `[TTS Multi] ${segments.length} đoạn · voices=${[...new Set(segments.map((s) => s.voice))].join(', ')}`,
        );
      }
    }

    // Mono dài → chia đoạn song song + concat (cùng giọng).
    // forceMono chỉ tắt Role Cast, KHÔNG tắt parallel-split (vẫn 1 giọng, nhiều luồng).
    if (
      !multi &&
      shouldParallelSplitMono(sceneText, platform)
    ) {
      const parts = splitMonoForParallel(sceneText, { maxChars: 240 });
      if (parts.length > 1) {
        multi = true;
        voiceSegments = parts.map((t, i) => ({
          speaker: `đoạn${i + 1}`,
          text: t,
          voice: defaultVoice,
          speed: globalSpeed,
          pitch: globalPitch,
        }));
        console.info(
          `[TTS Parallel-split] mono ${parts.length} đoạn · voice=${defaultVoice} · → gen song song + ghép`,
        );
        onProgress?.({
          percent: 5,
          multi: true,
          total: parts.length,
          current: 0,
          label: `Chia ${parts.length} đoạn · gen song song rồi ghép`,
        });
      }
    }

    if (multi && voiceSegments && voiceSegments.length > 1) {
      return runMultiVoiceTts({
        voiceSegments,
        chapter: chuong_dang_chon,
        sceneIndex,
        drivePath,
        ten_tac_pham,
        keysToUse,
        activeConfig,
        storeTtsConfig: storeState.ttsConfig,
        tiktokSessionIds: storeState.tiktokSessionIds || [],
        globalSpeed,
        globalPitch,
        forceFullMulti,
        applyLoudnorm,
        youtubeSafe: yt,
        onProgress,
      });
    }

    onProgress?.({
      percent: 15,
      multi: false,
      label: 'Đang sinh giọng đơn…',
    });

    const { buildClientApiHeaders } = await import('./apiClient');
    const res = await fetch(API.generateTts, {
      method: 'POST',
      headers: buildClientApiHeaders(),
      body: JSON.stringify({
        sceneText,
        chapterNum: chuong_dang_chon,
        sceneIndex,
        drivePath,
        voiceName: defaultVoice,
        apiKeys: keysToUse,
        ten_tac_pham,
        ttsConfig: withRotatedTikTokSession({
          config: activeConfig || storeState.ttsConfig,
          sessions: storeState.tiktokSessionIds || [],
          rotateIndex: sceneIndex,
        }),
        targetDuration,
        syncMode,
        applyLoudnorm,
        injectBreathPauses: yt?.injectBreathPauses !== false,
        roomTone: yt?.roomTone !== false,
        bgmMix: yt?.bgmMix === true,
        bgmPath: yt?.bgmPath || '',
        emotionTts: yt?.emotionTts !== false,
        emotion,
        voiceSegments: undefined,
      })
    });

    const data = await res.json().catch(() => ({}));
    const correlationId =
      res.headers.get('x-correlation-id') ||
      (typeof data?.correlationId === 'string' ? data.correlationId : '') ||
      '';
    if (!res.ok) {
      const msg = data.error || 'TTS generation failed.';
      const e = new Error(
        correlationId ? `${msg} [cid=${correlationId}]` : msg,
      ) as Error & { correlationId?: string };
      e.correlationId = correlationId || undefined;
      throw e;
    }

    if (!data.audioPath || !Number.isFinite(Number(data.duration)) || Number(data.duration) <= 0) {
      throw new Error('TTS API khong tra ve audioPath hoac duration hop le.');
    }

    onProgress?.({ percent: 100, multi: false, label: 'Hoàn tất' });

    return {
      audioPath: data.audioPath,
      duration: Number(data.duration),
      multi: false,
      segmentCount: 1,
    };
  };

  // Provider/platform are explicit; API key rotation stays inside engines / route.
  return await postTTS(ttsConfig, voice, apiKey, apiKeys);
}
