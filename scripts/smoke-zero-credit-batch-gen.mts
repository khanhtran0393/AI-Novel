/**
 * Empirical: GEN TẤT CẢ ẢNH / GEN TOÀN BỘ VIDEO at credits=0 (Free/Trial).
 * Mirrors useImagePromptActions deduct gate + stage batch runner.
 * Run: npx tsx scripts/smoke-zero-credit-batch-gen.mts
 */
import assert from 'node:assert/strict';
import {
  createStageBatchJob,
  runStageBatch,
} from '../src/lib/pipeline/index.ts';
import { jobProgress } from '../src/lib/jobQueue.ts';

// --- Mirror credentialActions.deductCredits (source of truth in store) ---
type FlagState = {
  credits: number;
  is_pro: boolean;
  is_trial: boolean;
  is_vip: boolean;
};

function makeCreditState(init: FlagState) {
  let state = { ...init };
  return {
    get: () => ({ ...state }),
    setCredits: (c: number) => {
      state.credits = Math.max(0, Number(c) || 0);
    },
    deductCredits: (amount: number): boolean => {
      // Paid Pro unlimited — trial + free deduct from balance.
      if (state.is_vip || (state.is_pro && !state.is_trial)) {
        if ((state.credits ?? 0) < 999_999_999) {
          state.credits = 999_999_999;
        }
        return true;
      }
      const a = Math.max(0, Number(amount) || 0);
      if (state.credits >= a) {
        state.credits -= a;
        return true;
      }
      return false;
    },
  };
}

/** Same gate as handleGenerateImage / handleGenerateVideo */
function gateImage(st: ReturnType<typeof makeCreditState>): void {
  if (!st.deductCredits(1)) throw new Error('HẾT_TÍN_DỤNG');
}
function gateVideo(st: ReturnType<typeof makeCreditState>): void {
  if (!st.deductCredits(2)) throw new Error('HẾT_TÍN_DỤNG');
}

function section(name: string) {
  console.log(`\n=== ${name} ===`);
}

async function main() {
  console.log('=== smoke-zero-credit-batch-gen ===');

  // --- 1) Unit: Free credits=0 ---
  section('FREE credits=0 · single gates');
  {
    const st = makeCreditState({
      credits: 0,
      is_pro: false,
      is_trial: false,
      is_vip: false,
    });
    assert.throws(() => gateImage(st), /HẾT_TÍN_DỤNG/);
    assert.throws(() => gateVideo(st), /HẾT_TÍN_DỤNG/);
    assert.equal(st.get().credits, 0, 'no partial deduct on fail');
    console.log('OK free 0 blocks image(-1) and video(-2)');
  }

  // --- 2) Batch GEN TẤT CẢ ẢNH @ 0 credit (5 shots) ---
  section('GEN TẤT CẢ ẢNH · Free credits=0 · 5 shots');
  {
    const st = makeCreditState({
      credits: 0,
      is_pro: false,
      is_trial: false,
      is_vip: false,
    });
    const job = createStageBatchJob({
      stage: 'image',
      chapter: 1,
      title: 'Gen ảnh · smoke 0 credit',
      concurrency: 1,
      itemGapMs: 0,
      items: Array.from({ length: 5 }, (_, i) => ({
        label: `p${i + 1}`,
        chapter: 1,
        sceneIndex: 0,
        promptIndex: i,
        assetKey: `1_0_${i}`,
      })),
    });
    const finished = await runStageBatch(job.id, async () => {
      // silentError path in UI still throws — batch marks failed
      gateImage(st);
      throw new Error('should_not_reach_network');
    });
    assert.ok(finished, 'batch finished');
    const p = jobProgress(finished!);
    assert.equal(p.total, 5);
    assert.equal(p.failed, 5, 'all 5 fail at credit gate');
    assert.equal(p.done, 0);
    assert.equal(st.get().credits, 0);
    const errs = finished!.items.map((it) => it.error || '');
    assert.ok(
      errs.every((e) => e.includes('HẾT_TÍN_DỤNG')),
      `errors must be HẾT_TÍN_DỤNG, got ${JSON.stringify(errs)}`,
    );
    console.log('OK image batch', {
      total: p.total,
      failed: p.failed,
      done: p.done,
      credits: st.get().credits,
      sampleError: errs[0],
    });
  }

  // --- 3) Batch GEN TOÀN BỘ VIDEO @ 0 credit (3 clips) ---
  section('GEN TOÀN BỘ VIDEO · Free credits=0 · 3 clips');
  {
    const st = makeCreditState({
      credits: 0,
      is_pro: false,
      is_trial: false,
      is_vip: false,
    });
    const job = createStageBatchJob({
      stage: 'video',
      chapter: 1,
      title: 'Gen video · smoke 0 credit',
      concurrency: 1,
      itemGapMs: 0,
      items: Array.from({ length: 3 }, (_, i) => ({
        label: `v${i + 1}`,
        chapter: 1,
        sceneIndex: 0,
        promptIndex: i,
        assetKey: `1_0_${i}_video`,
      })),
    });
    const finished = await runStageBatch(job.id, async () => {
      gateVideo(st);
      throw new Error('should_not_reach_network');
    });
    const p = jobProgress(finished!);
    assert.equal(p.failed, 3);
    assert.equal(p.done, 0);
    assert.equal(st.get().credits, 0);
    assert.ok(
      finished!.items.every((it) => (it.error || '').includes('HẾT_TÍN_DỤNG')),
    );
    console.log('OK video batch', {
      total: p.total,
      failed: p.failed,
      credits: st.get().credits,
    });
  }

  // --- 4) Partial credits: 2 credits, 5 images (cost 1) ---
  section('Partial · Free credits=2 · 5 images');
  {
    const st = makeCreditState({
      credits: 2,
      is_pro: false,
      is_trial: false,
      is_vip: false,
    });
    let networkHits = 0;
    const job = createStageBatchJob({
      stage: 'image',
      chapter: 1,
      title: 'Gen ảnh · partial',
      concurrency: 1,
      itemGapMs: 0,
      items: Array.from({ length: 5 }, (_, i) => ({
        label: `p${i + 1}`,
        chapter: 1,
        sceneIndex: 0,
        promptIndex: i,
      })),
    });
    const finished = await runStageBatch(job.id, async () => {
      gateImage(st);
      networkHits += 1;
      // success path — no throw
    });
    const p = jobProgress(finished!);
    assert.equal(networkHits, 2, 'only 2 shots reach gen');
    assert.equal(p.done, 2);
    assert.equal(p.failed, 3);
    assert.equal(st.get().credits, 0);
    console.log('OK partial image', {
      networkHits,
      done: p.done,
      failed: p.failed,
      credits: st.get().credits,
    });
  }

  // --- 5) Video partial: 3 credits, 3 clips (cost 2) → 1 OK, 2 fail ---
  section('Partial · Free credits=3 · 3 videos cost2');
  {
    const st = makeCreditState({
      credits: 3,
      is_pro: false,
      is_trial: false,
      is_vip: false,
    });
    let networkHits = 0;
    const job = createStageBatchJob({
      stage: 'video',
      chapter: 1,
      title: 'Gen video · partial',
      concurrency: 1,
      itemGapMs: 0,
      items: Array.from({ length: 3 }, (_, i) => ({
        label: `v${i + 1}`,
        chapter: 1,
        sceneIndex: 0,
        promptIndex: i,
      })),
    });
    const finished = await runStageBatch(job.id, async () => {
      gateVideo(st);
      networkHits += 1;
    });
    const p = jobProgress(finished!);
    assert.equal(networkHits, 1);
    assert.equal(p.done, 1);
    assert.equal(p.failed, 2);
    assert.equal(st.get().credits, 1, '3-2=1 leftover');
    console.log('OK partial video', {
      networkHits,
      done: p.done,
      failed: p.failed,
      credits: st.get().credits,
    });
  }

  // --- 6) Paid Pro credits=0 → unlimited ---
  section('PRO paid · credits=0 · batch still runs');
  {
    const st = makeCreditState({
      credits: 0,
      is_pro: true,
      is_trial: false,
      is_vip: false,
    });
    const job = createStageBatchJob({
      stage: 'image',
      chapter: 1,
      title: 'Pro unlimited',
      concurrency: 1,
      itemGapMs: 0,
      items: Array.from({ length: 3 }, (_, i) => ({
        label: `p${i + 1}`,
        chapter: 1,
        sceneIndex: 0,
        promptIndex: i,
      })),
    });
    const finished = await runStageBatch(job.id, async () => {
      gateImage(st);
    });
    const p = jobProgress(finished!);
    assert.equal(p.done, 3);
    assert.equal(p.failed, 0);
    assert.equal(st.get().credits, 999_999_999);
    console.log('OK pro unlimited', { done: p.done, credits: st.get().credits });
  }

  // --- 7) Trial (is_pro+is_trial) credits=0 → blocked (same as free) ---
  section('TRIAL · credits=0 · blocked');
  {
    const st = makeCreditState({
      credits: 0,
      is_pro: true,
      is_trial: true,
      is_vip: false,
    });
    assert.throws(() => gateImage(st), /HẾT_TÍN_DỤNG/);
    assert.throws(() => gateVideo(st), /HẾT_TÍN_DỤNG/);
    console.log('OK trial deducts, not unlimited when credits=0');
  }

  // --- 8) Source wiring check: handlers call deduct before network ---
  section('source wiring (static)');
  {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const hooks = fs.readFileSync(
      path.join(process.cwd(), 'src/app/workspace/hooks/useImagePromptActions.ts'),
      'utf8',
    );
    assert.ok(
      hooks.includes('deductCredits(1)'),
      'handleGenerateImage must deductCredits(1)',
    );
    assert.ok(
      hooks.includes('deductCredits(2)'),
      'handleGenerateVideo must deductCredits(2)',
    );
    assert.ok(
      hooks.includes('handleGenerateAllImages'),
      'batch image handler exists',
    );
    assert.ok(
      hooks.includes('handleGenerateAllVideos'),
      'batch video handler exists',
    );
    // Batch uses silentError=true → credit toast suppressed per-item
    const allImgIdx = hooks.indexOf('handleGenerateAllImagesInner');
    const allVidIdx = hooks.indexOf('handleGenerateAllVideosInner');
    assert.ok(allImgIdx > 0 && allVidIdx > 0);
    const imgSlice = hooks.slice(allImgIdx, allImgIdx + 4500);
    const vidSlice = hooks.slice(allVidIdx, allVidIdx + 4500);
    assert.ok(
      /handleGenerateImage\(\s*[\s\S]*?,\s*true\s*,?\s*\)/.test(imgSlice),
      'all-images calls handleGenerateImage(..., silentError true)',
    );
    assert.ok(
      /handleGenerateVideo\(\s*[\s\S]*?,\s*true\s*,?\s*\)/.test(vidSlice),
      'all-videos calls handleGenerateVideo(..., silentError true)',
    );
    // Buttons: no disabled on credits
    const scene = fs.readFileSync(
      path.join(process.cwd(), 'src/app/workspace/features/script/SceneCard.tsx'),
      'utf8',
    );
    assert.ok(scene.includes('handleGenerateAllImages(sceneIndex)'));
    assert.ok(scene.includes('handleGenerateAllVideos(sceneIndex)'));
    // Batch preflight must block credits=0 before queue
    assert.ok(
      hooks.includes('assertBatchCreditsOrToast'),
      'batch credit preflight helper required',
    );
    assert.ok(
      imgSlice.includes('assertBatchCreditsOrToast') &&
        imgSlice.includes('unitCost: 1'),
      'all-images preflight unitCost=1',
    );
    assert.ok(
      vidSlice.includes('assertBatchCreditsOrToast') &&
        vidSlice.includes('unitCost: 2'),
      'all-videos preflight unitCost=2',
    );
    console.log(
      'OK wiring: per-shot deduct · silentError per item · batch preflight credits=0 hard-stop',
    );
  }

  // --- 9) Product notes ---
  section('product notes');
  console.log(
    [
      'FIX: credits < unitCost → toast "Hết tín dụng" + return (no job queue)',
      'FIX: partial credits → warn then allow partial gen until deduct fails',
      'NOTE: SceneCard buttons still clickable (gate is in handler, not disabled)',
      'NOTE: paid Pro (is_pro && !is_trial) ignores credits balance',
      'NOTE: Free daily vault gen_image is SEPARATE (10/day) — server freeQuota',
      'NOTE: video also needs Pro/trial assertProAccess on server when enforce',
    ].join('\n'),
  );

  console.log('\n=== ALL PASS: smoke-zero-credit-batch-gen ===');
}

main().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
