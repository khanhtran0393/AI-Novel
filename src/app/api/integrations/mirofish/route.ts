import { NextRequest, NextResponse } from 'next/server';
import {
  mirofishStatus,
  probeMirofishBackend,
  runNativeWhatIf,
} from '@/lib/integrations/mirofish';

export const runtime = 'nodejs';

/** MiroFish only for outline / lore / arc planning — not mid-pipeline media. */
const ALLOWED_CONTEXTS = new Set([
  'outline',
  'lore',
  'lorebook',
  'plan_arc',
  'arc',
  'GENERATE_OUTLINE',
  'PLAN_ARC',
]);

export async function GET() {
  const status = mirofishStatus();
  const backend = await probeMirofishBackend();
  return NextResponse.json({
    success: true,
    ...status,
    backend,
    policy: 'outline_lore_only',
    allowedContexts: Array.from(ALLOWED_CONTEXTS),
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const context = String(
      body.context || body.scope || body.phase || body.source || '',
    )
      .trim()
      .toLowerCase();
    const contextRaw = String(body.context || body.scope || body.phase || body.source || '').trim();

    const allowed =
      ALLOWED_CONTEXTS.has(context) ||
      ALLOWED_CONTEXTS.has(contextRaw) ||
      context.includes('outline') ||
      context.includes('lore') ||
      context.includes('arc');

    if (!allowed) {
      return NextResponse.json(
        {
          success: false,
          error:
            'MiroFish chi dung o Outline / Lorebook / Plan Arc (P2). Khong goi giua Gen Prompt / Anh / Video / TTS.',
          code: 'MIROFISH_SCOPE',
          allowedContexts: Array.from(ALLOWED_CONTEXTS),
        },
        { status: 403 },
      );
    }

    const hypothesis = String(body.hypothesis || body.whatIf || body.prompt || '').trim();
    if (!hypothesis) {
      return NextResponse.json({ success: false, error: 'Missing hypothesis' }, { status: 400 });
    }

    const result = await runNativeWhatIf({
      title: body.title || body.ten_tac_pham || 'AI Novel',
      lorebook: body.lorebook,
      chapterSummary: body.chapterSummary || body.summary,
      characters: body.characters,
      hypothesis,
      rounds: body.rounds,
      apiKey: body.apiKey,
      apiKeys: body.apiKeys,
    });

    return NextResponse.json(
      { ...result, context: contextRaw || context || 'outline' },
      { status: result.success ? 200 : 500 },
    );
  } catch (err) {
    const e = err as Error;
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
