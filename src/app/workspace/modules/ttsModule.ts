/**
 * Module quan ly giong doc AI va studio thu am.
 */
import { cleanVoiceScript } from '../utils/stringUtils';
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
  clearMultiPartial,
  resolveResumeHits,
  writePartialFromPaths,
  type SegForResume,
} from '@/lib/multiTtsPartialCache';
import {
  resolveSceneCast,
  toApiVoiceSegments,
} from './castModule';
import {
  applyMediaSelfHealPatch,
  collectAudioRepairRoutes,
  diagnoseMediaSelfHeal,
  resolveMediaSelfHealLog,
  type AudioRepairRoute,
} from '../utils/mediaSelfRepair';


interface PlayTTSParams {
  text: string;
  voice: string;
  ttsConfig?: TTSConfig;
  apiKeys: string[];
  apiKey: string;
  ten_tac_pham: string;
  onStart: () => void;
  onSuccess: (audio: HTMLAudioElement) => void;
  onEnded: () => void;
  onError: (msg: string) => void;
}

function getTTSCredentialsForConfig(activeConfig: TTSConfig | undefined, apiKey: string, apiKeys: string[]) {
  const store = useNovelStore.getState();
  if (activeConfig?.platform === 'openai_tts') {
    const keys = store.openaiApiKeys?.length ? store.openaiApiKeys : (store.openaiApiKey ? [store.openaiApiKey] : []);
    return { apiKey: keys[0] || apiKey || '', apiKeys: keys };
  }
  if (activeConfig?.platform === 'gemini_tts') {
    const keys = store.apiKeys?.length ? store.apiKeys : (store.apiKey ? [store.apiKey] : []);
    return { apiKey: keys[0] || apiKey || '', apiKeys: keys };
  }
  return { apiKey, apiKeys };
}

export async function playTTSAction(params: PlayTTSParams): Promise<void> {
  const { text, voice, ttsConfig, apiKeys, apiKey, ten_tac_pham, onStart, onSuccess, onEnded, onError } = params;

  const cleanText = cleanVoiceScript(text);
  if (!cleanText) {
    throw new Error('Khong co loi thoai nao kha dung de nghe thu.');
  }

  const previewText = cleanText.substring(0, 300);
  const keysToUse = apiKeys && apiKeys.length > 0 ? apiKeys : (apiKey ? [apiKey] : []);

  onStart();

  const playPreview = async (
    activeConfig: TTSConfig | undefined,
    activeVoice: string,
    activeApiKey: string,
    activeApiKeys: string[],
  ) => {
    const speed = activeConfig?.speed || 1.0;
    const pitch = activeConfig?.pitch || 0;
    const cache = await window.caches.open('tts-prelisten-cache-v1');
    const cacheKey = `https://tts-prelisten-local/play?platform=${encodeURIComponent(activeConfig?.platform || '')}&voice=${encodeURIComponent(activeVoice)}&text=${encodeURIComponent(previewText)}&s=${speed}&p=${pitch}`;
    const cachedResponse = await cache.match(cacheKey);

    if (cachedResponse) {
      const blob = await cachedResponse.blob();
      const blobUrl = URL.createObjectURL(blob);
      const audio = new Audio(blobUrl);
      audio.play();
      onSuccess(audio);
      audio.onended = onEnded;
      audio.onerror = () => {
        onEnded();
        onError('File am thanh nghe thu trong cache bi loi.');
      };
      return;
    }
    const activeKeysToUse = activeApiKeys && activeApiKeys.length > 0 ? activeApiKeys : (activeApiKey ? [activeApiKey] : []);
    const res = await fetch('/api/generate-tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sceneText: previewText,
        chapterNum: 0,
        sceneIndex: 999,
        voiceName: activeVoice,
        apiKeys: activeKeysToUse,
        ten_tac_pham,
        ttsConfig: activeConfig
      })
    });

    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) {
      throw new Error(data?.error || 'Loi goi API sinh giong doc TTS.');
    }

    const audioRes = await fetch(data.audioPath);
    if (!audioRes.ok) {
      throw new Error(`Khong the tai tep am thanh nghe thu: ${data.audioPath}`);
    }

    const blob = await audioRes.blob();
    const contentType = audioRes.headers.get('Content-Type')
      || (data.audioPath?.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg');
    await cache.put(cacheKey, new Response(blob, {
      headers: { 'Content-Type': contentType }
    }));

    const blobUrl = URL.createObjectURL(blob);
    const audio = new Audio(blobUrl);
    audio.play();
    onSuccess(audio);
    audio.onended = onEnded;
    audio.onerror = () => {
      onEnded();
      onError('File am thanh bi loi, thu lai.');
    };
  };

  try {
    await playPreview(ttsConfig, voice, apiKey, keysToUse);
  } catch (err: unknown) {
    const store = useNovelStore.getState();
    const diagnosis = await diagnoseMediaSelfHeal(store, 'audio', err, {
      operation: 'tts_preview',
      ttsPlatform: ttsConfig?.platform,
      ttsVoice: voice,
    });

    const routes = collectAudioRepairRoutes(
      useNovelStore.getState(),
      diagnosis,
      ttsConfig?.platform,
      voice,
    );

    console.info(
      `[Self-Heal Brain] TTS preview orchestration: kind=${diagnosis.issue.kind}, routes=${routes.length}, log=${diagnosis.logId}`,
    );

    if (routes.length === 0) {
      onEnded();
      onError(err instanceof Error ? err.message : String(err));
      return;
    }

    applyMediaSelfHealPatch(useNovelStore.getState(), diagnosis.patch);

    let lastError: unknown = err;
    for (const route of routes) {
      applyMediaSelfHealPatch(useNovelStore.getState(), {
        ttsConfig: { platform: route.platform as TTSConfig['platform'], voice: route.voice },
      });
      const patchedStore = useNovelStore.getState();
      const patchedConfig = patchedStore.ttsConfig;
      const patchedVoice = route.voice || patchedConfig.voice || voice;
      const patchedCredentials = getTTSCredentialsForConfig(patchedConfig, apiKey, apiKeys);

      console.info(
        `[Self-Heal Brain] Trying TTS preview route: ${route.platform}/${patchedVoice} (${route.reason})`,
      );

      try {
        await playPreview(patchedConfig, patchedVoice, patchedCredentials.apiKey, patchedCredentials.apiKeys);
        await resolveMediaSelfHealLog(diagnosis.logId);
        return;
      } catch (retryError) {
        lastError = retryError;
        console.warn(
          `[Self-Heal Brain] TTS preview route failed ${route.platform}:`,
          retryError instanceof Error ? retryError.message : retryError,
        );
      }
    }

    onEnded();
    onError(
      `Self-heal that bai sau ${routes.length} tuyen TTS. ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    );
  }
}

export type TTSProgressEvent = {
  percent: number;
  current?: number;
  total?: number;
  label?: string;
  multi?: boolean;
};

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
  } = params;
  const drivePath = savePathTTS || (googleDrivePath ? `${googleDrivePath.trim()}${googleDrivePath.trim().includes('/') ? '/' : '\\'}Am Thanh TTS` : '');

  const postTTS = async (
    activeConfig?: TTSConfig,
    activeVoice = voice,
    activeApiKey = apiKey,
    activeApiKeys = apiKeys,
  ) => {
    const keysToUse = activeApiKeys && activeApiKeys.length > 0 ? activeApiKeys : (activeApiKey ? [activeApiKey] : []);
    const storeState = useNovelStore.getState();
    const yt = storeState.youtubeSafe;
    const applyLoudnorm = yt?.applyLoudnorm !== false;
    // Dominant emotion from storyboard prompts for this scene (emotion TTS)
    const assetKey = `${chuong_dang_chon}_${sceneIndex}`;
    const prompts = storeState.generatedPrompts?.[assetKey] || [];
    const emotionCounts: Record<string, number> = {};
    for (const p of prompts) {
      const e = (p as { emotion?: string }).emotion?.trim();
      if (e) emotionCounts[e] = (emotionCounts[e] || 0) + 1;
    }
    let emotion =
      Object.entries(emotionCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '';

    // Đa giọng: prefer Role Casting Studio when castActive; else legacy name: lines
    const platform = activeConfig?.platform || storeState.ttsConfig.platform;
    const defaultVoice = activeVoice || activeConfig?.voice || storeState.ttsConfig.voice;
    const charNames = storeState.nhan_vat || [];
    const globalSpeed = activeConfig?.speed ?? storeState.ttsConfig.speed ?? 1;
    const globalPitch = activeConfig?.pitch ?? storeState.ttsConfig.pitch ?? 0;
    const language = activeConfig?.language || storeState.ttsConfig.language || 'vi';
    const cast = normalizeVoiceCast(storeState.voiceCast);
    const castActive = isCastActive(cast);

    let voiceSegments:
      | Array<{
          speaker: string | null;
          text: string;
          voice: string;
          speed?: number;
          pitch?: number;
          emotion?: string;
        }>
      | undefined;
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
        true,
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

    // ——— Client multi: resume cache + parallel pool + per-seg retry ———
    if (multi && voiceSegments && voiceSegments.length > 1) {
      const total = voiceSegments.length;
      const MAX_SEG_RETRY = 2;
      const concurrency = 2;
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

      const segsForResume: SegForResume[] = voiceSegments.map((s) => ({
        text: s.text,
        voice: s.voice,
        speed: typeof s.speed === 'number' ? s.speed : globalSpeed,
        pitch: typeof s.pitch === 'number' ? s.pitch : globalPitch,
        emotion: (s.emotion || '').trim(),
        speaker: s.speaker,
      }));

      const { paths: resumePaths, hitCount } = await resolveResumeHits({
        chapter: chuong_dang_chon,
        sceneIndex,
        segments: segsForResume,
        forceFull: forceFullMulti,
      });

      if (hitCount > 0) {
        console.info(
          `[TTS Multi Resume] ${hitCount}/${total} đoạn tái sử dụng cache partial`,
        );
      }

      const genOneSeg = async (i: number): Promise<string> => {
        // Resume hit
        if (resumePaths[i]) {
          return resumePaths[i] as string;
        }

        const seg = voiceSegments[i];
        const segConfig: TTSConfig = {
          ...(activeConfig || storeState.ttsConfig),
          voice: seg.voice,
          speed: typeof seg.speed === 'number' ? seg.speed : globalSpeed,
          pitch: typeof seg.pitch === 'number' ? seg.pitch : globalPitch,
        };
        let lastErr: Error | null = null;
        for (let attempt = 0; attempt <= MAX_SEG_RETRY; attempt++) {
          if (attempt > 0) {
            onProgress?.({
              percent: Math.round(5 + ((i + 0.5) / total) * 80),
              current: i + 1,
              total,
              multi: true,
              label: `Retry ${attempt}/${MAX_SEG_RETRY} · đoạn ${i + 1} · ${seg.speaker || 'kể'}`,
            });
            await sleep(350 * attempt);
          }
          try {
            const res = await fetch('/api/generate-tts', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                sceneText: seg.text,
                chapterNum: 0,
                sceneIndex: 99000 + i,
                drivePath: '',
                voiceName: seg.voice,
                apiKeys: keysToUse,
                ten_tac_pham,
                ttsConfig: segConfig,
                applyLoudnorm: false,
                injectBreathPauses: yt?.injectBreathPauses !== false,
                roomTone: false,
                bgmMix: false,
                emotionTts: yt?.emotionTts !== false,
                emotion: (seg.emotion || '').trim(),
              }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data?.audioPath) {
              throw new Error(
                data?.error ||
                  `Lỗi sinh đoạn ${i + 1}/${total} (${seg.speaker || 'kể'})`,
              );
            }
            return data.audioPath as string;
          } catch (e) {
            lastErr = e instanceof Error ? e : new Error(String(e));
          }
        }
        throw lastErr || new Error(`Đoạn ${i + 1} thất bại sau ${MAX_SEG_RETRY} retry`);
      };

      onProgress?.({
        percent: 3,
        current: hitCount,
        total,
        multi: true,
        label:
          hitCount > 0
            ? `Resume ${hitCount}/${total} · gen ${total - hitCount} còn lại · ×${concurrency}`
            : `Đa giọng · ${total} đoạn · ×${concurrency}`,
      });

      const partPaths: (string | undefined)[] = new Array(total);
      for (let i = 0; i < total; i++) {
        if (resumePaths[i]) partPaths[i] = resumePaths[i] as string;
      }

      const pending: number[] = [];
      for (let i = 0; i < total; i++) {
        if (!partPaths[i]) pending.push(i);
      }

      let pendingCursor = 0;
      let completed = hitCount;
      const failBox: { err: Error | null } = { err: null };

      if (pending.length > 0) {
        const workers = Array.from(
          { length: Math.min(concurrency, pending.length) },
          async () => {
            while (!failBox.err) {
              const slot = pendingCursor++;
              if (slot >= pending.length) break;
              const i = pending[slot];
              try {
                partPaths[i] = await genOneSeg(i);
                writePartialFromPaths({
                  chapter: chuong_dang_chon,
                  sceneIndex,
                  segments: segsForResume,
                  paths: partPaths,
                });
                completed += 1;
                onProgress?.({
                  percent: Math.round(5 + (completed / total) * 80),
                  current: completed,
                  total,
                  multi: true,
                  label: `Xong ${completed}/${total} · ${voiceSegments[i].speaker || 'kể'}`,
                });
              } catch (e) {
                writePartialFromPaths({
                  chapter: chuong_dang_chon,
                  sceneIndex,
                  segments: segsForResume,
                  paths: partPaths,
                });
                if (!failBox.err) {
                  failBox.err =
                    e instanceof Error ? e : new Error(String(e));
                }
              }
            }
          },
        );
        await Promise.all(workers);
      }

      if (failBox.err) {
        const have = partPaths.filter(Boolean).length;
        throw new Error(
          `${failBox.err.message} (đã lưu ${have}/${total} đoạn — gen lại cảnh để resume)`,
        );
      }

      const finalPaths = partPaths as string[];
      if (finalPaths.some((p) => !p)) {
        throw new Error('Thiếu đường dẫn partial sau multi gen.');
      }

      onProgress?.({
        percent: 90,
        current: total,
        total,
        multi: true,
        label: 'Đang nối audio…',
      });

      const concatRes = await fetch('/api/concat-audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paths: finalPaths,
          chapterNum: chuong_dang_chon,
          sceneIndex,
          drivePath,
          ten_tac_pham,
          applyLoudnorm,
          roomTone: yt?.roomTone !== false,
          bgmMix: yt?.bgmMix === true,
          bgmPath: yt?.bgmPath || '',
          // Keep partials until success; concat cleans 99xxx by default
          cleanup: true,
        }),
      });
      const concatData = await concatRes.json().catch(() => ({}));
      if (!concatRes.ok || !concatData?.audioPath) {
        writePartialFromPaths({
          chapter: chuong_dang_chon,
          sceneIndex,
          segments: segsForResume,
          paths: finalPaths,
        });
        throw new Error(concatData?.error || 'Nối audio đa giọng thất bại.');
      }
      if (!Number.isFinite(Number(concatData.duration)) || Number(concatData.duration) <= 0) {
        throw new Error('Concat không trả duration hợp lệ.');
      }

      // Full success — drop resume cache
      clearMultiPartial(chuong_dang_chon, sceneIndex);

      onProgress?.({
        percent: 100,
        current: total,
        total,
        multi: true,
        label:
          hitCount > 0
            ? `Hoàn tất đa giọng (resume ${hitCount})`
            : 'Hoàn tất đa giọng',
      });

      return {
        audioPath: concatData.audioPath as string,
        duration: Number(concatData.duration),
        multi: true,
        segmentCount: total,
      };
    }

    onProgress?.({
      percent: 15,
      multi: false,
      label: 'Đang sinh giọng đơn…',
    });

    const res = await fetch('/api/generate-tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sceneText,
        chapterNum: chuong_dang_chon,
        sceneIndex,
        drivePath,
        voiceName: activeVoice,
        apiKeys: keysToUse,
        ten_tac_pham,
        ttsConfig: activeConfig,
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
    if (!res.ok) {
      throw new Error(data.error || 'TTS generation failed.');
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

  try {
    return await postTTS(ttsConfig, voice, apiKey, apiKeys);
  } catch (firstError) {
    const store = useNovelStore.getState();
    const castActiveHeal = isCastActive(normalizeVoiceCast(store.voiceCast));
    // Multi-cast: never blind platform-swap (voice IDs are platform-bound)
    if (castActiveHeal) {
      console.warn(
        '[Self-Heal Brain] castActive multi-cast: skip platform-swap heal routes',
      );
      throw firstError instanceof Error ? firstError : new Error(String(firstError));
    }

    const diagnosis = await diagnoseMediaSelfHeal(store, 'audio', firstError, {
      operation: 'generate_tts',
      ttsPlatform: ttsConfig?.platform,
      ttsVoice: voice,
      sceneIndex,
    });

    const routes = collectAudioRepairRoutes(
      useNovelStore.getState(),
      diagnosis,
      ttsConfig?.platform,
      voice,
    );

    console.info(
      `[Self-Heal Brain] TTS generate orchestration: kind=${diagnosis.issue.kind}, routes=${routes.length}, log=${diagnosis.logId}`,
    );

    if (routes.length === 0) {
      throw firstError instanceof Error ? firstError : new Error(String(firstError));
    }

    applyMediaSelfHealPatch(useNovelStore.getState(), diagnosis.patch);

    const attempted: AudioRepairRoute[] = [];
    let lastError: unknown = firstError;

    for (const route of routes) {
      attempted.push(route);
      applyMediaSelfHealPatch(useNovelStore.getState(), {
        ttsConfig: { platform: route.platform as TTSConfig['platform'], voice: route.voice },
      });
      const patchedStore = useNovelStore.getState();
      const patchedConfig = patchedStore.ttsConfig;
      const patchedVoice = route.voice || patchedConfig.voice || voice;
      const patchedCredentials = getTTSCredentialsForConfig(patchedConfig, apiKey, apiKeys);

      console.info(
        `[Self-Heal Brain] Trying TTS generate route ${attempted.length}/${routes.length}: ${route.platform}/${patchedVoice}`,
      );

      try {
        const repaired = await postTTS(
          patchedConfig,
          patchedVoice,
          patchedCredentials.apiKey,
          patchedCredentials.apiKeys,
        );
        await resolveMediaSelfHealLog(diagnosis.logId);
        const summary = `Self-heal TTS: ${attempted.map((r) => r.platform).join(' -> ')}. OK: ${route.platform}`;
        return {
          ...repaired,
          selfRepair: { message: summary },
        };
      } catch (retryError) {
        lastError = retryError;
        console.warn(
          `[Self-Heal Brain] TTS generate route failed ${route.platform}:`,
          retryError instanceof Error ? retryError.message : retryError,
        );
      }
    }

    const lastMsg = lastError instanceof Error ? lastError.message : String(lastError);
    const firstMsg = firstError instanceof Error ? firstError.message : String(firstError);
    throw new Error(
      `Self-heal that bai sau ${attempted.length} tuyen TTS. Goc: ${firstMsg}. Cuoi: ${lastMsg}. Log: ${diagnosis.logPath || diagnosis.logId}`,
    );
  }
}
