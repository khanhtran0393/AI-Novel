/**
 * Domain types — port hành vi core từ ainovel-cli (internal/domain + progress).
 * Độc lập: không phụ thuộc process Go / port 8080.
 */

export type EnginePhase = 'planning' | 'writing' | 'complete';
export type EngineFlow =
  | 'writing'
  | 'reviewing'
  | 'rewriting'
  | 'polishing'
  | 'steering'
  | 'idle';

export interface EngineChapter {
  id: number;
  title: string;
  dan_y: string;
  content: string;
  wordCount: number;
  status: 'empty' | 'planned' | 'draft' | 'committed' | 'review';
  updatedAt: string;
}

export interface EngineProgress {
  phase: EnginePhase;
  flow: EngineFlow;
  totalChapters: number;
  completedChapters: number[];
  pendingRewrites: number[];
  currentChapter: number;
  projectName: string;
  layered: boolean;
  lastAction: string;
  startedAt?: string;
  updatedAt: string;
}

export interface ArcBoundary {
  isArcEnd: boolean;
  isVolumeEnd: boolean;
  volume: number;
  arc: number;
  needsExpansion: boolean;
  needsNewVolume: boolean;
  nextArc: number;
  nextVolume: number;
}

export interface RouteState {
  progress: EngineProgress | null;
  lastCompleted: number;
  arcBoundary: ArcBoundary | null;
  hasArcReview: boolean;
  hasArcSummary: boolean;
  hasVolumeSummary: boolean;
  foundationMissing: string[];
}

export interface Instruction {
  agent: 'writer' | 'editor' | 'architect_long' | 'architect_short';
  task: string;
  reason: string;
  chapter: number;
}

export function createInitialProgress(input: {
  projectName: string;
  totalChapters: number;
}): EngineProgress {
  const now = new Date().toISOString();
  return {
    phase: 'writing',
    flow: 'writing',
    totalChapters: Math.max(1, input.totalChapters || 10),
    completedChapters: [],
    pendingRewrites: [],
    currentChapter: 1,
    projectName: input.projectName || 'Untitled',
    layered: false,
    lastAction: 'Ready / Idle',
    startedAt: now,
    updatedAt: now,
  };
}

/** Chương kế tiếp cần viết (1-indexed). 0 = xong. */
export function nextChapter(progress: EngineProgress): number {
  if (progress.phase === 'complete') return 0;
  const done = new Set(progress.completedChapters);
  for (let i = 1; i <= progress.totalChapters; i++) {
    if (!done.has(i)) return i;
  }
  return 0;
}

export function wordCount(text: string): number {
  const t = (text || '').trim();
  if (!t) return 0;
  // Ưu tiên đếm từ (kể cả tiếng Việt tách space)
  const words = t.split(/\s+/).filter(Boolean).length;
  return words > 0 ? words : t.length;
}
