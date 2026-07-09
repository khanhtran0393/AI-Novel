import { NextResponse } from 'next/server';
import { loadConfigFile, saveConfigFile } from '@/lib/novel-engine/store/diskStore';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const data = loadConfigFile();
  return NextResponse.json(data);
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { env?: string; config?: string };
    saveConfigFile({ env: body.env, config: body.config });
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
