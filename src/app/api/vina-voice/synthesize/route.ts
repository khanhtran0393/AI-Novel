import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { synthesizeVinaVoice } from '@/lib/vinaVoice';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const text = String(body.text || body.script || '').trim();
    if (!text) {
      return NextResponse.json({ error: 'Thiếu text' }, { status: 400 });
    }

    const isPreview =
      body.isPreview === true ||
      body.preview === true ||
      String(body.mode || '').toLowerCase() === 'preview';
    const result = await synthesizeVinaVoice(
      {
        text,
        settings: body.settings || body.vinaSettings || {},
        profileName: body.profileName || body.voice || undefined,
        forceBuiltin: !!body.forceBuiltin,
        isPreview,
        isChapter: !isPreview && !!body.isChapter,
      },
      {
        outDir: path.join(
          process.cwd(),
          'scratch',
          'vina-voice',
          `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        ),
      },
    );

    if (!result.ok || !result.audioPath || !fs.existsSync(result.audioPath)) {
      return NextResponse.json(
        {
          error: result.error || 'VinaVoice synthesize failed',
          warnings: result.warnings,
          method: result.method,
        },
        { status: 500 },
      );
    }

    const buf = fs.readFileSync(result.audioPath);
    const base64 = buf.toString('base64');

    // Also expose relative path if under public/scratch for client <audio>
    return NextResponse.json({
      ok: true,
      method: result.method,
      chunks: result.chunks,
      warnings: result.warnings,
      mimeType: result.mimeType || 'audio/wav',
      audioBase64: base64,
      audioPath: result.audioPath,
      // for generate-tts compatibility
      bufferBase64: base64,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
