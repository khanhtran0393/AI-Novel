import { NextRequest, NextResponse } from 'next/server';
import {
  mirofishStatus,
  probeMirofishBackend,
  runNativeWhatIf,
} from '@/lib/integrations/mirofish';

export const runtime = 'nodejs';

export async function GET() {
  const status = mirofishStatus();
  const backend = await probeMirofishBackend();
  return NextResponse.json({ success: true, ...status, backend });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
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

    return NextResponse.json(result, { status: result.success ? 200 : 500 });
  } catch (err) {
    const e = err as Error;
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
