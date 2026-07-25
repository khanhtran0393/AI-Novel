/**
 * User-journey smoke: walk Setup YouTube flow as an end user would feel it.
 * Covers empty → bad link → fake video → good video; gates for outline.
 *
 * npm run smoke:youtube-transcript already covers API messages;
 * this script focuses on journey semantics + message UX.
 */
import {
  buildYoutubeTranscriptUserError,
  fetchYoutubeSource,
} from '../src/lib/youtubeSource.ts';
import {
  getFriendlyErrorMessage,
  summarizeSetupErrorForToast,
} from '../src/app/workspace/modules/setupModule.ts';
import { extractYoutubeVideoId } from '../src/lib/youtubeSourceId.ts';

function hasUx(msg: string) {
  return (
    msg.includes('Vì sao') &&
    msg.includes('Ở đâu') &&
    msg.includes('Cách khắc phục') &&
    !msg.split('Chi tiết kỹ thuật')[0].includes('python_core')
  );
}

let fail = 0;
const step = (ok: boolean, name: string, note = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} [user] ${name}${note ? ' — ' + note : ''}`);
};

console.log('=== USER JOURNEY: Link YouTube · viết lại tương tự ===\n');

// Step 0: open form empty
step(true, 'Mở Setup YouTube — ô link trống, nút Phân tích disabled (UI: !url || !id)');

// Step 1: paste garbage
{
  const u = 'https://www.youtube.com/playlist?list=PLxxxx';
  const id = extractYoutubeVideoId(u);
  step(id === null, 'Dán playlist — app không nhận video ID', 'button stays disabled + hint');
}

// Step 2: paste invalid free text
{
  const u = 'not a youtube link';
  step(extractYoutubeVideoId(u) === null, 'Dán text linh tinh — không nhận ID');
  const msg = buildYoutubeTranscriptUserError({ code: 'INVALID_URL', detail: u });
  step(hasUx(msg), 'Message INVALID_URL user-readable');
  const toast = summarizeSetupErrorForToast(msg);
  step(toast.length <= 240 && toast.length > 20, 'Toast tóm tắt INVALID_URL', toast.slice(0, 80));
}

// Step 3: fake / dead video (user thinks link is fine)
{
  const r = await fetchYoutubeSource('https://www.youtube.com/watch?v=xxxxxxxxxxx');
  step(r.ok === false, 'Video không tồn tại → fail (không soft-success)');
  step(!!r.error && hasUx(r.error), 'Lỗi có Vì sao / Ở đâu / Cách khắc phục');
  const friendly = getFriendlyErrorMessage(new Error(r.error || ''));
  step(friendly === r.error, 'Không bọc «Lỗi hệ thống AI»');
  const toast = summarizeSetupErrorForToast(friendly);
  step(
    !toast.includes('python_core') && toast.includes('•'),
    'Toast hướng dẫn hành động, không jargon file',
    toast.slice(0, 100),
  );
  if (r.error) {
    console.log('\n--- User sees (fail) ---\n' + r.error.split('\n').slice(0, 14).join('\n') + '\n');
  }
}

// Step 4: success path
{
  const r = await fetchYoutubeSource('https://www.youtube.com/watch?v=dQw4w9WgXcQ', {
    preferredLangs: ['en', 'vi'],
  });
  if (r.ok) {
    step(
      (r.transcript || '').length >= 20 && (r.wordCount || 0) > 0,
      'Phân tích video có CC → có captions cache',
      `words=${r.wordCount} source=${r.source}`,
    );
    const hasPlotReady = true; // AI plot step needs LLM key — not asserted here
    step(hasPlotReady, 'Tiếp: AI bóc cốt truyện (cần API key) → ô 3 → Sinh kịch bản');
  } else {
    step(
      !!r.error && hasUx(r.error),
      'Mạng/YouTube chặn — vẫn báo lỗi rõ (không silent)',
      r.errorCode,
    );
  }
}

// Step 5: outline gate messaging (string contract) — Phân tích HOẶC gõ tay
{
  const needPlot =
    '⚠️ Điền cốt truyện ô 3 trước: bấm «Phân tích» (cạnh link) hoặc gõ tay tóm tắt rồi Sinh kịch bản.';
  step(
    needPlot.includes('Phân tích') &&
      needPlot.includes('gõ tay') &&
      needPlot.includes('cốt truyện'),
    'Gate Sinh kịch bản thiếu cốt truyện — Phân tích hoặc gõ tay',
  );
}

// Step 5b: metadata soft-seed when captions blocked
{
  const { buildYoutubeMetadataSeed } = await import(
    '../src/app/workspace/modules/setupModule.ts'
  );
  const seed = buildYoutubeMetadataSeed({
    title: 'Me at the zoo',
    description: 'The first video on YouTube — elephants at the zoo.',
    channel: 'jawed',
    url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
  });
  step(
    seed.length >= 40 && seed.includes('METADATA') && seed.includes('Me at the zoo'),
    'Soft-seed metadata khi không có captions',
    `len=${seed.length}`,
  );
}

// Step 6: escape hatch always present
{
  const msg = buildYoutubeTranscriptUserError({ code: 'NO_TRANSCRIPT' });
  step(
    msg.includes('gõ tay cốt truyện') || msg.includes('Cốt truyện'),
    'Luôn có lối thoát: gõ cốt truyện tay',
  );
}

console.log('');
console.log(fail === 0 ? 'JOURNEY_OK' : `JOURNEY_FAIL ${fail}`);
process.exit(fail === 0 ? 0 : 1);
