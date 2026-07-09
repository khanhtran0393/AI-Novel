/**
 * Full runtime synthesis — session + rules + chunk + clone/builtin.
 */
import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { runtimeSynthesize } from '@/lib/vinaVoice/runtime';
import { ensureVinaEnvironment, vinaPaths } from '@/lib/vinaVoice/paths';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    ensureVinaEnvironment();
    const body = await req.json();
    const text = String(body.text || '').trim();
    if (!text) {
      return NextResponse.json({ error: 'Thiếu text' }, { status: 400 });
    }

    const result = await runtimeSynthesize({
      text,
      profileName: body.profileName || body.voice,
      settings: body.settings || {},
      useSession: body.useSession !== false,
      forceBuiltin: !!body.forceBuiltin,
    });

    if (!result.ok || !result.audioPath || !fs.existsSync(result.audioPath)) {
      return NextResponse.json(
        {
          error: result.error || 'Runtime synthesize failed',
          warnings: result.warnings,
          method: result.method,
          preview: result.preview,
        },
        { status: 500 },
      );
    }

    // Publish under public/audio/clones for playback
    const pubDir = vinaPaths().publicClones;
    if (!fs.existsSync(pubDir)) fs.mkdirSync(pubDir, { recursive: true });
    const name = `runtime_${Date.now()}.wav`;
    const pub = path.join(pubDir, name);
    fs.copyFileSync(result.audioPath, pub);

    return NextResponse.json({
      success: true,
      ok: true,
      method: result.method,
      chunks: result.chunks,
      warnings: result.warnings,
      preview: result.preview,
      audioPath: `/audio/clones/${name}`,
      absolutePath: result.audioPath,
      mimeType: 'audio/wav',
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
