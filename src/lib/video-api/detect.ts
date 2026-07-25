import { VIDEO_API_CATALOG, getVideoApiCatalogEntry } from './catalog';
import type { VideoApiDetectResult, VideoApiProviderId } from './types';

function normalizeBaseUrl(raw?: string): string {
  return String(raw || '')
    .trim()
    .replace(/\/+$/, '')
    .toLowerCase();
}

function matchHostHints(baseUrl: string): VideoApiProviderId | null {
  if (!baseUrl) return null;
  for (const entry of VIDEO_API_CATALOG) {
    if (entry.hostHints.some((h) => baseUrl.includes(h.toLowerCase()))) {
      return entry.id;
    }
  }
  return null;
}

function matchKeyHints(apiKey: string): VideoApiProviderId | null {
  const k = apiKey.trim();
  const lower = k.toLowerCase();
  // Gemini / Veo keys
  if (k.startsWith('AIzaSy') || lower.startsWith('aizasy')) return 'veo';
  // OpenAI
  if (k.startsWith('sk-') && !lower.includes('heygen')) return 'sora';
  // xAI
  if (lower.startsWith('xai-')) return 'grok';
  // fal often key_id:key_secret
  if (/^[0-9a-f]{8}-[0-9a-f-]+:[0-9a-f]+$/i.test(k) || lower.includes('fal_')) {
    return 'fal';
  }
  for (const entry of VIDEO_API_CATALOG) {
    if (entry.keyHints.some((h) => lower.includes(h))) return entry.id;
  }
  return null;
}

async function probeHeygen(apiKey: string, baseUrl: string): Promise<boolean> {
  const root = baseUrl || 'https://api.heygen.com';
  const urls = [
    `${root}/v1/user/remaining_quota`,
    `${root}/v2/user/remaining_quota`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { 'X-Api-Key': apiKey },
        signal: AbortSignal.timeout(12_000),
      });
      if (res.status === 401 || res.status === 403) return false;
      if (res.ok || res.status === 404) {
        // 404 on path still means auth accepted on some gateways; prefer ok
        if (res.ok) return true;
      }
      // Some accounts return 200 JSON with error code in body — treat 2xx as live
      if (res.status >= 200 && res.status < 300) return true;
    } catch {
      /* try next */
    }
  }
  // Last resort: lightweight POST validation is too heavy; skip
  return false;
}

async function probeLuma(apiKey: string): Promise<boolean> {
  try {
    const res = await fetch('https://api.lumalabs.ai/dream-machine/v1/credits', {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(12_000),
    });
    if (res.status === 401 || res.status === 403) return false;
    return res.ok;
  } catch {
    return false;
  }
}

async function probeRunway(apiKey: string): Promise<boolean> {
  try {
    const res = await fetch('https://api.dev.runwayml.com/v1/organization', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'X-Runway-Version': '2024-11-06',
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (res.status === 401 || res.status === 403) return false;
    return res.ok;
  } catch {
    return false;
  }
}

async function probeOpenAi(apiKey: string): Promise<boolean> {
  try {
    const res = await fetch('https://api.openai.com/v1/models', {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(12_000),
    });
    if (res.status === 401 || res.status === 403) return false;
    return res.ok;
  } catch {
    return false;
  }
}

function buildResult(
  providerId: VideoApiProviderId,
  method: VideoApiDetectResult['method'],
  confidence: VideoApiDetectResult['confidence'],
  verified: boolean,
  message: string,
  baseUrlOverride?: string,
): VideoApiDetectResult {
  const cat = getVideoApiCatalogEntry(providerId);
  return {
    providerId,
    label: cat?.label || providerId,
    confidence,
    method,
    baseUrl: baseUrlOverride || cat?.defaultBaseUrl || '',
    defaultModel: cat?.defaultModel || '',
    durationsSec: cat?.durationsSec || [5, 8, 10],
    authStyle: cat?.authStyle || 'unknown',
    message,
    verified,
  };
}

/**
 * Auto-detect video API platform from key + optional base URL.
 * Prefer baseUrl → key heuristic → live probe (when confidence low or multi-candidate).
 */
export async function detectVideoApiPlatform(input: {
  apiKey: string;
  baseUrl?: string;
  /** Skip network probe (unit tests / offline) */
  skipProbe?: boolean;
  forceProvider?: VideoApiProviderId;
}): Promise<VideoApiDetectResult> {
  const apiKey = String(input.apiKey || '').trim();
  if (!apiKey) {
    throw new Error('Thiếu API key. Dán key nền tảng video (HeyGen, Luma, Runway, …).');
  }
  const baseUrl = normalizeBaseUrl(input.baseUrl);

  if (input.forceProvider && input.forceProvider !== 'unknown') {
    return buildResult(
      input.forceProvider,
      'manual',
      'high',
      false,
      `Chọn tay provider: ${input.forceProvider}`,
      baseUrl || undefined,
    );
  }

  const hostHit = matchHostHints(baseUrl);
  if (hostHit) {
    let verified = false;
    if (!input.skipProbe) {
      if (hostHit === 'heygen') verified = await probeHeygen(apiKey, baseUrl || 'https://api.heygen.com');
      else if (hostHit === 'luma') verified = await probeLuma(apiKey);
      else if (hostHit === 'runway') verified = await probeRunway(apiKey);
      else if (hostHit === 'sora') verified = await probeOpenAi(apiKey);
    }
    return buildResult(
      hostHit,
      'base_url',
      verified ? 'high' : 'medium',
      verified,
      verified
        ? `Base URL khớp ${hostHit} · probe key OK`
        : `Base URL khớp ${hostHit}${input.skipProbe ? '' : ' · chưa verify key (probe fail/offline)'}`,
      baseUrl || undefined,
    );
  }

  const keyHit = matchKeyHints(apiKey);

  // Live probe order when key heuristic weak
  if (!input.skipProbe) {
    const probes: Array<{
      id: VideoApiProviderId;
      run: () => Promise<boolean>;
    }> = [
      { id: 'heygen', run: () => probeHeygen(apiKey, 'https://api.heygen.com') },
      { id: 'luma', run: () => probeLuma(apiKey) },
      { id: 'runway', run: () => probeRunway(apiKey) },
    ];
    // Prefer heuristic candidate first
    if (keyHit) {
      probes.sort((a, b) => (a.id === keyHit ? -1 : b.id === keyHit ? 1 : 0));
    }
    for (const p of probes) {
      const ok = await p.run();
      if (ok) {
        return buildResult(
          p.id,
          'probe',
          'high',
          true,
          `Probe thành công → ${p.id}`,
        );
      }
    }
    if (keyHit === 'sora' && (await probeOpenAi(apiKey))) {
      return buildResult('sora', 'probe', 'high', true, 'Probe OpenAI OK → sora/veo-compatible key');
    }
  }

  if (keyHit) {
    return buildResult(
      keyHit,
      'heuristic',
      'medium',
      false,
      `Heuristic theo key → ${keyHit}${input.skipProbe ? '' : ' (probe không xác nhận — vẫn gán theo mẫu key)'}`,
    );
  }

  return buildResult(
    'unknown',
    'heuristic',
    'low',
    false,
    'Không nhận dạng được nền tảng. Nhập Base URL (vd. https://api.heygen.com) hoặc chọn tay HeyGen/Luma/Runway.',
  );
}
