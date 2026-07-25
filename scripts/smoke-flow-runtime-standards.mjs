/**
 * Smoke: Google Flow runtime standards (error taxonomy + recycle policy defaults).
 * No network / no Chrome required.
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
process.chdir(root);

const require = createRequire(import.meta.url);

function loadJiti() {
  try {
    return require('jiti')(import.meta.url);
  } catch {
    return null;
  }
}

function main() {
  const jiti = loadJiti();
  if (!jiti) {
    console.error('[smoke-flow-runtime] FAIL: jiti missing');
    process.exit(1);
  }

  const errors = jiti(
    path.join(root, 'src/lib/flow-bridge/flowRuntimeErrors.ts'),
  );
  const ops = jiti(path.join(root, 'src/lib/flow-bridge/opsStore.ts'));
  const config = jiti(path.join(root, 'src/lib/flow-bridge/config.ts'));
  const recycle = jiti(
    path.join(root, 'src/lib/flow-bridge/flowRuntimeRecycle.ts'),
  );
  const steps = jiti(path.join(root, 'src/lib/flow-bridge/flowRuntimeSteps.ts'));

  const cases = [
    {
      msg: 'PUBLIC_ERROR_USER_QUOTA_REACHED resource_exhausted',
      cat: 'quota',
      permanent: true,
    },
    {
      msg: 'HTTP 401 Unauthorized access token',
      cat: 'token_401',
      permanent: false,
    },
    {
      msg: 'recaptcha unusual_activity PUBLIC_ERROR_UNUSUAL_ACTIVITY',
      cat: 'forbidden_403',
      permanent: false,
    },
    {
      msg: 'HTTP 429 too many requests rate limit',
      cat: 'rate_429',
      permanent: false,
    },
    {
      msg: 'PUBLIC_ERROR_UNSAFE_GENERATION safety content policy',
      cat: 'content',
      permanent: true,
    },
    {
      msg: 'invalid videoModelKey mismatched model',
      cat: 'content',
      permanent: true,
    },
    {
      // Must NOT classify as quota (false positive on "credit" inside credentials)
      msg: 'Missing credentials for Google session',
      cat: 'other',
      permanent: false,
    },
    {
      msg: 'Không gửi được tới extension của profile x (socket offline)',
      cat: 'network',
      permanent: false,
    },
    {
      msg: 'resource_exhausted try again later',
      cat: 'rate_429',
      permanent: false,
    },
    {
      // Must NOT classify as 500/rate just because timeout contains "180000"
      msg: 'Extension API timeout after 180000ms',
      cat: 'network',
      permanent: false,
    },
    {
      msg: 'HTTP 503 Service Unavailable',
      cat: 'rate_429',
      permanent: false,
    },
  ];

  let failed = 0;
  for (const c of cases) {
    const d = errors.describeFlowError(undefined, c.msg);
    const ok =
      d.category === c.cat &&
      d.permanent === c.permanent &&
      String(d.userMessage || '').length > 10 &&
      Array.isArray(d.suggestions);
    console.log(
      ok ? 'OK' : 'FAIL',
      c.cat,
      '→',
      d.category,
      permanentLabel(d),
      d.userMessage.slice(0, 60),
    );
    if (!ok) failed += 1;
  }

  // Recycle: image N=2 triggers hard only on 2nd; video every success
  recycle.__resetFlowRecycleStateForTests();
  const opsLoaded = ops.loadFlowOps();
  // Force defaults via direct shouldHard checks (uses live ops file — tolerate user ops)
  const hard1 = recycle.shouldHardRecycleAfterSuccess('image', 'acc_a');
  const hard2 = recycle.shouldHardRecycleAfterSuccess('image', 'acc_a');
  console.log('image hard1', hard1, 'hard2', hard2);
  if (opsLoaded.recycleAfterSuccess !== false) {
    const everyN = Math.max(1, Number(opsLoaded.recycleEveryNSuccess) || 2);
    if (everyN === 2) {
      if (hard1 !== false || hard2 !== true) {
        console.error('FAIL: image recycle every 2 expected soft then hard', {
          hard1,
          hard2,
        });
        failed += 1;
      } else {
        console.log('OK image recycle streak: 1=no-hard / 2=hard');
      }
    } else {
      console.log('SKIP image streak assert (ops.recycleEveryNSuccess=', everyN, ')');
    }
  }

  const flowOps = ops.loadFlowOps();
  if (flowOps.recycleAfterSuccess !== true) {
    console.error('FAIL: recycleAfterSuccess default must be true');
    failed += 1;
  } else {
    console.log('OK recycleAfterSuccess default true');
  }
  if (flowOps.recycleEveryVideoSuccess !== true) {
    console.error('FAIL: recycleEveryVideoSuccess default must be true');
    failed += 1;
  } else {
    console.log('OK recycleEveryVideoSuccess default true');
  }

  const defs = config.FLOW_DEFAULTS;
  if (defs.maxConcurrentTasksPerAccount !== 1) {
    console.error('FAIL: maxConcurrentTasksPerAccount must be 1');
    failed += 1;
  } else {
    console.log('OK maxConcurrentTasksPerAccount=1');
  }
  if (!(defs.captchaExtraGapMs > 0)) {
    console.error('FAIL: captchaExtraGapMs must be > 0');
    failed += 1;
  } else {
    console.log('OK captchaExtraGapMs', defs.captchaExtraGapMs);
  }

  recycle.__resetFlowRecycleStateForTests();
  recycle.markAccountBusy('acc_test');
  if (!recycle.isAccountBusy('acc_test')) {
    console.error('FAIL: busy set');
    failed += 1;
  } else {
    console.log('OK account busy tracking');
  }
  recycle.markAccountFree('acc_test');

  const task = {
    id: 't1',
    kind: 'image',
    status: 'running',
    prompt: 'x',
    progress: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    attempts: 1,
  };
  steps.applyFlowTaskStep(task, 'submit');
  if (task.step !== 'submit' || task.progress < 30) {
    console.error('FAIL: applyFlowTaskStep', task);
    failed += 1;
  } else {
    console.log('OK step submit progress', task.progress, task.progressMessage);
  }

  // scheduleFlowRuntimeRecycle must not throw; mid-batch skip hard without crash
  recycle.__resetFlowRecycleStateForTests();
  try {
    recycle.scheduleFlowRuntimeRecycle({
      accountId: 'acc_batch',
      kind: 'image',
      hasMoreWorkForAccount: () => true,
    });
    // force streak to hard threshold
    recycle.shouldHardRecycleAfterSuccess('image', 'acc_batch');
    recycle.scheduleFlowRuntimeRecycle({
      accountId: 'acc_batch',
      kind: 'image',
      hasMoreWorkForAccount: () => true,
    });
    console.log('OK schedule recycle with pending work (no throw)');
  } catch (e) {
    console.error('FAIL schedule recycle threw', e);
    failed += 1;
  }

  // formatFlowTaskError shape
  const d = errors.describeFlowError(undefined, 'HTTP 401 access token');
  const formatted = errors.formatFlowTaskError(d);
  if (!formatted.includes('Token') && !formatted.includes('token') && !formatted.includes('Bearer')) {
    // VN message should mention token/Bearer path
    if (!formatted.includes('Google Flow')) {
      console.error('FAIL formatFlowTaskError weak', formatted);
      failed += 1;
    } else {
      console.log('OK formatFlowTaskError', formatted.slice(0, 80));
    }
  } else {
    console.log('OK formatFlowTaskError', formatted.slice(0, 80));
  }

  // config exports present
  if (!config.FLOW_DEFAULTS.recycleDelayMs || !config.FLOW_WS_PORT) {
    console.error('FAIL config defaults incomplete');
    failed += 1;
  } else {
    console.log(
      'OK config ports',
      config.FLOW_WS_PORT,
      config.FLOW_HTTP_PORT,
      'recycleDelay',
      config.FLOW_DEFAULTS.recycleDelayMs,
    );
  }

  // Double-claim invariant: retry backoff must NOT flip to pending
  const fs = require('fs');
  const qsrc = fs.readFileSync(
    path.join(root, 'src/lib/flow-bridge/queueEngine.ts'),
    'utf8',
  );
  const retrySetsPending =
    /attempt < max\)[\s\S]{0,120}task\.status\s*=\s*['"]pending['"]/.test(
      qsrc,
    );
  if (retrySetsPending) {
    console.error('FAIL: retry backoff sets pending (double-claim risk)');
    failed += 1;
  } else if (
    qsrc.includes('CRITICAL: keep status=running') ||
    qsrc.includes('Atomic claim')
  ) {
    console.log('OK anti double-claim (claim + running backoff)');
  } else {
    console.error('FAIL: missing double-pick guards in queueEngine');
    failed += 1;
  }

  if (failed > 0) {
    console.error(`[smoke-flow-runtime] FAIL count=${failed}`);
    process.exit(1);
  }
  console.log('[smoke-flow-runtime] PASS');
  process.exit(0);
}

function permanentLabel(d) {
  return d.permanent ? 'permanent' : 'retryable';
}

main();
