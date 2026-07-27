/**
 * Agent-Reach Auto-Research Module.
 * Automatically searches the web for a given query, extracts top quality articles,
 * and fuses knowledge into unified context.
 */

import { fetchMultiSourceIngest } from './router';
import type { SourceIngestResult } from './types';
import { assertSafePublicHttpUrl } from './ssrf';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

/**
 * Search DuckDuckGo HTML or public search engines to find top article URLs for query.
 */
export async function searchWebUrls(query: string, maxResults = 4): Promise<string[]> {
  const q = String(query || '').trim();
  if (!q) return [];

  const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch(searchUrl, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent': UA,
        'Accept-Language': 'vi,en;q=0.9',
      },
    });

    if (!res.ok) return [];
    const html = await res.text();

    // Extract links matching //duckduckgo.com/l/?uddg=... or direct hrefs
    const urls: string[] = [];
    const matches = html.matchAll(/class="result__url"[^>]*href=["']([^"']+)["']/gi);
    for (const m of matches) {
      let rawLink = m[1]?.trim();
      if (!rawLink) continue;

      if (rawLink.includes('uddg=')) {
        try {
          const uParam = new URL(`https://html.duckduckgo.com${rawLink}`).searchParams.get('uddg');
          if (uParam) rawLink = uParam;
        } catch {
          /* ignore */
        }
      }

      if (!rawLink.startsWith('http')) {
        rawLink = `https://${rawLink.replace(/^\/\//, '')}`;
      }

      const safe = assertSafePublicHttpUrl(rawLink);
      if (safe.ok && !safe.url.hostname.includes('duckduckgo.com')) {
        urls.push(safe.url.toString());
      }
      if (urls.length >= maxResults) break;
    }

    return Array.from(new Set(urls));
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Auto-Research knowledge pipeline: query -> search -> fetch multi-source -> aggregate.
 */
export async function autoResearchKnowledge(
  query: string,
  opts?: { maxResults?: number; fallbackUrls?: string[] },
): Promise<SourceIngestResult> {
  const q = String(query || '').trim();
  if (!q) {
    return {
      ok: false,
      platform: 'unsupported',
      url: '',
      errorCode: 'INVALID_URL',
      error: '❌ Thiếu từ khóa/chủ đề để tìm kiếm tự động.',
    };
  }

  let urls = await searchWebUrls(q, opts?.maxResults ?? 4);

  if (urls.length === 0 && opts?.fallbackUrls && opts.fallbackUrls.length > 0) {
    urls = opts.fallbackUrls;
  }

  if (urls.length === 0) {
    // Search fallback: attempt search query via Jina or direct web query
    urls = [`https://en.wikipedia.org/wiki/${encodeURIComponent(q.replace(/\s+/g, '_'))}`];
  }

  const multiInput = urls.join('\n');
  const result = await fetchMultiSourceIngest(multiInput);

  return {
    ...result,
    title: `Tri thức tự động cho chủ đề: "${q}" (${result.sourcesCount || 0} nguồn)`,
    author: `Agent-Reach Auto-Research ("${q}")`,
  };
}
