/**
 * Client-safe YouTube URL / video-id helpers (no Node builtins).
 * Server fetch lives in youtubeSource.ts (API route only).
 */

export function extractYoutubeVideoId(input: string): string | null {
  const s = (input || '').trim();
  if (!s) return null;
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;

  const patterns = [
    /(?:youtube\.com\/watch\?(?:[^#]*&)?v=)([A-Za-z0-9_-]{11})/i,
    /(?:youtu\.be\/)([A-Za-z0-9_-]{11})/i,
    /(?:youtube\.com\/embed\/)([A-Za-z0-9_-]{11})/i,
    /(?:youtube\.com\/shorts\/)([A-Za-z0-9_-]{11})/i,
    /(?:youtube\.com\/live\/)([A-Za-z0-9_-]{11})/i,
    /(?:youtube\.com\/v\/)([A-Za-z0-9_-]{11})/i,
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m?.[1]) return m[1];
  }
  return null;
}

export function isValidYoutubeUrlOrId(input: string): boolean {
  return extractYoutubeVideoId(input) != null;
}
