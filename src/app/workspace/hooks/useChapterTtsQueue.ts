'use client';

/**
 * Leaf-only chapter TTS queue subscription.
 * Keep this OUT of the workspace root — progress ticks must not re-render page.tsx.
 */
import { useEffect, useState } from 'react';
import {
  getChapterQueueState,
  hydrateChapterQueueFromDisk,
  subscribeChapterQueue,
  type ChapterQueueSnapshot,
} from '@/lib/ttsChapterQueue';

export function useChapterTtsQueue(): ChapterQueueSnapshot {
  const [snap, setSnap] = useState<ChapterQueueSnapshot>(() => getChapterQueueState());

  useEffect(() => {
    void hydrateChapterQueueFromDisk();
    return subscribeChapterQueue(setSnap);
  }, []);

  return snap;
}
