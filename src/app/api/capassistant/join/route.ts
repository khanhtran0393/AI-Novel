import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import fs from 'fs';
import { buildSimpleJoinCommand, buildSmartJoinCommand } from '@/lib/capassistant/core';

export const runtime = 'nodejs';

function cleanupTempFiles(files?: string[]) {
  if (!files) return;
  for (const file of files) {
    try {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch {
      // best-effort
    }
  }
}

export async function POST(req: Request) {
  try {
    const payload = await req.json();
    const videoPaths = Array.isArray(payload.videoPaths) ? payload.videoPaths.map(String).filter(Boolean) : [];
    const outputPath = String(payload.outputPath || '');
    const targetRatio = String(payload.targetRatio || payload.exportRatio || 'Giữ nguyên');
    const mode = String(payload.mode || 'smart').toLowerCase(); // smart | copy

    if (!outputPath) {
      return NextResponse.json({ success: false, error: 'Missing outputPath' }, { status: 400 });
    }

    const built = mode === 'copy'
      ? buildSimpleJoinCommand(videoPaths, outputPath)
      : buildSmartJoinCommand(videoPaths, outputPath, targetRatio);
    const encoder = new TextEncoder();
    const tempFiles = 'tempFiles' in built ? (built as { tempFiles?: string[] }).tempFiles : undefined;

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`[START] CapAssistant ${mode === 'copy' ? 'VideoJoin(copy)' : 'SmartJoin'} Engine (AI Novel independent)\n`));
        controller.enqueue(encoder.encode(`[CMD] ${built.commandLine}\n\n`));

        const child = spawn(built.ffmpegPath, built.ffmpegArgs, {
          shell: false,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        child.stdout.on('data', data => controller.enqueue(encoder.encode(data.toString())));
        child.stderr.on('data', data => controller.enqueue(encoder.encode(data.toString())));

        child.on('close', code => {
          cleanupTempFiles(tempFiles);
          if (code === 0) {
            controller.enqueue(encoder.encode(`\n\n[SUCCESS] ${built.outputPath}`));
          } else {
            controller.enqueue(encoder.encode(`\n\n[ERROR] FFmpeg exited with code ${code}.`));
          }
          controller.close();
        });

        child.on('error', err => {
          cleanupTempFiles(tempFiles);
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
    console.error('Error in capassistant join route:', error);
    return NextResponse.json({ success: false, error: message }, { status: message.includes('not found') ? 400 : 500 });
  }
}
