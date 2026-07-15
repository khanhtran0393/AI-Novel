import { NextRequest, NextResponse } from 'next/server';
import {
  compileSeedanceBatch,
  compileSeedancePrompt,
  persistSeedanceCompile,
  seedanceRepoReady,
  loadSeedanceReference,
} from '@/lib/integrations/seedance';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({
    success: true,
    ready: seedanceRepoReady(),
    directingSnippet: loadSeedanceReference('references/directing-engine.md', 1500),
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const persist = Boolean(body.persist);

    if (Array.isArray(body.scenes)) {
      const batch = compileSeedanceBatch(
        body.scenes.map(
          (s: {
            id?: string;
            text?: string;
            sceneText?: string;
            characters?: string[];
            environment?: string;
            hasStartImage?: boolean;
            durationSec?: number;
          }, i: number) => ({
            id: s.id || `scene_${i + 1}`,
            text: s.text || s.sceneText || '',
            characters: s.characters,
            environment: s.environment,
            hasStartImage: s.hasStartImage,
            durationSec: s.durationSec,
          }),
        ),
        { styleHint: body.styleHint, genre: body.genre },
      );
      const savedPath = persist ? persistSeedanceCompile(batch, 'batch') : undefined;
      return NextResponse.json({ success: true, results: batch, savedPath, repoReady: seedanceRepoReady() });
    }

    const sceneText = String(body.sceneText || body.text || body.prompt || '').trim();
    if (!sceneText) {
      return NextResponse.json({ success: false, error: 'Missing sceneText' }, { status: 400 });
    }

    const result = compileSeedancePrompt({
      sceneText,
      characterHints: body.characterHints || body.characters,
      environmentHint: body.environmentHint || body.environment,
      styleHint: body.styleHint,
      mode: body.mode,
      hasStartImage: Boolean(body.hasStartImage || body.startImage),
      hasEndImage: Boolean(body.hasEndImage || body.endImage),
      durationSec: body.durationSec ?? body.duration,
      genre: body.genre,
      language: body.language,
    });

    const savedPath = persist ? persistSeedanceCompile(result, 'single') : undefined;
    return NextResponse.json({ success: true, result, savedPath, repoReady: seedanceRepoReady() });
  } catch (err) {
    const e = err as Error;
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
