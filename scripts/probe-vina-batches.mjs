/**
 * Não Zero-Shot — probe theo CỤM 5 giọng, resume, không fallback platform.
 * Chạy trong CMD riêng (không qua agent timeout).
 *
 *   node scripts/probe-vina-batches.mjs
 *   node scripts/probe-vina-batches.mjs --batch-size=5
 *   node scripts/probe-vina-batches.mjs --force
 *   node scripts/probe-vina-batches.mjs --only-fails
 *
 * Progress: scratch/vina-batch-progress.json
 * Log:      scratch/vina-batch-probe.log
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { Agent, setGlobalDispatcher } from 'undici';

setGlobalDispatcher(
  new Agent({
    // Keep under HARD_MS so undici doesn't outlive Promise.race
    headersTimeout: 200_000,
    bodyTimeout: 200_000,
    connectTimeout: 30_000,
  }),
);

const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.AINOVEL_BASE || 'http://127.0.0.1:3000';
const PROGRESS = path.join(cwd, 'scratch', 'vina-batch-progress.json');
const LOG = path.join(cwd, 'scratch', 'vina-batch-probe.log');

const args = process.argv.slice(2);
const batchSize = Math.max(
  1,
  Number((args.find((a) => a.startsWith('--batch-size=')) || '').split('=')[1] || 5),
);
const force = args.includes('--force');
const onlyFails = args.includes('--only-fails');
const maxRetries = Number(
  (args.find((a) => a.startsWith('--retries=')) || '').split('=')[1] || 1,
);
const PREVIEW_TEXT = 'Xin chào, đây là kiểm tra nghe thử giọng Zero-Shot.';

function log(...parts) {
  const line = `[${new Date().toISOString()}] ${parts.join(' ')}`;
  console.log(line);
  try {
    fs.mkdirSync(path.dirname(LOG), { recursive: true });
    fs.appendFileSync(LOG, line + '\n', 'utf8');
  } catch {
    /* ignore */
  }
}

function loadProgress() {
  try {
    if (fs.existsSync(PROGRESS)) {
      return JSON.parse(fs.readFileSync(PROGRESS, 'utf8'));
    }
  } catch {
    /* ignore */
  }
  return { pass: {}, fail: {}, batches: [], at: null };
}

function saveProgress(p) {
  fs.mkdirSync(path.dirname(PROGRESS), { recursive: true });
  p.at = new Date().toISOString();
  // atomic-ish write
  const tmp = PROGRESS + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(p, null, 2), 'utf8');
  fs.renameSync(tmp, PROGRESS);
}

async function waitServer(maxMs = 120_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    try {
      const r = await fetch(`${BASE}/api/vina-voice/status`, {
        signal: AbortSignal.timeout(8_000),
      });
      if (r.ok) {
        const j = await r.json();
        if (j.ok && j.onnxBrain?.ready) return j;
      }
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error('Server/brain not ready at ' + BASE);
}

async function warm() {
  try {
    const r = await fetch(`${BASE}/api/vina-voice/warm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(300_000),
    });
    const t = await r.text();
    log('warm', t.slice(0, 200));
  } catch (e) {
    log('warm warn', String(e?.message || e).slice(0, 120));
  }
}

/** Hard kill hung vina python (AbortSignal alone can hang forever on stuck ORT). */
function killHungVinaPython() {
  try {
    if (process.platform === 'win32') {
      execSync(
        `powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'vina_voice_server|vina_voice_infer' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"`,
        { stdio: 'ignore', timeout: 12_000, windowsHide: true },
      );
    }
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
    ten_tac_pham: 'VinaBatch5',
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
  // 180s hard ceiling — CPU preview normally 20–50s; hang = kill daemon & fail voice
  const HARD_MS = Number(process.env.VINA_PROBE_HARD_MS) || 180_000;
  const ac = new AbortController();
  const hardTimer = setTimeout(() => {
    try {
      ac.abort();
    } catch {
      /* ignore */
    }
  }, HARD_MS);

  const work = (async () => {
    const res = await fetch(`${BASE}/api/generate-tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    const data = await res.json().catch(() => ({}));
    let bytes = 0;
    if (data.success && data.audioPath) {
      const url = String(data.audioPath).startsWith('http')
        ? data.audioPath
        : `${BASE}${data.audioPath.startsWith('/') ? '' : '/'}${data.audioPath}`;
      const ar = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (ar.ok) bytes = Buffer.from(await ar.arrayBuffer()).length;
    }
    const ok = !!data.success && bytes > 500;
    return {
      ok,
      ms: Date.now() - t0,
      cached: !!data.cached,
      bytes,
      method: String(data.method || '').slice(0, 120),
      error: String(
        data.error ||
          (!ok && data.success
            ? 'audio empty/small'
            : !data.success
              ? `HTTP ${res.status}`
              : ''),
      ).slice(0, 400),
      audioPath: data.audioPath || '',
    };
  })();

  try {
    return await Promise.race([
      work,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`HARD_TIMEOUT ${HARD_MS}ms`)), HARD_MS + 2000),
      ),
    ]);
  } catch (e) {
    const msg = String(e?.message || e);
    if (/HARD_TIMEOUT|aborted|AbortError/i.test(msg)) {
      log(`  HARD timeout on «${voice}» — kill vina python, mark fail`);
      killHungVinaPython();
    }
    return {
      ok: false,
      ms: Date.now() - t0,
      cached: false,
      bytes: 0,
      method: '',
      error: msg.slice(0, 400),
      audioPath: '',
    };
  } finally {
    clearTimeout(hardTimer);
  }
}

async function probeWithRetry(voice) {
  let last = null;
  for (let a = 0; a <= maxRetries; a++) {
    try {
      const r = await probeOne(voice);
      if (r.ok) return r;
      last = r;
      if (a < maxRetries) {
        log(`  retry ${a + 1}/${maxRetries} after: ${r.error.slice(0, 80)}`);
        await warm();
        await new Promise((x) => setTimeout(x, 2000 * (a + 1)));
      }
    } catch (e) {
      last = {
        ok: false,
        ms: 0,
        cached: false,
        bytes: 0,
        method: '',
        error: String(e?.message || e).slice(0, 400),
        audioPath: '',
      };
      if (a < maxRetries) {
        log(`  retry ${a + 1}/${maxRetries} after throw: ${last.error.slice(0, 80)}`);
        await new Promise((x) => setTimeout(x, 2000 * (a + 1)));
      }
    }
  }
  return last;
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function main() {
  process.env.VINA_PROVIDER = process.env.VINA_PROVIDER || 'cpu';
  process.env.VINA_FORCE_CPU = process.env.VINA_FORCE_CPU || '1';

  log('=== START batch-size=', batchSize, 'base=', BASE, 'force=', force, 'onlyFails=', onlyFails);
  const st = await waitServer();
  log(
    'server ok profiles=',
    st.profilesCount,
    'samples=',
    st.samplesResolved,
    'brainGB=',
    st.onnxBrain?.totalGB,
  );
  await warm();

  const cat = await (await fetch(`${BASE}/api/tts/voices`)).json();
  const all = (cat.catalog?.vina_voice?.vi || []).map((v) => v.id).filter(Boolean);
  if (!all.length) throw new Error('No vina_voice.vi catalog');

  let progress = force ? { pass: {}, fail: {}, batches: [] } : loadProgress();
  // merge: only-fails = retest fails first, skip solid passes
  let todo = all.filter((id) => {
    const k = `vina_voice::${id}`;
    if (onlyFails) return !!progress.fail[k];
    if (!force && progress.pass[k]?.bytes > 500) return false;
    return true;
  });

  // fails first
  const failsFirst = todo.filter((id) => progress.fail[`vina_voice::${id}`]);
  const rest = todo.filter((id) => !progress.fail[`vina_voice::${id}`]);
  todo = [...failsFirst, ...rest];

  const batches = chunk(todo, batchSize);
  log(
    `catalog=${all.length} todo=${todo.length} alreadyPass=${
      Object.keys(progress.pass).filter((k) => k.startsWith('vina_voice::')).length
    } batches=${batches.length}`,
  );

  let batchIdx = 0;
  for (const batch of batches) {
    batchIdx++;
    log(`\n======== BATCH ${batchIdx}/${batches.length} (${batch.length} voices) ========`);
    // health + warm each batch boundary (avoid timeout/hang cascade)
    try {
      await waitServer(60_000);
    } catch (e) {
      log('SERVER DOWN mid-run:', e.message);
      saveProgress(progress);
      process.exit(2);
    }
    await warm();

    const batchResult = { idx: batchIdx, voices: [], pass: 0, fail: 0, at: new Date().toISOString() };

    for (let i = 0; i < batch.length; i++) {
      const voice = batch[i];
      const k = `vina_voice::${voice}`;
      log(`[B${batchIdx} ${i + 1}/${batch.length}] ${voice}`);
      const r = await probeWithRetry(voice);
      if (r.ok) {
        progress.pass[k] = {
          platform: 'vina_voice',
          lang: 'vi',
          id: voice,
          ...r,
          at: new Date().toISOString(),
        };
        delete progress.fail[k];
        batchResult.pass++;
        log(
          `  OK ${r.ms}ms ${r.bytes}b${r.cached ? ' cached' : ''} ${String(r.method).slice(0, 50)}`,
        );
      } else {
        progress.fail[k] = {
          platform: 'vina_voice',
          lang: 'vi',
          id: voice,
          error: r.error,
          ms: r.ms,
          at: new Date().toISOString(),
        };
        batchResult.fail++;
        log(`  FAIL ${r.ms}ms ${r.error.slice(0, 160)}`);
      }
      batchResult.voices.push({ id: voice, ok: r.ok, bytes: r.bytes, ms: r.ms, error: r.error });
      saveProgress(progress);
      // brief settle between voices
      await new Promise((x) => setTimeout(x, 400));
    }

    progress.batches = progress.batches || [];
    progress.batches.push(batchResult);
    saveProgress(progress);

    const passN = Object.keys(progress.pass).filter((k) => k.startsWith('vina_voice::')).length;
    const failN = Object.keys(progress.fail).filter((k) => k.startsWith('vina_voice::')).length;
    log(`BATCH ${batchIdx} done: +${batchResult.pass}ok +${batchResult.fail}fail | total pass=${passN} fail=${failN}`);
    // pause between batches so GPU/CPU cools (avoid hang)
    await new Promise((x) => setTimeout(x, 1500));
  }

  const passN = Object.keys(progress.pass).filter((k) => k.startsWith('vina_voice::')).length;
  const failN = Object.keys(progress.fail).filter((k) => k.startsWith('vina_voice::')).length;
  const fails = Object.values(progress.fail).filter((v) => v.platform === 'vina_voice' || true);
  const summary = {
    totals: { catalog: all.length, pass: passN, fail: failN },
    fails: Object.entries(progress.fail)
      .filter(([k]) => k.startsWith('vina_voice::'))
      .map(([k, v]) => ({ voice: k.replace('vina_voice::', ''), error: v.error, ms: v.ms })),
    at: new Date().toISOString(),
  };
  fs.writeFileSync(
    path.join(cwd, 'tmp-vina-batch-summary.json'),
    JSON.stringify(summary, null, 2),
    'utf8',
  );
  log('\n=== DONE ===', JSON.stringify(summary.totals));
  if (summary.fails.length) {
    log('FAILS:');
    for (const f of summary.fails) log(' -', f.voice, '::', f.error.slice(0, 100));
  }
  process.exit(failN > 0 ? 1 : 0);
}

main().catch((e) => {
  log('FATAL', e?.stack || e);
  process.exit(1);
});
