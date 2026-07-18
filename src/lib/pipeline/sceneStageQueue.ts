/**
 * P1 — Scene stage job queue (wraps jobQueue).
 * User still triggers each stage (prompt/image/video/tts) — no 1-click mega pipeline.
 * Provides resume/retry/pause + correlation for multi-scene batches.
 */

import {
  createBatchJob,
  runBatchJob,
  retryFailedJob,
  type BatchJob,
  type BatchJobItem,
  type JobKind,
} from '@/lib/jobQueue';
import type { MediaStage } from './types';

export type StageJobMeta = {
  stage: MediaStage;
  chapter: number;
  sceneIndex: number;
  promptIndex?: number;
  assetKey?: string;
};

function stageToKind(stage: MediaStage): JobKind {
  if (stage === 'prompt') return 'other';
  if (stage === 'image') return 'image';
  if (stage === 'video') return 'video';
  return 'tts';
}

export type StageItemSpec = {
  label: string;
  chapter: number;
  sceneIndex: number;
  promptIndex?: number;
  assetKey?: string;
  meta?: Record<string, unknown>;
};

/**
 * Create a batch for one media stage across many scenes/shots.
 */
export function createStageBatchJob(params: {
  stage: MediaStage;
  chapter: number;
  title?: string;
  items: StageItemSpec[];
  concurrency?: number;
  itemGapMs?: number;
}): BatchJob {
  const stage = params.stage;
  return createBatchJob({
    title:
      params.title ||
      `${stage.toUpperCase()} · ch${params.chapter} · ${params.items.length} slot`,
    kind: stageToKind(stage),
    concurrency: params.concurrency ?? 1,
    itemGapMs: params.itemGapMs ?? (stage === 'image' || stage === 'video' ? 4000 : 0),
    items: params.items.map((it) => ({
      label: it.label,
      kind: stageToKind(stage),
      meta: {
        stage,
        chapter: it.chapter,
        sceneIndex: it.sceneIndex,
        promptIndex: it.promptIndex,
        assetKey: it.assetKey,
        ...(it.meta || {}),
      } satisfies StageJobMeta & Record<string, unknown>,
    })),
  });
}

export async function runStageBatch(
  jobId: string,
  runner: (item: BatchJobItem, job: BatchJob) => Promise<void>,
): Promise<BatchJob | undefined> {
  return runBatchJob(jobId, runner);
}

export async function retryStageBatch(
  jobId: string,
  runner?: (item: BatchJobItem, job: BatchJob) => Promise<void>,
): Promise<BatchJob | undefined> {
  return retryFailedJob(jobId, runner);
}

export function readStageMeta(item: BatchJobItem): StageJobMeta | null {
  const m = item.meta;
  if (!m || typeof m !== 'object') return null;
  const stage = m.stage as MediaStage | undefined;
  const chapter = Number(m.chapter);
  const sceneIndex = Number(m.sceneIndex);
  if (!stage || !Number.isFinite(chapter) || !Number.isFinite(sceneIndex)) return null;
  return {
    stage,
    chapter,
    sceneIndex,
    promptIndex: typeof m.promptIndex === 'number' ? m.promptIndex : undefined,
    assetKey: typeof m.assetKey === 'string' ? m.assetKey : undefined,
  };
}
