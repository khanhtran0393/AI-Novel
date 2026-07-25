/**
 * Smoke: Flow video async path (enqueue + task poll shape + ops recycle + finalize unit).
 * Live gen optional when bridge has token (SKIP live if not ready).
 */
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const BASE = process.env.AINOVEL_SMOKE_BASE || 'http://127.0.0.1:3000';
const BRIDGE = process.env.AINOVEL_FLOW_HTTP || 'http://127.0.0.1:8101';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function main() {
  console.log('=== smoke-flow-video-async ===');

  // 1) ops recycle default false
  const { loadFlowOps } = await import('../src/lib/flow-bridge/opsStore.ts');
  const ops = loadFlowOps();
  assert(
    ops.recycleEveryVideoSuccess === false,
    `recycleEveryVideoSuccess expected false, got ${ops.recycleEveryVideoSuccess}`,
  );
  console.log('OK ops.recycleEveryVideoSuccess=false');

  // 2) queue enqueueAndStart unit (in-process)
  const { FlowQueueEngine } = await import(
    '../src/lib/flow-bridge/queueEngine.ts'
  );
  const q = new FlowQueueEngine();
  // Don't start real gen — only enqueue structure via private path:
  // enqueueMany is public via enqueueAndStart which starts workers — use enqueueMany only
  const tasks = (q as unknown as { enqueueMany: (b: Record<string, unknown>) => unknown[] }).enqueueMany({
    kind: 'video',
    prompt: 'smoke async unit only — no gen',
    chapterNum: 99,
    sceneIndex: 1,
    promptIndex: 0,
    durationSec: 4,
    videoModel: 'veo_3_1_t2v_fast',
  });
  assert(Array.isArray(tasks) && tasks.length === 1, 'enqueueMany created 1');
  const t0 = tasks[0] as { id?: string; step?: string; status?: string };
  assert(t0.id && String(t0.id).startsWith('ft_'), 'task id');
  assert(t0.status === 'pending', 'pending');
  assert(t0.step === 'queued', 'queued step');
  console.log('OK enqueueMany video task', t0.id);

  // 3) finalize recover unit with tiny fake file if needed
  const { recoverLocalVideoArtifact } = await import(
    '../src/lib/flow-bridge/flowVideoFinalize.ts'
  );
  const miss = recoverLocalVideoArtifact({
    chapterNum: 99999,
    sceneIndex: 99999,
    promptIndex: 0,
  });
  assert(miss.ok === false, 'missing artifact ok=false');
  console.log('OK recover miss');

  // Prefer existing real video for recover success path
  const real = path.join(ROOT, 'public', 'video', 'chapter_9_scene_98_animatic.mp4');
  const alt = path.join(ROOT, 'public', 'video', 'c9_s98_p0.mp4');
  if (fs.existsSync(real) || fs.existsSync(alt)) {
    const hit = recoverLocalVideoArtifact({
      chapterNum: 9,
      sceneIndex: 98,
      promptIndex: 0,
    });
    assert(hit.ok && hit.videoPath, 'recover existing s98');
    console.log('OK recover s98', hit.filename, hit.artifact?.sizeBytes);
  } else {
    console.log('SKIP recover hit (no s98 file)');
  }

  // 4) Live health (Next preferred; bridge optional after restart)
  try {
    const h = await fetch(`${BASE}/api/flow/health`, {
      signal: AbortSignal.timeout(5000),
    });
    if (h.ok) {
      const j = (await h.json()) as { ok?: boolean };
      assert(j.ok === true, 'flow health ok');
      console.log('OK /api/flow/health');
    } else {
      console.log('SKIP /api/flow/health HTTP', h.status);
    }
  } catch {
    console.log('SKIP /api/flow/health (app down)');
  }
  try {
    const h = await fetch(`${BRIDGE}/api/health`, {
      signal: AbortSignal.timeout(3000),
    });
    if (h.ok) {
      console.log('OK bridge :8101 /api/health');
    } else {
      console.log('SKIP bridge :8101 health HTTP', h.status, '(restart app for new bridge routes)');
    }
  } catch {
    console.log('SKIP bridge :8101 health (down)');
  }

  // 5) API contracts exist via Next if up
  {
    let st: Response | null = null;
    try {
      st = await fetch(`${BASE}/api/flow/status`, {
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      st = null;
    }
    if (!st) {
      console.log('SKIP next app (down)');
    } else if (!st.ok) {
      console.log('SKIP next flow status', st.status);
    } else {
      console.log('OK /api/flow/status');
      const task = await fetch(`${BASE}/api/flow/task?id=ft_smoke_missing`, {
        signal: AbortSignal.timeout(8000),
      });
      // 404 not found · 500 if route missing in old process
      assert(
        task.status === 404 || task.status === 200,
        `flow/task unexpected HTTP ${task.status}`,
      );
      console.log('OK /api/flow/task HTTP', task.status);
      const art = await fetch(
        `${BASE}/api/video-artifact?chapterNum=9&sceneIndex=98&promptIndex=0`,
        { signal: AbortSignal.timeout(8000) },
      );
      assert(
        art.status === 200 || art.status === 404,
        `video-artifact unexpected HTTP ${art.status}`,
      );
      console.log('OK /api/video-artifact HTTP', art.status);
    }
  }

  console.log('SMOKE_OK smoke-flow-video-async');
}

main().catch((e) => {
  console.error('SMOKE_FAIL', e);
  process.exit(1);
});
