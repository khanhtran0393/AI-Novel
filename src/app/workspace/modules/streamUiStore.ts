/**
 * Isolated stream UI store — typewriter ticks do NOT re-render the whole workspace.
 * Only components that call useStreamUi(...) re-render on stream updates.
 *
 * CRITICAL: useSyncExternalStore getSnapshot must return a stable reference when
 * the store is unchanged (React infinite-loop guard).
 */
'use client';

import { useCallback, useRef, useSyncExternalStore } from 'react';

export type StreamUiState = {
  isStreaming: boolean;
  streamText: string;
  liveWordCount: number;
  liveScriptText: string;
};

const initial: StreamUiState = {
  isStreaming: false,
  streamText: '',
  liveWordCount: 0,
  liveScriptText: '',
};

let state: StreamUiState = initial;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function getStreamUi(): StreamUiState {
  return state;
}

export function setStreamUi(partial: Partial<StreamUiState>): void {
  let changed = false;
  const next: StreamUiState = { ...state };
  (Object.keys(partial) as (keyof StreamUiState)[]).forEach((k) => {
    const v = partial[k];
    if (v !== undefined && !Object.is(next[k], v)) {
      (next as Record<string, unknown>)[k] = v;
      changed = true;
    }
  });
  if (!changed) return;
  state = next;
  emit();
}

export function resetStreamUi(): void {
  if (
    state === initial ||
    (state.isStreaming === false &&
      state.streamText === '' &&
      state.liveWordCount === 0 &&
      state.liveScriptText === '')
  ) {
    state = initial;
    return;
  }
  state = { ...initial };
  emit();
}

export function subscribeStreamUi(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Subscribe to a slice of stream UI.
 * Prefer primitive selectors (boolean / number / string) for stable snapshots.
 */
export function useStreamUi<T>(selector: (s: StreamUiState) => T): T {
  const selectorRef = useRef(selector);
  selectorRef.current = selector;

  // Cache last selected value so getSnapshot is referentially stable
  // when the underlying store + selection are unchanged.
  const cacheRef = useRef<{ root: StreamUiState; value: T } | null>(null);

  const getSnapshot = useCallback((): T => {
    const root = state;
    const next = selectorRef.current(root);
    const cache = cacheRef.current;
    if (cache && cache.root === root && Object.is(cache.value, next)) {
      return cache.value;
    }
    cacheRef.current = { root, value: next };
    return next;
  }, []);

  const getServerSnapshot = useCallback((): T => {
    return selectorRef.current(initial);
  }, []);

  return useSyncExternalStore(subscribeStreamUi, getSnapshot, getServerSnapshot);
}
