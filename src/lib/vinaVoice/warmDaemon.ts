/**
 * Warm ONNX daemon pool — 1..N Python processes each holding model-tts_*.onnx.
 * Parallel jobs (chunks / scenes) fan out across workers, then client concat merges.
 */
import { spawn, execSync, type ChildProcessWithoutNullStreams } from 'child_process';
import fs from 'fs';
import path from 'path';
import { getVinaInferScript, resolveVinaPython } from './paths';
import {
  noteVinaRestart,
  vinaRssMinUptimeS,
  vinaWorkerRssSoftMb,
  withGpuTtsSlot,
} from '@/lib/tts/gpuTtsGuard';

export type DaemonSynthJob = {
  text: string;
  refText: string;
  refAudio: string;
  output: string;
  speed?: number;
  speakerSeed?: number;
  styleSeed?: number;
  nfeStep?: number;
  provider?: 'auto' | 'cuda' | 'dml' | 'cpu';
  reseedNoise?: boolean;
  timeoutMs?: number;
};

export type DaemonSynthResult = {
  ok: boolean;
  output?: string;
  providers?: string[];
  nfeStep?: number;
  error?: string;
  method?: string;
  workerId?: number;
};

type Pending = {
  resolve: (v: DaemonSynthResult) => void;
  timer: ReturnType<typeof setTimeout>;
};

type Worker = {
  id: number;
  child: ChildProcessWithoutNullStreams;
  buf: string;
  pending: Map<string, Pending>;
  /** in-flight jobs (for least-busy pick) */
  inflight: number;
  alive: boolean;
  /** true after JSON event:ready (models loaded) */
  ready: boolean;
  /** epoch ms when process spawned */
  startedAt: number;
  /** epoch ms when event:ready received */
  readyAt: number;
};

let workers: Worker[] = [];
let seq = 0;
let starting: Promise<void> | null = null;
/** Last RSS recycle time — prevent thrash loops */
let lastRssRecycleAt = 0;
const RSS_RECYCLE_COOLDOWN_MS = 5 * 60 * 1000;
/** After first successful synth/load, stick to working EP (avoid CUDA spam next boot). */
let lastGoodProvider: 'auto' | 'cuda' | 'dml' | 'cpu' = readCachedProvider();

function providerCachePath(cwd = process.cwd()): string {
  return path.join(cwd, 'data', 'cache', 'vina_ort_ep.json');
}

function readCachedProvider(cwd = process.cwd()): 'auto' | 'cuda' | 'dml' | 'cpu' {
  const env = (process.env.VINA_PROVIDER || '').toLowerCase();
  if (env === 'cpu' || env === 'cuda' || env === 'dml' || env === 'auto') {
    return env;
  }
  if ((process.env.VINA_FORCE_CPU || '').toLowerCase() === '1') return 'cpu';
  try {
    const p = providerCachePath(cwd);
    if (!fs.existsSync(p)) return 'auto';
    const j = JSON.parse(fs.readFileSync(p, 'utf8')) as {
      cuda_ok?: boolean;
      dml_ok?: boolean;
      prefer?: string;
    };
    if (j.prefer === 'cpu' || j.prefer === 'cuda' || j.prefer === 'dml') {
      return j.prefer;
    }
    // Known-bad CUDA → default cpu so spawn never probes CUDA again
    if (j.cuda_ok === false && j.dml_ok === false) return 'cpu';
    if (j.cuda_ok === false && j.dml_ok !== true) return 'cpu';
  } catch {
    /* ignore */
  }
  return 'auto';
}

function writeCachedProvider(
  prefer: 'auto' | 'cuda' | 'dml' | 'cpu',
  cwd = process.cwd(),
) {
  try {
    const p = providerCachePath(cwd);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    let cur: Record<string, unknown> = {};
    if (fs.existsSync(p)) {
      try {
        cur = JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, unknown>;
      } catch {
        cur = {};
      }
    }
    cur.prefer = prefer;
    if (prefer === 'cpu') {
      // Don't force-fail cuda forever if user later installs CUDA — only remember prefer
    }
    if (prefer === 'cuda') cur.cuda_ok = true;
    if (prefer === 'dml') cur.dml_ok = true;
    if (prefer === 'cpu' && cur.cuda_ok !== true) cur.cuda_ok = false;
    fs.writeFileSync(p, JSON.stringify(cur, null, 2), 'utf8');
  } catch {
    /* ignore */
  }
}

function serverScript(cwd: string): string {
  const infer = getVinaInferScript(cwd);
  return path.join(path.dirname(infer), 'vina_voice_server.py');
}

/** How many warm ONNX processes (each ~1.3–1.5GB RAM/VRAM). Default 1 on low-VRAM safety. */
export function resolveDaemonWorkerCount(): number {
  const n = Number(process.env.VINA_DAEMON_WORKERS);
  if (Number.isFinite(n) && n > 0) return Math.max(1, Math.min(4, Math.trunc(n)));
  // GTX 1050 Ti 4GB / laptop GPUs: 2× full brain often OOM or hang under CUDA
  return 1;
}

function killWorker(w: Worker) {
  w.alive = false;
  try {
    w.child.kill();
  } catch {
    /* ignore */
  }
  for (const [, p] of w.pending) {
    clearTimeout(p.timer);
    p.resolve({ ok: false, error: `Daemon worker #${w.id} exited` });
  }
  w.pending.clear();
}

/** Kill tracked workers + any orphan vina_voice_server.py (leaked by timeout/HMR). */
export function killAllDaemons() {
  for (const w of workers) killWorker(w);
  workers = [];
  // Orphans: previous ensure attempts that Node no longer tracks — eat VRAM on 4GB GPUs
  if (process.platform === 'win32') {
    try {
      execSync(
        `powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'vina_voice_server' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"`,
        { windowsHide: true, timeout: 8000, stdio: 'ignore' },
      );
      console.log('[vina_daemon] killed tracked + orphan vina_voice_server processes');
    } catch {
      /* best-effort */
    }
  }
}

function handleWorkerLine(w: Worker, line: string) {
  let msg: {
    id?: string;
    ok?: boolean;
    output?: string;
    error?: string;
    providers?: string[];
    nfe_step?: number;
    event?: string;
  };
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.event === 'ready') {
    w.ready = true;
    w.readyAt = Date.now();
    const prov = msg.providers || [];
    console.log(`[vina_daemon] worker#${w.id} ready`, prov);
    const p0 = String(prov[0] || '').toLowerCase();
    if (p0.includes('cuda')) lastGoodProvider = 'cuda';
    else if (p0.includes('dml')) lastGoodProvider = 'dml';
    else if (p0.includes('cpu') || prov.length) lastGoodProvider = 'cpu';
    if (lastGoodProvider !== 'auto') writeCachedProvider(lastGoodProvider);
    return;
  }
  const id = String(msg.id || '');
  if (!id || !w.pending.has(id)) return;
  const p = w.pending.get(id)!;
  w.pending.delete(id);
  w.inflight = Math.max(0, w.inflight - 1);
  clearTimeout(p.timer);
  if (msg.ok && msg.output) {
    p.resolve({
      ok: true,
      output: msg.output,
      providers: msg.providers,
      nfeStep: msg.nfe_step,
      workerId: w.id,
      method: `VinaDaemon#${w.id} warm-ONNX (${(msg.providers || []).join('+') || 'ep'})`,
    });
  } else {
    p.resolve({
      ok: false,
      error: msg.error || 'daemon synth failed',
      workerId: w.id,
    });
  }
}

function attachWorker(w: Worker) {
  const proc = w.child;
  proc.stdout.setEncoding('utf8');
  proc.stderr.setEncoding('utf8');
  proc.stdout.on('data', (chunk: string) => {
    w.buf += chunk;
    let idx: number;
    while ((idx = w.buf.indexOf('\n')) >= 0) {
      const line = w.buf.slice(0, idx).trim();
      w.buf = w.buf.slice(idx + 1);
      if (line) handleWorkerLine(w, line);
    }
  });
  proc.stderr.on('data', (d: string) => {
    const t = d.toString().trim();
    if (!t) return;
    // ORT CUDA EP listed in package but cuDNN/CUDA missing → expected, not user-facing error
    if (
      /TryGetProviderInfo_CUDA|CUDAExecutionProvider|cuDNN|provider_bridge_ort|Error loading ".*cud/i.test(
        t,
      )
    ) {
      return;
    }
    // Keep real daemon lines (READY / skip EP / FATAL)
    console.log(`[vina_daemon#${w.id}]`, t.slice(0, 400));
  });
  proc.on('exit', (code) => {
    console.warn(`[vina_daemon] worker#${w.id} exit`, code);
    killWorker(w);
    workers = workers.filter((x) => x.id !== w.id);
  });
  proc.on('error', (e) => {
    console.warn(`[vina_daemon] worker#${w.id} error`, e.message);
    killWorker(w);
    workers = workers.filter((x) => x.id !== w.id);
  });
}

/** Prepend torch/lib + onnxruntime/capi so ORT CUDA finds cuDNN (shipped with torch). */
function withCudaDllPath(env: NodeJS.ProcessEnv, pythonExe: string): NodeJS.ProcessEnv {
  const pyDir = path.dirname(pythonExe);
  // …/omnivoice-python/python.exe → site-packages next to Lib
  const candidates = [
    path.join(pyDir, 'Lib', 'site-packages', 'torch', 'lib'),
    path.join(pyDir, 'Lib', 'site-packages', 'onnxruntime', 'capi'),
    // nested layouts
    path.join(pyDir, 'lib', 'site-packages', 'torch', 'lib'),
    path.join(pyDir, 'lib', 'site-packages', 'onnxruntime', 'capi'),
  ].filter((d) => fs.existsSync(d));
  if (!candidates.length) return env;
  const prefix = candidates.join(path.delimiter);
  const prev = env.PATH || env.Path || '';
  return {
    ...env,
    PATH: `${prefix}${path.delimiter}${prev}`,
  };
}

function spawnOneWorker(cwd: string, id: number): Worker | null {
  const script = serverScript(cwd);
  if (!fs.existsSync(script)) {
    console.warn('[vina_daemon] script missing:', script);
    return null;
  }
  const pythonExe = resolveVinaPython(cwd);
  // Re-read disk cache each spawn (Node may keep stale lastGoodProvider=cpu)
  const cached = readCachedProvider(cwd);
  if (cached === 'auto' || cached === 'cuda' || cached === 'dml') {
    lastGoodProvider = cached;
  }
  const prefer =
    (process.env.VINA_PROVIDER as typeof lastGoodProvider | undefined) ||
    (lastGoodProvider === 'cpu' && cached === 'auto' ? 'auto' : lastGoodProvider) ||
    'auto';
  const env = withCudaDllPath(
    {
      ...process.env,
      PYTHONUTF8: '1',
      PYTHONUNBUFFERED: '1',
      VINA_PROVIDER: prefer,
    },
    pythonExe,
  );
  console.log(`[vina_daemon] start worker#${id} py=${pythonExe} provider=${prefer}`);
  const proc = spawn(pythonExe, ['-u', script], {
    cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const w: Worker = {
    id,
    child: proc,
    buf: '',
    pending: new Map(),
    inflight: 0,
    startedAt: Date.now(),
    readyAt: 0,
    alive: true,
    ready: false,
  };
  attachWorker(w);
  return w;
}

async function waitForAnyReady(timeoutMs = 120_000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    workers = workers.filter((w) => w.alive && w.child && !w.child.killed);
    if (workers.some((w) => w.ready)) return true;
    if (!workers.length) return false;
    await new Promise((r) => setTimeout(r, 400));
  }
  // Accept alive workers even if ready line missed (stdin still works after load)
  return workers.some((w) => w.alive);
}

export async function ensureVinaDaemon(cwd = process.cwd()): Promise<boolean> {
  const want = resolveDaemonWorkerCount();
  workers = workers.filter((w) => w.alive && w.child && !w.child.killed);
  // No tracked workers but orphans may still hold VRAM — wipe before spawn
  if (!workers.length) {
    killAllDaemons();
  }
  if (workers.some((w) => w.ready) && workers.length >= 1) {
    // Top up pool in background if short, but don't block synth
    if (workers.length < want && !starting) {
      starting = (async () => {
        const need = want - workers.length;
        const nextId = workers.reduce((m, w) => Math.max(m, w.id), -1) + 1;
        for (let i = 0; i < need; i++) {
          const w = spawnOneWorker(cwd, nextId + i);
          if (w) workers.push(w);
        }
      })().finally(() => {
        starting = null;
      });
    }
    return true;
  }
  if (starting) {
    await starting;
    return waitForAnyReady(120_000);
  }
  starting = (async () => {
    const need = Math.max(1, want - workers.length);
    const nextId = workers.reduce((m, w) => Math.max(m, w.id), -1) + 1;
    for (let i = 0; i < need; i++) {
      const w = spawnOneWorker(cwd, nextId + i);
      if (w) workers.push(w);
    }
    // Wait for real ready (model load ~1.3GB) — not a fixed 2s guess
    await waitForAnyReady(120_000);
  })();
  try {
    await starting;
  } finally {
    starting = null;
  }
  return workers.some((w) => w.alive);
}

function pickWorker(): Worker | null {
  const live = workers.filter((w) => w.alive && w.child.stdin.writable);
  if (!live.length) return null;
  // IRON B10: chỉ worker ready — không giao job cho process chưa load brain
  const ready = live.filter((w) => w.ready);
  if (!ready.length) return null;
  ready.sort((a, b) => a.inflight - b.inflight || a.id - b.id);
  return ready[0];
}

function workerRssMb(pid: number | undefined): number | null {
  if (!pid || process.platform !== 'win32') return null;
  try {
    const out = execSync(
      `powershell -NoProfile -Command "(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).WorkingSet64"`,
      { encoding: 'utf8', windowsHide: true, timeout: 4000 },
    ).trim();
    const bytes = Number(out);
    if (!Number.isFinite(bytes) || bytes <= 0) return null;
    return bytes / (1024 * 1024);
  } catch {
    return null;
  }
}

/**
 * Recycle daemon only when truly bloated — never thrash right after load.
 * Steady Vina after ONNX load is often 2.8–4.0GB WorkingSet; that is normal.
 */
export async function recycleVinaDaemonIfHeavy(cwd = process.cwd()): Promise<boolean> {
  const soft = vinaWorkerRssSoftMb();
  const minUp = vinaRssMinUptimeS();
  const now = Date.now();
  if (now - lastRssRecycleAt < RSS_RECYCLE_COOLDOWN_MS) {
    return false;
  }

  let heavy = false;
  for (const w of workers) {
    if (!w.alive || !w.child.pid) continue;
    // Never kill mid-job
    if (w.inflight > 0) continue;
    // Wait for ready + min uptime (default 180s)
    const uptimeS =
      w.readyAt > 0
        ? (now - w.readyAt) / 1000
        : (now - (w.startedAt || now)) / 1000;
    if (uptimeS < minUp) {
      const rssEarly = workerRssMb(w.child.pid);
      if (rssEarly != null && rssEarly >= soft) {
        console.log(
          `[vina_daemon] worker#${w.id} RSS ${rssEarly.toFixed(0)}MB ≥ soft ${soft}MB but uptime ${uptimeS.toFixed(0)}s < ${minUp}s — skip recycle`,
        );
      }
      continue;
    }
    const rss = workerRssMb(w.child.pid);
    if (rss != null && rss >= soft) {
      console.warn(
        `[vina_daemon] worker#${w.id} RSS ${rss.toFixed(0)}MB ≥ soft ${soft}MB (uptime ${uptimeS.toFixed(0)}s) — recycle`,
      );
      heavy = true;
      break;
    }
  }
  if (!heavy) return false;
  lastRssRecycleAt = now;
  noteVinaRestart();
  killAllDaemons();
  await ensureVinaDaemon(cwd);
  return true;
}

export async function daemonSynth(
  job: DaemonSynthJob,
  cwd = process.cwd(),
): Promise<DaemonSynthResult> {
  // Exclusive GPU: unload Omni when Vina runs; serial with Omni
  // Job timeout stays on the JSON job (not outer race that leaks the mutex)
  // Preview first-load on 4GB CUDA often 90–180s; default was 150s → false timeout → stacked one-shots.
  const jobTimeout = job.timeoutMs ?? 240_000;
  // Slot budget = load daemon + synth (+ respawn headroom)
  const slotTimeout = Math.max(jobTimeout + 90_000, 330_000);

  return withGpuTtsSlot(
    'vina',
    async () => {
      await recycleVinaDaemonIfHeavy(cwd);
      const ok = await ensureVinaDaemon(cwd);
      if (!ok) return { ok: false, error: 'Daemon not available' };

      const w = pickWorker();
      if (!w) return { ok: false, error: 'No live daemon worker' };

      const id = `j${Date.now()}_${++seq}`;
      const provider =
        job.provider ||
        (process.env.VINA_PROVIDER as DaemonSynthJob['provider']) ||
        lastGoodProvider ||
        'auto';

      const payload = {
        id,
        cmd: 'synth',
        text: job.text,
        ref_text: job.refText,
        ref_audio: job.refAudio,
        output: job.output,
        speed: job.speed ?? 1,
        speaker_seed: job.speakerSeed ?? 2336,
        style_seed: job.styleSeed ?? 4125,
        nfe_step: job.nfeStep ?? 24,
        provider,
        reseed_noise: !!job.reseedNoise,
      };

      w.inflight += 1;
      return new Promise<DaemonSynthResult>((resolve) => {
        const timer = setTimeout(() => {
          // CRITICAL: hung CUDA/ORT jobs leave the worker deadlocked.
          // Must kill + drop worker so the next request can respawn clean brain.
          // (Previously only resolved error → next jobs queued into a stuck worker.)
          console.error(
            `[vina_daemon] worker#${w.id} TIMEOUT ${jobTimeout}ms id=${id} — killing hung worker`,
          );
          // Remove self first so killWorker only fails *other* pending jobs
          w.pending.delete(id);
          w.inflight = Math.max(0, w.inflight - 1);
          noteVinaRestart();
          killWorker(w);
          workers = workers.filter((x) => x.id !== w.id);
          resolve({
            ok: false,
            error: `Daemon timeout ${jobTimeout}ms (worker killed)`,
            workerId: w.id,
          });
        }, jobTimeout);
        w.pending.set(id, { resolve, timer });
        try {
          w.child.stdin.write(`${JSON.stringify(payload)}\n`);
        } catch (e) {
          w.pending.delete(id);
          clearTimeout(timer);
          w.inflight = Math.max(0, w.inflight - 1);
          killWorker(w);
          workers = workers.filter((x) => x.id !== w.id);
          resolve({
            ok: false,
            error: e instanceof Error ? e.message : String(e),
            workerId: w.id,
          });
        }
      }).then((res) => {
        if (res.ok && res.providers?.length) {
          const p = res.providers[0].toLowerCase();
          if (p.includes('cuda')) lastGoodProvider = 'cuda';
          else if (p.includes('dml')) lastGoodProvider = 'dml';
          else lastGoodProvider = 'cpu';
          writeCachedProvider(lastGoodProvider, cwd);
        }
        return res;
      });
    },
    { timeoutMs: slotTimeout },
  );
}

export function isDaemonEnabled(): boolean {
  const v = (process.env.VINA_WARM_DAEMON || '1').toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'off';
}

export function resolveNfeStep(opts: {
  isPreview?: boolean;
  isChapter?: boolean;
  explicit?: number;
}): number {
  if (Number.isFinite(opts.explicit) && (opts.explicit as number) > 0) {
    return Math.trunc(opts.explicit as number);
  }
  const envFull = Number(process.env.VINA_NFE_STEP);
  const envPreview = Number(process.env.VINA_NFE_PREVIEW);
  const envChapter = Number(process.env.VINA_NFE_CHAPTER);
  if (opts.isPreview) {
    // Preview NFE floor = 16. NFE≤8 (esp. 4) yields noise-like garbage on CPU/CUDA
    // (high ZCR / flat energy envelope — not speech). Empirically: nfe=4 NOISY, nfe=16 SPEECH.
    // Override: VINA_NFE_PREVIEW (must still be ≥12 or quality collapses).
    if (Number.isFinite(envPreview) && envPreview > 0) {
      return Math.max(12, Math.trunc(envPreview));
    }
    return 16;
  }
  if (opts.isChapter) {
    if (Number.isFinite(envChapter) && envChapter > 0) return Math.trunc(envChapter);
    return 20;
  }
  if (Number.isFinite(envFull) && envFull > 0) return Math.trunc(envFull);
  return 24;
}
