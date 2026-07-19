import path from 'path';
import { runAutoMaster, type AutoMasterRequest } from '@/lib/capassistant/autoMaster';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as AutoMasterRequest;
    if (!body?.videoPath && !(Array.isArray(body?.videoPaths) && body.videoPaths.length)) {
      return Response.json({ success: false, error: 'Missing videoPath / videoPaths' }, { status: 400 });
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        const log = (line: string) => {
          controller.enqueue(encoder.encode(line.endsWith('\n') ? line : `${line}\n`));
        };

        runAutoMaster(
          {
            ...body,
            videoPath: body.videoPath || (body.videoPaths?.[0] as string),
            outputDir: body.outputDir || path.join(process.cwd(), 'output', 'auto-master'),
          },
          log,
        )
          .then((result) => {
            controller.enqueue(
              encoder.encode(
                `\n[ARTIFACTS] ${JSON.stringify({
                  finalVideoPath: result.finalVideoPath,
                  originSrtPath: result.originSrtPath,
                  translatedSrtPath: result.translatedSrtPath,
                  ttsAudioPath: result.ttsAudioPath,
                  workDir: result.workDir,
                })}\n`,
              ),
            );
            if (result.finalVideoPath) {
              controller.enqueue(encoder.encode(`\n[SUCCESS] ${result.finalVideoPath}\n`));
            } else {
              controller.enqueue(
                encoder.encode('\n[SUCCESS] Auto Master completed without final video (render skipped)\n'),
              );
            }
            controller.close();
          })
          .catch((err) => {
            const message = err instanceof Error ? err.message : String(err);
            controller.enqueue(encoder.encode(`\n[ERROR] ${message}\n`));
            controller.close();
          });
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Auto-Master': '1',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
