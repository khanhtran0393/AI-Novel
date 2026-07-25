/**
 * Offline unit: id parse + error builder + VTT parse (no network).
 *   npx tsx scripts/smoke-youtube-rewrite-unit.mts
 */
import {
  extractYoutubeVideoId,
  buildYoutubeTranscriptUserError,
  summarizeYoutubeErrorForToast,
  parseSubtitleFileToText,
} from '../src/lib/youtubeSource.ts';

const failures: string[] = [];
function ok(cond: boolean, msg: string) {
  if (!cond) {
    failures.push(msg);
    console.error('[FAIL]', msg);
  } else {
    console.log('[OK]', msg);
  }
}

// id
ok(extractYoutubeVideoId('https://www.youtube.com/watch?v=jNQXAC9IVRw') === 'jNQXAC9IVRw', 'watch?v=');
ok(extractYoutubeVideoId('https://youtu.be/jNQXAC9IVRw') === 'jNQXAC9IVRw', 'youtu.be');
ok(extractYoutubeVideoId('https://www.youtube.com/shorts/jNQXAC9IVRw') === 'jNQXAC9IVRw', 'shorts');
ok(extractYoutubeVideoId('not a link') === null, 'garbage → null');

// error UX
const err = buildYoutubeTranscriptUserError({
  code: 'RATE_LIMITED',
  videoId: 'jNQXAC9IVRw',
  title: 'Me at the zoo',
});
ok(err.includes('Vì sao') && err.includes('Cách khắc phục'), 'RATE_LIMITED UX block');
const toast = summarizeYoutubeErrorForToast(err);
ok(toast.length > 20 && toast.length <= 220, 'toast length');

// VTT parse (yt-dlp step)
const vtt = `WEBVTT

00:00:00.000 --> 00:00:02.000
all right

00:00:02.000 --> 00:00:04.000
so here we are

00:00:04.000 --> 00:00:06.000
so here we are
`;
const plain = parseSubtitleFileToText(vtt);
ok(plain.includes('all right') && plain.includes('so here we are'), `vtt parse: ${plain}`);
ok(!plain.includes('-->'), 'vtt stripped timestamps');
// dedupe consecutive
ok((plain.match(/so here we are/g) || []).length === 1, 'vtt dedupe consecutive');

console.log(
  JSON.stringify({
    ok: failures.length === 0,
    toastSample: toast,
    errorLen: err.length,
    vttPlain: plain,
  }),
);
if (failures.length) {
  console.error('[smoke-youtube-rewrite-unit] FAIL', failures);
  process.exit(1);
}
console.log('[smoke-youtube-rewrite-unit] PASS');
