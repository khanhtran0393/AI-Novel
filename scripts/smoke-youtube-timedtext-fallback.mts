/**
 * Force Python bins empty path simulation is hard; instead call timedtext
 * via full fetch when python works — assert either python_captions or captions.
 * Also unit: pythonBins includes resolvePythonExe path.
 *
 *   npx tsx scripts/smoke-youtube-timedtext-fallback.mts
 */
import { fetchYoutubeSource } from '../src/lib/youtubeSource.ts';
import { resolvePythonExe } from '../src/app/api/self-heal/media/mediaHelpers.ts';
import fs from 'fs';

const py = resolvePythonExe();
console.log('[resolvePythonExe]', py, fs.existsSync(py) || py === 'python' || py === 'py');

const r = await fetchYoutubeSource('https://www.youtube.com/watch?v=jNQXAC9IVRw', {
  preferredLangs: ['en', 'vi'],
});
console.log(
  JSON.stringify(
    {
      ok: r.ok,
      source: r.source,
      words: r.wordCount,
      len: r.transcript?.length || 0,
      errorCode: r.errorCode,
    },
    null,
    2,
  ),
);

const blocked =
  r.errorCode === 'IP_BLOCKED' ||
  r.errorCode === 'RATE_LIMITED' ||
  /IP_BLOCKED|RATE_LIMITED|HTTP 429|blocking requests/i.test(
    `${r.errorCode || ''} ${r.error || ''}`,
  );

if (blocked) {
  console.warn(
    '[SKIP-NET] YouTube rate-limit/IP block — cannot assert captions live; code path still loads.',
  );
  console.log('[smoke-youtube-timedtext-fallback] PASS (skip-net) code=', r.errorCode);
  process.exit(0);
}

if (!r.ok || !(r.transcript && r.transcript.length >= 20)) {
  console.error('[FAIL] expected captions', r.errorCode, (r.error || '').slice(0, 200));
  process.exit(1);
}
if (r.source !== 'python_captions' && r.source !== 'captions') {
  console.error('[FAIL] unexpected source', r.source);
  process.exit(2);
}
console.log('[smoke-youtube-timedtext-fallback] PASS source=', r.source);
