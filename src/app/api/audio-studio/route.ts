import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { applyAudioStudioMix } from '@/lib/audioStudio';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST { audioPath: string (public or absolute), roomTone?, bgmMix?, bgmPath? }
 * Re-mixes TTS for YouTube-friendlier bed + loudnorm.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { audioPath, roomTone, bgmMix, bgmPath } = body || {};
    if (!audioPath || typeof audioPath !== 'string') {
      return NextResponse.json({ error: 'Missing audioPath' }, { status: 400 });
    }

    let abs = audioPath;
    if (audioPath.startsWith('/')) {
      abs = path.join(
        /* turbopackIgnore: true */ process.cwd(),
        'public',
        audioPath.replace(/^\//, ''),
      );
    }
    const resolvedInput = path.resolve(/* turbopackIgnore: true */ abs);
    if (!fs.existsSync(/* turbopackIgnore: true */ resolvedInput)) {
      return NextResponse.json({ error: `Audio not found: ${resolvedInput}` }, { status: 404 });
    }

    const input = fs.readFileSync(/* turbopackIgnore: true */ resolvedInput);
    const { buffer, applied } = await applyAudioStudioMix(input, {
      roomTone: roomTone !== false,
      bgmMix: !!bgmMix,
      bgmPath: typeof bgmPath === 'string' ? bgmPath : '',
      loudnormI: -14,
    });

    const outName = `studio_${path.basename(resolvedInput).replace(/\.[^.]+$/, '')}_${Date.now()}.mp3`;
    const outDir = path.join(process.cwd(), 'public', 'audio', 'studio');
    fs.mkdirSync(outDir, { recursive: true });
    const outAbs = path.join(outDir, outName);
    fs.writeFileSync(outAbs, buffer);

    return NextResponse.json({
      success: true,
      audioPath: `/audio/studio/${outName}`,
      applied,
      bytes: buffer.length,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
