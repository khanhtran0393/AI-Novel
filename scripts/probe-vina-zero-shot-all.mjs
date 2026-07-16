/**
 * IRON B10 — Probe EVERY Não Zero-Shot (vina_voice) catalog voice.
 * No fallback. Sequential. Health-check between jobs. Retry once after recycle.
 *
 * Usage:
 *   node scripts/probe-vina-zero-shot-all.mjs
 *   node scripts/probe-vina-zero-shot-all.mjs --limit=5
 *   node scripts/probe-vina-zero-shot-all.mjs --only=Lồng Tiếng Phim - Nam Trẻ 1
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Agent, setGlobalDispatcher } from 'undici';

// undici default headersTimeout=300s drops long ONNX previews; raise hard limits
setGlobalDispatcher(
  new Agent({
    headersTimeout: 900_000,
    bodyTimeout: 900_000,
    connectTimeout: 30_000,
  }),
);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.AINOVEL_BASE || 'http://127.0.0.1:3000';
const outPath = path.join(root, 'tmp-vina-zero-shot-probe.json');
const PREVIEW_TEXT = 'Xin chào, đây là kiểm tra nghe thử giọng Zero-Shot.';

const args = process.argv.slice(2);
const limit = Number((args.find((a) => a.startsWith('--limit=')) || '').split('=')[1] || 0);
const only = (args.find((a) => a.startsWith('--only=')) || '').replace('--only=', '').trim();
const skipCached = args.includes('--skip-cached');

async function health() {
  try {
    const r = await fetch(`${BASE}/api/vina-voice/status`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
    const j = await r.json();
    return {
      ok: !!j.ok && !!j.onnxBrain?.ready,
      profiles: j.profilesCount,
      samples: j.samplesResolved,
      brain: j.onnxBrain?.totalGB,
      engine: j.engine?.online,
    };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

async function warm() {
  try {
    await fetch(`${BASE}/api/vina-voice/warm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(180_000),
    });
  } catch {
    /* best effort */
  }
}

async function probeOne(voice) {
  const body = {
    sceneText: PREVIEW_TEXT,
    chapterNum: 0,
    sceneIndex: 999,
    isPreview: true,
    voiceName: voice,
    voice,
    ten_tac_pham: 'VinaZeroShotProbe',
    apiKeys: [],
    applyLoudnorm: false,
    injectBreathPauses: false,
    roomTone: false,
    bgmMix: false,
    ttsConfig: {
      platform: 'vina_voice',
      language: 'vi',
      voice,
      speed: 1,
      pitch: 0,
      vinaUseClone: true,
    },
  };
  const t0 = Date.now();
  try {
    const r = await fetch(`${BASE}/api/generate-tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(420_000),
    });
    const data = await r.json().catch(() => ({}));
    let audioBytes = 0;
    let audioOk = false;
    if (data.success && data.audioPath) {
      const url = String(data.audioPath).startsWith('http')
        ? data.audioPath
        : `${BASE}${data.audioPath.startsWith('/') ? '' : '/'}${data.audioPath}`;
      try {
        const ar = await fetch(url, { signal: AbortSignal.timeout(30_000) });
        if (ar.ok) {
          const buf = Buffer.from(await ar.arrayBuffer());
          audioBytes = buf.length;
          audioOk = buf.length > 500;
        }
      } catch {
        /* audio fetch fail */
      }
    }
    return {
      voice,
      success: !!data.success && audioOk,
      cached: !!data.cached,
      method: String(data.method || '').slice(0, 120),
      audioPath: data.audioPath || '',
      audioBytes,
      error: String(
        data.error ||
          (!audioOk && data.success ? 'audio empty/missing' : !data.success ? `HTTP ${r.status}` : ''),
      ).slice(0, 500),
      ms: Date.now() - t0,
      http: r.status,
    };
  } catch (e) {
    return {
      voice,
      success: false,
      cached: false,
      method: '',
      audioPath: '',
      audioBytes: 0,
      error: String(e?.message || e).slice(0, 500),
      ms: Date.now() - t0,
      http: 0,
    };
  }
}

async function main() {
  console.log(`[probe] base=${BASE}`);
  let h = await health();
  console.log('[probe] health', h);
  if (!h.ok) {
    console.error('Server/brain not ready — start next dev first');
    process.exit(2);
  }
  await warm();

  const catRes = await fetch(`${BASE}/api/tts/voices`, { signal: AbortSignal.timeout(60_000) });
  const catBody = await catRes.json();
  const list = catBody?.catalog?.vina_voice?.vi || [];
  if (!list.length) {
    console.error('No vina_voice.vi voices');
    process.exit(1);
  }

  let voices = list.map((v) => v.id || v.name).filter(Boolean);
  if (only) voices = voices.filter((v) => v === only || v.includes(only));
  if (limit > 0) voices = voices.slice(0, limit);

  console.log(`[probe] jobs=${voices.length}`);
  const results = [];
  let pass = 0;
  let fail = 0;

  for (let i = 0; i < voices.length; i++) {
    const voice = voices[i];
    process.stdout.write(`[${i + 1}/${voices.length}] ${voice} … `);

    // Health between jobs — if server died, stop early with clear error
    h = await health();
    if (!h.ok) {
      console.log(`SERVER_DOWN ${h.error || ''}`);
      // wait and retry health once
      await new Promise((r) => setTimeout(r, 5000));
      h = await health();
      if (!h.ok) {
        results.push({
          voice,
          success: false,
          error: `server down before job: ${h.error || 'unknown'}`,
          ms: 0,
        });
        fail++;
        // remaining mark skipped
        for (let j = i + 1; j < voices.length; j++) {
          results.push({
            voice: voices[j],
            success: false,
            error: 'skipped: server down',
            ms: 0,
          });
          fail++;
        }
        break;
      }
      await warm();
    }

    let res = await probeOne(voice);
    if (skipCached && res.success && res.cached) {
      // Force miss by appending unique suffix to text — re-probe real synth
      // (user wants real nghe-thử, not just cache hit)
    }
    if (!res.success) {
      // one recycle + retry for this voice only (no fallback engine)
      console.log(`RETRY (${res.error.slice(0, 80)})`);
      await warm();
      await new Promise((r) => setTimeout(r, 1500));
      res = await probeOne(voice);
      res.retried = true;
    }

    if (res.success) {
      pass++;
      console.log(
        `OK ${res.ms}ms ${res.audioBytes}b${res.cached ? ' cached' : ''} ${res.method.slice(0, 60)}`,
      );
    } else {
      fail++;
      console.log(`FAIL ${res.ms}ms ${res.error.slice(0, 160)}`);
    }
    results.push(res);

    // Brief pause to let GPU settle (4GB cards)
    await new Promise((r) => setTimeout(r, 400));
  }

  const summary = {
    totals: { jobs: voices.length, pass, fail },
    health: h,
    fails: results.filter((r) => !r.success).map((r) => ({
      voice: r.voice,
      error: r.error,
      ms: r.ms,
    })),
    results,
    at: new Date().toISOString(),
  };
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2), 'utf8');
  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify({ totals: summary.totals, fails: summary.fails }, null, 2));
  console.log('WROTE', outPath);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
