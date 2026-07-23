/**
 * Offline unit checks for YouTube rewrite (no network).
 *   npx tsx scripts/smoke-youtube-rewrite-unit.mts
 */
import assert from 'assert';
import {
  buildYoutubeTranscriptUserError,
  extractYoutubeVideoId,
  summarizeYoutubeErrorForToast,
} from '../src/lib/youtubeSource.ts';

// —— IDs ——
assert.equal(
  extractYoutubeVideoId('https://www.youtube.com/watch?v=jNQXAC9IVRw'),
  'jNQXAC9IVRw',
);
assert.equal(extractYoutubeVideoId('https://youtu.be/jNQXAC9IVRw'), 'jNQXAC9IVRw');
assert.equal(
  extractYoutubeVideoId('https://www.youtube.com/shorts/jNQXAC9IVRw'),
  'jNQXAC9IVRw',
);
assert.equal(extractYoutubeVideoId('not-a-url'), null);

// —— User error builder (no corrupt template strings) ——
const full = buildYoutubeTranscriptUserError({
  code: 'RATE_LIMITED',
  videoId: 'jNQXAC9IVRw',
  url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
  title: 'Me at the zoo',
  channel: 'jawed',
  detail: 'HTTP 429',
  playerCaptionTrackCount: 2,
});
assert.ok(full.includes('Không lấy được phụ đề'), 'title line');
assert.ok(full.includes('🔎 Vì sao:'), 'why line');
assert.ok(full.includes('Me at the zoo'), 'title in where');
assert.ok(full.includes('✅ Cách khắc phục:'), 'fix section');
assert.ok(full.includes('code=RATE_LIMITED'), 'tech code');
assert.ok(full.includes('videoId=jNQXAC9IVRw'), 'full videoId tech bit');
assert.ok(!full.includes('\\videoId'), 'no broken escapes');
// Guard against old corruption that produced bare "\videoId=" or "\ideoId="
assert.ok(!/\\videoId=|[^v]ideoId=/.test(full), 'no truncated videoId artifact');

const toast = summarizeYoutubeErrorForToast(full, 200);
assert.ok(toast.length > 10 && toast.length <= 200, `toast len=${toast.length}`);
assert.ok(!toast.includes('python_core'), 'toast not dump paths');

const noKeyGate = (hasKey: boolean, moTa: string, ytUrl: string) => {
  if (!hasKey) return 'NO_KEY';
  const ytMode = !!ytUrl;
  if (ytMode && !moTa.trim()) return 'NEED_PHAN_TICH';
  if (!moTa.trim()) return 'NEED_MO_TA';
  return null;
};
assert.equal(
  noKeyGate(true, 'Plot đủ dài để sinh kịch bản YouTube rewrite path.', 'https://youtu.be/x'),
  null,
);
assert.equal(noKeyGate(false, 'plot', 'https://youtu.be/x'), 'NO_KEY');
assert.equal(noKeyGate(true, '', 'https://youtu.be/x'), 'NEED_PHAN_TICH');

console.log(
  JSON.stringify(
    {
      ok: true,
      toastSample: toast.slice(0, 120),
      errorLen: full.length,
    },
    null,
    2,
  ),
);
console.log('[smoke-youtube-rewrite-unit] PASS');
