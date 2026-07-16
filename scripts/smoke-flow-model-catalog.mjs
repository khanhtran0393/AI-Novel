/**
 * Empirical smoke: Flow model catalog + payload family/duration.
 * Run: node scripts/smoke-flow-model-catalog.mjs
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);
const jiti = require('jiti')(import.meta.url, { interopDefault: true });

const catalog = jiti(path.join(root, 'src/lib/flow-bridge/modelCatalog.ts'));
const payload = jiti(path.join(root, 'src/lib/flow-bridge/payloadBuilder.ts'));

const {
  FLOW_VIDEO_MODELS,
  FLOW_IMAGE_MODELS,
  FLOW_VIDEO_DURATIONS_SEC,
  FLOW_DEFAULT_VIDEO_DURATION_SEC,
  estimateTaskCredits,
  clampFlowVideoDuration,
  resolveFlowImageModelName,
  listFlowVideoModelsForUi,
  FLOW_CATALOG_META,
} = catalog;

const {
  detectVideoModelFamily,
  resolveFlowVideoModelKey,
  buildVideoT2VBody,
  buildVideoI2VBody,
  buildVideoIngredientsBody,
} = payload;

const assert = (c, m) => {
  if (!c) {
    console.error('FAIL', m);
    process.exit(1);
  }
};

assert(FLOW_VIDEO_DURATIONS_SEC.join(',') === '4,6,8', 'durations 4,6,8');
assert(FLOW_DEFAULT_VIDEO_DURATION_SEC === 8, 'default 8s');
assert(clampFlowVideoDuration(10, 'veo_3_1_t2v_fast') === 8, 'clamp 10→8');
assert(clampFlowVideoDuration(6) === 6, 'keep 6');
assert(resolveFlowImageModelName('NANO_BANANA_2') === 'NARWHAL', 'NB2→NARWHAL');
assert(resolveFlowImageModelName('NANO_BANANA_PRO') === 'GEM_PIX_2', 'NBP→GEM_PIX_2');
assert(detectVideoModelFamily('veo_3_1_r2v_fast') === 'reference', 'r2v family');
assert(detectVideoModelFamily('veo_3_1_i2v_lite_low_priority') === 'i2v', 'lite i2v');
assert(detectVideoModelFamily('veo_3_1_i2v_s_fast_fl') === 'i2v', 'fl i2v');

// Duration is clamped in catalog for UI/credits; aisandbox rejects videoLengthSeconds field
assert(clampFlowVideoDuration(10, 'veo_3_1_t2v_fast') === 8, 'clamp 10→8 for payload path');

const t2v = buildVideoT2VBody({
  projectId: 'p',
  prompt: 'x',
  videoModel: 'veo_3_1_t2v_fast',
  durationSec: 10,
});
const t2vReq = t2v.body.requests[0];
assert(t2vReq.videoModelKey === 'veo_3_1_t2v_fast', 't2v key');
assert(t2vReq.videoLengthSeconds == null, 'no illegal videoLengthSeconds field');

const i2v = buildVideoI2VBody({
  projectId: 'p',
  prompt: 'x',
  startMediaId: 'm1',
  videoModel: 'veo_3_1_i2v_s_fast',
  durationSec: 6,
  aspectRatio: '9:16',
});
const i2vReq = i2v.body.requests[0];
assert(
  i2vReq.videoModelKey === 'veo_3_1_i2v_s_fast_portrait',
  'portrait resolve ' + i2vReq.videoModelKey,
);

const i2vFl = buildVideoI2VBody({
  projectId: 'p',
  prompt: 'x',
  startMediaId: 'm1',
  endMediaId: 'm2',
  videoModel: 'veo_3_1_i2v_s_fast',
  durationSec: 8,
});
const flReq = i2vFl.body.requests[0];
assert(flReq.videoModelKey === 'veo_3_1_i2v_s_fast_fl', 'firstLast ' + flReq.videoModelKey);
assert(i2vFl.url.includes('StartAndEndImage'), 'endpoint fl');

const i2vFlP = buildVideoI2VBody({
  projectId: 'p',
  prompt: 'x',
  startMediaId: 'm1',
  endMediaId: 'm2',
  videoModel: 'veo_3_1_i2v_s_fast',
  durationSec: 8,
  aspectRatio: '9:16',
});
assert(
  i2vFlP.body.requests[0].videoModelKey === 'veo_3_1_i2v_s_fast_portrait_fl',
  'portrait+fl ' + i2vFlP.body.requests[0].videoModelKey,
);

const ing = buildVideoIngredientsBody({
  projectId: 'p',
  prompt: 'x',
  referenceMediaIds: ['a'],
  durationSec: 8,
});
const ingReq = ing.body.requests[0];
assert(ingReq.videoModelKey === 'veo_3_1_r2v_fast', 'default r2v ' + ingReq.videoModelKey);

let threw = false;
try {
  resolveFlowVideoModelKey('i2v', { videoModel: 'veo_3_1_t2v_fast' });
} catch {
  threw = true;
}
assert(threw, 'MODEL_MISMATCH t2v on i2v');

const ui = listFlowVideoModelsForUi();
assert(ui.some((m) => m.id === 'veo_3_1_r2v_fast'), 'ui r2v');
assert(ui.every((m) => !m.uiHidden), 'no hidden in ui');
assert(ui.some((m) => m.id === 'veo_3_1_i2v_lite_low_priority'), 'ui lite lp');

const cr = estimateTaskCredits({
  kind: 'video',
  modelId: 'veo_3_1_i2v_s_fast',
  durationSec: 8,
  paygate: 'pro',
});
assert(cr === 20, 'credits pro 20 got ' + cr);
const crU = estimateTaskCredits({
  kind: 'video',
  modelId: 'veo_3_1_i2v_s_fast',
  durationSec: 8,
  paygate: 'ultra',
});
assert(crU === 10, 'credits ultra 10 got ' + crU);
const cr4 = estimateTaskCredits({
  kind: 'video',
  modelId: 'veo_3_1_i2v_s_fast',
  durationSec: 4,
  paygate: 'pro',
});
assert(cr4 === 10, 'credits pro 4s=10 got ' + cr4);

console.log(
  JSON.stringify(
    {
      ok: true,
      videoTotal: FLOW_VIDEO_MODELS.length,
      videoUi: ui.length,
      images: FLOW_IMAGE_MODELS.length,
      meta: FLOW_CATALOG_META,
      samples: {
        t2vKey: t2vReq.videoModelKey,
        i2vPortrait: i2vReq.videoModelKey,
        i2vFl: flReq.videoModelKey,
        r2vDefault: ingReq.videoModelKey,
        proFast8cr: cr,
        ultraFast8cr: crU,
        proFast4cr: cr4,
      },
    },
    null,
    2,
  ),
);
