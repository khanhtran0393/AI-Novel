/**
 * Browser-side cache for TTS "Nghe thử".
 * Avoids re-calling /api/generate-tts (and re-synth) when the same
 * platform/voice/text/prosody was already heard in this session or Cache API.
 */

const CACHE_NAME = 'tts-prelisten-cache-v2';

/** Session memory: key → blob URL (instant replay, no network) */
const sessionBlobByKey = new Map<string, string>();

export function normalizeProsodyClient(speed?: number, pitch?: number): {
  speed: number;
  pitch: number;
} {
  const s = Number(speed);
  const p = Number(pitch);
  return {
    speed: Number.isFinite(s) && s > 0 ? Math.round(s * 100) / 100 : 1,
    pitch: Number.isFinite(p) ? Math.round(p * 10) / 10 : 0,
  };
}

export function buildClientPreviewKey(params: {
  platform: string;
  voice: string;
  text: string;
  speed?: number;
  pitch?: number;
  speakerSeed?: number;
  styleSeed?: number;
}): string {
  const { speed, pitch } = normalizeProsodyClient(params.speed, params.pitch);
  const text = String(params.text || '').normalize('NFC').trim().slice(0, 300);
  const platform = String(params.platform || '').toLowerCase();
  const seedS =
    platform === 'vina_voice'
      ? Number.isFinite(Number(params.speakerSeed))
        ? Number(params.speakerSeed)
        : 2336
      : '';
  const seedY =
    platform === 'vina_voice'
      ? Number.isFinite(Number(params.styleSeed))
        ? Number(params.styleSeed)
        : 4125
      : '';
  return [
    platform,
    String(params.voice || '').trim(),
    text,
    String(speed),
    String(pitch),
    String(seedS),
    String(seedY),
  ].join('|');
}

async function openCache(): Promise<Cache | null> {
  try {
    if (typeof caches === 'undefined') return null;
    return await caches.open(CACHE_NAME);
  } catch {
    return null;
  }
}

function cacheRequestUrl(key: string): string {
  // Synthetic URL for Cache Storage (not fetched from network)
  return `https://tts-prelisten.local/v2?k=${encodeURIComponent(key)}`;
}

/** Instant hit from session Map (blob:) */
export function getSessionPreviewBlob(key: string): string | null {
  return sessionBlobByKey.get(key) || null;
}

export function putSessionPreviewBlob(key: string, blobUrl: string): void {
  const prev = sessionBlobByKey.get(key);
  if (prev && prev !== blobUrl && prev.startsWith('blob:')) {
    try {
      URL.revokeObjectURL(prev);
    } catch {
      /* ignore */
    }
  }
  sessionBlobByKey.set(key, blobUrl);
}

/** Cache Storage hit → blob URL */
export async function readBrowserPreviewCache(key: string): Promise<string | null> {
  const session = getSessionPreviewBlob(key);
  if (session) return session;

  const cache = await openCache();
  if (!cache) return null;
  try {
    const res = await cache.match(cacheRequestUrl(key));
    if (!res) return null;
    const blob = await res.blob();
    if (!blob || blob.size < 400) return null;
    const blobUrl = URL.createObjectURL(blob);
    putSessionPreviewBlob(key, blobUrl);
    return blobUrl;
  } catch {
    return null;
  }
}

/** Persist Response/blob for next Nghe thử */
export async function writeBrowserPreviewCache(
  key: string,
  blob: Blob,
  contentType?: string,
): Promise<string> {
  const type =
    contentType ||
    (blob.type && blob.type !== 'application/octet-stream'
      ? blob.type
      : 'audio/mpeg');
  const sealed = blob.type === type ? blob : new Blob([blob], { type });
  const blobUrl = URL.createObjectURL(sealed);
  putSessionPreviewBlob(key, blobUrl);

  const cache = await openCache();
  if (cache) {
    try {
      await cache.put(
        cacheRequestUrl(key),
        new Response(sealed, { headers: { 'Content-Type': type } }),
      );
    } catch {
      /* private mode / quota */
    }
  }
  return blobUrl;
}
