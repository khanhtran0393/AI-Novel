import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const durable = require('../electron/durableStore.js');

const appData = process.env.APPDATA?.trim();
if (!appData) {
  throw new Error('APPDATA is unavailable; cannot locate the Electron durable store.');
}

const userData = path.join(appData, 'ai-novel-script-generator');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const paths = durable.getPaths(userData, root);
const best = durable.readBest(paths);
if (!best?.raw) {
  throw new Error(`No valid AI Novel durable store found under ${userData}.`);
}

const parsed = JSON.parse(best.raw);
const hasEnvelope = Boolean(parsed && typeof parsed === 'object' && parsed.state);
const state = hasEnvelope ? { ...parsed.state } : { ...parsed };

if (state.imageProvider !== 'flow' || state.videoProvider !== 'flow') {
  throw new Error(
    `FLOW_PROVIDER_REQUIRED: expected image/video provider "flow", got ` +
      `${String(state.imageProvider)}/${String(state.videoProvider)}.`,
  );
}
if (!['16:9', '9:16'].includes(String(state.videoAspectRatio))) {
  throw new Error(
    `FLOW_VIDEO_RATIO_INVALID: ${String(state.videoAspectRatio)}; choose 16:9 or 9:16.`,
  );
}
if (![4, 6, 8].includes(Number(state.videoDuration))) {
  throw new Error(
    `FLOW_DURATION_INVALID: ${String(state.videoDuration)}; choose 4, 6, or 8 seconds.`,
  );
}

const previousVideoModel = String(state.videoModel || '');
let changed = false;
if (previousVideoModel === 'veo_3_1_i2v_lite_low_priority') {
  state.videoModel = 'OMNI_FLASH';
  changed = true;
}

const next = JSON.stringify(hasEnvelope ? { ...parsed, state } : state);
const result = changed
  ? durable.writeAll(paths, next, { history: true })
  : { ok: true, written: [], summary: durable.scorePersistedStore(next) };

if (!result.ok) {
  throw new Error(`Durable output migration failed: ${String(result.error || 'unknown')}`);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      changed,
      source: best.source,
      written: result.written || [],
      output: {
        imageProvider: state.imageProvider,
        imageModel: state.imageModel,
        imageAspectRatio: state.imageAspectRatio,
        imageCount: state.imageCount,
        imageOutput: state.savePathImage || 'public/images',
        videoProvider: state.videoProvider,
        previousVideoModel,
        videoModel: state.videoModel,
        videoAspectRatio: state.videoAspectRatio,
        videoDuration: state.videoDuration,
        videoOutput: state.savePathVideo || 'public/video',
      },
    },
    null,
    2,
  ),
);
