import { NextResponse } from 'next/server';
import {
  ensureBridgeStarted,
  findQueueTaskByCoords,
  getQueue,
  getQueueTask,
  isAdoptedExternalBridge,
} from '@/lib/flow-bridge';
import {
  finalizeFlowVideoTask,
  recoverLocalVideoArtifact,
} from '@/lib/flow-bridge/flowVideoFinalize';
import { correlationIdFromRequest, slog } from '@/lib/requestContext';
import type { FlowTask } from '@/lib/flow-bridge/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Poll one Flow queue task (async generate-video path).
 * GET ?id=ft_…
 * GET ?chapterNum=&sceneIndex=&promptIndex=&kind=video
 * GET ?id=…&finalize=1  → when done, copy to animatic + full success payload
 */
export async function GET(req: Request) {
  const correlationId = correlationIdFromRequest(req);
  try {
    await ensureBridgeStarted();
    const url = new URL(req.url);
    const id = String(url.searchParams.get('id') || '').trim();
    const finalize = ['1', 'true', 'yes'].includes(
      String(url.searchParams.get('finalize') || '').toLowerCase(),
    );
    const recover = ['1', 'true', 'yes'].includes(
      String(url.searchParams.get('recover') || '').toLowerCase(),
    );

    let task: FlowTask | undefined;
    if (id) {
      task = getQueueTask(id);
      if (!task && isAdoptedExternalBridge()) {
        const { remoteGetTask } = await import('@/lib/flow-bridge/remoteBridge');
        const r = await remoteGetTask(id);
        if (r.task) task = r.task as FlowTask;
      }
    } else {
      const chapterNum = Number(url.searchParams.get('chapterNum'));
      const sceneIndex = Number(url.searchParams.get('sceneIndex'));
      const promptIndexRaw = url.searchParams.get('promptIndex');
      const kind = String(url.searchParams.get('kind') || 'video');
      if (!Number.isFinite(chapterNum) || !Number.isFinite(sceneIndex)) {
        return NextResponse.json(
          { ok: false, error: 'missing id or chapterNum/sceneIndex', correlationId },
          { status: 400 },
        );
      }
      task = findQueueTaskByCoords({
        kind,
        chapterNum,
        sceneIndex,
        promptIndex:
          promptIndexRaw != null && promptIndexRaw !== ''
            ? Number(promptIndexRaw)
            : undefined,
      });
    }

    if (!task) {
      if (recover) {
        const ch = Number(url.searchParams.get('chapterNum'));
        const sc = Number(url.searchParams.get('sceneIndex'));
        const pi = Number(url.searchParams.get('promptIndex') || 0);
        if (Number.isFinite(ch) && Number.isFinite(sc)) {
          const rec = recoverLocalVideoArtifact({
            chapterNum: ch,
            sceneIndex: sc,
            promptIndex: pi,
          });
          if (rec.ok) {
            return NextResponse.json({
              ...rec,
              recovered: true,
              correlationId,
            });
          }
        }
      }
      return NextResponse.json(
        { ok: false, error: 'task_not_found', correlationId },
        { status: 404 },
      );
    }

    const queue = getQueue().snapshot();
    const pendingAhead =
      task.status === 'pending'
        ? queue.tasks.filter(
            (t) =>
              t.status === 'pending' &&
              t.createdAt < task!.createdAt,
          ).length
        : 0;

    if (
      finalize &&
      task.status === 'done' &&
      (task.kind === 'video' || task.kind === 'extend')
    ) {
      const fin = finalizeFlowVideoTask(task);
      slog({
        level: fin.ok ? 'info' : 'warn',
        msg: fin.ok ? 'flow_task_finalize_ok' : 'flow_task_finalize_fail',
        correlationId: task.correlationId || correlationId,
        route: '/api/flow/task',
        error: fin.error,
      });
      return NextResponse.json({
        ...fin,
        task,
        queueAhead: pendingAhead,
        queue: { pending: queue.pending, running: queue.running },
        correlationId: task.correlationId || correlationId,
      });
    }

    if (
      recover &&
      (task.status === 'failed' || task.status === 'cancelled') &&
      task.chapterNum != null &&
      task.sceneIndex != null
    ) {
      const rec = recoverLocalVideoArtifact({
        chapterNum: Number(task.chapterNum),
        sceneIndex: Number(task.sceneIndex),
        promptIndex: task.promptIndex,
      });
      if (rec.ok) {
        return NextResponse.json({
          ...rec,
          recovered: true,
          task,
          correlationId,
        });
      }
    }

    return NextResponse.json({
      ok: true,
      task,
      queueAhead: pendingAhead,
      queue: { pending: queue.pending, running: queue.running },
      correlationId: task.correlationId || correlationId,
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { ok: false, error, correlationId },
      { status: 500 },
    );
  }
}
