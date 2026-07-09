/**
 * Client-side cache for cast auto-tag results (10 min TTL).
 */
import { hash12 } from './voiceCast';

export type CachedAssignment = {
  id: string;
  speaker: string | null;
  confidence: number;
};

type CacheEntry = {
  assignments: CachedAssignment[];
  provider?: string;
  at: number;
};

const TTL_MS = 10 * 60 * 1000;
const store = new Map<string, CacheEntry>();

export function autoTagCacheKey(
  sceneText: string,
  characterNames: string[],
): string {
  const names = [...characterNames]
    .map((n) => n.normalize('NFC').trim())
    .filter(Boolean)
    .sort()
    .join('|');
  return hash12(`${sceneText.normalize('NFC')}|${names}`);
}

export function getAutoTagCache(key: string): CachedAssignment[] | null {
  const e = store.get(key);
  if (!e) return null;
  if (Date.now() - e.at > TTL_MS) {
    store.delete(key);
    return null;
  }
  return e.assignments;
}

export function setAutoTagCache(
  key: string,
  assignments: CachedAssignment[],
  provider?: string,
): void {
  store.set(key, { assignments, provider, at: Date.now() });
  // prune old
  if (store.size > 40) {
    const now = Date.now();
    for (const [k, v] of store) {
      if (now - v.at > TTL_MS) store.delete(k);
    }
  }
}

export function clearAutoTagCache(): void {
  store.clear();
}
