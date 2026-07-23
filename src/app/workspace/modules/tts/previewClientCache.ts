/**
 * Browser-side cache for TTS "Nghe thử".
 * Avoids re-calling /api/generate-tts (and re-synth) when the same
 * platform/voice/text/prosody was already heard in this session or Cache API.
 */

import {
  buildTtsCacheVariantKey,
  type TtsCacheVariantConfig,
} from '@/lib/tts/prosodyVariant';
import {
  TTS_PRELISTEN_CACHE_NAME,
  VINA_PREVIEW_NFE_DEFAULT,
} from '@/lib/tts/previewDefaults';

/** v8: magic-byte MIME (never trust wrong Content-Type) + NFE default 20. */
const CACHE_NAME = TTS_PRELISTEN_CACHE_NAME;
const MAX_SESSION_BLOBS = 16;

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
  /** Vina flow-matching steps — must match server resolveNfeStep(isPreview) */
  nfeStep?: number;
  variantKey?: string;
} & TtsCacheVariantConfig): string {
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
  const nfe =
    platform === 'vina_voice'
      ? Number.isFinite(Number(params.nfeStep)) && Number(params.nfeStep) > 0
        ? Math.trunc(Number(params.nfeStep))
        : VINA_PREVIEW_NFE_DEFAULT
      : '';
  const variantKey =
    params.variantKey !== undefined
      ? String(params.variantKey || '')
      : buildTtsCacheVariantKey(params);
  return [
    platform,
    String(params.voice || '').trim(),
    text,
    String(speed),
    String(pitch),
    String(seedS),
    String(seedY),
    String(nfe),
    variantKey,
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
  return `https://tts-prelisten.local/v8?k=${encodeURIComponent(key)}`;
}

/** Instant hit from session Map (blob:) */
export function getSessionPreviewBlob(key: string): string | null {
  const hit = sessionBlobByKey.get(key) || null;
  if (hit) {
    sessionBlobByKey.delete(key);
    sessionBlobByKey.set(key, hit);
  }
  return hit;
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
  while (sessionBlobByKey.size > MAX_SESSION_BLOBS) {
    const oldest = sessionBlobByKey.keys().next().value as string | undefined;
    if (!oldest) break;
    const oldUrl = sessionBlobByKey.get(oldest);
    sessionBlobByKey.delete(oldest);
    if (oldUrl?.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(oldUrl);
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * Detect real audio/* from magic bytes.
 * Never trust Content-Type alone — server/CDN often returns audio/mpeg for WAV
 * which makes <audio> fail silently or crackle.
 */
export async function sniffAudioMime(blob: Blob, hint?: string): Promise<string> {
  try {
    const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
    // RIFF....WAVE
    if (
      head.length >= 12 &&
      head[0] === 0x52 &&
      head[1] === 0x49 &&
      head[2] === 0x46 &&
      head[3] === 0x46 &&
      head[8] === 0x57 &&
      head[9] === 0x41 &&
      head[10] === 0x56 &&
      head[11] === 0x45
    ) {
      return 'audio/wav';
    }
    // ID3 or MPEG frame sync
    if (
      (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) ||
      (head[0] === 0xff && (head[1] & 0xe0) === 0xe0)
    ) {
      return 'audio/mpeg';
    }
    // Ogg
    if (
      head.length >= 4 &&
      head[0] === 0x4f &&
      head[1] === 0x67 &&
      head[2] === 0x67 &&
      head[3] === 0x53
    ) {
      return 'audio/ogg';
    }
  } catch {
    /* ignore */
  }
  const h = (hint || blob.type || '').split(';')[0].trim().toLowerCase();
  if (h.startsWith('audio/')) return h;
  return 'audio/mpeg';
}

/** Seal blob with correct MIME so HTMLAudioElement can decode. */
export async function sealAudioBlob(
  blob: Blob,
  hint?: string,
): Promise<Blob> {
  const type = await sniffAudioMime(blob, hint);
  if (blob.type === type) return blob;
  return new Blob([blob], { type });
}

/** Cache Storage hit → blob URL (re-sniff MIME every time). */
export async function readBrowserPreviewCache(key: string): Promise<string | null> {
  const session = getSessionPreviewBlob(key);
  if (session) return session;

  const cache = await openCache();
  if (!cache) return null;
  try {
    const res = await cache.match(cacheRequestUrl(key));
    if (!res) return null;
    const raw = await res.blob();
    if (!raw || raw.size < 400) return null;
    const sealed = await sealAudioBlob(
      raw,
      res.headers.get('Content-Type') || raw.type,
    );
    const blobUrl = URL.createObjectURL(sealed);
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
  if (!blob || blob.size < 400) {
    throw new Error(
      `File nghe thử quá nhỏ (${blob?.size || 0} byte) — không phải audio hợp lệ.`,
    );
  }
  const sealed = await sealAudioBlob(blob, contentType);
  const blobUrl = URL.createObjectURL(sealed);
  putSessionPreviewBlob(key, blobUrl);

  const cache = await openCache();
  if (cache) {
    try {
      await cache.put(
        cacheRequestUrl(key),
        new Response(sealed, {
          headers: { 'Content-Type': sealed.type || 'audio/mpeg' },
        }),
      );
    } catch {
      /* private mode / quota */
    }
  }
  return blobUrl;
}

/** Resolve relative /audio/... for browser + Electron. */
export function resolvePlayableAudioUrl(raw: string): string {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (
    s.startsWith('blob:') ||
    s.startsWith('data:') ||
    /^https?:\/\//i.test(s)
  ) {
    return s;
  }
  if (s.startsWith('/') && typeof window !== 'undefined') {
    return `${window.location.origin}${s}`;
  }
  if (s.startsWith('audio/')) {
    return typeof window !== 'undefined'
      ? `${window.location.origin}/${s}`
      : `/${s}`;
  }
  return s;
}
