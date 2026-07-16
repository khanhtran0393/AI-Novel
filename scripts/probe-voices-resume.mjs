/**
 * Resume-capable voice probe — retry each fail, no engine fallback.
 * Writes progress to scratch/voice-probe-progress.json
 *
 * node scripts/probe-voices-resume.mjs --platform=vina_voice
 * node scripts/probe-voices-resume.mjs --platform=edge_tts,gemini_tts,piper,vieneu_tts
 * node scripts/probe-voices-resume.mjs --platform=omnivoice_local --presets-only
 * node scripts/probe-voices-resume.mjs --platform=omnivoice_local --limit=50
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Agent, setGlobalDispatcher } from 'undici';

// undici default headersTimeout=300s kills long Zero-Shot CPU/CUDA previews
setGlobalDispatcher(
  new Agent({
    headersTimeout: 900_000,
    bodyTimeout: 900_000,
    connectTimeout: 30_000,
  }),
);

const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.AINOVEL_BASE || 'http://127.0.0.1:3000';
// v2 path — old progress file was repeatedly race-corrupted by overlapping probes
const PROGRESS = path.join(
  cwd,
  'scratch',
  process.env.VOICE_PROBE_PROGRESS || 'voice-probe-progress-v2.json',
);

// load .env
if (fs.existsSync(path.join(cwd, '.env'))) {
  for (const line of fs.readFileSync(path.join(cwd, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const args = process.argv.slice(2);
const platformFilter = (args.find((a) => a.startsWith('--platform=')) || '')
  .replace('--platform=', '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const limit = Number((args.find((a) => a.startsWith('--limit=')) || '').split('=')[1] || 0);
const presetsOnly = args.includes('--presets-only');
const force = args.includes('--force');
const maxRetries = Number((args.find((a) => a.startsWith('--retries=')) || '').split('=')[1] || 2);

const DESIGN_PRESETS = new Set([
  'alloy', 'ash', 'ballad', 'cedar', 'coral', 'echo', 'fable',
  'marin', 'nova', 'onyx', 'sage', 'shimmer', 'verse', 'auto',
]);

function geminiKeys() {
  return [1, 2, 3, 4, 5, 6, 7, 8, 9]
    .map((i) => process.env[`GEMINI_KEY_${i}`])
    .concat([process.env.GEMINI_API_KEY])
    .filter((k) => k && k.trim());
}

function progressSnapshotPaths() {
  return [
    PROGRESS.replace(/\.json$/, '.locked.json'),
    PROGRESS.replace(/\.json$/, '.safe.json'),
    PROGRESS.replace(/\.json$/, '.bak.json'),
    PROGRESS,
  ];
}

function mergePassFromDisk(p) {
  // locked first so golden baseline always wins over a shrunk main file
  for (const file of progressSnapshotPaths()) {
    try {
      if (!fs.existsSync(file)) continue;
      const disk = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (disk?.pass && typeof disk.pass === 'object') {
        p.pass = { ...disk.pass, ...(p.pass || {}) };
      }
      if (disk?.fail && typeof disk.fail === 'object') {
        const mergedFail = { ...disk.fail, ...(p.fail || {}) };
        for (const k of Object.keys(mergedFail)) {
          if (p.pass?.[k]) delete mergedFail[k];
        }
        p.fail = mergedFail;
      }
    } catch {
      /* skip corrupt snapshot */
    }
  }
  return p;
}

function loadProgress() {
  const p = { pass: {}, fail: {}, at: null };
  mergePassFromDisk(p);
  return p;
}

function saveProgress(p) {
  fs.mkdirSync(path.dirname(PROGRESS), { recursive: true });
  const safePath = PROGRESS.replace(/\.json$/, '.safe.json');
  const lockedPath = PROGRESS.replace(/\.json$/, '.locked.json');
  mergePassFromDisk(p);
  p.at = new Date().toISOString();
  const n = Object.keys(p.pass || {}).length;

  // Absolute floor: never write fewer than locked/safe if those are large
  for (const file of [lockedPath, safePath]) {
    try {
      if (!fs.existsSync(file)) continue;
      const snap = JSON.parse(fs.readFileSync(file, 'utf8'));
      const snapN = Object.keys(snap.pass || {}).length;
      if (snapN >= 200 && n < snapN) {
        console.error(`[probe] merge-up from ${path.basename(file)}: ${n} → ${snapN}`);
        p.pass = { ...snap.pass, ...(p.pass || {}) };
      }
    } catch {
      /* ignore */
    }
  }

  try {
    if (fs.existsSync(PROGRESS) && Object.keys(p.pass).length >= 200) {
      fs.copyFileSync(PROGRESS, PROGRESS.replace(/\.json$/, '.bak.json'));
    }
  } catch {
    /* ignore */
  }

  const payload = JSON.stringify(p, null, 2);
  const tmp = PROGRESS + '.tmp';
  fs.writeFileSync(tmp, payload, 'utf8');
  fs.renameSync(tmp, PROGRESS);

  const nowN = Object.keys(p.pass || {}).length;
  if (nowN >= 200) {
    try {
      let safeN = 0;
      if (fs.existsSync(safePath)) {
        safeN = Object.keys(JSON.parse(fs.readFileSync(safePath, 'utf8')).pass || {}).length;
      }
      if (nowN >= safeN) fs.writeFileSync(safePath, payload, 'utf8');
      let lockedN = 0;
      if (fs.existsSync(lockedPath)) {
        lockedN = Object.keys(JSON.parse(fs.readFileSync(lockedPath, 'utf8')).pass || {}).length;
      }
      if (nowN >= lockedN) fs.writeFileSync(lockedPath, payload, 'utf8');
    } catch {
      /* ignore */
    }
  }
  if (nowN < 200) {
    console.error(`[probe] WARN saved only ${nowN} pass entries — check locked/safe`);
  }
}

function keyOf(platform, id) {
  return `${platform}::${id}`;
}

async function loadJobs() {
  const res = await fetch(`${BASE}/api/tts/voices`, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`voices HTTP ${res.status}`);
  const cat = await res.json();
  const tree = cat.catalog || cat;
  const jobs = [];
  for (const [platform, langs] of Object.entries(tree)) {
    if (platformFilter.length && !platformFilter.includes(platform)) continue;
    for (const [lang, list] of Object.entries(langs || {})) {
      const seen = new Set();
      for (const v of list || []) {
        const id = String(v?.id || '').trim();
        if (!id || seen.has(id)) continue;
        if (presetsOnly && platform === 'omnivoice_local' && !DESIGN_PRESETS.has(id.toLowerCase())) {
          continue;
        }
        seen.add(id);
        jobs.push({ platform, lang, id, name: v.name || id });
      }
    }
  }
  // dedupe
  const uk = new Set();
  const out = [];
  for (const j of jobs) {
    const k = keyOf(j.platform, j.id);
    if (uk.has(k)) continue;
    uk.add(k);
    out.push(j);
  }
  return limit > 0 ? out.slice(0, limit) : out;
}

async function probeOne(platform, voiceId, lang) {
  const apiKeys =
    platform === 'gemini_tts'
      ? geminiKeys()
      : platform === 'openai_tts'
        ? [process.env.OPENAI_API_KEY, process.env.OPENAI_KEY].filter(Boolean)
        : [];

  const body = {
    sceneText: 'Xin chào. Hello voice test.',
    chapterNum: 0,
    sceneIndex: 999,
    isPreview: true,
    voiceName: voiceId,
    voice: voiceId,
    apiKeys,
    ten_tac_pham: 'VoiceAudit',
    ttsConfig: {
      platform,
      voice: voiceId,
      language: lang || 'vi',
      speed: 1,
      pitch: 0,
      vinaUseClone: platform === 'vina_voice',
    },
    applyLoudnorm: false,
    injectBreathPauses: false,
    roomTone: false,
    bgmMix: false,
  };

  // Omni clone ~20–90s; hard cap so one hung voice cannot stall the whole run
  const timeout =
    platform === 'vina_voice'
      ? 600_000
      : platform === 'omnivoice_local'
        ? 200_000
        : 120_000;

  async function postOnce() {
    // Double watchdog: AbortSignal + Promise.race (some hung TCP ignore abort until body)
    const ac = new AbortController();
    const killer = setTimeout(() => ac.abort(), timeout);
    try {
      const fetchP = fetch(`${BASE}/api/generate-tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      const raceP = new Promise((_, rej) => {
        setTimeout(
          () => rej(new Error(`hard-timeout ${timeout}ms ${platform}/${voiceId}`)),
          timeout + 5_000,
        );
      });
      return await Promise.race([fetchP, raceP]);
    } finally {
      clearTimeout(killer);
    }
  }

  let res;
  try {
    res = await postOnce();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Socket drop while Next still writes preview cache — wait + health + retry once
    if (!/fetch failed|ECONNRESET|aborted|timeout|AbortError/i.test(msg)) throw e;
    await new Promise((r) => setTimeout(r, 2000));
    for (let h = 0; h < 15; h++) {
      try {
        const hr = await fetch(`${BASE}/api/health/runtime`, {
          signal: AbortSignal.timeout(3000),
        });
        if (hr.ok) break;
      } catch {
        /* wait */
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    res = await postOnce();
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.success || !data?.audioPath) {
    throw new Error(data?.error || `HTTP ${res.status}`);
  }
  const audioUrl = String(data.audioPath).startsWith('http')
    ? data.audioPath
    : `${BASE}${data.audioPath.startsWith('/') ? '' : '/'}${data.audioPath}`;
  const ar = await fetch(audioUrl, { signal: AbortSignal.timeout(30_000) });
  if (!ar.ok) throw new Error(`audio HTTP ${ar.status}`);
  const buf = Buffer.from(await ar.arrayBuffer());
  if (buf.length < 200) throw new Error(`audio small ${buf.length}B`);
  return { bytes: buf.length, method: data.method || '', cached: !!data.cached };
}

async function probeWithRetry(job) {
  let last = '';
  for (let a = 0; a <= maxRetries; a++) {
    try {
      return await probeOne(job.platform, job.id, job.lang);
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
      // permanent credential / missing sample — don't retry forever
      // CODE_INFER is transient on 4GB (CUDA OOM) — retry allowed for vina_voice
      if (
        /chưa có|chua co|Session ID|API Key|not valid|leaked|khong ton tai|không tồn tại|missing sample|CODE_REF_MISSING|CODE_PROFILE_NOT_FOUND/i.test(
          last,
        )
      ) {
        throw e;
      }
      if (a < maxRetries) {
        const wait = job.platform === 'vina_voice' ? 3000 * (a + 1) : 1500 * (a + 1);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }
  throw new Error(last);
}

async function main() {
  console.log(`Base ${BASE}`);
  const jobs = await loadJobs();
  const progress = force ? { pass: {}, fail: {} } : loadProgress();

  let todo = jobs.filter((j) => {
    const k = keyOf(j.platform, j.id);
    if (!force && progress.pass[k]) return false;
    return true;
  });

  // Prefer re-testing previous fails first if not force
  const failsFirst = todo.filter((j) => progress.fail[keyOf(j.platform, j.id)]);
  const rest = todo.filter((j) => !progress.fail[keyOf(j.platform, j.id)]);
  todo = [...failsFirst, ...rest];

  console.log(
    `Jobs total=${jobs.length} todo=${todo.length} alreadyPass=${Object.keys(progress.pass).length}`,
  );

  let passN = 0;
  let failN = 0;
  for (let i = 0; i < todo.length; i++) {
    const j = todo[i];
    const k = keyOf(j.platform, j.id);
    const tag = `[${i + 1}/${todo.length}] ${j.platform} · ${j.id}`;
    process.stdout.write(`${tag} … `);
    try {
      if (j.platform === 'gemini_tts' && geminiKeys().length === 0) {
        throw new Error('no Gemini keys');
      }
      if (j.platform === 'openai_tts' && !process.env.OPENAI_API_KEY && !process.env.OPENAI_KEY) {
        throw new Error('no OpenAI keys');
      }
      const r = await probeWithRetry(j);
      progress.pass[k] = { ...j, ...r, at: new Date().toISOString() };
      delete progress.fail[k];
      passN++;
      console.log(`OK (${r.bytes}B${r.cached ? ' cached' : ''})`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      progress.fail[k] = { ...j, error: msg.slice(0, 400), at: new Date().toISOString() };
      failN++;
      console.log(`FAIL ${msg.slice(0, 160)}`);
    }
    // Save every voice — crash/OOM mid-run must not lose pass/fail evidence
    saveProgress(progress);
    // slight spacing so Omni server does not queue forever
    await new Promise((r) => setTimeout(r, j.platform === 'omnivoice_local' ? 800 : 300));
  }
  saveProgress(progress);

  const allPass = Object.keys(progress.pass).length;
  const allFail = Object.keys(progress.fail).length;
  console.log('\n=== SUMMARY ===');
  console.log(`this run: pass=${passN} fail=${failN}`);
  console.log(`progress: pass=${allPass} fail=${allFail}`);
  const byPlat = {};
  for (const [k, v] of Object.entries(progress.fail)) {
    byPlat[v.platform] = byPlat[v.platform] || [];
    byPlat[v.platform].push(v);
  }
  for (const [p, list] of Object.entries(byPlat)) {
    console.log(`  FAIL ${p}: ${list.length}`);
    for (const f of list.slice(0, 8)) console.log(`    - ${f.id}: ${(f.error || '').slice(0, 80)}`);
    if (list.length > 8) console.log(`    ... +${list.length - 8} more`);
  }
  console.log(`Progress file: ${PROGRESS}`);
  process.exit(allFail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
