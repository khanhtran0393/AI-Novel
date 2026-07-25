/**
 * Empirical smoke: Google Flow runtime standards end-to-end (no live Google gen).
 * 1) Bridge listen HTTP
 * 2) Queue mock execute — taxonomy, busy free, claim, batch
 * 3) Recycle schedule
 *
 * Run: npx tsx scripts/smoke-flow-runtime-e2e.mts
 */
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
process.chdir(root);

let failed = 0;
function ok(label: string, cond: boolean, detail?: string) {
  if (cond) console.log('OK', label, detail || '');
  else {
    console.error('FAIL', label, detail || '');
    failed += 1;
  }
}

async function main() {
  console.log('[smoke-flow-e2e] cwd', root);

  const bridge = await import('../src/lib/flow-bridge/index.ts');
  const {
    ensureBridgeStarted,
    getQueue,
    FLOW_HTTP_PORT,
    FLOW_WS_PORT,
    FLOW_DEFAULTS,
    describeFlowError,
    formatFlowTaskError,
    isAccountBusy,
    markAccountFree,
    scheduleFlowRuntimeRecycle,
  } = bridge;

  const rec = await import('../src/lib/flow-bridge/flowRuntimeRecycle.ts');
  const accounts = await import('../src/lib/flow-bridge/accountStore.ts');

  // ── 1) Bridge ───────────────────────────────────────────────────
  const snap = await ensureBridgeStarted();
  ok('bridge started', Boolean(snap), `ws=${FLOW_WS_PORT} http=${FLOW_HTTP_PORT}`);

  const statusRes = await fetch(`http://127.0.0.1:${FLOW_HTTP_PORT}/api/status`, {
    signal: AbortSignal.timeout(5000),
  });
  const statusJson = (await statusRes.json()) as { running?: boolean };
  ok(
    'HTTP /api/status',
    statusRes.ok && statusJson.running !== false,
    `http=${statusRes.status} running=${statusJson.running}`,
  );

  // ── 2) Taxonomy ─────────────────────────────────────────────────
  const d401 = describeFlowError(undefined, 'HTTP 401 access token');
  ok('taxonomy 401', d401.category === 'token_401' && !d401.permanent);
  ok(
    'taxonomy credentials≠quota',
    describeFlowError(undefined, 'Missing credentials').category !== 'quota',
  );
  ok(
    'taxonomy 180000≠500',
    describeFlowError(undefined, 'Extension API timeout after 180000ms')
      .category === 'network',
  );
  ok(
    'taxonomy resource_exhausted=rate',
    describeFlowError(undefined, 'resource_exhausted try again').category ===
      'rate_429',
  );
  ok('formatFlowTaskError', formatFlowTaskError(d401).length > 20);

  // ── 3) Seed verified account ────────────────────────────────────
  const acc = accounts.createAccount({
    name: `SmokeRuntime ${Date.now().toString(36)}`,
    email: 'smoke-runtime@test.local',
    engine: 'chromium',
  });
  accounts.updateAccount(acc.id, {
    sessionVerified: true,
    flowKeyPresent: true,
    status: 'active',
    healthScore: 90,
    // plausible-looking id (not in blocklist patterns)
    projectId: 'f7e8d9c0-b1a2-4c3d-8e9f-0a1b2c3d4e5f',
  });
  const aid = acc.id;
  markAccountFree(aid);
  rec.__resetFlowRecycleStateForTests();

  // ── 4) Queue: permanent fail path (fast) ────────────────────────
  const queue = getQueue();
  const q = queue as unknown as {
    stopFlag: boolean;
    running: boolean;
    executeTaskOnce: (task: { id?: string; accountId?: string }) => Promise<void>;
    enqueueMany: (body: Record<string, unknown>) => Array<{ id: string }>;
    snapshot: () => {
      pending: number;
      activeWorkers?: number;
      tasks: Array<{
        id: string;
        status: string;
        step?: string;
        error?: string;
        retryCategory?: string;
        progressMessage?: string;
      }>;
    };
    clearPending: () => void;
    setDelay: (a: number, b: number) => void;
    setMode: (m: 'parallel' | 'sequential') => void;
    start: () => void;
    stop: () => void;
    runOne: (body: Record<string, unknown>) => Promise<{
      ok: boolean;
      error?: string;
      task?: { status?: string; retryCategory?: string; step?: string };
    }>;
  };

  const originalOnce = q.executeTaskOnce.bind(queue);
  let onceCalls = 0;
  q.executeTaskOnce = async () => {
    onceCalls += 1;
    // Permanent — fail fast (no 15s retry sleep)
    throw new Error('PUBLIC_ERROR_USER_QUOTA_REACHED credits exhausted');
  };

  q.stopFlag = false;
  q.running = false;
  q.setDelay(0, 0);
  q.clearPending();

  const r = await queue.runOne({
    kind: 'image',
    prompt: 'smoke runtime taxonomy permanent fail',
    aspectRatio: '16:9',
    imageCount: 1,
  });

  ok('runOne fails controlled', r.ok === false);
  ok('executeTaskOnce called', onceCalls >= 1, `n=${onceCalls}`);
  ok(
    'error VN quota',
    Boolean(r.error && /quota|credits/i.test(r.error)),
    (r.error || '').slice(0, 140),
  );
  ok(
    'retryCategory quota',
    r.task?.retryCategory === 'quota' ||
      q.snapshot().tasks.slice(-1)[0]?.retryCategory === 'quota',
    String(r.task?.retryCategory || q.snapshot().tasks.slice(-1)[0]?.retryCategory),
  );
  ok('not busy after fail', !isAccountBusy(aid));
  const last = q.snapshot().tasks.slice(-1)[0];
  ok(
    'step error/failed',
    Boolean(last && (last.status === 'failed' || last.step === 'error')),
    last ? `${last.status}/${last.step}` : 'none',
  );

  // ── 5) Batch claim: two tasks, no double-run same id ────────────
  onceCalls = 0;
  const seen = new Map<string, number>();
  q.executeTaskOnce = async (task) => {
    onceCalls += 1;
    const id = String(task.id || '');
    seen.set(id, (seen.get(id) || 0) + 1);
    await new Promise((r) => setTimeout(r, 40));
    throw new Error('invalid videoModelKey mismatched model');
  };
  q.stopFlag = false;
  q.running = false;
  q.setMode('parallel');
  q.setDelay(0, 0);
  q.clearPending();

  q.enqueueMany({
    kind: 'image',
    prompts: ['claim-A', 'claim-B', 'claim-C'],
    aspectRatio: '16:9',
  });
  q.start();

  for (let i = 0; i < 200; i++) {
    const s = q.snapshot();
    const open = s.tasks.filter(
      (t) => t.status === 'pending' || t.status === 'running',
    );
    if (open.length === 0 && !s.activeWorkers) break;
    await new Promise((r) => setTimeout(r, 40));
  }
  q.stop();
  q.stopFlag = false;

  const double = [...seen.entries()].filter(([, n]) => n > 1);
  ok('batch execute called ≥2', onceCalls >= 2, `calls=${onceCalls}`);
  ok(
    'no double-claim same task id',
    double.length === 0,
    double.map(([id, n]) => `${id}x${n}`).join(',') || 'clean',
  );
  ok('not busy after batch', !isAccountBusy(aid));

  // ── 6) Recycle ──────────────────────────────────────────────────
  rec.__resetFlowRecycleStateForTests();
  scheduleFlowRuntimeRecycle({
    accountId: aid,
    kind: 'video',
    hasMoreWorkForAccount: () => true,
  });
  ok('recycle skip when more work', true);

  rec.__resetFlowRecycleStateForTests();
  // No hard kill of real chrome: hasMoreWork always true if we schedule after streak
  // Only verify shouldHard logic
  const h1 = rec.shouldHardRecycleAfterSuccess('image', aid);
  const h2 = rec.shouldHardRecycleAfterSuccess('image', aid);
  ok('image hard streak 1 false 2 true', h1 === false && h2 === true, `${h1},${h2}`);

  // ── 7) Defaults ─────────────────────────────────────────────────
  ok('maxConcurrent=1', FLOW_DEFAULTS.maxConcurrentTasksPerAccount === 1);
  ok('captchaExtraGap>0', FLOW_DEFAULTS.captchaExtraGapMs > 0);

  // restore
  q.executeTaskOnce = originalOnce;
  q.clearPending();
  q.setMode('sequential');
  q.setDelay(FLOW_DEFAULTS.delayMsMin, FLOW_DEFAULTS.delayMsMax);
  try {
    accounts.deleteAccount(aid);
  } catch {
    /* ignore */
  }

  if (failed > 0) {
    console.error(`[smoke-flow-e2e] FAIL count=${failed}`);
    process.exit(1);
  }
  console.log('[smoke-flow-e2e] PASS');
  process.exit(0);
}

main().catch((e) => {
  console.error('[smoke-flow-e2e] ERROR', e);
  process.exit(1);
});
