/**
 * POST /api/flow/install-browser — one-click portable Chromium (auto download).
 * GET  /api/flow/install-browser — status only (no download).
 */
import fs from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';
import { ensurePortableBrowser } from '@/lib/flow-bridge/ensurePortableBrowser';
import { listDetectedBrowsers } from '@/lib/flow-bridge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      force?: boolean;
    };
    const result = await ensurePortableBrowser({
      forceRedownload: body.force === true,
    });
    const detected = listDetectedBrowsers();
    return NextResponse.json({
      ...result,
      detected: detected.map((b) => ({
        engine: b.engine,
        label: b.label,
        isStockChrome: b.isStockChrome,
        exe: b.exe,
      })),
    });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        alreadyPresent: false,
        message: e instanceof Error ? e.message : String(e),
        steps: [],
      },
      { status: 500 },
    );
  }
}

export async function GET() {
  try {
    const portable = path.join(
      process.cwd(),
      'tools',
      'browsers',
      'ungoogled-chromium',
      'chrome.exe',
    );
    const clean = listDetectedBrowsers().find(
      (b) => b.family === 'chromium' && !b.isStockChrome,
    );
    const hasPortable = fs.existsSync(portable);
    const hasClean = Boolean(clean || hasPortable);
    return NextResponse.json({
      ok: true,
      hasCleanBrowser: hasClean,
      hasPortable,
      browser: clean
        ? {
            engine: clean.engine,
            label: clean.label,
            isStockChrome: clean.isStockChrome,
            exe: clean.exe,
          }
        : hasPortable
          ? {
              engine: 'ungoogled',
              label: 'Portable Chromium (app)',
              isStockChrome: false,
              exe: portable,
            }
          : null,
      message: hasClean
        ? `Đã sẵn sàng: ${clean?.label || 'Portable Chromium'}`
        : 'Chưa có browser sạch — bấm «Cài browser gen ảnh» (1 nút, tự tải).',
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
