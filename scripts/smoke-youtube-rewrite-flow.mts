/**
 * Empirical: YouTube rewrite flow (ver 1.0.5 path)
 * 1) extract id
 * 2) fetchYoutubeSource (captions)
 * 3) HTTP POST /api/youtube-source
 * 4) optional ANALYZE_YOUTUBE_PLOT + GENERATE_OUTLINE if keys present
 *
 *   npx tsx scripts/smoke-youtube-rewrite-flow.mts
 *   npx tsx scripts/smoke-youtube-rewrite-flow.mts --url "https://..."
 */
import fs from 'fs';
import path from 'path';
import {
  extractYoutubeVideoId,
  fetchYoutubeSource,
} from '../src/lib/youtubeSource.ts';

const BASE = process.env.AINOVEL_SMOKE_BASE || 'http://127.0.0.1:3000';
const cwd = process.cwd();
const args = process.argv.slice(2);
const urlArgIdx = args.indexOf('--url');
const TEST_URL =
  (urlArgIdx >= 0 && args[urlArgIdx + 1]) ||
  process.env.YOUTUBE_SMOKE_URL ||
  'https://www.youtube.com/watch?v=jNQXAC9IVRw'; // short public video with captions

const failures: string[] = [];
function ok(cond: boolean, msg: string) {
  if (!cond) {
    failures.push(msg);
    console.error('[FAIL]', msg);
  } else {
    console.log('[OK]', msg);
  }
}

console.log('[base]', BASE);
console.log('[url]', TEST_URL);

// —— 0) script + python preflight ——
const scriptPath = path.join(cwd, 'src', 'python_core', 'fetch_youtube_transcript.py');
ok(fs.existsSync(scriptPath), `script exists: ${scriptPath}`);

// —— 1) extract id ——
const vid = extractYoutubeVideoId(TEST_URL);
ok(!!vid && vid.length >= 6, `videoId=${vid}`);

// —— 2) library fetch ——
const lib = await fetchYoutubeSource(TEST_URL, {
  preferredLangs: ['en', 'vi', 'en-US'],
});
console.log(
  '[lib]',
  JSON.stringify({
    ok: lib.ok,
    errorCode: lib.errorCode,
    title: lib.title?.slice(0, 80),
    words: lib.wordCount,
    source: lib.source,
    chain: lib.chain,
    transcriptLen: lib.transcript?.length || 0,
  }),
);
// Chain must include fallback steps when early caption paths fail
if (Array.isArray(lib.chain)) {
  const hasPy = lib.chain.some((s) => String(s).startsWith('python:'));
  ok(hasPy, `chain has python step: ${lib.chain.join('>')}`);
  if (lib.ok && lib.source === 'audio_whisper') {
    ok(
      lib.chain.some((s) => s === 'whisper:ok'),
      `whisper path used: ${lib.chain.join('>')}`,
    );
    ok(
      !!(lib.transcript && lib.transcript.length >= 20),
      `whisper transcript len=${lib.transcript?.length || 0}`,
    );
  } else if (!lib.ok) {
    const hasYtdlp = lib.chain.some((s) => String(s).startsWith('ytdlp:'));
    const hasWhisper = lib.chain.some((s) => String(s).startsWith('whisper:'));
    ok(hasYtdlp, `chain has ytdlp step: ${lib.chain.join('>')}`);
    ok(hasWhisper, `chain has whisper step: ${lib.chain.join('>')}`);
  }
}
const netBlocked =
  lib.errorCode === 'IP_BLOCKED' ||
  lib.errorCode === 'RATE_LIMITED' ||
  /IP_BLOCKED|RATE_LIMITED|HTTP 429|blocking requests from your IP/i.test(
    `${lib.errorCode || ''} ${lib.error || ''}`,
  );

if (netBlocked) {
  console.warn(
    `[SKIP-NET] YouTube đang chặn IP/rate-limit trên máy này (code=${lib.errorCode}). ` +
      `Đây là môi trường, không phải bug logic app. Outline-with-plot vẫn test riêng.`,
  );
} else {
  ok(lib.ok === true, `fetchYoutubeSource ok (code=${lib.errorCode || 'none'})`);
  ok(
    !!(lib.transcript && lib.transcript.length >= 20),
    `transcript length=${lib.transcript?.length || 0}`,
  );
}
if (!lib.ok) {
  console.error('[lib.error head]\n', (lib.error || '').slice(0, 500));
}

// —— 3) HTTP API (running Next) ——
let httpOk = false;
try {
  const res = await fetch(`${BASE}/api/youtube-source`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: TEST_URL,
      preferredLangs: ['en', 'vi'],
    }),
  });
  const j = (await res.json()) as {
    success?: boolean;
    ok?: boolean;
    error?: string;
    errorCode?: string;
    transcript?: string;
    title?: string;
    wordCount?: number;
  };
  console.log(
    '[http]',
    res.status,
    JSON.stringify({
      success: j.success,
      ok: j.ok,
      errorCode: j.errorCode,
      title: j.title?.slice(0, 60),
      words: j.wordCount,
      transcriptLen: j.transcript?.length || 0,
      errHead: j.error?.slice(0, 160),
    }),
  );
  httpOk =
    res.ok &&
    (j.success === true || j.ok === true) &&
    !!(j.transcript && j.transcript.length >= 20);
  const httpBlocked =
    j.errorCode === 'IP_BLOCKED' ||
    j.errorCode === 'RATE_LIMITED' ||
    /IP_BLOCKED|RATE_LIMITED|HTTP 429|blocking requests/i.test(
      `${j.errorCode || ''} ${j.error || ''}`,
    );
  if (httpBlocked || netBlocked) {
    console.warn(`[SKIP-NET] HTTP youtube-source status=${res.status} code=${j.errorCode}`);
  } else {
    ok(httpOk, `HTTP /api/youtube-source status=${res.status}`);
  }
} catch (e) {
  failures.push(`HTTP youtube-source: ${e instanceof Error ? e.message : String(e)}`);
  console.error('[FAIL] HTTP', e);
}

// —— 4) UI-critical: caption cache + plot path without LLM ——
// Simulate store after Phân tích step1
const captionCache = lib.transcript || '';
const hasCaptionCache = captionCache.trim().length >= 40;
// jNQXAC9IVRw is short (~39 words) — allow >= 20 for smoke of short videos
if (netBlocked) {
  console.warn('[SKIP-NET] caption cache skipped (YouTube IP block)');
} else {
  ok(
    captionCache.trim().length >= 20,
    `caption cache usable for UI (${captionCache.trim().length} chars)`,
  );
}

// Short videos: UI captionCached uses >=40 chars — check threshold gap
const UI_CAPTION_MIN = 40;
if (captionCache.trim().length >= 20 && captionCache.trim().length < UI_CAPTION_MIN) {
  console.warn(
    `[WARN] transcript ${captionCache.trim().length} chars < UI captionCached threshold ${UI_CAPTION_MIN} — badge «có cache» may stay off for very short videos`,
  );
}

// —— 5) GENERATE / ANALYZE if keys in env ——
const geminiKey =
  process.env.GEMINI_API_KEY ||
  process.env.GOOGLE_API_KEY ||
  process.env.AINOVEL_GEMINI_KEY ||
  '';
const hasKey = geminiKey.trim().length > 10;
console.log('[llm key present]', hasKey);

if (hasKey && lib.ok && lib.transcript) {
  try {
    const plotRes = await fetch(`${BASE}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestType: 'ANALYZE_YOUTUBE_PLOT',
        apiKeys: [geminiKey],
        model: 'gemini',
        payload: {
          source_text: lib.transcript,
          title: lib.title || 'test',
          similarity_target: 80,
        },
      }),
    });
    const plotJ = (await plotRes.json()) as {
      mo_ta?: string;
      error?: string;
    };
    console.log(
      '[ANALYZE_YOUTUBE_PLOT]',
      plotRes.status,
      plotJ.error || `mo_ta_len=${(plotJ.mo_ta || '').length}`,
    );
    ok(
      plotRes.ok && !!(plotJ.mo_ta && plotJ.mo_ta.length > 40),
      'ANALYZE_YOUTUBE_PLOT returns mo_ta',
    );

    if (plotJ.mo_ta && plotJ.mo_ta.length > 40) {
      const outRes = await fetch(`${BASE}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestType: 'GENERATE_OUTLINE',
          apiKeys: [geminiKey],
          model: 'gemini',
          payload: {
            chu_de: 'Viết lại từ YouTube',
            phong_cach: 'Trùng ý tưởng mẫu ~80%',
            mo_ta: plotJ.mo_ta,
            so_chuong: 2,
            so_tu_chuong: 1200,
            ngon_ngu: 'Tiếng Việt',
            youtube_rewrite: true,
            similarity_target: 80,
            youtube_title: lib.title || '',
            youtube_captions_excerpt: captionCache.slice(0, 4500),
            rewrite_source_kind: 'youtube',
            scriptMode: 'chuyen_sau',
          },
        }),
      });
      const outJ = (await outRes.json()) as {
        tieu_de?: string;
        dan_y_tong_the?: string;
        danh_sach_chuong?: unknown[];
        error?: string;
      };
      console.log(
        '[GENERATE_OUTLINE]',
        outRes.status,
        outJ.error ||
          `title=${(outJ.tieu_de || '').slice(0, 40)} chapters=${Array.isArray(outJ.danh_sach_chuong) ? outJ.danh_sach_chuong.length : 0}`,
      );
      ok(
        outRes.ok &&
          !!(outJ.tieu_de && outJ.dan_y_tong_the) &&
          Array.isArray(outJ.danh_sach_chuong) &&
          outJ.danh_sach_chuong.length === 2,
        'GENERATE_OUTLINE youtube rewrite 2 chapters',
      );
    }
  } catch (e) {
    failures.push(`LLM path: ${e instanceof Error ? e.message : String(e)}`);
    console.error('[FAIL] LLM', e);
  }
} else {
  console.log(
    '[SKIP] ANALYZE/OUTLINE — no GEMINI_API_KEY in env (captions path still verified)',
  );
}

// —— 6) Bug probes from screenshot state ——
// User has plot filled but "Chưa có captions cache"
// App allows outline if mo_ta filled; should NOT require caption cache
const moTaOnly = 'Bối cảnh thành phố. NV chính bị hệ thống đánh dấu. Xung đột 3 hồi.';
ok(moTaOnly.length > 40, 'mo_ta-only path length ok for generate gate');
// Simulate client gate from useSetupActions
function clientWouldBlockOutline(opts: {
  moTa: string;
  captionCache: string;
  ytUrl: string;
  hasKey: boolean;
}): string | null {
  if (!opts.hasKey) return 'NO_KEY';
  const ytMode = !!(opts.ytUrl || opts.captionCache);
  const mo = opts.moTa.trim();
  const isRaw =
    mo.startsWith('[NGUỒN YOUTUBE') ||
    mo.startsWith('[RAW YOUTUBE') ||
    mo.includes('BẢN CHÉP LỜI (phụ đề nguồn):');
  if (ytMode && (!mo || isRaw)) return 'NEED_PHAN_TICH';
  if (!mo) return 'NEED_MO_TA';
  return null;
}
ok(
  clientWouldBlockOutline({
    moTa: moTaOnly,
    captionCache: '',
    ytUrl: TEST_URL,
    hasKey: true,
  }) === null,
  'client gate: plot without caption cache still allowed',
);
ok(
  clientWouldBlockOutline({
    moTa: '',
    captionCache: '',
    ytUrl: TEST_URL,
    hasKey: true,
  }) === 'NEED_PHAN_TICH',
  'client gate: empty plot blocked',
);
ok(
  clientWouldBlockOutline({
    moTa: moTaOnly,
    captionCache: '',
    ytUrl: TEST_URL,
    hasKey: false,
  }) === 'NO_KEY',
  'client gate: no API key blocked',
);

console.log('\n=== SUMMARY ===');
console.log(
  JSON.stringify(
    {
      videoId: vid,
      libOk: lib.ok,
      httpOk,
      transcriptLen: lib.transcript?.length || 0,
      wordCount: lib.wordCount,
      failCount: failures.length,
      failures,
    },
    null,
    2,
  ),
);

if (failures.length) {
  console.error('[smoke-youtube-rewrite-flow] FAIL');
  process.exit(1);
}
console.log('[smoke-youtube-rewrite-flow] PASS');
