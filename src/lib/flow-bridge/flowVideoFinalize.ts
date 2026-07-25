/**
 * After Flow queue marks a video task done, copy bridge output → app animatic path
 * and return a UI-shaped success payload (same fields as /api/generate-video).
 */
import fs from 'fs';
import path from 'path';
import { localVideoFilename } from '@/contracts';
import { probeVisualArtifact } from '@/lib/mediaArtifactValidation';
import { setFlowMediaIdsFromTask } from './mediaIdIndex';
import type { FlowTask } from './types';

export type FlowVideoFinalizeResult = {
  ok: boolean;
  error?: string;
  success?: true;
  videoPath?: string;
  filename?: string;
  duration?: number;
  method?: 'flow';
  mediaIds?: string[];
  mediaId?: string;
  artifact?: {
    codec?: string;
    width?: number;
    height?: number;
    durationSec?: number;
    sizeBytes?: number;
  };
  localSavePath?: string;
  task?: FlowTask;
};

function copyVideoAtomic(sourcePath: string, destinationPath: string): void {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Generated video source missing: ${sourcePath}`);
  }
  const tempPath = `${destinationPath}.copy-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`;
  try {
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.copyFileSync(sourcePath, tempPath);
    const artifact = probeVisualArtifact(tempPath, 'video');
    if (!artifact.ok) {
      throw new Error(`Invalid video artifact: ${artifact.error}`);
    }
    try {
      if (fs.existsSync(destinationPath)) fs.unlinkSync(destinationPath);
    } catch {
      /* win race */
    }
    try {
      fs.renameSync(tempPath, destinationPath);
    } catch {
      fs.copyFileSync(tempPath, destinationPath);
      try {
        fs.unlinkSync(tempPath);
      } catch {
        /* ignore */
      }
    }
  } finally {
    if (fs.existsSync(tempPath)) {
      try {
        fs.unlinkSync(tempPath);
      } catch {
        /* best-effort */
      }
    }
  }
}

/**
 * Persist task.resultPaths[0] to appSavePath or chapter/scene animatic name.
 */
export function finalizeFlowVideoTask(task: FlowTask): FlowVideoFinalizeResult {
  if (task.status !== 'done') {
    return {
      ok: false,
      error:
        task.status === 'failed' || task.status === 'cancelled'
          ? task.error || `Task ${task.status}`
          : `Task still ${task.status}`,
      task,
    };
  }
  const src = Array.isArray(task.resultPaths)
    ? task.resultPaths.find((p) => p && fs.existsSync(String(p)))
    : undefined;
  if (!src) {
    return {
      ok: false,
      error: 'Task done nhưng không tìm thấy file video trên đĩa',
      task,
    };
  }

  const ch = Number(task.chapterNum);
  const sc = Number(task.sceneIndex);
  const filename =
    Number.isFinite(ch) && Number.isFinite(sc)
      ? localVideoFilename(ch, sc)
      : path.basename(src);
  const dest =
    (task.appSavePath && String(task.appSavePath).trim()) ||
    path.join(process.cwd(), 'public', 'video', filename);

  try {
    if (path.resolve(src) !== path.resolve(dest)) {
      copyVideoAtomic(src, dest);
    }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      task,
    };
  }

  const artifact = probeVisualArtifact(dest, 'video');
  if (!artifact.ok) {
    return {
      ok: false,
      error: artifact.error || 'probe failed',
      task,
    };
  }

  const mids = Array.isArray(task.mediaIds)
    ? task.mediaIds.filter(Boolean).map(String)
    : [];

  try {
    setFlowMediaIdsFromTask({
      chapterNum: Number.isFinite(ch) ? ch : 0,
      sceneIndex: Number.isFinite(sc) ? sc : 0,
      promptIndex: task.promptIndex != null ? Number(task.promptIndex) : 0,
      kind: 'video',
      mediaIds: mids,
    });
  } catch {
    /* optional */
  }

  return {
    ok: true,
    success: true,
    videoPath: `/video/${path.basename(dest)}`,
    filename: path.basename(dest),
    duration: artifact.durationSec || task.durationSec || 0,
    method: 'flow',
    mediaIds: mids.length ? mids : undefined,
    mediaId: mids[0],
    artifact: {
      codec: artifact.codec,
      width: artifact.width,
      height: artifact.height,
      durationSec: artifact.durationSec,
      sizeBytes: artifact.sizeBytes,
    },
    localSavePath: dest,
    task,
  };
}

/** Recover: if animatic or bridge cN_sM_pK already on disk. */
export function recoverLocalVideoArtifact(opts: {
  chapterNum: number;
  sceneIndex: number;
  promptIndex?: number;
}): FlowVideoFinalizeResult {
  const ch = Number(opts.chapterNum);
  const sc = Number(opts.sceneIndex);
  const pi = opts.promptIndex != null ? Number(opts.promptIndex) : 0;
  const publicVideo = path.join(process.cwd(), 'public', 'video');
  const candidates = [
    path.join(publicVideo, localVideoFilename(ch, sc)),
    path.join(publicVideo, `c${ch}_s${sc}_p${pi}.mp4`),
    path.join(publicVideo, `c${ch}_s${sc}_p0.mp4`),
  ];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    const artifact = probeVisualArtifact(p, 'video');
    if (!artifact.ok) continue;
    return {
      ok: true,
      success: true,
      videoPath: `/video/${path.basename(p)}`,
      filename: path.basename(p),
      duration: artifact.durationSec || 0,
      method: 'flow',
      artifact: {
        codec: artifact.codec,
        width: artifact.width,
        height: artifact.height,
        durationSec: artifact.durationSec,
        sizeBytes: artifact.sizeBytes,
      },
      localSavePath: p,
    };
  }
  return { ok: false, error: 'Không có file video local để recover' };
}
