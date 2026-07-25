import { NextResponse } from 'next/server';
import {
  collectChapterAudioDiskPaths,
  collectChapterImageDiskPaths,
  collectChapterVideoDiskPaths,
} from '@/lib/integrations/mediaPaths';
import { buildXinChaoPack } from '@/lib/integrations/xinchaoCut';
import { runChapterPipeline } from '@/lib/integrations/chapterPipeline';
import { assertPremiumAccessHard } from '@/lib/commercial/proGateHard';
import { responseForGateFailure } from '@/lib/commercial/apiGate';
import { httpStatusFromError, toErrorJson } from '@/lib/errors';
import { type CapCutAspect } from '@/lib/outputCriteria';

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
 * Xuất CapCut (tên GUI) — engine = pack media + mở editor multi-track (tools/xinchao-cut).
 * cutsdk draft CapCut desktop: soft-try, không hard-fail khi máy chưa cài CapCut.
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
    const audios = collectChapterAudioDiskPaths(ch, audioMap);

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
      // Loose shapes — cutsdk soft path; never block primary pack success
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const videoClips: any[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const audioClips: any[] = [];
      let currentTime = 0;
      const transitions = ['fade_in', 'fade_out', 'zoom_in', 'slide_left'];

      const visual = [
        ...videos.map((v) => ({ key: v.key, path: v.disk, kind: 'video' as const })),
        ...images.map((i) => ({ key: i.key, path: i.disk, kind: 'image' as const })),
      ].sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));

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
        videoClips.push({
          type: v.kind,
          src: v.path,
          start: currentTime,
          duration: perClip,
          transition: { name: transitions[i % transitions.length], duration: 0.8 },
        });
        currentTime += perClip;
      }
      let audioCursor = 0;
      for (const a of audios) {
        const dur = a.duration > 0 ? a.duration : perClip;
        audioClips.push({
          type: 'audio',
          src: a.disk,
          start: audioCursor,
          duration: dur,
        });
        audioCursor += dur;
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
      engine: 'xinchao-cut-pack',
    };

    console.log(
      `[Export CapCut] aspect=${capCutAspect} pack=${pack.packRoot} files=${pack.media.files} cutsdk=${draftId ? 'ok' : 'skip'}`,
    );

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
      criteria,
    });
  } catch (error: unknown) {
    console.error('[Export CapCut] Error:', error);
    return NextResponse.json(toErrorJson(error), {
      status: httpStatusFromError(error),
    });
  }
}
