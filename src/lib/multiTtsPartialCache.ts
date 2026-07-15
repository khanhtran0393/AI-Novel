/**
 * Browser partial cache for multi-segment TTS.
 * Survives mid-scene failures so retry reuses completed segments.
 */
import { sceneAssetKey } from '@/contracts';
import { hash12 } from './voiceCast';

export type MultiSegFingerprint = {
  text: string;
  voice: string;
  speed: number;
  pitch: number;
  emotion: string;
};

export type MultiPartialEntry = {
  chapter: number;
  sceneIndex: number;
  total: number;
  /** index → { path, fp } */
  parts: Record<
    number,
    {
      path: string;
      fp: string;
    }
  >;
  updatedAt: number;
};

const PREFIX = 'ainovel_tts_multi_partial_v1:';
const TTL_MS = 24 * 60 * 60 * 1000;

export function multiPartialStorageKey(chapter: number, sceneIndex: number): string {
  return `${PREFIX}${sceneAssetKey(chapter, sceneIndex)}`;
}

export function fingerprintSeg(seg: MultiSegFingerprint): string {
  return hash12(
    [
      seg.text.normalize('NFC').trim().slice(0, 200),
      seg.voice,
      String(seg.speed),
      String(seg.pitch),
      (seg.emotion || '').trim(),
    ].join('|'),
  );
}

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof sessionStorage !== 'undefined';
}

export function loadMultiPartial(
  chapter: number,
  sceneIndex: number,
): MultiPartialEntry | null {
  if (!canUseStorage()) return null;
  try {
    const raw = sessionStorage.getItem(multiPartialStorageKey(chapter, sceneIndex));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MultiPartialEntry;
    if (!parsed || typeof parsed !== 'object') return null;
    if (Date.now() - (parsed.updatedAt || 0) > TTL_MS) {
      sessionStorage.removeItem(multiPartialStorageKey(chapter, sceneIndex));
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveMultiPartial(entry: MultiPartialEntry): void {
  if (!canUseStorage()) return;
  try {
    sessionStorage.setItem(
      multiPartialStorageKey(entry.chapter, entry.sceneIndex),
      JSON.stringify({ ...entry, updatedAt: Date.now() }),
    );
  } catch {
    /* quota */
  }
}

export function clearMultiPartial(chapter: number, sceneIndex: number): void {
  if (!canUseStorage()) return;
  try {
    sessionStorage.removeItem(multiPartialStorageKey(chapter, sceneIndex));
  } catch {
    /* ignore */
  }
}

/** Count saved parts in a partial entry */
export function countPartialParts(entry: MultiPartialEntry | null): number {
  if (!entry?.parts) return 0;
  return Object.keys(entry.parts).filter((k) => entry.parts[Number(k)]?.path).length;
}

/** Snapshot of all multi partial caches in this session */
export function listAllMultiPartials(): Array<{
  chapter: number;
  sceneIndex: number;
  total: number;
  cached: number;
  updatedAt: number;
  key: string;
}> {
  if (!canUseStorage()) return [];
  const out: Array<{
    chapter: number;
    sceneIndex: number;
    total: number;
    cached: number;
    updatedAt: number;
    key: string;
  }> = [];
  try {
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (!key || !key.startsWith(PREFIX)) continue;
      const raw = sessionStorage.getItem(key);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as MultiPartialEntry;
        if (Date.now() - (parsed.updatedAt || 0) > TTL_MS) {
          sessionStorage.removeItem(key);
          continue;
        }
        out.push({
          chapter: parsed.chapter,
          sceneIndex: parsed.sceneIndex,
          total: parsed.total,
          cached: countPartialParts(parsed),
          updatedAt: parsed.updatedAt,
          key,
        });
      } catch {
        /* skip */
      }
    }
  } catch {
    /* ignore */
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function clearAllMultiPartials(): number {
  if (!canUseStorage()) return 0;
  let n = 0;
  try {
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k?.startsWith(PREFIX)) keys.push(k);
    }
    for (const k of keys) {
      sessionStorage.removeItem(k);
      n += 1;
    }
  } catch {
    /* ignore */
  }
  return n;
}

/** HEAD-check public audio URL still exists */
export async function audioPathExists(path: string): Promise<boolean> {
  if (!path || typeof path !== 'string') return false;
  try {
    const res = await fetch(path, { method: 'HEAD', cache: 'no-store' });
    if (res.ok) return true;
    // Some servers don't allow HEAD — try range GET
    if (res.status === 405 || res.status === 501) {
      const g = await fetch(path, {
        method: 'GET',
        headers: { Range: 'bytes=0-0' },
        cache: 'no-store',
      });
      return g.ok || g.status === 206;
    }
    return false;
  } catch {
    return false;
  }
}

/** Pool-limited parallel map (browser-safe) */
async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(1, concurrency), Math.max(1, items.length)) },
    async () => {
      while (true) {
        const i = cursor++;
        if (i >= items.length) break;
        results[i] = await fn(items[i], i);
      }
    },
  );
  if (items.length === 0) return [];
  await Promise.all(workers);
  return results;
}

/**
 * Drop dead partial paths (file gone) and rewrite cache.
 * Returns number of paths removed.
 */
export async function pruneDeadPartialParts(
  chapter: number,
  sceneIndex: number,
  concurrency = 4,
): Promise<number> {
  const entry = loadMultiPartial(chapter, sceneIndex);
  if (!entry) return 0;
  const indices = Object.keys(entry.parts).map(Number);
  if (!indices.length) return 0;

  let removed = 0;
  const nextParts = { ...entry.parts };
  await mapPool(indices, concurrency, async (idx) => {
    const part = entry.parts[idx];
    if (!part?.path) {
      delete nextParts[idx];
      removed += 1;
      return;
    }
    const ok = await audioPathExists(part.path);
    if (!ok) {
      delete nextParts[idx];
      removed += 1;
    }
  });

  if (removed > 0) {
    if (Object.keys(nextParts).length === 0) {
      clearMultiPartial(chapter, sceneIndex);
    } else {
      saveMultiPartial({
        ...entry,
        parts: nextParts,
        updatedAt: Date.now(),
      });
    }
  }
  return removed;
}

export type SegForResume = MultiSegFingerprint & { speaker?: string | null };

/**
 * Resolve which segment indices can be skipped (resume hits).
 */
export async function resolveResumeHits(params: {
  chapter: number;
  sceneIndex: number;
  segments: SegForResume[];
  forceFull?: boolean;
}): Promise<{
  paths: (string | null)[];
  hitCount: number;
  entry: MultiPartialEntry | null;
}> {
  const total = params.segments.length;
  const paths: (string | null)[] = new Array(total).fill(null);
  if (params.forceFull) {
    clearMultiPartial(params.chapter, params.sceneIndex);
    return { paths, hitCount: 0, entry: null };
  }

  const entry = loadMultiPartial(params.chapter, params.sceneIndex);
  if (!entry || entry.total !== total) {
    return { paths, hitCount: 0, entry: entry };
  }

  let hitCount = 0;
  const dirtyParts = { ...entry.parts };
  let dirty = false;

  await mapPool(params.segments, 4, async (seg, i) => {
    const fp = fingerprintSeg(seg);
    const cached = entry.parts[i];
    if (!cached || cached.fp !== fp || !cached.path) return;
    const ok = await audioPathExists(cached.path);
    if (ok) {
      paths[i] = cached.path;
      hitCount += 1;
    } else {
      delete dirtyParts[i];
      dirty = true;
    }
  });

  // Self-heal cache: drop dead files so next resume is accurate
  if (dirty) {
    if (Object.keys(dirtyParts).length === 0) {
      clearMultiPartial(params.chapter, params.sceneIndex);
    } else {
      saveMultiPartial({
        ...entry,
        parts: dirtyParts,
        updatedAt: Date.now(),
      });
    }
  }

  return { paths, hitCount, entry };
}

export function writePartialFromPaths(params: {
  chapter: number;
  sceneIndex: number;
  segments: SegForResume[];
  paths: (string | null | undefined)[];
}): void {
  const parts: MultiPartialEntry['parts'] = {};
  params.paths.forEach((p, i) => {
    if (!p) return;
    const seg = params.segments[i];
    if (!seg) return;
    parts[i] = { path: p, fp: fingerprintSeg(seg) };
  });
  saveMultiPartial({
    chapter: params.chapter,
    sceneIndex: params.sceneIndex,
    total: params.segments.length,
    parts,
    updatedAt: Date.now(),
  });
}

/** Chapter-level failed scene log (session) */
const CHAPTER_FAIL_PREFIX = 'ainovel_tts_chapter_fail_v1:';

export function saveChapterFailLog(
  chapter: number,
  failedSceneIndexes: number[],
): void {
  if (!canUseStorage()) return;
  try {
    sessionStorage.setItem(
      `${CHAPTER_FAIL_PREFIX}${chapter}`,
      JSON.stringify({ failed: failedSceneIndexes, at: Date.now() }),
    );
  } catch {
    /* ignore */
  }
}

export function loadChapterFailLog(chapter: number): number[] {
  if (!canUseStorage()) return [];
  try {
    const raw = sessionStorage.getItem(`${CHAPTER_FAIL_PREFIX}${chapter}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { failed?: number[]; at?: number };
    if (Date.now() - (parsed.at || 0) > TTL_MS) return [];
    return Array.isArray(parsed.failed) ? parsed.failed : [];
  } catch {
    return [];
  }
}

export function clearChapterFailLog(chapter: number): void {
  if (!canUseStorage()) return;
  try {
    sessionStorage.removeItem(`${CHAPTER_FAIL_PREFIX}${chapter}`);
  } catch {
    /* ignore */
  }
}
