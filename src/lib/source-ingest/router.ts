/**
 * Source ingest router — ordered channels (youtube strict → web fallback).
 * YouTube hosts never fall through to HTML scrape of watch pages.
 */

import { youtubeChannel } from './channels/youtube';
import { webChannel } from './channels/web';
import { assertSafePublicHttpUrl, isYoutubeHost } from './ssrf';
import type { SourceChannel, SourceFetchOpts, SourceIngestResult, SourcePlatform } from './types';

/** Ordered: specific platforms first, generic web last. */
export const SOURCE_CHANNELS: SourceChannel[] = [youtubeChannel, webChannel];

export function detectSourcePlatform(rawUrl: string): SourcePlatform {
  const input = String(rawUrl || '').trim();
  if (!input) return 'unsupported';

  if (youtubeChannel.canHandle(input)) return 'youtube';

  const safe = assertSafePublicHttpUrl(input);
  if (safe.ok) {
    // YouTube host without valid video id still counts as youtube (fail in channel)
    if (isYoutubeHost(safe.url.hostname)) return 'youtube';
    return 'web';
  }

  return 'unsupported';
}

export function pickChannel(rawUrl: string): SourceChannel | null {
  const platform = detectSourcePlatform(rawUrl);
  if (platform === 'unsupported') return null;
  return SOURCE_CHANNELS.find((c) => c.id === platform) ?? null;
}

/**
 * Fetch content from URL via the matching channel.
 */
export async function fetchSourceIngest(
  rawUrl: string,
  opts?: SourceFetchOpts,
): Promise<SourceIngestResult> {
  const url = String(rawUrl || '').trim();
  if (!url) {
    return {
      ok: false,
      platform: 'unsupported',
      url: '',
      errorCode: 'INVALID_URL',
      error:
        '❌ Thiếu URL.\n\n🔎 Vì sao: Body/ô link trống.\n📍 Ở đâu: Bước «Phân tích»\n✅ Cách khắc phục:\n• Dán link YouTube hoặc bài viết web rồi bấm Phân tích.',
    };
  }

  const channel = pickChannel(url);
  if (!channel) {
    return {
      ok: false,
      platform: 'unsupported',
      url,
      errorCode: 'UNSUPPORTED_URL',
      error: [
        '❌ Không hỗ trợ loại link này.',
        '',
        '🔎 Vì sao: Không phải YouTube hợp lệ và không phải URL http/https công khai.',
        '📍 Ở đâu: Bước «Phân tích»',
        '✅ Cách khắc phục:',
        '• Dán link YouTube (watch / youtu.be / shorts) hoặc link bài viết web.',
        '• Hoặc gõ tay cốt truyện vào ô 3.',
      ].join('\n'),
    };
  }

  return channel.fetch(url, opts);
}

/**
 * Agent-Reach multi-source ingest — fetches and aggregates content from multiple URLs.
 */
export async function fetchMultiSourceIngest(
  rawInput: string,
  opts?: SourceFetchOpts,
): Promise<SourceIngestResult> {
  const input = String(rawInput || '').trim();
  if (!input) {
    return fetchSourceIngest('', opts);
  }

  // Helper import safely
  const { extractUrlsFromInput } = await import('../sourceIngestId');
  const urls = extractUrlsFromInput(input);

  if (urls.length <= 1) {
    return fetchSourceIngest(urls[0] || input, opts);
  }

  // Fetch all URLs in parallel (settled)
  const results: SourceIngestResult[] = await Promise.all(
    urls.map(async (u): Promise<SourceIngestResult> => {
      try {
        return await fetchSourceIngest(u, opts);
      } catch (err) {
        return {
          ok: false,
          platform: 'unsupported',
          url: u,
          errorCode: 'FETCH_FAILED',
          error: String((err as Error)?.message || err),
        };
      }
    }),
  );

  const successful = results.filter((r) => r.ok && (r.text || '').trim().length >= 20);

  if (successful.length === 0) {
    // Return first failure with context
    const firstFail = results[0];
    return {
      ...firstFail,
      error: `❌ Không trích xuất được nội dung từ ${urls.length} nguồn.\n\nChi tiết nguồn 1:\n${firstFail.error || 'Thất bại'}`,
      sources: results,
      isMultiSource: true,
      sourcesCount: 0,
    };
  }

  // Combine text from successful sources into unified Agent-Reach knowledge block
  const fusedTextBlocks: string[] = [];
  let totalWords = 0;

  successful.forEach((res, index) => {
    const srcType = res.platform === 'youtube' ? 'YouTube Video' : 'Trang Web/Bài Viết';
    const heading = `[NGUỒN ${index + 1}: ${srcType} - ${res.title || res.author || res.url}]`;
    const text = (res.text || '').trim();
    fusedTextBlocks.push(`${heading}\n${text}`);
    totalWords += res.wordCount || text.split(/\s+/).filter(Boolean).length;
  });

  const fusedText = fusedTextBlocks.join('\n\n' + '='.repeat(40) + '\n\n');
  const primarySource = successful[0];

  return {
    ok: true,
    platform: successful.every((s) => s.platform === 'youtube')
      ? 'youtube'
      : successful.every((s) => s.platform === 'web')
        ? 'web'
        : 'web',
    url: input,
    title: `Tổng hợp tri thức từ ${successful.length}/${urls.length} nguồn`,
    author: `Agent-Reach Multi-Source (${successful.length} nguồn)`,
    text: fusedText,
    wordCount: totalWords,
    source: `agent_reach_multi_${successful.map((s) => s.source || s.platform).join('_')}`,
    sources: results,
    isMultiSource: true,
    sourcesCount: successful.length,
    rewriteBrief: primarySource.rewriteBrief,
  };
}

