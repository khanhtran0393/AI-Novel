/**
 * Process EXACTLY one batch of N remaining Zero-Shot voices, then exit.
 * Parent bat loops until todo=0 — avoids multi-hour hang in one process.
 *
 *   node scripts/probe-vina-one-batch.mjs --batch-size=5
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { Agent, setGlobalDispatcher, fetch as undiciFetch } from 'undici';

const HARD_MS = Number(process.env.VINA_PROBE_HARD_MS) || 150_000;

setGlobalDispatcher(
  new Agent({
    headersTimeout: HARD_MS + 5_000,
    bodyTimeout: HARD_MS + 5_000,
    connectTimeout: 20_000,
  }),
);

const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.AINOVEL_BASE || 'http://127.0.0.1:3000';
const PROGRESS = path.join(cwd, 'scratch', 'vina-batch-progress.json');
const LOG = path.join(cwd, 'scratch', 'vina-batch-probe.log');
const batchSize = Math.max(
  1,
  Number(
    (process.argv.find((a) => a.startsWith('--batch-size=')) || '').split('=')[1] || 5,
  ),
);
const PREVIEW = 'Xin chào, đây là kiểm tra nghe thử giọng Zero-Shot.';

function log(...a) {
  const line = `[${new Date().toISOString()}] ${a.join(' ')}`;
  console.log(line);
  fs.mkdirSync(path.dirname(LOG), { recursive: true });
  fs.appendFileSync(LOG, line + '\n');
}

function load() {
  try {
    return JSON.parse(fs.readFileSync(PROGRESS, 'utf8'));
  } catch {
    return { pass: {}, fail: {}, batches: [] };
  }
}

function save(p) {
  p.at = new Date().toISOString();
  const tmp = PROGRESS + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(p, null, 2));
  fs.renameSync(tmp, PROGRESS);
}

function killVinaPy() {
  try {
    if (process.platform === 'win32') {
      execSync(
        `powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'vina_voice_server|vina_voice_infer' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"`,
        { stdio: 'ignore', timeout: 10_000, windowsHide: true },
      );
    }
  } catch {
    /* ignore */
  }
}

function withHardTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      killVinaPy();
      reject(new Error(`HARD_TIMEOUT ${ms}ms ${label}`));
    }, ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

async function probe(voice) {
  const t0 = Date.now();
  const body = {
    sceneText: PREVIEW,
    chapterNum: 0,
    sceneIndex: 999,
    isPreview: true,
    voiceName: voice,
    voice,
    ten_tac_pham: 'VinaOneBatch',
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
  try {
    const res = await withHardTimeout(
      undiciFetch(`${BASE}/api/generate-tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
      HARD_MS,
      voice,
    );
    const data = await res.json().catch(() => ({}));
    let bytes = 0;
    if (data.success && data.audioPath) {
      const url = String(data.audioPath).startsWith('http')
        ? data.audioPath
        : `${BASE}${data.audioPath.startsWith('/') ? '' : '/'}${data.audioPath}`;
      const ar = await withHardTimeout(undiciFetch(url), 30_000, 'audio');
      if (ar.ok) bytes = Buffer.from(await ar.arrayBuffer()).length;
    }
    const ok = !!data.success && bytes > 500;
    return {
      ok,
      ms: Date.now() - t0,
      cached: !!data.cached,
      bytes,
      method: String(data.method || '').slice(0, 100),
      error: String(data.error || '').slice(0, 300),
    };
  } catch (e) {
    return {
      ok: false,
      ms: Date.now() - t0,
      cached: false,
      bytes: 0,
      method: '',
      error: String(e?.message || e).slice(0, 300),
    };
  }
}

async function main() {
  process.env.VINA_PROVIDER = process.env.VINA_PROVIDER || 'cpu';
  process.env.VINA_FORCE_CPU = process.env.VINA_FORCE_CPU || '1';

  // server ping
  const st = await withHardTimeout(undiciFetch(`${BASE}/api/vina-voice/status`), 15_000, 'status');
  if (!st.ok) throw new Error('status HTTP ' + st.status);

  try {
    await withHardTimeout(
      undiciFetch(`${BASE}/api/vina-voice/warm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      }),
      120_000,
      'warm',
    );
  } catch (e) {
    log('warm warn', e.message);
  }

  const cat = await (await undiciFetch(`${BASE}/api/tts/voices`)).json();
  const all = (cat.catalog?.vina_voice?.vi || []).map((v) => v.id);
  const p = load();
  const todo = all.filter((id) => {
    const k = `vina_voice::${id}`;
    return !(p.pass[k] && p.pass[k].bytes > 500);
  });

  if (!todo.length) {
    log('ALL DONE pass=', Object.keys(p.pass).length);
    const summary = {
      totals: {
        catalog: all.length,
        pass: Object.keys(p.pass).length,
        fail: Object.keys(p.fail || {}).length,
      },
      at: new Date().toISOString(),
    };
    fs.writeFileSync(
      path.join(cwd, 'tmp-vina-batch-summary.json'),
      JSON.stringify(summary, null, 2),
    );
    process.exit(0);
  }

  const batch = todo.slice(0, batchSize);
  log(
    `ONE-BATCH size=${batch.length} todo=${todo.length} alreadyPass=${Object.keys(p.pass).length}`,
  );
  log('voices:', batch.join(' | '));

  let okN = 0;
  let failN = 0;
  for (const voice of batch) {
    log('>', voice);
    let r = await probe(voice);
    if (!r.ok) {
      log('  retry after', r.error.slice(0, 80));
      killVinaPy();
      await new Promise((x) => setTimeout(x, 1500));
      try {
        await withHardTimeout(
          undiciFetch(`${BASE}/api/vina-voice/warm`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
          }),
          90_000,
          'rewarm',
        );
      } catch {
        /* ignore */
      }
      r = await probe(voice);
    }
    const k = `vina_voice::${voice}`;
    if (r.ok) {
      p.pass[k] = {
        platform: 'vina_voice',
        lang: 'vi',
        id: voice,
        ...r,
        at: new Date().toISOString(),
      };
      delete p.fail[k];
      okN++;
      log(`  OK ${r.ms}ms ${r.bytes}b ${r.cached ? 'cached' : 'synth'}`);
    } else {
      p.fail[k] = {
        platform: 'vina_voice',
        lang: 'vi',
        id: voice,
        error: r.error,
        ms: r.ms,
        at: new Date().toISOString(),
      };
      failN++;
      log(`  FAIL ${r.ms}ms ${r.error.slice(0, 140)}`);
      killVinaPy();
    }
    save(p);
  }

  const pass = Object.keys(p.pass).length;
  const fail = Object.keys(p.fail || {}).length;
  log(`BATCH END +${okN}ok +${failN}fail | total pass=${pass} fail=${fail} remaining≈${todo.length - batch.length}`);
  // exit 0 if more work, 2 if all done? parent checks progress. exit 1 only if all 5 failed
  process.exit(failN === batch.length ? 1 : 0);
}

main().catch((e) => {
  log('FATAL', e?.stack || e);
  process.exit(2);
});
