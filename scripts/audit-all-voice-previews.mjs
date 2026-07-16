/**
 * IRON B10 — Audit EVERY catalog voice preview.
 * No platform/voice fallback. Failures reported per voice.
 *
 * Usage:
 *   node scripts/audit-all-voice-previews.mjs
 *   node scripts/audit-all-voice-previews.mjs --platform=edge_tts
 *   node scripts/audit-all-voice-previews.mjs --limit=5
 *   node scripts/audit-all-voice-previews.mjs --lang=vi
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const base = process.env.TTS_AUDIT_BASE || 'http://127.0.0.1:3000';
const outPath = path.join(root, 'tmp-all-voice-previews.json');

const args = process.argv.slice(2);
const onlyPlatform = (
  args.find((a) => a.startsWith('--platform=')) || ''
).split('=')[1];
const onlyLang = (args.find((a) => a.startsWith('--lang=')) || '').split(
  '=',
)[1];
const limit = Number(
  (args.find((a) => a.startsWith('--limit=')) || '').split('=')[1] || 0,
);

const PREVIEW_TEXT = 'Xin chào, đây là kiểm tra nghe thử giọng đọc.';

function loadApiKeys() {
  const keys = [];
  const envKeys = [
    process.env.GEMINI_API_KEY,
    process.env.OPENAI_API_KEY,
    process.env.GOOGLE_API_KEY,
  ].filter(Boolean);
  keys.push(...envKeys);
  for (const rel of ['apikey.txt', 'tmp-audit-keys.txt']) {
    try {
      const p = path.join(root, rel);
      if (!fs.existsSync(p)) continue;
      for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
        const k = line.trim();
        if (
          k.startsWith('AIza') ||
          k.startsWith('sk-') ||
          k.startsWith('gsk_') ||
          k.length > 20
        ) {
          keys.push(k);
        }
      }
    } catch {
      /* ignore */
    }
  }
  // Electron durable secrets (if present)
  try {
    const home = process.env.APPDATA || '';
    const sec = path.join(
      home,
      'ai-novel-script-generator',
      'store',
      'secrets.json',
    );
    if (fs.existsSync(sec)) {
      const j = JSON.parse(fs.readFileSync(sec, 'utf8'));
      for (const k of [j.apiKey, ...(j.apiKeys || []), ...(j.openaiApiKeys || [])]) {
        if (k && String(k).trim()) keys.push(String(k).trim());
      }
    }
  } catch {
    /* ignore */
  }
  return [...new Set(keys)];
}

async function tryPreview(platform, voice, apiKeys) {
  const bodyReq = {
    sceneText: PREVIEW_TEXT,
    chapterNum: 0,
    sceneIndex: 999,
    isPreview: true,
    voiceName: voice,
    voice,
    ttsConfig: {
      platform,
      language: onlyLang || 'vi',
      voice,
      speed: 1,
      pitch: 0,
    },
    apiKeys,
    ten_tac_pham: 'VoiceAuditAll',
    applyLoudnorm: false,
    injectBreathPauses: false,
    roomTone: false,
    bgmMix: false,
  };
  const t0 = Date.now();
  try {
    const r = await fetch(`${base}/api/generate-tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyReq),
    });
    const data = await r.json().catch(() => ({}));
    let audioBytes = 0;
    let audioOk = false;
    if (data.success && data.audioPath) {
      const url = String(data.audioPath).startsWith('http')
        ? data.audioPath
        : `${base}${data.audioPath.startsWith('/') ? '' : '/'}${data.audioPath}`;
      try {
        const ar = await fetch(url);
        if (ar.ok) {
          const buf = Buffer.from(await ar.arrayBuffer());
          audioBytes = buf.length;
          audioOk = buf.length > 500;
        }
      } catch {
        /* download fail */
      }
    }
    return {
      platform,
      voice,
      status: r.status,
      success: !!data.success && audioOk,
      apiSuccess: !!data.success,
      audioOk,
      audioBytes,
      cached: !!data.cached,
      method: String(data.method || '').slice(0, 80),
      audioPath: data.audioPath || '',
      error: String(data.error || (!audioOk && data.success ? 'audio empty/missing' : '')).slice(
        0,
        400,
      ),
      ms: Date.now() - t0,
    };
  } catch (e) {
    return {
      platform,
      voice,
      success: false,
      apiSuccess: false,
      audioOk: false,
      audioBytes: 0,
      error: String(e?.message || e).slice(0, 400),
      ms: Date.now() - t0,
    };
  }
}

async function main() {
  const apiKeys = loadApiKeys();
  console.log(`[audit] base=${base} keys=${apiKeys.length}`);

  const res = await fetch(`${base}/api/tts/voices`, { cache: 'no-store' });
  const body = await res.json().catch(() => ({}));
  const cat = body.catalog || body;
  if (!cat || typeof cat !== 'object') {
    console.error('No catalog', res.status, body);
    process.exit(1);
  }

  /** @type {Array<{platform:string, lang:string, id:string, name:string}>} */
  const jobs = [];
  for (const [platform, langs] of Object.entries(cat)) {
    if (onlyPlatform && platform !== onlyPlatform) continue;
    if (!langs || typeof langs !== 'object') continue;
    for (const [lang, list] of Object.entries(langs)) {
      if (onlyLang && lang !== onlyLang) continue;
      if (!Array.isArray(list)) continue;
      for (const v of list) {
        const id = String(v?.id || '').trim();
        if (!id) continue;
        jobs.push({
          platform,
          lang,
          id,
          name: String(v?.name || id),
        });
      }
    }
  }

  // de-dupe platform+id
  const seen = new Set();
  const unique = jobs.filter((j) => {
    const k = `${j.platform}::${j.id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const work = limit > 0 ? unique.slice(0, limit) : unique;
  console.log(`[audit] jobs=${work.length} (from ${unique.length} unique)`);

  const results = [];
  let pass = 0;
  let fail = 0;
  for (let i = 0; i < work.length; i++) {
    const j = work[i];
    process.stdout.write(
      `[${i + 1}/${work.length}] ${j.platform} / ${j.lang} / ${j.id} … `,
    );
    const r = await tryPreview(j.platform, j.id, apiKeys);
    r.lang = j.lang;
    r.name = j.name;
    results.push(r);
    if (r.success) {
      pass++;
      console.log(`OK ${r.ms}ms ${r.audioBytes}b${r.cached ? ' cached' : ''}`);
    } else {
      fail++;
      console.log(`FAIL ${r.ms}ms ${r.error || r.status}`);
    }
  }

  const byPlatform = {};
  for (const r of results) {
    if (!byPlatform[r.platform]) {
      byPlatform[r.platform] = { pass: 0, fail: 0, fails: [] };
    }
    if (r.success) byPlatform[r.platform].pass++;
    else {
      byPlatform[r.platform].fail++;
      byPlatform[r.platform].fails.push({
        voice: r.voice,
        lang: r.lang,
        error: r.error,
        status: r.status,
      });
    }
  }

  const report = {
    base,
    at: new Date().toISOString(),
    totals: { jobs: work.length, pass, fail },
    byPlatform,
    results,
  };
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify({ totals: report.totals, byPlatform }, null, 2));
  console.log('WROTE', outPath);
  process.exit(fail > 0 ? 2 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
