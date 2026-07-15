import type { TTSConfig } from '@/store/useNovelStore';
import {
  clearMultiPartial,
  resolveResumeHits,
  writePartialFromPaths,
  type SegForResume,
} from '@/lib/multiTtsPartialCache';
import { withRotatedTikTokSession } from './generateHelpers';
import type { TTSProgressEvent, TtsVoiceSegment } from './types';
import { API } from '@/contracts';
import { buildClientApiHeaders } from '../apiClient';

type YoutubeTtsMixConfig = {
  injectBreathPauses?: boolean;
  roomTone?: boolean;
  bgmMix?: boolean;
  bgmPath?: string;
  emotionTts?: boolean;
};

function stripQuery(p: string): string {
  const s = String(p || '').trim();
  const q = s.indexOf('?');
  return q >= 0 ? s.slice(0, q) : s;
}

/** Unique part tag so parallel scenes never overwrite each other's segment files */
function partTagFor(chapter: number, sceneIndex: number, segIndex: number): string {
  return `ch${chapter}_sc${sceneIndex}_p${segIndex}_${Date.now().toString(36)}`;
}

export async function runMultiVoiceTts(params: {
  voiceSegments: TtsVoiceSegment[];
  chapter: number;
  sceneIndex: number;
  drivePath: string;
  ten_tac_pham: string;
  keysToUse: string[];
  activeConfig?: TTSConfig;
  storeTtsConfig: TTSConfig;
  tiktokSessionIds: string[];
  globalSpeed: number;
  globalPitch: number;
  forceFullMulti: boolean;
  applyLoudnorm: boolean;
  youtubeSafe?: YoutubeTtsMixConfig;
  onProgress?: (ev: TTSProgressEvent) => void;
}): Promise<{
  audioPath: string;
  duration: number;
  multi: true;
  segmentCount: number;
}> {
  const {
    voiceSegments,
    chapter,
    sceneIndex,
    drivePath,
    ten_tac_pham,
    keysToUse,
    activeConfig,
    storeTtsConfig,
    tiktokSessionIds,
    globalSpeed,
    globalPitch,
    forceFullMulti,
    applyLoudnorm,
    youtubeSafe,
    onProgress,
  } = params;
  const total = voiceSegments.length;
  const MAX_SEG_RETRY = 2;
  const plat = (
    activeConfig?.platform ||
    storeTtsConfig?.platform ||
    ''
  ).toLowerCase();
  const envMulti = Number(
    process.env.NEXT_PUBLIC_TTS_MULTI_CONCURRENCY ||
      process.env.TTS_MULTI_CONCURRENCY ||
      '',
  );
  // Match server pool default (VINA_DAEMON_WORKERS=2). Client env is optional hint.
  const vinaWorkers = Math.max(
    1,
    Math.min(
      4,
      Number(process.env.NEXT_PUBLIC_VINA_DAEMON_WORKERS) ||
        Number(process.env.VINA_DAEMON_WORKERS) ||
        2,
    ),
  );
  const concurrency =
    plat === 'vina_voice' || plat === 'omnivoice_local'
      ? Number.isFinite(envMulti) && envMulti > 0
        ? Math.min(vinaWorkers, Math.trunc(envMulti))
        : vinaWorkers
      : Math.max(
          1,
          Math.min(3, Number.isFinite(envMulti) && envMulti > 0 ? Math.trunc(envMulti) : 3),
        );
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
    chapter,
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
    if (resumePaths[i]) {
      return stripQuery(resumePaths[i] as string);
    }

    const seg = voiceSegments[i];
    const segConfig: TTSConfig = withRotatedTikTokSession({
      config: {
        ...(activeConfig || storeTtsConfig),
        voice: seg.voice,
        speed: typeof seg.speed === 'number' ? seg.speed : globalSpeed,
        pitch: typeof seg.pitch === 'number' ? seg.pitch : globalPitch,
      },
      fallbackPlatform: storeTtsConfig?.platform,
      sessions: tiktokSessionIds,
      fallbackSession: activeConfig?.tiktokSessionId || storeTtsConfig?.tiktokSessionId,
      rotateIndex: i + sceneIndex,
    }) as TTSConfig;
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
        const retryConfig =
          attempt > 0
            ? (withRotatedTikTokSession({
                config: segConfig,
                fallbackPlatform: storeTtsConfig?.platform,
                sessions: tiktokSessionIds,
                fallbackSession: activeConfig?.tiktokSessionId || storeTtsConfig?.tiktokSessionId,
                rotateIndex: i + sceneIndex + attempt,
              }) as TTSConfig)
            : segConfig;
        // Unique partTag: concurrent scenes + parallel segments never clobber files
        const partTag = `${partTagFor(chapter, sceneIndex, i)}_a${attempt}`;
        const res = await fetch(API.generateTts, {
          method: 'POST',
          headers: buildClientApiHeaders(),
          body: JSON.stringify({
            sceneText: seg.text,
            chapterNum: chapter,
            // High unique index + partTag → /audio/multi/part_*.wav
            sceneIndex: 800000 + Math.abs(chapter) * 2000 + Math.abs(sceneIndex) * 40 + i,
            partTag,
            drivePath: '',
            voiceName: seg.voice,
            apiKeys: keysToUse,
            ten_tac_pham,
            ttsConfig: retryConfig,
            applyLoudnorm: false,
            injectBreathPauses: youtubeSafe?.injectBreathPauses !== false,
            roomTone: false,
            bgmMix: false,
            emotionTts: youtubeSafe?.emotionTts !== false,
            emotion: (seg.emotion || '').trim(),
            // Segment is part of chapter pipeline
            isChapterPart: true,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.audioPath) {
          throw new Error(
            data?.error ||
              `Lỗi sinh đoạn ${i + 1}/${total} (${seg.speaker || 'kể'})`,
          );
        }
        return stripQuery(data.audioPath as string);
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
        ? `Resume ${hitCount}/${total} · gen ${total - hitCount} · ×${concurrency} luồng`
        : `Song song ×${concurrency} · ${total} đoạn → ghép`,
  });

  const partPaths: (string | undefined)[] = new Array(total);
  for (let i = 0; i < total; i++) {
    if (resumePaths[i]) partPaths[i] = stripQuery(resumePaths[i] as string);
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
              chapter,
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
              label: `Xong ${completed}/${total} · ${voiceSegments[i].speaker || 'kể'} · ×${concurrency}`,
            });
          } catch (e) {
            writePartialFromPaths({
              chapter,
              sceneIndex,
              segments: segsForResume,
              paths: partPaths,
            });
            if (!failBox.err) {
              failBox.err = e instanceof Error ? e : new Error(String(e));
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

  const finalPaths = (partPaths as string[]).map(stripQuery);
  if (finalPaths.some((p) => !p)) {
    throw new Error('Thiếu đường dẫn partial sau multi gen.');
  }

  onProgress?.({
    percent: 90,
    current: total,
    total,
    multi: true,
    label: `Đang ghép ${total} đoạn…`,
  });

  const concatRes = await fetch(API.concatAudio, {
    method: 'POST',
    headers: buildClientApiHeaders(),
    body: JSON.stringify({
      paths: finalPaths,
      chapterNum: chapter,
      sceneIndex,
      drivePath,
      ten_tac_pham,
      applyLoudnorm,
      roomTone: youtubeSafe?.roomTone !== false,
      bgmMix: youtubeSafe?.bgmMix === true,
      bgmPath: youtubeSafe?.bgmPath || '',
      cleanup: true,
    }),
  });
  const concatData = await concatRes.json().catch(() => ({}));
  if (!concatRes.ok || !concatData?.audioPath) {
    writePartialFromPaths({
      chapter,
      sceneIndex,
      segments: segsForResume,
      paths: finalPaths,
    });
    throw new Error(concatData?.error || 'Nối audio (ghép đoạn) thất bại.');
  }
  if (!Number.isFinite(Number(concatData.duration)) || Number(concatData.duration) <= 0) {
    throw new Error('Concat không trả duration hợp lệ.');
  }

  clearMultiPartial(chapter, sceneIndex);

  onProgress?.({
    percent: 100,
    current: total,
    total,
    multi: true,
    label:
      hitCount > 0
        ? `Hoàn tất ghép (resume ${hitCount})`
        : `Hoàn tất · ${total} đoạn đã ghép`,
  });

  return {
    audioPath: stripQuery(concatData.audioPath as string),
    duration: Number(concatData.duration),
    multi: true,
    segmentCount: total,
  };
}
