/**
 * Empirical: Flow scene-mode sync (prompt kịch bản ↔ model).
 * npx tsx scripts/smoke-flow-scene-mode.mts
 */
import {
  resolveFlowVideoModelForScene,
  recommendFlowSceneModels,
  FLOW_SCENE_PIPELINE_PRESETS,
} from '../src/lib/flow-bridge/flowSceneMode.ts';

let fails = 0;
function ok(name: string, cond: boolean, detail = '') {
  if (cond) console.log('PASS', name, detail);
  else {
    console.error('FAIL', name, detail);
    fails += 1;
  }
}

// Missing prompt → block
{
  const r = resolveFlowVideoModelForScene({
    videoModel: 'veo_3_1_i2v_s_fast',
    hasVideoPrompt: false,
    hasStartImage: true,
  });
  ok('block_no_prompt', !r.ok && r.action === 'block');
}

// I2V no start → align T2V
{
  const r = resolveFlowVideoModelForScene({
    videoModel: 'veo_3_1_i2v_s_fast',
    hasVideoPrompt: true,
    hasStartImage: false,
    autoAlign: true,
  });
  ok(
    'i2v_no_start_to_t2v',
    r.ok && r.changed && r.modelId === 'veo_3_1_t2v_fast',
    r.modelId,
  );
}

// T2V with start → align I2V
{
  const r = resolveFlowVideoModelForScene({
    videoModel: 'veo_3_1_t2v_fast',
    hasVideoPrompt: true,
    hasStartImage: true,
    autoAlign: true,
  });
  ok(
    't2v_with_start_to_i2v',
    r.ok && r.changed && r.modelId === 'veo_3_1_i2v_s_fast',
    r.modelId,
  );
}

// Lite T2V + start + preferZero → I2V 0cr
{
  const r = resolveFlowVideoModelForScene({
    videoModel: 'veo_3_1_lite_t2v',
    hasVideoPrompt: true,
    hasStartImage: true,
    preferZeroCredit: true,
    autoAlign: true,
  });
  ok(
    'zero_prefer_i2v',
    r.ok && r.modelId === 'veo_3_1_i2v_lite_low_priority',
    r.modelId,
  );
}

// R2V no ref → block
{
  const r = resolveFlowVideoModelForScene({
    videoModel: 'veo_3_1_r2v_fast',
    hasVideoPrompt: true,
    hasStartImage: false,
    hasIngredients: false,
  });
  ok('block_r2v_no_ref', !r.ok && r.action === 'block');
}

// Extend → block
{
  const r = resolveFlowVideoModelForScene({
    videoModel: 'veo_3_1_extend_fast',
    hasVideoPrompt: true,
    hasStartImage: true,
  });
  ok('block_extend', !r.ok);
}

// Upsample → block
{
  const r = resolveFlowVideoModelForScene({
    videoModel: 'veo_3_1_upsampler_1080p',
    hasVideoPrompt: true,
    hasStartImage: true,
  });
  ok('block_upsample', !r.ok);
}

// I2V with start → ok no change
{
  const r = resolveFlowVideoModelForScene({
    videoModel: 'veo_3_1_i2v_lite_low_priority',
    hasVideoPrompt: true,
    hasStartImage: true,
  });
  ok('i2v_ok', r.ok && !r.changed && r.modelId === 'veo_3_1_i2v_lite_low_priority');
}

// Start+End dual stills → first+last sibling (not R2V)
{
  const r = resolveFlowVideoModelForScene({
    videoModel: 'veo_3_1_i2v_s_fast',
    hasVideoPrompt: true,
    hasStartImage: true,
    hasEndImage: true,
    autoAlign: true,
  });
  ok(
    'dual_stills_to_first_last',
    r.ok && r.modelId === 'veo_3_1_i2v_s_fast_fl',
    r.modelId,
  );
}

// Presets exist + Start+End pipeline
ok('presets_len', FLOW_SCENE_PIPELINE_PRESETS.length >= 4);
ok(
  'preset_first_last',
  FLOW_SCENE_PIPELINE_PRESETS.some((p) => p.id === 'scene_first_last'),
);
ok(
  'recommend_no_image',
  recommendFlowSceneModels({ hasVideoPrompt: true, hasStartImage: false })
    .videoModel.includes('t2v'),
);

// Requirements helper for Media Config
{
  const {
    flowVideoModelRequirements,
    formatFlowVideoModelPickToast,
  } = await import('../src/lib/flow-bridge/modelCatalog.ts');
  const fl = flowVideoModelRequirements('veo_3_1_i2v_s_fast_fl');
  ok(
    'req_fl_needs_end',
    fl.isFirstLast &&
      fl.needs.some((n) => /end|Start/i.test(n)) &&
      fl.usageSteps.length >= 3,
  );
  const t2v = flowVideoModelRequirements('veo_3_1_t2v_fast');
  ok(
    'req_t2v_no_start',
    t2v.family === 't2v' &&
      /BẮT BUỘC|KHÔNG cần ảnh/i.test(t2v.requireLine) &&
      t2v.usageSteps.length >= 3,
  );
  const r2v = flowVideoModelRequirements('veo_3_1_r2v_fast');
  ok('req_r2v', r2v.family === 'reference' && Boolean(r2v.warning));
  const toastPick = formatFlowVideoModelPickToast('veo_3_1_i2v_s_fast');
  ok(
    'toast_pick_i2v',
    /I2V|ảnh start/i.test(toastPick.title) &&
      /BẮT BUỘC|ảnh start/i.test(toastPick.body),
  );
}

if (fails > 0) {
  console.error('SMOKE_FAIL', fails);
  process.exit(1);
}
console.log('SMOKE_OK flow-scene-mode');
