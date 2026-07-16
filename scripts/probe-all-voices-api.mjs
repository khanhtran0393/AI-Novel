/**
 * Probe EVERY voice returned by /api/tts/voices via POST /api/generate-tts (isPreview).
 * NO fallback: each fail is attributed to that voice only.
 *
 * Usage:
 *   node scripts/probe-all-voices-api.mjs
 *   node scripts/probe-all-voices-api.mjs --platform=edge_tts
 *   node scripts/probe-all-voices-api.mjs --platform=gemini_tts,piper,edge_tts
 *   node scripts/probe-all-voices-api.mjs --limit=5
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.AINOVEL_BASE || 'http://127.0.0.1:3000';

// Load .env into process.env (simple)
const envPath = path.join(cwd, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    if (!process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const args = process.argv.slice(2);
const platformFilter = (args.find((a) => a.startsWith('--platform=')) || '')
  .replace('--platform=', '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const limit = (() => {
  const a = args.find((x) => x.startsWith('--limit='));
  return a ? Math.max(1, Number(a.split('=')[1]) || 0) : 0;
})();

function geminiKeys() {
  return [
    process.env.GEMINI_KEY_1,
    process.env.GEMINI_KEY_2,
    process.env.GEMINI_KEY_3,
    process.env.GEMINI_KEY_4,
    process.env.GEMINI_KEY_5,
    process.env.GEMINI_KEY_6,
    process.env.GEMINI_KEY_7,
    process.env.GEMINI_KEY_8,
    process.env.GEMINI_KEY_9,
    process.env.GEMINI_API_KEY,
  ].filter((k) => k && k.trim());
}

function openaiKeys() {
  return [
    process.env.OPENAI_API_KEY,
    process.env.OPENAI_KEY,
    process.env.OPENAI_KEY_1,
  ].filter((k) => k && k.trim());
}

async function loadCatalog() {
  const res = await fetch(`${BASE}/api/tts/voices`, {
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`voices API HTTP ${res.status}`);
  return res.json();
}

async function probeOne(platform, voiceId, lang) {
  const apiKeys =
    platform === 'gemini_tts'
      ? geminiKeys()
      : platform === 'openai_tts'
        ? openaiKeys()
        : platform === 'google'
          ? geminiKeys() // sometimes shared? no - google needs google key
          : [];

  const ttsConfig = {
    platform,
    voice: voiceId,
    language: lang || 'vi',
    speed: 1,
    pitch: 0,
    vinaUseClone: platform === 'vina_voice',
  };

  const body = {
    sceneText: 'Xin chào. Hello voice test.',
    chapterNum: 0,
    sceneIndex: 999,
    isPreview: true,
    voiceName: voiceId,
    voice: voiceId,
    apiKeys,
    ten_tac_pham: 'VoiceAudit',
    ttsConfig,
    applyLoudnorm: false,
    injectBreathPauses: false,
    roomTone: false,
    bgmMix: false,
  };

  const res = await fetch(`${BASE}/api/generate-tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(
      platform === 'vina_voice' || platform === 'omnivoice_local'
        ? 300_000
        : 120_000,
    ),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.success || !data?.audioPath) {
    throw new Error(data?.error || `HTTP ${res.status}`);
  }
  // verify audio fetchable
  const audioUrl = String(data.audioPath).startsWith('/')
    ? `${BASE}${data.audioPath}`
    : String(data.audioPath).startsWith('http')
      ? data.audioPath
      : `${BASE}/${data.audioPath}`;
  const ar = await fetch(audioUrl, { signal: AbortSignal.timeout(30_000) });
  if (!ar.ok) throw new Error(`audio fetch ${ar.status} ${audioUrl}`);
  const buf = Buffer.from(await ar.arrayBuffer());
  if (buf.length < 200) throw new Error(`audio too small ${buf.length}B`);
  return { bytes: buf.length, method: data.method || '', cached: !!data.cached };
}

// Platforms that require external deps — still probe; fail = report (no fallback)
const SKIP_WITHOUT_CREDS = new Set([
  // still try if keys present
]);

async function main() {
  console.log(`Base ${BASE}`);
  console.log(`Gemini keys: ${geminiKeys().length} · OpenAI keys: ${openaiKeys().length}`);

  const cat = await loadCatalog();
  const catalog = cat.catalog || cat.voices || cat;
  // API shape: { catalog: { platform: { lang: [{id,name}] } }, counts }
  const tree = cat.catalog || catalog;
  if (!tree || typeof tree !== 'object') {
    throw new Error('Unexpected /api/tts/voices shape: ' + Object.keys(cat).join(','));
  }

  const jobs = [];
  for (const [platform, langs] of Object.entries(tree)) {
    if (platformFilter.length && !platformFilter.includes(platform)) continue;
    for (const [lang, list] of Object.entries(langs || {})) {
      const arr = Array.isArray(list) ? list : [];
      const seen = new Set();
      for (const v of arr) {
        const id = String(v?.id || '').trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        jobs.push({ platform, lang, id, name: v.name || id });
      }
    }
  }

  // Dedupe platform+id
  const uniq = [];
  const uk = new Set();
  for (const j of jobs) {
    const k = `${j.platform}::${j.id}`;
    if (uk.has(k)) continue;
    uk.add(k);
    uniq.push(j);
  }

  let work = uniq;
  if (limit > 0) work = work.slice(0, limit);
  console.log(`Jobs: ${work.length} (from ${uniq.length} unique)\n`);

  const results = { pass: [], fail: [] };
  for (let i = 0; i < work.length; i++) {
    const j = work[i];
    const tag = `[${i + 1}/${work.length}] ${j.platform} · ${j.id}`;
    try {
      // skip credential platforms without keys
      if (j.platform === 'gemini_tts' && geminiKeys().length === 0) {
        throw new Error('no Gemini keys in .env');
      }
      if (j.platform === 'openai_tts' && openaiKeys().length === 0) {
        throw new Error('no OpenAI keys in .env');
      }
      if (
        ['tiktok_tts', 'capcut_tts', 'hotai_tts', 'vbee', 'elevenlabs', 'google'].includes(
          j.platform,
        )
      ) {
        // Still attempt — may hard-fail with clear message
      }
      const r = await probeOne(j.platform, j.id, j.lang);
      results.pass.push({ ...j, ...r });
      console.log(`OK   ${tag} (${r.bytes}B${r.cached ? ' cached' : ''})`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.fail.push({ ...j, error: msg.slice(0, 300) });
      console.log(`FAIL ${tag}: ${msg.slice(0, 160)}`);
    }
    // gentle spacing for rate limits
    await new Promise((r) => setTimeout(r, 200));
  }

  const outDir = path.join(cwd, 'scratch');
  fs.mkdirSync(outDir, { recursive: true });
  const report = {
    at: new Date().toISOString(),
    base: BASE,
    total: work.length,
    pass: results.pass.length,
    fail: results.fail.length,
    fails: results.fail,
  };
  const reportPath = path.join(outDir, 'all-voices-probe.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

  // Group fails by platform
  const byPlat = {};
  for (const f of results.fail) {
    byPlat[f.platform] = byPlat[f.platform] || [];
    byPlat[f.platform].push(f);
  }
  console.log('\n=== SUMMARY ===');
  console.log(`PASS ${results.pass.length} / FAIL ${results.fail.length}`);
  for (const [p, list] of Object.entries(byPlat)) {
    console.log(`  ${p}: ${list.length} fails`);
  }
  console.log(`Report: ${reportPath}`);
  process.exit(results.fail.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
