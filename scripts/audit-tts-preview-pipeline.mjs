/**
 * Empirical audit: TTS preview (Nghe thử) quality standard.
 * POST /api/generate-tts isPreview=true for each engine, probe file, quality gate.
 *
 * Usage: node scripts/audit-tts-preview-pipeline.mjs
 *        node scripts/audit-tts-preview-pipeline.mjs --base http://127.0.0.1:3000
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cwd = path.resolve(__dirname, '..');
const base = (
  process.argv.find((a) => a.startsWith('--base='))?.slice(7) ||
  'http://127.0.0.1:3000'
).replace(/\/$/, '');

const ffmpeg = [
  path.join(cwd, 'bin', 'ffmpeg.exe'),
  'ffmpeg',
].find((p) => p === 'ffmpeg' || fs.existsSync(p));

function probe(filePath) {
  if (!fs.existsSync(filePath)) return { ok: false, error: 'missing file' };
  const st = fs.statSync(filePath);
  if (st.size < 800) return { ok: false, error: `too small ${st.size}B`, bytes: st.size };
  const r = spawnSync(
    ffmpeg,
    ['-i', filePath, '-f', 'null', '-'],
    { encoding: 'utf8' },
  );
  const err = `${r.stderr || ''}${r.stdout || ''}`;
  const m = err.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  let duration = 0;
  if (m) {
    duration = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  }
  const audioLine = (err.match(/Audio:.+/i) || [])[0] || '';
  // silence-ish: very short
  if (duration > 0 && duration < 0.35) {
    return { ok: false, error: `duration ${duration}s < 0.35`, bytes: st.size, duration, audioLine };
  }
  if (!m && st.size < 2000) {
    return { ok: false, error: 'no duration / tiny', bytes: st.size, audioLine };
  }
  return { ok: true, bytes: st.size, duration, audioLine };
}

function firstVinaProfile() {
  const goc = path.join(cwd, 'data', 'vina-voices', 'profiles_goc.json');
  if (!fs.existsSync(goc)) return null;
  const j = JSON.parse(fs.readFileSync(goc, 'utf8'));
  const name = Object.keys(j)[0];
  if (!name) return null;
  const sample = path.join(cwd, 'data', 'vina-voices', 'samples', j[name].filename || '');
  return { name, hasSample: fs.existsSync(sample), sample };
}

async function previewOne(label, body) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${base}/api/generate-tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    const ms = Date.now() - t0;
    if (!res.ok || !data?.success || !data?.audioPath) {
      return {
        label,
        ok: false,
        status: res.status,
        ms,
        error: data?.error || `HTTP ${res.status}`,
      };
    }
    const rel = String(data.audioPath).split('?')[0].replace(/^\//, '');
    const abs = path.join(cwd, 'public', rel);
    // also try fetch URL
    let httpOk = false;
    let httpBytes = 0;
    try {
      const ar = await fetch(`${base}${data.audioPath.startsWith('/') ? '' : '/'}${String(data.audioPath).replace(/^\//, '/').replace(/^([^/])/, '/$1')}`.replace(/\/\/audio/, '/audio').replace(base + base, base));
      // simpler:
    } catch {
      /* ignore */
    }
    try {
      const url = data.audioPath.startsWith('http')
        ? data.audioPath
        : `${base}${data.audioPath.startsWith('/') ? '' : '/'}${data.audioPath}`;
      const ar = await fetch(url);
      httpOk = ar.ok;
      if (ar.ok) {
        const buf = Buffer.from(await ar.arrayBuffer());
        httpBytes = buf.length;
      }
    } catch (e) {
      httpOk = false;
    }
    const q = probe(abs);
    return {
      label,
      ok: Boolean(q.ok && httpOk && httpBytes >= 800),
      status: res.status,
      ms,
      cached: !!data.cached,
      method: String(data.method || '').slice(0, 80),
      audioPath: data.audioPath,
      durationApi: data.duration,
      file: q,
      httpOk,
      httpBytes,
      error: q.ok && httpOk ? undefined : q.error || (!httpOk ? 'HTTP audio fetch fail' : 'unknown'),
    };
  } catch (e) {
    return {
      label,
      ok: false,
      ms: Date.now() - t0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

const sceneText = 'Xin chào, đây là giọng đọc thử chuẩn chất lượng.';
const vina = firstVinaProfile();

const cases = [
  {
    label: 'edge_tts',
    body: {
      sceneText,
      chapterNum: 0,
      sceneIndex: 991,
      isPreview: true,
      voiceName: 'vi-VN-NamMinhNeural',
      ttsConfig: {
        platform: 'edge_tts',
        language: 'vi',
        voice: 'vi-VN-NamMinhNeural',
        speed: 1,
        pitch: 0,
      },
      apiKeys: [],
      applyLoudnorm: false,
      injectBreathPauses: false,
    },
  },
  {
    label: 'piper',
    body: {
      sceneText,
      chapterNum: 0,
      sceneIndex: 992,
      isPreview: true,
      voiceName: 'manhdung.onnx',
      ttsConfig: {
        platform: 'piper',
        language: 'vi',
        voice: 'manhdung.onnx',
        speed: 1,
        pitch: 0,
      },
      apiKeys: [],
      applyLoudnorm: false,
      injectBreathPauses: false,
    },
  },
];

if (vina?.hasSample) {
  cases.push({
    label: 'vina_voice',
    body: {
      sceneText,
      chapterNum: 0,
      sceneIndex: 993,
      isPreview: true,
      voiceName: vina.name,
      ttsConfig: {
        platform: 'vina_voice',
        language: 'vi',
        voice: vina.name,
        speed: 1,
        pitch: 0,
        vinaUseClone: true,
        vinaGender: 'female',
        vinaGroup: 'story',
        vinaEmotion: 'neutral',
        vinaSpeakerSeed: 2336,
        vinaStyleSeed: 4125,
      },
      apiKeys: [],
      applyLoudnorm: false,
      injectBreathPauses: false,
    },
  });
} else {
  console.warn('SKIP vina_voice — no sample for first profile');
}

console.log('=== TTS Preview Pipeline Audit ===');
console.log({ base, ffmpeg, vina: vina?.name, hasSample: vina?.hasSample });

const results = [];
for (const c of cases) {
  process.stdout.write(`→ ${c.label} … `);
  const r = await previewOne(c.label, c.body);
  results.push(r);
  console.log(r.ok ? `OK ${r.ms}ms ${r.httpBytes}B` : `FAIL ${r.error || r.status}`);
}

const pass = results.filter((r) => r.ok).length;
const fail = results.filter((r) => !r.ok).length;
console.log('\n=== SUMMARY ===');
console.log(JSON.stringify({ pass, fail, results }, null, 2));
process.exit(fail > 0 ? 1 : 0);
