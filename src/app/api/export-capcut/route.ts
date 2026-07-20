import { NextResponse } from 'next/server';
import { createDraftFromSpec } from 'cutsdk';
import type { DraftSpec, TrackSpec, ClipSpec } from 'cutsdk';
import {
  collectChapterAudioDiskPaths,
  collectChapterImageDiskPaths,
  collectChapterVideoDiskPaths,
} from '@/lib/integrations/mediaPaths';
import { runChapterPipeline } from '@/lib/integrations/chapterPipeline';
import { assertPremiumAccessHard } from '@/lib/commercial/proGateHard';
import { httpStatusFromError, toErrorJson } from '@/lib/errors';
import { toCapCutAspect, type CapCutAspect } from '@/lib/outputCriteria';

export const runtime = 'nodejs';

function normalizeCapCutAspect(raw: unknown, fallbackVideo?: unknown): CapCutAspect {
  if (typeof raw === 'string' && raw.trim()) {
    const allowed: CapCutAspect[] = ['16:9', '9:16', '1:1', '4:5'];
    if ((allowed as string[]).includes(raw.trim())) return raw.trim() as CapCutAspect;
    return toCapCutAspect(raw);
  }
  if (typeof fallbackVideo === 'string') return toCapCutAspect(fallbackVideo);
  return '16:9';
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    await assertPremiumAccessHard(req, body);
    const {
      chapterNum,
      ten_tac_pham,
      generatedAudioPaths,
      generatedImages,
      generatedVideos,
      // Toolbar Ảnh / Video
      imageAspectRatio,
      videoAspectRatio,
      aspect,
      videoDuration,
      imageProvider,
      videoProvider,
      mediaStylePreset,
      visualDna,
      // Toolbar TTS
      ttsConfig,
    } = body;

    if (!chapterNum) {
      return NextResponse.json({ error: 'Missing chapterNum' }, { status: 400 });
    }

    const ch = Number(chapterNum);
    const capCutAspect = normalizeCapCutAspect(aspect, videoAspectRatio);
    const durationHint = Math.max(
      1,
      Math.min(30, Number(videoDuration) || 6),
    );
    const ttsPlatform = String(ttsConfig?.platform || '').trim();
    const ttsVoice = String(ttsConfig?.voice || '').trim();

    // Resolve store URLs → absolute disk files
    const images = collectChapterImageDiskPaths(ch, generatedImages || {});
    const videos = collectChapterVideoDiskPaths(ch, generatedVideos || {});
    const audios = collectChapterAudioDiskPaths(ch, generatedAudioPaths || {});

    // FableCut rebuild with USER video aspect (not hardcoded 9:16)
    let fablecutPath: string | undefined;
    try {
      const pipe = await runChapterPipeline({
        chapterNum: ch,
        title: `Chương ${ch}`,
        ten_tac_pham: ten_tac_pham || 'AI-Novel',
        generatedImages: generatedImages || {},
        generatedAudioPaths: generatedAudioPaths || {},
        generatedVideos: generatedVideos || {},
        runSeedance: false,
        runFableCut: true,
        liveEditor: true,
        autoStartFableCut: false,
        aspect: capCutAspect,
        secondsPerImage: durationHint,
      });
      if (pipe.fablecut?.success) fablecutPath = pipe.fablecut.projectPath;
    } catch (e) {
      console.warn('[Export CapCut] fablecut:', (e as Error).message);
    }

    const videoClips: ClipSpec[] = [];
    const audioClips: ClipSpec[] = [];
    let currentTime = 0;
    const transitions = ['fade_in', 'fade_out', 'zoom_in', 'slide_left'];

    // Prefer videos then images, ordered by key
    const visual = [
      ...videos.map((v) => ({ key: v.key, path: v.disk, kind: 'video' as const })),
      ...images.map((i) => ({ key: i.key, path: i.disk, kind: 'image' as const })),
    ].sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));

    // Dedupe by key preferring video over image
    const seen = new Set<string>();
    const visuals: typeof visual = [];
    for (const v of visual) {
      const baseKey = v.key.replace(/_video$/, '');
      if (seen.has(baseKey) && v.kind === 'image') continue;
      if (v.kind === 'video') seen.add(baseKey);
      else if (!seen.has(baseKey)) seen.add(baseKey);
      else continue;
      visuals.push(v);
    }

    const totalAudioDur = audios.reduce((s, a) => s + (a.duration || 0), 0);
    const perClip =
      visuals.length > 0 && totalAudioDur > 0
        ? Math.max(2, totalAudioDur / visuals.length)
        : Math.max(2, durationHint);

    for (let i = 0; i < visuals.length; i++) {
      const v = visuals[i];
      const transitionName = transitions[i % transitions.length];
      videoClips.push({
        type: v.kind,
        src: v.path,
        start: currentTime,
        duration: perClip,
        transition: { name: transitionName, duration: 0.8 },
      } as ClipSpec);
      currentTime += perClip;
    }

    // Narration audio from start (TTS already baked; metadata is criteria only)
    let audioCursor = 0;
    for (const a of audios) {
      const dur = a.duration > 0 ? a.duration : perClip;
      audioClips.push({
        type: 'audio',
        src: a.disk,
        start: audioCursor,
        duration: dur,
      } as ClipSpec);
      audioCursor += dur;
    }

    const tracks: TrackSpec[] = [];
    if (videoClips.length > 0) tracks.push({ type: 'visual', clips: videoClips });
    if (audioClips.length > 0) tracks.push({ type: 'audio', clips: audioClips });

    if (tracks.length === 0) {
      return NextResponse.json(
        {
          error:
            'Không có media trên đĩa. Bấm 「Sản xuất cảnh (1 click)」 trước khi xuất CapCut.',
        },
        { status: 400 },
      );
    }

    const draftSpec: DraftSpec = {
      version: '1.0',
      tracks,
    };

    const result = await createDraftFromSpec(draftSpec);

    const criteria = {
      imageAspectRatio: imageAspectRatio || null,
      videoAspectRatio: videoAspectRatio || null,
      capCutAspect,
      videoDuration: durationHint,
      imageProvider: imageProvider || null,
      videoProvider: videoProvider || null,
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
    };

    console.log(
      `[Export CapCut] aspect=${capCutAspect} durationHint=${durationHint}s tts=${ttsPlatform}/${ttsVoice} img=${images.length} vid=${videos.length} aud=${audios.length}`,
    );

    return NextResponse.json({
      success: true,
      draftId: result.draftId,
      projectPath: result.filePath,
      fablecutPath,
      media: {
        images: images.length,
        videos: videos.length,
        audios: audios.length,
        clips: videoClips.length,
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
