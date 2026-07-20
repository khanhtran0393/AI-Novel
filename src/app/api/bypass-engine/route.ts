import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import fs from 'fs';
import {
  buildBypassEngineCommand,
  type BypassFilterId,
} from '@/lib/bypass-engine';
import {
  BYPASS_FILTER_CATALOG,
} from '@/lib/bypass-engine/publicCatalog';
import { requireToolboxAccess } from '@/lib/commercial/apiGate';

export const runtime = 'nodejs';
export const maxDuration = 300;

const VALID_IDS = new Set(
  BYPASS_FILTER_CATALOG.map((c: { id: BypassFilterId }) => c.id),
);

export async function GET(req: Request) {
  const url = new URL(req.url);
  // Real NVENC probe (shared with Settings) — ?nvenc=1|probe
  const wantNvenc =
    url.searchParams.get('nvenc') === '1' ||
    url.searchParams.get('probe') === 'nvenc' ||
    url.searchParams.has('nvenc');

  if (wantNvenc) {
    const { probeH264Nvenc } = await import('@/lib/ffmpeg/nvencProbe');
    const { resolveNvidiaDriverForGpu } = await import(
      '@/lib/ffmpeg/nvidiaDriverLookup'
    );
    const { spawnSync } = await import('child_process');
    const force = url.searchParams.get('force') === '1';
    const probe = probeH264Nvenc({ force });

    let gpuName = '';
    try {
      const smi = spawnSync(
        'nvidia-smi',
        ['--query-gpu=name,driver_version', '--format=csv,noheader'],
        { encoding: 'utf8', windowsHide: true, timeout: 4000 },
      );
      if (smi.status === 0) {
        gpuName = String(smi.stdout || '')
          .split(/\r?\n/)
          .map((l) => l.trim())
          .find(Boolean)
          ?.split(',')[0]
          ?.trim() || '';
      }
    } catch {
      /* ignore */
    }

    const nvidiaDriver = gpuName
      ? await resolveNvidiaDriverForGpu(gpuName.startsWith('NVIDIA') ? gpuName : `NVIDIA ${gpuName}`, {
          force,
        })
      : null;

    return NextResponse.json({
      success: true,
      nvenc: probe,
      gpuName: gpuName || null,
      nvidiaDriver,
    });
  }

  // Labels only — no FFmpeg strings
  return NextResponse.json({
    filters: BYPASS_FILTER_CATALOG.map(({ id, label, master }) => ({
      id,
      label,
      master: Boolean(master),
    })),
  });
}

/**
 * Parse FFmpeg -progress pipe:1 key=value lines.
 * out_time_ms / out_time → percent when duration known.
 */
function parseProgressChunk(
  chunk: string,
  durationSec: number,
): { percent?: number; ended?: boolean } {
  let percent: number | undefined;
  let ended = false;
  for (const line of chunk.split(/\r?\n/)) {
    const t = line.trim();
    if (t === 'progress=end') {
      ended = true;
      continue;
    }
    if (t.startsWith('out_time_ms=')) {
      const ms = Number(t.slice('out_time_ms='.length));
      if (Number.isFinite(ms) && durationSec > 0) {
        percent = Math.min(99, Math.max(1, Math.floor((ms / 1000 / durationSec) * 100)));
      }
    } else if (t.startsWith('out_time=')) {
      // HH:MM:SS.micro
      const raw = t.slice('out_time='.length);
      const m = raw.match(/(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (m && durationSec > 0) {
        const sec = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
        percent = Math.min(99, Math.max(1, Math.floor((sec / durationSec) * 100)));
      }
    }
  }
  return { percent, ended };
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const denied = await requireToolboxAccess(req, body);
    if (denied) return denied;
    // Single or first of batch — client may also send inputPaths[]
    const inputPathsRaw: unknown[] = Array.isArray(body.inputPaths) ? body.inputPaths : [];
    const inputPath =
      String(body.inputPath || inputPathsRaw[0] || '').trim();
    const outputPath = body.outputPath ? String(body.outputPath).trim() : undefined;
    const outputDir = body.outputDir ? String(body.outputDir).trim() : undefined;
    const overlayPath = body.overlayPath ? String(body.overlayPath).trim() : undefined;
    const preferGpu = body.preferGpu !== false;
    const turbo = Boolean(body.turbo);
    const gridLayout = body.gridLayout;
    const variance = body.variance ?? {
      enabled: Boolean(body.randomize ?? body.random),
      percent: body.randomPercent ?? body.variancePercent,
    };
    const rawFilters: unknown[] = Array.isArray(body.filters) ? body.filters : [];
    const filters = rawFilters
      .map((f) => String(f) as BypassFilterId)
      .filter((id) => VALID_IDS.has(id));

    if (!inputPath) {
      return NextResponse.json({ success: false, error: 'Thiếu inputPath.' }, { status: 400 });
    }
    if (!fs.existsSync(inputPath)) {
      return NextResponse.json(
        { success: false, error: `File không tồn tại: ${inputPath}` },
        { status: 400 },
      );
    }
    if (filters.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Chọn ít nhất một bộ lọc.' },
        { status: 400 },
      );
    }

    const built = buildBypassEngineCommand({
      inputPath,
      outputPath,
      outputDir,
      overlayPath,
      filters,
      preferGpu,
      gridLayout,
      variance,
      turbo,
    });

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('[START] Phantom-X Bypass\n'));
        controller.enqueue(
          encoder.encode(
            `[META] ${built.meta.width}x${built.meta.height} @ ${built.meta.fps.toFixed(3)}fps, duration=${built.meta.duration.toFixed(3)}s, audio=${built.meta.hasAudio}, nvenc=${built.usedNvenc}, turbo=${built.turbo}\n`,
          ),
        );
        if (built.nvencProbe) {
          controller.enqueue(
            encoder.encode(
              `[NVENC] probe ok=${built.nvencProbe.ok} bf2=${built.nvencProbe.bf2Ok} cache=${built.nvencProbe.fromCache}\n`,
            ),
          );
          controller.enqueue(encoder.encode(`[NVENC] ${built.nvencProbe.message}\n`));
        }
        if (built.gpuFallbackNote) {
          controller.enqueue(encoder.encode(`${built.gpuFallbackNote}\n`));
        }
        controller.enqueue(encoder.encode(`[FILTERS] ${built.activeLabels.join(' · ')}\n`));
        controller.enqueue(encoder.encode(`[VARIANCE] ${built.params.summary}\n`));
        if (built.turbo) {
          controller.enqueue(
            encoder.encode(
              built.usedNvenc
                ? '[TURBO] scale mid max 1280 → Ultimate/Grid → scale back · NVENC p6\n'
                : '[TURBO] scale mid max 1280 → Ultimate/Grid → scale back · libx264 ultrafast\n',
            ),
          );
        } else {
          controller.enqueue(
            encoder.encode(
              built.usedNvenc
                ? '[QUALITY] full-res · NVENC HQ · threads max\n'
                : '[QUALITY] full-res · libx264 medium · threads max\n',
            ),
          );
        }
        controller.enqueue(encoder.encode(`[OUT] ${built.outputPath}\n`));
        // Stage markers only — never dump raw filter math to UI
        controller.enqueue(
          encoder.encode(
            '[PIPELINE] S1 input flags → S2/S3 filter_complex → S4 encoder/GOP → S5 mux\n\n',
          ),
        );

        const child = spawn(built.ffmpegPath, built.ffmpegArgs, {
          shell: false,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        child.stdout.on('data', (data) => {
          const str = data.toString();
          const { percent, ended } = parseProgressChunk(str, built.meta.duration);
          if (percent != null) {
            controller.enqueue(encoder.encode(`\nPROGRESS:${percent}\n`));
          }
          if (ended) {
            controller.enqueue(encoder.encode('\nPROGRESS:99\n'));
          }
        });

        child.stderr.on('data', (data) => {
          // -v error: only fatal / real errors
          const str = data.toString();
          if (str.trim()) {
            controller.enqueue(encoder.encode(str));
          }
        });

        child.on('close', (code) => {
          if (code === 0 && fs.existsSync(built.outputPath)) {
            controller.enqueue(encoder.encode(`\n\n[SUCCESS] ${built.outputPath}`));
            controller.enqueue(encoder.encode('\nPROGRESS:100\n'));
          } else {
            controller.enqueue(
              encoder.encode(`\n\n[ERROR] FFmpeg exited with code ${code ?? 'unknown'}.`),
            );
          }
          controller.close();
        });

        child.on('error', (err) => {
          controller.enqueue(encoder.encode(`\n\n[ERROR] Cannot start FFmpeg: ${err.message}`));
          controller.close();
        });
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[bypass-engine]', error);
    return NextResponse.json(
      { success: false, error: message },
      {
        status:
          message.includes('không tìm thấy') ||
          message.includes('Không tìm thấy') ||
          message.includes('Thiếu') ||
          message.includes('Chọn')
            ? 400
            : 500,
      },
    );
  }
}
