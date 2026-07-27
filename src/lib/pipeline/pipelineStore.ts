/**
 * Client/server-safe pipeline state for P0–P2.
 * Browser: localStorage. Server: in-memory process global.
 * Does not replace Zustand story store — only quality/foreshadow/longform meta.
 */

import type {
  ChapterQualityReport,
  ForeshadowEntry,
  LongformConfig,
  MemoryPackSnapshot,
} from './types';
import { DEFAULT_LONGFORM } from './types';

const LS_QUALITY = 'ainovel.pipeline.quality.v1';
const LS_FORESHADOW = 'ainovel.pipeline.foreshadow.v1';
const LS_MEMORY = 'ainovel.pipeline.memoryPack.v1';
const LS_LONGFORM = 'ainovel.pipeline.longform.v1';
const LS_ARC_FLAGS = 'ainovel.pipeline.arcFlags.v1';

type ArcFlags = {
  lastArcSummaryAtChapter: number;
  lastVolumeSummaryAtChapter: number;
  lastArcReviewAtChapter: number;
  hasArcReview: boolean;
  hasArcSummary: boolean;
  hasVolumeSummary: boolean;
};

type PipelineBag = {
  quality: Record<number, ChapterQualityReport>;
  foreshadow: ForeshadowEntry[];
  memoryPack: MemoryPackSnapshot | null;
  longform: LongformConfig;
  arcFlags: ArcFlags;
};

const g = globalThis as unknown as { __ainovelPipelineBag?: PipelineBag };
const listeners = new Set<() => void>();
let qualityVersion = 0;

function emit(): void {
  qualityVersion += 1;
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      /* ignore */
    }
  }
}

/** React / external UI: re-render when quality or ledger changes */
export function subscribePipelineStore(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getPipelineStoreVersion(): number {
  return qualityVersion;
}

function bag(): PipelineBag {
  if (!g.__ainovelPipelineBag) {
    g.__ainovelPipelineBag = {
      quality: {},
      foreshadow: [],
      memoryPack: null,
      longform: { ...DEFAULT_LONGFORM },
      arcFlags: {
        lastArcSummaryAtChapter: 0,
        lastVolumeSummaryAtChapter: 0,
        lastArcReviewAtChapter: 0,
        hasArcReview: true,
        hasArcSummary: true,
        hasVolumeSummary: true,
      },
    };
    hydrateFromLocalStorage();
  }
  return g.__ainovelPipelineBag;
}

function canUseLs(): boolean {
  return typeof localStorage !== 'undefined';
}

function readLs<T>(key: string): T | null {
  if (!canUseLs()) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeLs(key: string, value: unknown): void {
  if (!canUseLs()) return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota */
  }
}

function hydrateFromLocalStorage(): void {
  const b = g.__ainovelPipelineBag!;
  const q = readLs<Record<number, ChapterQualityReport>>(LS_QUALITY);
  if (q && typeof q === 'object') b.quality = q;
  const fs = readLs<ForeshadowEntry[]>(LS_FORESHADOW);
  if (Array.isArray(fs)) b.foreshadow = fs;
  const mp = readLs<MemoryPackSnapshot>(LS_MEMORY);
  if (mp && typeof mp === 'object') b.memoryPack = mp;
  const lf = readLs<LongformConfig>(LS_LONGFORM);
  if (lf && typeof lf === 'object') b.longform = { ...DEFAULT_LONGFORM, ...lf };
  const af = readLs<ArcFlags>(LS_ARC_FLAGS);
  if (af && typeof af === 'object') b.arcFlags = { ...b.arcFlags, ...af };
}

export function setChapterQuality(report: ChapterQualityReport): void {
  const b = bag();
  b.quality[report.chapter] = report;
  writeLs(LS_QUALITY, b.quality);
  emit();
}

export function getChapterQuality(chapter: number): ChapterQualityReport | null {
  const q = bag().quality;
  const report = q[chapter] || q[Number(chapter)] || null;
  if (!report) return null;

  // Auto-heal cached reports with stale word_over_max hard error severity
  let dirty = false;
  const sanitizedFindings = (report.findings || []).map((f) => {
    if (f.code === 'word_over_max' && f.severity === 'error') {
      dirty = true;
      return { ...f, severity: 'warning' as const };
    }
    return f;
  });

  if (dirty) {
    const hardErrors = sanitizedFindings.filter((f) => f.severity === 'error').length;
    const warnings = sanitizedFindings.filter((f) => f.severity === 'warning').length;
    const mediaReady = hardErrors === 0 && (report.wordCount > 0 || (report.sceneCount || 0) > 0);
    const updated: ChapterQualityReport = {
      ...report,
      findings: sanitizedFindings,
      hardErrors,
      warnings,
      ok: hardErrors === 0,
      mediaReady,
    };
    q[chapter] = updated;
    q[Number(chapter)] = updated;
    writeLs(LS_QUALITY, q);
    return updated;
  }

  return report;
}

export function getAllChapterQuality(): Record<number, ChapterQualityReport> {
  return { ...bag().quality };
}

export function setForeshadowLedger(entries: ForeshadowEntry[]): void {
  bag().foreshadow = entries;
  writeLs(LS_FORESHADOW, entries);
  emit();
}

export function getForeshadowLedger(): ForeshadowEntry[] {
  return [...bag().foreshadow];
}

export function setMemoryPack(pack: MemoryPackSnapshot): void {
  bag().memoryPack = pack;
  writeLs(LS_MEMORY, pack);
  emit();
}

export function getMemoryPack(): MemoryPackSnapshot | null {
  return bag().memoryPack;
}

export function getLongformConfig(): LongformConfig {
  return { ...bag().longform };
}

export function setLongformConfig(patch: Partial<LongformConfig>): LongformConfig {
  const b = bag();
  b.longform = { ...b.longform, ...patch };
  writeLs(LS_LONGFORM, b.longform);
  return { ...b.longform };
}

export function getArcFlags(): ArcFlags {
  return { ...bag().arcFlags };
}

export function setArcFlags(patch: Partial<ArcFlags>): ArcFlags {
  const b = bag();
  b.arcFlags = { ...b.arcFlags, ...patch };
  writeLs(LS_ARC_FLAGS, b.arcFlags);
  return { ...b.arcFlags };
}

/** After arc summary tool succeeds */
export function markArcSummaryDone(atChapter: number): void {
  setArcFlags({
    hasArcSummary: true,
    lastArcSummaryAtChapter: atChapter,
  });
}

export function markArcReviewDone(atChapter: number): void {
  setArcFlags({
    hasArcReview: true,
    lastArcReviewAtChapter: atChapter,
  });
}

export function markVolumeSummaryDone(atChapter: number): void {
  setArcFlags({
    hasVolumeSummary: true,
    lastVolumeSummaryAtChapter: atChapter,
  });
}

/** Portable / backup snapshot — multi-machine hand-off */
export type PipelinePortableSnapshot = {
  version: 1;
  quality: Record<number, ChapterQualityReport>;
  foreshadow: ForeshadowEntry[];
  memoryPack: MemoryPackSnapshot | null;
  longform: LongformConfig;
  arcFlags: ArcFlags;
  exportedAt: string;
};

export function exportPipelineSnapshot(): PipelinePortableSnapshot {
  const b = bag();
  return {
    version: 1,
    quality: { ...b.quality },
    foreshadow: [...b.foreshadow],
    memoryPack: b.memoryPack ? { ...b.memoryPack } : null,
    longform: { ...b.longform },
    arcFlags: { ...b.arcFlags },
    exportedAt: new Date().toISOString(),
  };
}

export function importPipelineSnapshot(
  snap: PipelinePortableSnapshot | null | undefined,
): void {
  if (!snap || typeof snap !== 'object') return;
  const b = bag();
  if (snap.quality && typeof snap.quality === 'object') {
    // JSON keys are strings — normalize to numeric chapter ids
    const q: Record<number, ChapterQualityReport> = {};
    for (const [k, v] of Object.entries(snap.quality as Record<string, ChapterQualityReport>)) {
      const n = Number(k);
      if (Number.isFinite(n) && v && typeof v === 'object') {
        q[n] = { ...v, chapter: n };
      }
    }
    b.quality = q;
    writeLs(LS_QUALITY, b.quality);
  }
  if (Array.isArray(snap.foreshadow)) {
    b.foreshadow = snap.foreshadow;
    writeLs(LS_FORESHADOW, b.foreshadow);
  }
  if (snap.memoryPack && typeof snap.memoryPack === 'object') {
    b.memoryPack = snap.memoryPack;
    writeLs(LS_MEMORY, b.memoryPack);
  }
  if (snap.longform && typeof snap.longform === 'object') {
    b.longform = { ...DEFAULT_LONGFORM, ...snap.longform };
    writeLs(LS_LONGFORM, b.longform);
  }
  if (snap.arcFlags && typeof snap.arcFlags === 'object') {
    b.arcFlags = { ...b.arcFlags, ...snap.arcFlags };
    writeLs(LS_ARC_FLAGS, b.arcFlags);
  }
  emit();
}

/** Clear quality/ledger after Làm Mới Dự Án */
export function clearPipelineStore(): void {
  const b = bag();
  b.quality = {};
  b.foreshadow = [];
  b.memoryPack = null;
  b.longform = { ...DEFAULT_LONGFORM };
  b.arcFlags = {
    lastArcSummaryAtChapter: 0,
    lastVolumeSummaryAtChapter: 0,
    lastArcReviewAtChapter: 0,
    hasArcReview: true,
    hasArcSummary: true,
    hasVolumeSummary: true,
  };
  writeLs(LS_QUALITY, b.quality);
  writeLs(LS_FORESHADOW, b.foreshadow);
  writeLs(LS_MEMORY, b.memoryPack);
  writeLs(LS_LONGFORM, b.longform);
  writeLs(LS_ARC_FLAGS, b.arcFlags);
  emit();
}

/** Reset arc flags when entering a new arc end window */
export function openArcEndWindow(): void {
  setArcFlags({
    hasArcReview: false,
    hasArcSummary: false,
    hasVolumeSummary: false,
  });
}
