import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { muxVideoWithTts } from '@/lib/ttsBatchSrt/muxFinalVideo';
import { resolveMediaToDisk } from '@/lib/integrations/mediaPaths';
import { stitchSceneVideos } from '@/lib/flow-bridge/ffmpegService';

function isAbsoluteFsPath(raw: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(raw) || raw.startsWith('\\\\');
}

function stripQuery(raw: string): string {
  return raw.trim().split('?')[0];
}

function decodeSafe(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function resolveVideoPath(raw: string): string {
  const clean = decodeSafe(stripQuery(raw));
  const videoMatch = clean.match(/(?:^|\/)video\/([^/\\?]+)$/i);
  if (videoMatch) {
    return path.join(process.cwd(), 'public', 'video', path.basename(videoMatch[1]));
  }

  const resolved = resolveMediaToDisk(raw);
  if (resolved) return resolved;

  if (isAbsoluteFsPath(clean)) return clean;

  return path.resolve(process.cwd(), clean.replace(/^\/+/, ''));
}

function resolveOutputPath(rawOutPath: unknown, videoPath: string): string {
  const raw = typeof rawOutPath === 'string' ? rawOutPath.trim() : '';
  if (raw) {
    const clean = decodeSafe(stripQuery(raw));
    const videoMatch = clean.match(/(?:^|\/)video\/([^/\\?]+)$/i);
    if (videoMatch) {
      return path.join(process.cwd(), 'public', 'video', path.basename(videoMatch[1]));
    }

    const resolved = resolveMediaToDisk(raw);
    if (resolved) return resolved;

    if (isAbsoluteFsPath(clean)) return clean;

    if (!clean.includes('serve-local-video')) {
      return path.resolve(process.cwd(), clean.replace(/^\/+/, ''));
    }
  }

  const baseDir = path.dirname(videoPath);
  const baseName = path.basename(videoPath, path.extname(videoPath));
  return path.join(baseDir, `${baseName}_dubbed.mp4`);
}

/**
 * Audio-only mux: join one or more generated video clips with TTS voiceover.
 * Subtitles stay editable in the CapCut export path.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      videoPath: rawVideoPath,
      videoPaths: rawVideoPaths,
      ttsAudioPath: rawTtsPath,
      outPath: rawOutPath,
      muteOriginal = true,
      bgmPath: rawBgmPath,
      musicVolume = 25,
      ttsVolume = 100,
      originalVolume = 0,
      autoDucking = true,
    } = body || {};

    const videoInputs = Array.isArray(rawVideoPaths)
      ? rawVideoPaths.map((item) => String(item || '').trim()).filter(Boolean)
      : [];
    if (videoInputs.length === 0 && typeof rawVideoPath === 'string' && rawVideoPath.trim()) {
      videoInputs.push(rawVideoPath.trim());
    }

    if (videoInputs.length === 0) {
      return NextResponse.json(
        { error: 'Missing valid videoPath/videoPaths.' },
        { status: 400 },
      );
    }
    if (!rawTtsPath || typeof rawTtsPath !== 'string') {
      return NextResponse.json(
        { error: 'Missing valid ttsAudioPath.' },
        { status: 400 },
      );
    }

    const resolvedVideoPaths = videoInputs.map(resolveVideoPath);
    const missingVideos = resolvedVideoPaths.filter((candidate) => !fs.existsSync(candidate));
    if (missingVideos.length > 0) {
      return NextResponse.json(
        {
          error: `Video input does not exist: ${missingVideos.slice(0, 3).join(', ')}`,
          missingVideos,
        },
        { status: 400 },
      );
    }

    let videoPath = resolvedVideoPaths[0];
    let stitchedVideoPath: string | undefined;
    if (resolvedVideoPaths.length > 1) {
      const stitchedOut = path.join(
        process.cwd(),
        'public',
        'video',
        `chapter_timeline_source_${Date.now()}.mp4`,
      );
      const stitched = await stitchSceneVideos({
        sceneFiles: resolvedVideoPaths,
        outputPath: stitchedOut,
      });
      if (!stitched.ok || !stitched.outputPath) {
        throw new Error(stitched.error || 'Unable to stitch timeline video.');
      }
      videoPath = stitched.outputPath;
      stitchedVideoPath = stitched.outputPath;
    }

    const ttsAudioPath = resolveMediaToDisk(rawTtsPath) || rawTtsPath;
    const bgmPath = rawBgmPath ? (resolveMediaToDisk(rawBgmPath) || rawBgmPath) : undefined;
    const outPath = resolveOutputPath(rawOutPath, videoPath);

    const res = muxVideoWithTts({
      videoPath,
      ttsAudioPath,
      outPath,
      muteOriginal: Boolean(muteOriginal),
      bgmPath: typeof bgmPath === 'string' && bgmPath.trim() ? bgmPath.trim() : undefined,
      musicVolume: Number(musicVolume) || 25,
      ttsVolume: Number(ttsVolume) || 100,
      originalVolume: Number(originalVolume) || 0,
      autoDucking: Boolean(autoDucking),
    });

    return NextResponse.json({
      success: true,
      outPath: res.outPath,
      inputCount: resolvedVideoPaths.length,
      stitchedVideoPath,
      message: 'Audio dub export completed. Subtitles remain editable in CapCut export.',
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Audio dub export failed.' },
      { status: 500 },
    );
  }
}
