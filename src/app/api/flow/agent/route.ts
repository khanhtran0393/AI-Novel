import { NextResponse } from 'next/server';
import { runFlowAgentPlan } from '@/lib/flow-bridge/flowAgent';
import { loadFlowOps } from '@/lib/flow-bridge/opsStore';
import {
  ensureBridgeStarted,
  getQueue,
} from '@/lib/flow-bridge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * P2 Flow Agent:
 * - plan: brainstorm shot list from chapter/cast
 * - enqueue: push planned shots into Flow queue
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || 'plan');

  if (action === 'plan' || action === 'chat') {
    const apiKey = String(body.apiKey || process.env.GEMINI_API_KEY || '').trim();
    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            'Thiếu API key cho Agent. Truyền body.apiKey (Gemini AIza… hoặc OpenAI sk-…).',
        },
        { status: 400 },
      );
    }
    try {
      const result = await runFlowAgentPlan({
        apiKey,
        userMessage: String(body.message || body.userMessage || ''),
        chapterText: body.chapterText ? String(body.chapterText) : undefined,
        castNames: Array.isArray(body.castNames)
          ? body.castNames.map(String)
          : undefined,
        existingPrompts: Array.isArray(body.existingPrompts)
          ? body.existingPrompts.map(String)
          : undefined,
        history: Array.isArray(body.history) ? body.history : undefined,
        maxShots: body.maxShots != null ? Number(body.maxShots) : 8,
      });
      return NextResponse.json({
        ok: true,
        ...result,
        ops: loadFlowOps(),
      });
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : String(e) },
        { status: 500 },
      );
    }
  }

  if (action === 'enqueue') {
    await ensureBridgeStarted();
    const shots = Array.isArray(body.shots) ? body.shots : [];
    if (!shots.length) {
      return NextResponse.json({ error: 'Thiếu shots[]' }, { status: 400 });
    }
    const ops = loadFlowOps();
    const queue = getQueue();
    const created = [];
    for (const s of shots) {
      const kind = s.kind === 'video' ? 'video' : 'image';
      const tasks = queue.enqueueMany({
        kind,
        prompt: String(s.prompt || ''),
        chapterNum: body.chapterNum,
        sceneIndex: body.sceneIndex,
        promptIndex: s.index != null ? Number(s.index) : undefined,
        aspectRatio: body.aspectRatio || '16:9',
        quality: body.quality || ops.defaultQuality,
        videoModel: body.videoModel,
        imageModel: body.imageModel,
        durationSec: s.durationSec != null ? Number(s.durationSec) : 6,
        ingredientPaths: s.ingredientPaths,
        camera: s.camera,
        videoMode: s.videoMode,
      });
      created.push(...tasks);
    }
    queue.start();
    return NextResponse.json({
      ok: true,
      enqueued: created.length,
      tasks: created,
      queue: queue.snapshot(),
    });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
