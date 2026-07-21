import { NextResponse } from 'next/server';
import {
  botToken,
  processUpdate,
  setWebhook,
  telegramConfigured,
  webhookSecret,
  type TgUpdate,
} from '@/lib/bridge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function verifySecret(req: Request): boolean {
  const expected = webhookSecret();
  if (!expected) return true;
  const got =
    req.headers.get('x-telegram-bot-api-secret-token') ||
    req.headers.get('X-Telegram-Bot-Api-Secret-Token') ||
    '';
  return got === expected;
}

export async function POST(req: Request) {
  try {
    if (!botToken()) {
      return NextResponse.json(
        { ok: false, error: 'Bot token missing' },
        { status: 503 },
      );
    }
    if (!verifySecret(req)) {
      return NextResponse.json(
        { ok: false, error: 'Webhook secret mismatch' },
        { status: 401 },
      );
    }
    const body = (await req.json().catch(() => ({}))) as TgUpdate;
    await processUpdate(body);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    );
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get('setup') === 'true') {
    const hostUrl = searchParams.get('url');
    if (!hostUrl?.trim()) {
      return NextResponse.json(
        { ok: false, error: 'Need ?setup=true&url=https://…' },
        { status: 400 },
      );
    }
    if (!telegramConfigured()) {
      return NextResponse.json(
        { ok: false, error: 'Telegram env missing on server' },
        { status: 503 },
      );
    }
    const result = await setWebhook(hostUrl.trim());
    return NextResponse.json(result);
  }

  const hasSupabase = Boolean(
    (
      process.env.SUPABASE_URL ||
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      ''
    ).trim() && (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim(),
  );
  return NextResponse.json({
    ok: true,
    service: 'ainovel-telegram-bridge',
    configured: telegramConfigured(),
    supabaseLedger: hasSupabase,
    hint: 'POST = Telegram updates; GET ?setup=true&url=… = setWebhook. Cấp Key must write Supabase licenses.',
  });
}
