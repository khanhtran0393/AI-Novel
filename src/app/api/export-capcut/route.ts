import { NextResponse } from 'next/server';
import {
  collectChapterAudioDiskPaths,
  collectChapterImageDiskPaths,
  collectChapterVideoDiskPaths,
  isFullChapterAudioKey,
  selectChapterTimelineAudioPaths,
} from '@/lib/integrations/mediaPaths';
import { buildXinChaoPack } from '@/lib/integrations/xinchaoCut';
import { runChapterPipeline } from '@/lib/integrations/chapterPipeline';
import { assertPremiumAccessHard } from '@/lib/commercial/proGateHard';
import { responseForGateFailure } from '@/lib/commercial/apiGate';
import { httpStatusFromError, toErrorJson } from '@/lib/errors';
import { type CapCutAspect } from '@/lib/outputCriteria';
import { probeDurationSec } from '@/lib/audioStudio';

export const runtime = 'nodejs';

function requireCapCutAspect(raw: unknown): CapCutAspect {
  const value = typeof raw === 'string' ? raw.trim() : '';
  const allowed: CapCutAspect[] = ['16:9', '9:16', '1:1', '4:5'];
  if ((allowed as string[]).includes(value)) return value as CapCutAspect;
  throw new Error('Thiếu tỷ lệ CapCut hợp lệ: 16:9, 9:16, 1:1 hoặc 4:5');
}

/** Store audio values may be string path or { path, duration }. */
function normalizeAudioMap(
  raw: unknown,
): Record<string, { path: string; duration: number }> {
  const out: Record<string, { path: string; duration: number }> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string' && v.trim()) {
      out[k] = { path: v.trim(), duration: 0 };
      continue;
    }
    if (v && typeof v === 'object') {
      const o = v as { path?: string; duration?: number };
      const p = String(o.path || '').trim();
      if (p) out[k] = { path: p, duration: Number(o.duration) || 0 };
    }
  }
  return out;
}

/**
 * Xuất CapCut — pack media + mở editor multi-track nội bộ (product name: CapCut).
 * cutsdk draft CapCut desktop: soft-try, không hard-fail khi máy chưa cài CapCut OS.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    try {
      await assertPremiumAccessHard(req, body);
    } catch (gateErr) {
      return responseForGateFailure(gateErr, 'export_capcut', undefined, body);
    }
    const {
      chapterNum,
      ten_tac_pham,
      generatedAudioPaths,
      generatedPrompts,
      generatedImages,
      generatedVideos,
      imageAspectRatio,
      videoAspectRatio,
      aspect,
      videoDuration,
      imageProvider,
      videoProvider,
      mediaStylePreset,
      visualDna,
      ttsConfig,
      openEditor = true,
    } = body;

    if (!chapterNum) {
      return NextResponse.json({ error: 'Missing chapterNum' }, { status: 400 });
    }

    const ch = Number(chapterNum);
    const capCutAspect = requireCapCutAspect(aspect || videoAspectRatio);
    const configuredDuration = Number(videoDuration);
    if (!Number.isFinite(configuredDuration) || configuredDuration <= 0) {
      return NextResponse.json(
        { error: 'Thiếu videoDuration hợp lệ cho CapCut' },
        { status: 400 },
      );
    }
    const configuredImageProvider = String(imageProvider || '').trim();
    const configuredVideoProvider = String(videoProvider || '').trim();
    if (!configuredImageProvider || !configuredVideoProvider) {
      return NextResponse.json(
        { error: 'Thiếu imageProvider hoặc videoProvider cho CapCut' },
        { status: 400 },
      );
    }
    const durationHint = Math.max(1, Math.min(30, configuredDuration));
    const ttsPlatform = String(ttsConfig?.platform || '').trim();
    const ttsVoice = String(ttsConfig?.voice || '').trim();
    const audioMap = normalizeAudioMap(generatedAudioPaths);

    const images = collectChapterImageDiskPaths(ch, generatedImages || {});
    const videos = collectChapterVideoDiskPaths(ch, generatedVideos || {});
    const rawAudios = collectChapterAudioDiskPaths(ch, audioMap);
    const audios = selectChapterTimelineAudioPaths(
      ch,
      rawAudios,
      (diskPath) => probeDurationSec(diskPath),
    );

    if (images.length + videos.length + audios.length === 0) {
      return NextResponse.json(
        {
          error:
            'Không có media trên đĩa. Gen ảnh/video/TTS trước khi xuất CapCut.',
        },
        { status: 400 },
      );
    }

    // ── Primary: multi-track editor pack (vendored full repo) ──
    const pack = buildXinChaoPack({
      chapterNum: ch,
      ten_tac_pham: ten_tac_pham || 'AI-Novel',
      generatedAudioPaths: audioMap,
      generatedPrompts: generatedPrompts || {},
      generatedImages: generatedImages || {},
      generatedVideos: generatedVideos || {},
      aspect: capCutAspect,
      videoDuration: durationHint,
      imageProvider: configuredImageProvider,
      videoProvider: configuredVideoProvider,
    });

    if (!pack.success) {
      return NextResponse.json(
        { error: pack.error || 'Không đóng gói được media cho editor.' },
        { status: 400 },
      );
    }

    // ── Side: FableCut project.json (soft) ──
    let fablecutPath: string | undefined;
    try {
      const pipe = await runChapterPipeline({
        chapterNum: ch,
        title: `Chương ${ch}`,
        ten_tac_pham: ten_tac_pham || 'AI-Novel',
        generatedImages: generatedImages || {},
        generatedAudioPaths: audioMap,
        generatedPrompts: generatedPrompts || {},
        generatedVideos: generatedVideos || {},
        runSeedance: false,
        runFableCut: true,
        liveEditor: false,
        autoStartFableCut: false,
        aspect: capCutAspect,
        secondsPerImage: durationHint,
      });
      if (pipe.fablecut?.success) fablecutPath = pipe.fablecut.projectPath;
    } catch (e) {
      console.warn('[Export CapCut] fablecut soft:', (e as Error).message);
    }

    // ── Optional: CapCut desktop draft via cutsdk (soft — never block success) ──
    let draftId: string | undefined;
    let cutsdkPath: string | undefined;
    let cutsdkError: string | undefined;
    try {
      const { createDraftFromSpec } = await import('cutsdk');
      const parseSceneIndices = (key: string) => {
        const clean = String(key || '').replace(/_video$/, '').trim();
        const mPrompt = clean.match(/(?:scene[_-]?|s)(\d+)[_-](?:prompt[_-]?|p)(\d+)/i);
        if (mPrompt) {
          return { sceneIndex: Number(mPrompt[1]) || 0, promptIndex: Number(mPrompt[2]) || 0 };
        }
        const mScene = clean.match(/(?:scene[_-]?|s)(\d+)/i);
        if (mScene) {
          return { sceneIndex: Number(mScene[1]) || 0, promptIndex: 0 };
        }
        const parts = clean.split('_');
        if (parts.length >= 3) {
          return { sceneIndex: Number(parts[1]) || 0, promptIndex: Number(parts[2]) || 0 };
        } else if (parts.length === 2) {
          return { sceneIndex: Number(parts[1]) || 0, promptIndex: 0 };
        }
        return { sceneIndex: 0, promptIndex: 0 };
      };

      const getSceneRank = (sceneIdx: number) => {
        if (sceneIdx === 990) return -1;
        return sceneIdx;
      };

      const rawVisuals = [
        ...videos.map((v) => {
          const idx = parseSceneIndices(v.key);
          return { key: v.key, path: v.disk, kind: 'video' as const, ...idx };
        }),
        ...images.map((i) => {
          const idx = parseSceneIndices(i.key);
          return { key: i.key, path: i.disk, kind: 'image' as const, ...idx };
        }),
      ];

      // Prefer video over image for the same base prompt key
      const seenVisualKeys = new Set<string>();
      const visuals: typeof rawVisuals = [];
      rawVisuals.sort((a, b) =>
        a.kind === b.kind ? 0 : a.kind === 'video' ? -1 : 1,
      );
      for (const v of rawVisuals) {
        const baseKey = v.key.replace(/_video$/, '');
        if (seenVisualKeys.has(baseKey)) continue;
        seenVisualKeys.add(baseKey);
        visuals.push(v);
      }

      const parsedAudios = audios.map((a) => {
        const idx = parseSceneIndices(a.key);
        let dur = a.duration || 0;
        if (a.disk) {
          try {
            const probed = probeDurationSec(a.disk);
            if (probed > 0.1) dur = probed;
          } catch {
            /* keep existing dur */
          }
        }
        return { key: a.key, path: a.disk, duration: dur, ...idx };
      });

      const uniqueScenes = Array.from(
        new Set<number>([
          ...visuals.map((v) => v.sceneIndex),
          ...parsedAudios.map((a) => a.sceneIndex),
        ]),
      ).sort((a, b) => getSceneRank(a) - getSceneRank(b));
      const hasFullChapterAudio =
        parsedAudios.length === 1 &&
        isFullChapterAudioKey(parsedAudios[0].key);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const videoClips: any[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const audioClips: any[] = [];
      const transitions = ['fade_in', 'fade_out', 'zoom_in', 'slide_left'];
      let timelineCursor = 0;

      if (pack.timelineReservation) {
        const diskByKey = new Map([
          ...images.map((item) => [item.key, item.disk] as const),
          ...videos.map((item) => [item.key, item.disk] as const),
        ]);
        for (
          let index = 0;
          index < pack.timelineReservation.slots.length;
          index += 1
        ) {
          const slot = pack.timelineReservation.slots[index];
          if (!slot.mediaKey || !slot.mediaKind) continue;
          const disk = diskByKey.get(slot.mediaKey);
          if (!disk) continue;
          videoClips.push({
            type: slot.mediaKind,
            src: disk,
            start: slot.startSec,
            duration: slot.durationSec,
            sourceDuration:
              slot.mediaKind === 'video'
                ? probeDurationSec(disk)
                : undefined,
            transition: {
              name: transitions[index % transitions.length],
              duration: 0.8,
            },
          });
        }
        if (hasFullChapterAudio) {
          const fullAudio = parsedAudios[0];
          audioClips.push({
            type: 'audio',
            src: fullAudio.path,
            start: 0,
            duration: pack.timelineReservation.durationSec,
            sourceDuration: fullAudio.duration,
            volume: 1.0,
          });
        } else {
          let cursor = 0;
          for (const audio of [...parsedAudios].sort(
            (left, right) =>
              getSceneRank(left.sceneIndex) - getSceneRank(right.sceneIndex),
          )) {
            audioClips.push({
              type: 'audio',
              src: audio.path,
              start: cursor,
              duration: audio.duration,
              sourceDuration: audio.duration,
              volume: 1.0,
            });
            cursor += audio.duration;
          }
        }
      } else if (hasFullChapterAudio) {
        const fullAudio = parsedAudios[0];
        const fullDuration = fullAudio.duration;
        if (!Number.isFinite(fullDuration) || fullDuration <= 0.1) {
          throw new Error('Không đọc được thời lượng audio full trên đĩa');
        }
        const orderedVisuals = [...visuals].sort(
          (left, right) =>
            getSceneRank(left.sceneIndex) - getSceneRank(right.sceneIndex) ||
            left.promptIndex - right.promptIndex,
        );
        const perVisualDuration =
          orderedVisuals.length > 0
            ? fullDuration / orderedVisuals.length
            : 0;
        let visualCursor = 0;
        for (let index = 0; index < orderedVisuals.length; index += 1) {
          const visual = orderedVisuals[index];
          videoClips.push({
            type: visual.kind,
            src: visual.path,
            start: visualCursor,
            duration: perVisualDuration,
            sourceDuration:
              visual.kind === 'video' ? perVisualDuration : undefined,
            transition: {
              name: transitions[index % transitions.length],
              duration: 0.8,
            },
          });
          visualCursor += perVisualDuration;
        }
        audioClips.push({
          type: 'audio',
          src: fullAudio.path,
          start: 0,
          duration: fullDuration,
          sourceDuration: fullDuration,
          volume: 1.0,
        });
        timelineCursor = fullDuration;
      }

      for (const sceneIdx of pack.timelineReservation || hasFullChapterAudio ? [] : uniqueScenes) {
        const sceneAudios = parsedAudios.filter((a) => a.sceneIndex === sceneIdx);
        const sceneVisuals = visuals
          .filter((v) => v.sceneIndex === sceneIdx)
          .sort((a, b) => a.promptIndex - b.promptIndex);

        const totalAudioDur = sceneAudios.reduce((s, a) => s + (a.duration || 0), 0);
        const effectiveAudioDur = totalAudioDur > 0.1 ? totalAudioDur : 0;

        const perVisualDur =
          sceneVisuals.length > 0
            ? effectiveAudioDur > 0
              ? effectiveAudioDur / sceneVisuals.length
              : Math.max(2, durationHint)
            : Math.max(2, durationHint);

        const sceneVisualTotalDur = sceneVisuals.length * perVisualDur;
        const sceneTotalDur = Math.max(effectiveAudioDur, sceneVisualTotalDur);

        let visCursor = timelineCursor;
        for (let i = 0; i < sceneVisuals.length; i++) {
          const v = sceneVisuals[i];
          videoClips.push({
            type: v.kind,
            src: v.path,
            start: visCursor,
            duration: perVisualDur,
            sourceDuration: v.kind === 'video' ? perVisualDur : undefined,
            transition: { name: transitions[i % transitions.length], duration: 0.8 },
          });
          visCursor += perVisualDur;
        }

        let audCursor = timelineCursor;
        for (const a of sceneAudios) {
          const dur = a.duration > 0.1 ? a.duration : sceneTotalDur;
          audioClips.push({
            type: 'audio',
            src: a.path,
            start: audCursor,
            duration: dur,
            sourceDuration: dur,
            volume: 1.0,
          });
          audCursor += dur;
        }

        timelineCursor += sceneTotalDur;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tracks: any[] = [];
      if (videoClips.length > 0) tracks.push({ type: 'visual', clips: videoClips });
      if (audioClips.length > 0) tracks.push({ type: 'audio', clips: audioClips });

      if (tracks.length > 0) {
        const result = await createDraftFromSpec({ version: '1.0', tracks });
        draftId = result?.draftId;
        cutsdkPath = result?.filePath;
      }
    } catch (e) {
      cutsdkError = e instanceof Error ? e.message : String(e);
      console.warn('[Export CapCut] cutsdk soft-fail (editor pack vẫn OK):', cutsdkError);
    }

    const criteria = {
      imageAspectRatio: imageAspectRatio || null,
      videoAspectRatio: videoAspectRatio || null,
      capCutAspect,
      videoDuration: durationHint,
      imageProvider: configuredImageProvider,
      videoProvider: configuredVideoProvider,
      mediaStylePreset: mediaStylePreset || null,
      visualDna: visualDna || null,
      tts: {
        platform: ttsPlatform || null,
        voice: ttsVoice || null,
        speed: ttsConfig?.speed ?? null,
        pitch: ttsConfig?.pitch ?? null,
        language: ttsConfig?.language || null,
      },
      source: 'toolbar: Ảnh/Video + TTS + CapCut',
      engine: 'capcut-pack',
    };

    console.log(
      `[Export CapCut] aspect=${capCutAspect} pack=${pack.packRoot} files=${pack.media.files} cutsdk=${draftId ? 'ok' : 'skip'}`,
    );

    // Auto-save CapCut pack into active channel ship_pack folder
    try {
      const { autoSaveToChannelFolder } = require('@/lib/channelMediaMirror');
      autoSaveToChannelFolder({
        channelName: ten_tac_pham || 'Kênh Chính',
        resourceType: 'ship_pack',
        sourceFilePath: pack.packRoot,
      });
    } catch {
      /* ignore */
    }

    return NextResponse.json({
      success: true,
      /** Pack editor (primary project path for GUI) */
      projectPath: pack.packRoot,
      mediaDir: pack.mediaDir,
      manifestPath: pack.manifestPath,
      draftId: draftId || null,
      cutsdkPath: cutsdkPath || null,
      cutsdkError: cutsdkError || null,
      fablecutPath: fablecutPath || null,
      openEditor: Boolean(openEditor),
      openEditorHint: pack.openEditorHint,
      media: {
        images: images.length,
        videos: videos.length,
        audios: audios.length,
        files: pack.media.files,
        clips: pack.timelineClips,
      },
      reservation: {
        slots: pack.timelineReservation?.slots.length || 0,
        filled: pack.timelineReservation?.filledSlots || 0,
        durationSec: pack.timelineReservation?.durationSec || 0,
        manifestPath: pack.manifestPath,
      },
      criteria,
    });
  } catch (error: unknown) {
    console.error('[Export CapCut] Error:', error);
    return NextResponse.json(toErrorJson(error), {
      status: httpStatusFromError(error),
    });
  }
}
