/**
 * Client-safe URL helpers for multi-source setup (no Node / youtubeSource).
 */

import { extractYoutubeVideoId } from './youtubeSourceId';

export type ClientSourcePlatform = 'youtube' | 'web' | 'unsupported';

function isYoutubeHost(hostname: string): boolean {
  const h = (hostname || '').toLowerCase().replace(/^www\./, '');
  return (
    h === 'youtube.com' ||
    h === 'm.youtube.com' ||
    h === 'music.youtube.com' ||
    h === 'youtu.be' ||
    h.endsWith('.youtube.com')
  );
}

/**
 * Detect platform for UI validation (mirrors server router, without SSRF private-IP DNS).
 */
export function detectClientSourcePlatform(raw: string): ClientSourcePlatform {
  const s = (raw || '').trim();
  if (!s) return 'unsupported';

  if (/^[A-Za-z0-9_-]{11}$/.test(s) && extractYoutubeVideoId(s)) {
    return 'youtube';
  }

  let normalized = s;
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(normalized)) {
    normalized = `https://${normalized}`;
  }

  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    return 'unsupported';
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return 'unsupported';
  }

  const host = (url.hostname || '').toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.local')) {
    return 'unsupported';
  }

  if (isYoutubeHost(host)) {
    return 'youtube';
  }

  return 'web';
}

/** True when Phân tích button should enable. */
export function isAnalyzableSourceUrl(raw: string): boolean {
  const platform = detectClientSourcePlatform(raw);
  if (platform === 'web') return true;
  if (platform === 'youtube') return extractYoutubeVideoId(raw) != null;
  return false;
}

export function sourceUrlHint(raw: string): string {
  const s = (raw || '').trim();
  if (!s) return '';
  const urls = extractUrlsFromInput(s);
  if (urls.length > 1) {
    const validCount = urls.filter(isAnalyzableSourceUrl).length;
    if (validCount === 0) {
      return 'Không tìm thấy URL YouTube hoặc Web hợp lệ trong danh sách.';
    }
    if (validCount < urls.length) {
      return `Phát hiện ${validCount}/${urls.length} URL hợp lệ — hệ thống sẽ phân tích các nguồn hợp lệ.`;
    }
    return '';
  }

  const platform = detectClientSourcePlatform(s);
  if (platform === 'youtube' && !extractYoutubeVideoId(s)) {
    return 'Link YouTube chưa hợp lệ — cần watch / youtu.be / shorts (không dán playlist hay trang kênh).';
  }
  if (platform === 'unsupported') {
    return 'Cần URL http/https công khai (YouTube hoặc bài viết web).';
  }
  return '';
}

/**
 * Extract distinct valid URLs from single string or multiline input (Agent-Reach Multi-Source).
 */
export function extractUrlsFromInput(input: string): string[] {
  const raw = String(input || '').trim();
  if (!raw) return [];

  // Split by line breaks, commas, or spaces
  const tokens = raw
    .split(/[\r\n,\s]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  const set = new Set<string>();
  for (const token of tokens) {
    if (token.startsWith('http://') || token.startsWith('https://') || /^[A-Za-z0-9_-]{11}$/.test(token)) {
      set.add(token);
    }
  }

  // If no http prefix was found but user entered a single line domain/video, fallback to raw if valid
  if (set.size === 0 && raw) {
    set.add(raw);
  }

  return Array.from(set);
}

/** True when Phân tích button should enable for single or multi-url input. */
export function isAnalyzableMultiSourceInput(input: string): boolean {
  const urls = extractUrlsFromInput(input);
  if (urls.length === 0) return isAnalyzableSourceUrl(input);
  return urls.some(isAnalyzableSourceUrl);
}

