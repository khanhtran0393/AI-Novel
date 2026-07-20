import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import fs from 'fs';
import { buildCapAssistantCommand, getCapAssistantRuntimeInfo } from '@/lib/capassistant/core';
import { requireToolboxAccess } from '@/lib/commercial/apiGate';

export const runtime = 'nodejs';

function cleanupTempFiles(files: string[]) {
  for (const file of files) {
    try {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch {
      // Best-effort cleanup only.
    }
  }
}

export async function POST(req: Request) {
  try {
    const payload = await req.json();
    const denied = await requireToolboxAccess(req, payload);
    if (denied) return denied;
    const built = buildCapAssistantCommand(payload);
    const runtime = getCapAssistantRuntimeInfo();
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('[START] AI Novel CapAssistant Engine (independent)\n'));
        controller.enqueue(encoder.encode(`[RUNTIME] ffmpeg=${runtime.ffmpeg}\n`));
        controller.enqueue(
          encoder.encode(
            `[META] ${built.metadata.width}x${built.metadata.height} @ ${built.metadata.fps.toFixed(3)}fps, duration=${built.metadata.duration.toFixed(3)}s, audio=${built.metadata.hasAudio}\n`,
          ),
        );
        controller.enqueue(encoder.encode(`[CMD] ${built.commandLine}\n\n`));

        const child = spawn(built.ffmpegPath, built.ffmpegArgs, {
          shell: false,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        child.stdout.on('data', data => {
          controller.enqueue(encoder.encode(data.toString()));
        });

        child.stderr.on('data', data => {
          const str = data.toString();
          controller.enqueue(encoder.encode(str));

          const frameMatch = str.match(/frame=\s*(\d+)/);
          if (frameMatch && built.metadata.frameCount > 0) {
            const percent = Math.min(99, Math.max(1, Math.floor((Number(frameMatch[1]) / built.metadata.frameCount) * 100)));
            controller.enqueue(encoder.encode(`\nPROGRESS:${percent}\n`));
          }

          const timeMatch = str.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/);
          if (timeMatch && built.metadata.duration > 0) {
            const seconds = Number(timeMatch[1]) * 3600 + Number(timeMatch[2]) * 60 + Number(timeMatch[3]);
            const percent = Math.min(99, Math.max(1, Math.floor((seconds / built.metadata.duration) * 100)));
            controller.enqueue(encoder.encode(`\nPROGRESS:${percent}\n`));
          }
        });

        child.on('close', code => {
          cleanupTempFiles(built.tempFiles);
          if (code === 0) {
            controller.enqueue(encoder.encode(`\n\n[SUCCESS] ${built.outputPath}`));
          } else {
            controller.enqueue(encoder.encode(`\n\n[ERROR] FFmpeg exited with code ${code}.`));
          }
          controller.close();
        });

        child.on('error', err => {
          cleanupTempFiles(built.tempFiles);
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
    console.error('Error in video-editor route:', error);
    return NextResponse.json({ success: false, error: message }, { status: message.includes('not found') ? 400 : 500 });
  }
}
