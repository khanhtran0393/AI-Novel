/**
 * Empirical smoke: YouTube transcript error messages (WHAT · WHERE · FIX)
 * + success path when captions exist.
 *
 * Run: npx tsx scripts/smoke-youtube-transcript-errors.mts
 */
import {
  buildYoutubeTranscriptUserError,
  fetchYoutubeSource,
  summarizeYoutubeErrorForToast,
  type YoutubeTranscriptFailCode,
} from '../src/lib/youtubeSource.ts';
import {
  getFriendlyErrorMessage,
  summarizeSetupErrorForToast,
} from '../src/app/workspace/modules/setupModule.ts';
import { extractYoutubeVideoId } from '../src/lib/youtubeSourceId.ts';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const CODES: YoutubeTranscriptFailCode[] = [
  'INVALID_URL',
  'SCRIPT_MISSING',
  'PYTHON_NOT_FOUND',
  'PACKAGE_MISSING',
  'TIMEOUT',
  'NO_TRANSCRIPT',
  'TRANSCRIPTS_DISABLED',
  'VIDEO_UNAVAILABLE',
  'AGE_RESTRICTED',
  'IP_BLOCKED',
  'RATE_LIMITED',
  'EMPTY_TRANSCRIPT',
  'FETCH_FAILED',
  'NETWORK',
];

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
}

function hasSections(msg: string): boolean {
  return (
    msg.includes('Vì sao') &&
    msg.includes('Ở đâu') &&
    msg.includes('Cách khắc phục')
  );
}

async function runPython(videoId: string): Promise<{ code: number; json: Record<string, unknown> | null; raw: string }> {
  const script = path.join(process.cwd(), 'src', 'python_core', 'fetch_youtube_transcript.py');
  assert(fs.existsSync(script), `script missing: ${script}`);
  return new Promise((resolve) => {
    const child = spawn('python', [script, videoId, 'vi,en'], {
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    });
    const chunks: Buffer[] = [];
    child.stdout?.on('data', (d) => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(String(d))));
    child.stderr?.on('data', () => {});
    child.on('close', (code) => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      const line = raw.split(/\r?\n/).filter(Boolean).pop() || '';
      let json: Record<string, unknown> | null = null;
      try {
        json = JSON.parse(line) as Record<string, unknown>;
      } catch {
        json = null;
      }
      resolve({ code: code ?? 1, json, raw });
    });
    child.on('error', () => resolve({ code: 1, json: null, raw: '' }));
  });
}

async function main() {
  let failed = 0;
  const log = (ok: boolean, name: string, extra = '') => {
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
  };

  // 1) Every fail code builds full UX sections (user-first, no mid-message jargon dump)
  for (const code of CODES) {
    const msg = buildYoutubeTranscriptUserError({
      code,
      videoId: 'dQw4w9WgXcQ',
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      title: 'Smoke Title',
      playerCaptionTrackCount: code === 'NO_TRANSCRIPT' ? 0 : 1,
      detail: 'smoke-detail',
    });
    const main = msg.split('Chi tiết kỹ thuật')[0] || msg;
    const ok =
      hasSections(msg) &&
      msg.includes('❌') &&
      msg.includes('smoke-detail') &&
      !msg.includes('Lỗi hệ thống AI') &&
      !main.includes('python_core') &&
      !main.includes('IRON B10') &&
      !main.includes('fetch_youtube_transcript.py');
    log(ok, `builder/${code}`);
  }

  // 2) Friendly wrapper must NOT double-wrap YouTube; must NOT misread rate-limit as Gemini quota
  {
    const yt = buildYoutubeTranscriptUserError({
      code: 'RATE_LIMITED',
      videoId: 'dQw4w9WgXcQ',
    });
    const friendly = getFriendlyErrorMessage(new Error(yt));
    log(friendly === yt, 'friendly/preserve_youtube_rate_limit');
    log(!friendly.includes('aistudio.google.com'), 'friendly/no_gemini_quota_on_yt_rate_limit');
    const toastLine = summarizeSetupErrorForToast(yt, 240);
    log(
      toastLine.length <= 240 &&
        toastLine.includes('•') &&
        !toastLine.includes('Chi tiết kỹ thuật'),
      'toast/summary_actionable',
      `len=${toastLine.length}`,
    );
    const toast2 = summarizeYoutubeErrorForToast(yt, 240);
    log(toast2.length <= 240 && toast2.length > 10, 'toast/server_summary_export');
  }
  {
    const gem = getFriendlyErrorMessage(new Error('429 Quota Exceeded from Gemini generativelanguage'));
    log(gem.includes('aistudio.google.com'), 'friendly/gemini_quota_still_works');
  }

  // 3) extract id
  log(extractYoutubeVideoId('https://youtu.be/dQw4w9WgXcQ') === 'dQw4w9WgXcQ', 'extract/youtu.be');
  log(extractYoutubeVideoId('not-a-url') === null, 'extract/invalid');

  // 4) invalid URL path
  {
    const r = await fetchYoutubeSource('not-a-url');
    log(
      r.ok === false &&
        r.errorCode === 'INVALID_URL' &&
        !!r.error &&
        hasSections(r.error),
      'fetch/invalid_url',
      r.errorCode,
    );
  }

  // 5) fake video → structured fail (not generic)
  {
    const r = await fetchYoutubeSource('https://www.youtube.com/watch?v=xxxxxxxxxxx');
    log(
      r.ok === false &&
        !!r.errorCode &&
        !!r.error &&
        hasSections(r.error) &&
        !r.error.includes('Lỗi hệ thống AI') &&
        !r.error.includes('Không fallback timedtext/mô tả. Bật captions'),
      'fetch/fake_video',
      `${r.errorCode}`,
    );
    if (r.error) {
      console.log('    sample:\n' + r.error.split('\n').slice(0, 8).map((l) => '    ' + l).join('\n'));
    }
  }

  // 6) Python direct on fake id
  {
    const py = await runPython('xxxxxxxxxxx');
    log(
      py.json != null &&
        py.json.ok === false &&
        typeof py.json.code === 'string' &&
        typeof py.json.error === 'string',
      'python/fake_video_json',
      String(py.json?.code || 'no-code'),
    );
  }

  // 7) Success path — public video with captions (Rickroll has many langs)
  {
    const r = await fetchYoutubeSource('https://www.youtube.com/watch?v=dQw4w9WgXcQ', {
      preferredLangs: ['en', 'vi'],
    });
    if (r.ok) {
      log(
        (r.transcript || '').length >= 20 &&
          (r.wordCount || 0) > 0 &&
          r.source === 'python_captions',
        'fetch/success_public_captions',
        `words=${r.wordCount} lang=${r.language || '?'}`,
      );
    } else {
      // Network/YouTube block in CI still OK if error is structured
      const structured = !!r.error && hasSections(r.error) && !!r.errorCode;
      log(structured, 'fetch/success_or_structured_fail', `${r.errorCode}`);
      if (!structured) failed++;
      console.log('    (network may block; structured fail still acceptable)');
    }
  }

  // 8) Python success same video
  {
    const py = await runPython('dQw4w9WgXcQ');
    if (py.json?.ok) {
      const t = String(py.json.transcript || '');
      log(t.length >= 20, 'python/success_public', `chars=${t.length}`);
    } else {
      log(
        py.json != null && typeof py.json.code === 'string',
        'python/success_or_coded_fail',
        String(py.json?.code || 'null'),
      );
    }
  }

  console.log('');
  console.log(failed === 0 ? 'SMOKE_OK youtube-transcript-errors' : `SMOKE_FAIL count=${failed}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
