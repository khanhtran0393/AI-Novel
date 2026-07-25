/**
 * Empirical: full caption chain including audio+whisper.
 *   npx tsx scripts/diag-youtube-whisper-chain.mts
 *   npx tsx scripts/diag-youtube-whisper-chain.mts --url "https://..."
 */
import { fetchYoutubeSource } from '../src/lib/youtubeSource.ts';

const args = process.argv.slice(2);
const i = args.indexOf('--url');
const url =
  (i >= 0 && args[i + 1]) ||
  process.env.YOUTUBE_SMOKE_URL ||
  'https://www.youtube.com/watch?v=jNQXAC9IVRw';

console.log('[url]', url);
const t0 = Date.now();
const r = await fetchYoutubeSource(url, { preferredLangs: ['en', 'vi'] });
console.log(
  JSON.stringify(
    {
      ok: r.ok,
      source: r.source,
      chain: r.chain,
      words: r.wordCount,
      title: r.title,
      language: r.language,
      head: (r.transcript || '').slice(0, 220),
      errorCode: r.errorCode,
      ms: Date.now() - t0,
    },
    null,
    2,
  ),
);
if (!r.ok) {
  console.error((r.error || '').slice(0, 400));
  process.exit(1);
}
if ((r.transcript || '').length < 20) {
  console.error('transcript too short');
  process.exit(1);
}
console.log('[PASS] content ready for cache + % similarity');
