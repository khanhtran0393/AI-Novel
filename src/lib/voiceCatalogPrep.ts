import { API } from '@/contracts';
/**
 * Hậu trường chuẩn bị catalog giọng (client).
 * Gọi /api/tts/voices để merge: static + Piper scan + OmniVoice library + Vina profiles.
 */
import {
  cloneVoiceCatalog,
  countCatalogVoices,
  type VoiceCatalog,
  type VoiceOption,
} from './voiceCatalog';

export type VoiceCatalogPrepResult = {
  ok: boolean;
  catalog: VoiceCatalog;
  counts: Record<string, number>;
  sources: string[];
  preparedAt: string;
  error?: string;
};

let cachedPrep: VoiceCatalogPrepResult | null = null;
let inflight: Promise<VoiceCatalogPrepResult> | null = null;

/** Map omnivoice language label → code */
export function mapOmniLanguage(language?: string): string {
  const l = (language || '').toLowerCase();
  if (l.includes('english') || l === 'en') return 'en';
  if (l.includes('japan') || l === 'ja') return 'ja';
  if (l.includes('korea') || l === 'ko') return 'ko';
  if (l.includes('thai') || l === 'th') return 'th';
  if (l.includes('chinese') || l === 'zh' || l.includes('中')) return 'zh';
  if (l.includes('french') || l === 'fr') return 'fr';
  if (l.includes('german') || l === 'de') return 'de';
  if (l.includes('spanish') || l === 'es') return 'es';
  if (l.includes('portug') || l === 'pt') return 'pt';
  if (l.includes('indonesia') || l === 'id') return 'id';
  return 'vi';
}

export function mergeOmnivoiceIntoCatalog(
  catalog: VoiceCatalog,
  rows: Array<{
    id: string;
    name?: string;
    gender?: string;
    language?: string;
    location?: string;
    style?: string;
    previewUrl?: string;
  }>,
): VoiceCatalog {
  const next = cloneVoiceCatalog(catalog);
  if (!next.omnivoice_local) next.omnivoice_local = {};

  for (const voice of rows) {
    if (!voice?.id) continue;
    const lang = mapOmniLanguage(voice.language);
    if (!next.omnivoice_local[lang]) next.omnivoice_local[lang] = [];
    const gender =
      voice.gender === 'male' || voice.gender === 'female'
        ? voice.gender
        : undefined;
    const name = `${voice.name || voice.id}${
      gender ? ` - ${gender === 'male' ? 'Nam' : 'Nữ'}` : ''
    }${voice.location || voice.style ? ` (${voice.location || voice.style})` : ''}`;
    const entry: VoiceOption = {
      id: voice.id,
      name,
      gender,
      previewUrl: voice.previewUrl,
    };
    const idx = next.omnivoice_local[lang].findIndex((x) => x.id === entry.id);
    if (idx >= 0) {
      const prev = next.omnivoice_local[lang][idx];
      // Prefer longer display name when library has style variants under same id
      if ((entry.name || '').length >= (prev.name || '').length) {
        next.omnivoice_local[lang][idx] = entry;
      }
    } else {
      next.omnivoice_local[lang].push(entry);
    }
  }
  return next;
}

/**
 * Chuẩn bị catalog đầy đủ từ server (hậu trường).
 * - forceRefresh: bỏ cache client
 * - Có cache + inflight de-dupe để tránh spam API khi mở nhiều modal
 */
export async function prepareVoiceCatalog(options?: {
  forceRefresh?: boolean;
  signal?: AbortSignal;
}): Promise<VoiceCatalogPrepResult> {
  if (!options?.forceRefresh && cachedPrep?.ok) return cachedPrep;
  if (!options?.forceRefresh && inflight) return inflight;

  inflight = (async () => {
    try {
      const qs = options?.forceRefresh ? '?refresh=1' : '';
      const res = await fetch(`${API.ttsVoices}${qs}`, {
        method: 'GET',
        cache: options?.forceRefresh ? 'no-store' : 'default',
        signal: options?.signal,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.catalog) {
        throw new Error(data?.error || `Prep voices HTTP ${res.status}`);
      }
      const catalog = data.catalog as VoiceCatalog;
      const result: VoiceCatalogPrepResult = {
        ok: true,
        catalog,
        counts: data.counts || countCatalogVoices(catalog),
        sources: Array.isArray(data.sources) ? data.sources : ['static'],
        preparedAt: data.preparedAt || new Date().toISOString(),
      };
      cachedPrep = result;
      return result;
    } catch (err) {
      const catalog: VoiceCatalog = {};
      const result: VoiceCatalogPrepResult = {
        ok: false,
        catalog,
        counts: {},
        sources: [],
        preparedAt: new Date().toISOString(),
        error: err instanceof Error ? err.message : String(err),
      };
      cachedPrep = result;
      return result;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

export function getCachedPreparedCatalog(): VoiceCatalog {
  return cachedPrep?.catalog || {};
}

export function clearVoiceCatalogCache(): void {
  cachedPrep = null;
}
