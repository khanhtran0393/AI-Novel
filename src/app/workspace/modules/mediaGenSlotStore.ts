/**
 * Per-slot media gen state — only subscribers of that key re-render.
 */
import { useCallback, useSyncExternalStore } from 'react';
import type { MediaGenProgress } from './mediaGenProgress';
import {
  startFlowProgressPoll,
  startIndeterminateProgress,
  progressUnchanged,
} from './mediaGenProgress';

export type MediaGenSlotState = {
  generating: boolean;
  progress: MediaGenProgress | null;
};

const empty: MediaGenSlotState = Object.freeze({
  generating: false,
  progress: null,
});

const slots = new Map<string, MediaGenSlotState>();
const listeners = new Map<string, Set<() => void>>();
const pollStops = new Map<string, () => void>();

function notify(key: string): void {
  const set = listeners.get(key);
  if (!set) return;
  for (const cb of set) {
    try {
      cb();
    } catch {
      /* ignore */
    }
  }
}

function read(key: string): MediaGenSlotState {
  return slots.get(key) || empty;
}

function write(key: string, next: MediaGenSlotState): void {
  const prev = read(key);
  if (
    prev.generating === next.generating &&
    prev.progress?.percent === next.progress?.percent &&
    prev.progress?.phase === next.progress?.phase &&
    !!prev.progress === !!next.progress
  ) {
    return;
  }
  if (!next.generating && !next.progress) {
    slots.delete(key);
  } else {
    slots.set(key, next);
  }
  notify(key);
}

export function setMediaGenProgress(key: string, p: MediaGenProgress | null): void {
  const prev = read(key);
  if (p && prev.progress && progressUnchanged(prev.progress, p)) return;
  write(key, { generating: prev.generating || !!p, progress: p });
}

function stopPoll(key: string): void {
  const s = pollStops.get(key);
  if (s) {
    try {
      s();
    } catch {
      /* ignore */
    }
    pollStops.delete(key);
  }
}

/** Begin generating + progress for one asset key only. */
export function beginMediaGenProgress(
  key: string,
  mode:
    | {
        type: 'flow';
        kind: 'image' | 'video';
        chapterNum: number;
        sceneIndex: number;
        promptIndex: number;
      }
    | { type: 'estimate'; kind: 'image' | 'video' },
): void {
  stopPoll(key);
  write(key, {
    generating: true,
    progress: { percent: 2, phase: 'Bắt đầu…' },
  });

  const onUpdate = (p: MediaGenProgress) => {
    const cur = read(key);
    if (!cur.generating) return;
    if (cur.progress && progressUnchanged(cur.progress, p)) return;
    write(key, { generating: true, progress: p });
  };

  const stop =
    mode.type === 'flow'
      ? startFlowProgressPoll({
          kind: mode.kind,
          chapterNum: mode.chapterNum,
          sceneIndex: mode.sceneIndex,
          promptIndex: mode.promptIndex,
          onUpdate,
        })
      : startIndeterminateProgress({ kind: mode.kind, onUpdate });

  pollStops.set(key, stop);
}

export function completeMediaGenProgress(
  key: string,
  ok: boolean,
  errPhase?: string,
): void {
  stopPoll(key);
  if (ok) {
    write(key, { generating: false, progress: { percent: 100, phase: 'Xong' } });
    window.setTimeout(() => write(key, empty), 800);
  } else {
    write(key, {
      generating: false,
      progress: { percent: 0, phase: (errPhase || 'Lỗi').slice(0, 48) },
    });
    window.setTimeout(() => write(key, empty), 1400);
  }
}

/** Subscribe one key — only this component re-renders on its updates. */
export function useMediaGenSlot(key: string): MediaGenSlotState {
  const subscribe = useCallback(
    (onChange: () => void) => {
      let set = listeners.get(key);
      if (!set) {
        set = new Set();
        listeners.set(key, set);
      }
      set.add(onChange);
      return () => {
        set!.delete(onChange);
        if (set!.size === 0) listeners.delete(key);
      };
    },
    [key],
  );
  const get = useCallback(() => read(key), [key]);
  return useSyncExternalStore(subscribe, get, () => empty);
}
