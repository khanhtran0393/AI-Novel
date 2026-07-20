import { NextRequest, NextResponse } from 'next/server';
import {
  buildFableCutProject,
  buildFromChapterAssets,
  fableCutStatus,
  isFableCutServerUp,
  startFableCutServer,
  stopFableCutServer,
  type FableClipInput,
} from '@/lib/integrations/fablecut';
import { requireFeature } from '@/lib/commercial/apiGate';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const denied = await requireFeature(req, 'integrations_pipeline');
  if (denied) return denied;
  const status = fableCutStatus();
  const serverUp = status.ready ? await isFableCutServerUp(status.port) : false;
  return NextResponse.json({ success: true, ...status, serverUp });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const denied = await requireFeature(req, 'integrations_pipeline', body);
    if (denied) return denied;
    const action = String(body.action || 'build');

    if (action === 'start') {
      const started = startFableCutServer(body.port);
      // brief wait for bind
      await new Promise((r) => setTimeout(r, 800));
      const up = await isFableCutServerUp(started.port);
      return NextResponse.json({ ...started, serverUp: up });
    }

    if (action === 'stop') {
      return NextResponse.json(stopFableCutServer());
    }

    if (action === 'fromChapter') {
      const imagePaths: string[] = Array.isArray(body.imagePaths) ? body.imagePaths : [];
      if (imagePaths.length === 0) {
        return NextResponse.json(
          { success: false, error: 'imagePaths[] required for fromChapter' },
          { status: 400 },
        );
      }
      const result = buildFromChapterAssets({
        name: body.name || body.title || 'AI-Novel-Chapter',
        imagePaths,
        audioPath: body.audioPath,
        secondsPerImage: body.secondsPerImage,
        aspect: body.aspect || '9:16',
        liveEditor: body.liveEditor !== false,
        title: body.title,
      });
      if (body.autoStart && result.success) {
        const started = startFableCutServer();
        return NextResponse.json({ ...result, server: started });
      }
      return NextResponse.json(result);
    }

    // generic build
    const clips: FableClipInput[] = Array.isArray(body.clips) ? body.clips : [];
    if (clips.length === 0) {
      return NextResponse.json({ success: false, error: 'clips[] required' }, { status: 400 });
    }
    const result = buildFableCutProject({
      name: body.name || 'AI-Novel',
      clips,
      width: body.width,
      height: body.height,
      fps: body.fps,
      aspect: body.aspect,
      liveEditor: body.liveEditor !== false,
    });
    if (body.autoStart && result.success) {
      const started = startFableCutServer();
      return NextResponse.json({ ...result, server: started });
    }
    return NextResponse.json(result);
  } catch (err) {
    const e = err as Error;
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
