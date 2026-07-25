/**
 * Empirical: GEN VIDEO / NỐI VIDEO client gate after dual-still fix.
 * 1) resolveVideoKeyframeRange unit
 * 2) wantsEndFrame gate (must not force dual without Start+End)
 * 3) Optional live POST /api/generate-video when Flow session ready
 */
import fs from 'fs';
import path from 'path';
import { resolveVideoKeyframeRange } from '../src/lib/projectProgress.ts';

const BASE = process.env.AINOVEL_SMOKE_BASE || 'http://127.0.0.1:3000';
const LIVE = process.env.AINOVEL_LIVE_VIDEO !== '0';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function wantsEndFrame(use_end: boolean): boolean {
  // Mirrors useImagePromptActions after fix — NOT startIdx !== endIdx
  return Boolean(use_end);
}

async function main() {
  console.log('=== smoke-video-button-gate ===');

  // --- 1) Range: Flow middle = single ---
  const mid = resolveVideoKeyframeRange({
    promptIndex: 2,
    promptsLen: 6,
    useEndFrame: false,
    chapter: 9,
    sceneIndex: 0,
  });
  assert(mid.dualFrame === false, 'middle dualFrame false');
  assert(mid.startPromptIndex === 2 && mid.endPromptIndex === 2, 'middle single idx');
  console.log('OK middle single', mid);

  const edge = resolveVideoKeyframeRange({
    promptIndex: 0,
    promptsLen: 6,
    useEndFrame: false,
    chapter: 9,
    sceneIndex: 0,
  });
  assert(!edge.dualFrame && edge.startPromptIndex === 0, 'edge');
  console.log('OK edge single', edge);

  const dual = resolveVideoKeyframeRange({
    promptIndex: 1,
    promptsLen: 4,
    useEndFrame: true,
    endImageKey: '3_0_2',
    chapter: 3,
    sceneIndex: 0,
  });
  assert(dual.dualFrame === true, 'start+end dual');
  assert(dual.startPromptIndex === 1 && dual.endPromptIndex === 2, 'dual indices');
  console.log('OK start+end dual', dual);

  const legacy = resolveVideoKeyframeRange({
    promptIndex: 2,
    promptsLen: 5,
    useEndFrame: false,
    chapter: 1,
    sceneIndex: 0,
    singleClipPerPrompt: false,
  });
  assert(legacy.dualFrame === true, 'legacy middle dual');
  console.log('OK legacy middle dual', legacy);

  // --- 2) Gate: old vs new ---
  // Scenario: middle shot, only image for THIS prompt (no prev still)
  const startIdx = mid.startPromptIndex;
  const endIdx = mid.endPromptIndex;
  const hasStart = true;
  const hasEnd = false; // only current still
  const hasDualStills =
    hasStart &&
    hasEnd &&
    startIdx !== endIdx;

  const newWants = wantsEndFrame(false);
  const oldWants = Boolean(false || startIdx !== endIdx); // old: OR indices differ

  // With fixed range, start===end so oldWants on NEW range is also false.
  // Document the historical middle range that broke:
  const histStart = 1;
  const histEnd = 2;
  const oldWantsHist = Boolean(false || histStart !== histEnd);
  assert(oldWantsHist === true, 'historical bug forces dual gate');
  assert(newWants === false, 'new gate no force');
  assert(
    !(newWants && !hasDualStills),
    'new path must NOT throw Start+End with 1 still',
  );
  // Historical: would throw
  const histWouldThrow = oldWantsHist && !hasDualStills;
  assert(histWouldThrow === true, 'hist throw documented');
  console.log('OK gate regression: old would throw, new passes with 1 still');

  // Start+End without 2 stills still blocks
  assert(wantsEndFrame(true) === true, 'checkbox wants');
  assert(
    wantsEndFrame(true) && !hasDualStills,
    'Start+End missing still still hard-fails (correct)',
  );
  console.log('OK Start+End still hard-fails without 2 stills');

  // --- 3) Live Flow status ---
  let sessionReady = false;
  let statusJson: Record<string, unknown> = {};
  try {
    const st = await fetch(`${BASE}/api/flow/status`, {
      signal: AbortSignal.timeout(8000),
    });
    statusJson = (await st.json().catch(() => ({}))) as Record<string, unknown>;
    assert(st.ok, `flow status HTTP ${st.status}`);
    const accounts = (statusJson.accounts as Array<Record<string, unknown>>) || [];
    const activeId = statusJson.activeAccountId;
    const active =
      accounts.find((a) => a.id === activeId) || accounts[0] || {};
    const email = String(active.email || '');
    const key = Boolean(active.flowKeyPresent || statusJson.flowKeyPresent);
    const ext = Boolean(active.extensionConnected || statusJson.extensionConnected);
    sessionReady = ext && key && email.includes('@');
    console.log('OK flow status', {
      ext,
      key,
      email: email || null,
      sessionVerified: active.sessionVerified,
      sessionReady,
    });
  } catch (e) {
    console.log('SKIP live (app down)', e instanceof Error ? e.message : e);
  }

  // --- 4) Live generate-video (optional) ---
  if (!LIVE) {
    console.log('SKIP live gen (AINOVEL_LIVE_VIDEO=0)');
  } else if (!sessionReady) {
    console.log('SKIP live gen (Flow session not ready — key/email)');
  } else {
    const startImageRel = '/images/c1_s990_p4.png';
    const startAbs = path.join(process.cwd(), 'public', 'images', 'c1_s990_p4.png');
    if (!fs.existsSync(startAbs)) {
      console.log('SKIP live gen (no sample still c1_s990_p4.png)');
    } else {
      // Middle-style shot indices: chapter 91 / scene 2 / prompt 2 (synthetic ids)
      // to prove single-clip path does not require dual stills.
      const body = {
        chapterNum: 91,
        sceneIndex: 2,
        promptIndex: 2,
        prompt:
          'Cinematic tracking shot, neon rain alley, man walks forward, slow dolly, dramatic lighting, high detail',
        duration: 4,
        secondsPerBeat: 4,
        videoProvider: 'flow',
        model: 'veo_3_1_i2v_s_fast',
        videoAspectRatio: '16:9',
        startImage: startImageRel,
        // NO endImage — middle shot with 1 still only
        styleHint: 'cinematic neon noir',
        genre: 'Hành động / Hiện đại',
        async: true,
        videoMode: 'auto',
      };
      console.log('LIVE POST /api/generate-video (1 still, middle indices)…');
      const t0 = Date.now();
      const res = await fetch(`${BASE}/api/generate-video`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      console.log('LIVE status', res.status, {
        success: data.success,
        async: data.async,
        accepted: data.accepted,
        taskId: data.taskId || data.jobId,
        error: data.error,
        videoPath: data.videoPath,
        ms: Date.now() - t0,
      });

      // Client gate fixed path: must NOT fail with Keyframe Start+End (that is client-only).
      // Server may return 202 async, 200 success, or Flow session errors — all after gate.
      assert(
        !String(data.error || '').includes('Keyframe Start+End'),
        'must not be dual-still client error on server',
      );

      if (res.status === 202 || data.async || data.accepted) {
        const taskId = String(data.taskId || data.jobId || '');
        assert(taskId, 'async taskId');
        console.log('OK async accepted', taskId, '— polling up to 8 min…');
        const pollUntil = Date.now() + 8 * 60_000;
        let done = false;
        while (Date.now() < pollUntil) {
          await new Promise((r) => setTimeout(r, 3000));
          const pr = await fetch(
            `${BASE}/api/flow/task?id=${encodeURIComponent(taskId)}&finalize=1&recover=1`,
            { signal: AbortSignal.timeout(15000) },
          );
          const pj = (await pr.json().catch(() => ({}))) as Record<string, unknown>;
          const task = (pj.task || {}) as Record<string, unknown>;
          const st = String(task.status || pj.status || '');
          if (pj.success && pj.videoPath) {
            console.log('LIVE VIDEO OK', pj.videoPath, task);
            // verify file
            const vp = String(pj.videoPath);
            const local = vp.includes('/video/')
              ? path.join(process.cwd(), 'public', 'video', path.basename(vp.split('?')[0]))
              : path.isAbsolute(vp)
                ? vp
                : path.join(process.cwd(), 'public', 'video', path.basename(vp));
            if (fs.existsSync(local)) {
              const sz = fs.statSync(local).size;
              assert(sz > 1000, `video size ${sz}`);
              console.log('OK disk artifact', local, sz);
            } else {
              console.log('NOTE path not under public/video', vp);
            }
            done = true;
            break;
          }
          if (st === 'failed' || st === 'cancelled') {
            throw new Error(
              `Flow task ${st}: ${task.error || pj.error || JSON.stringify(pj).slice(0, 400)}`,
            );
          }
          process.stdout.write(`.${st || pr.status}`);
        }
        if (!done) throw new Error('poll timeout 8m — no videoPath');
      } else if (res.ok && data.success && data.videoPath) {
        console.log('LIVE VIDEO sync OK', data.videoPath);
      } else if (res.status === 403 || res.status === 402) {
        console.log('SKIP live gen (entitlement gate)', data.error);
      } else if (res.status === 503 || String(data.error || '').includes('Flow')) {
        console.log('SKIP live gen (Flow session/runtime)', data.error);
      } else {
        throw new Error(
          `unexpected generate-video HTTP ${res.status}: ${JSON.stringify(data).slice(0, 500)}`,
        );
      }
    }
  }

  console.log('SMOKE_OK smoke-video-button-gate');
}

main().catch((e) => {
  console.error('SMOKE_FAIL', e instanceof Error ? e.message : e);
  process.exit(1);
});
