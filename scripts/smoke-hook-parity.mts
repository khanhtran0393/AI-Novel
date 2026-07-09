/**
 * Empirical smoke test: Hook scene parity helpers (990 index, migration, labels).
 * Run: npx tsx scripts/smoke-hook-parity.mts
 */
import {
  YOUTUBE_HOOK_SCENE_INDEX,
  LEGACY_HOOK_SCENE_INDEX,
  YOUTUBE_HOOK_DEFAULT_DURATION_SEC,
  scenePromptCode,
  isHookSceneIndex,
  migrateHookAssetKeys,
  buildYoutubeChapters,
  buildCutPlan,
} from '../src/lib/youtubeSafe';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error('ASSERT FAIL: ' + msg);
}

console.log('--- Hook parity smoke ---');
console.log('HOOK_INDEX', YOUTUBE_HOOK_SCENE_INDEX);
console.log('LEGACY', LEGACY_HOOK_SCENE_INDEX);
console.log('DEFAULT_DUR', YOUTUBE_HOOK_DEFAULT_DURATION_SEC);

assert(YOUTUBE_HOOK_SCENE_INDEX === 990, 'index is 990');
assert(LEGACY_HOOK_SCENE_INDEX === -1, 'legacy is -1');
assert(YOUTUBE_HOOK_DEFAULT_DURATION_SEC === 30, 'default 30s');
assert(isHookSceneIndex(990) === true, 'isHook 990');
assert(isHookSceneIndex(-1) === true, 'isHook -1');
assert(isHookSceneIndex(0) === false, 'not hook 0');
assert(scenePromptCode(990, 0) === 'hook-01', 'label hook-01');
assert(scenePromptCode(0, 2) === 'c1-03', 'label c1-03');

const state: {
  chuong_dang_chon: number;
  danh_sach_chuong: { so_chuong: number }[];
  generatedAudioPaths: Record<string, { path: string; duration: number }>;
  generatedPrompts: Record<string, unknown[]>;
  generatedImages: Record<string, string>;
  generatedVideos: Record<string, string>;
  projectUrls: Record<string, string>;
  addGeneratedAudio: (k: string, p: string, d: number) => void;
  addGeneratedPrompts: (k: string, prompts: unknown[]) => void;
  addGeneratedImage: (k: string, p: string) => void;
  addGeneratedVideo: (k: string, p: string) => void;
  addProjectUrl: (k: string, u: string) => void;
} = {
  chuong_dang_chon: 1,
  danh_sach_chuong: [{ so_chuong: 1 }],
  generatedAudioPaths: { '1_-1': { path: '/audio/hook.mp3', duration: 28 } },
  generatedPrompts: { '1_-1': [{ prompt: 'p1' }] },
  generatedImages: { '1_-1_0': '/img/h.png' },
  generatedVideos: { '1_-1_0_video': '/vid/h.mp4' },
  projectUrls: { '1_-1_0': 'https://x' },
  addGeneratedAudio(k, p, d) {
    state.generatedAudioPaths[k] = { path: p, duration: d };
  },
  addGeneratedPrompts(k, prompts) {
    state.generatedPrompts[k] = prompts;
  },
  addGeneratedImage(k, p) {
    state.generatedImages[k] = p;
  },
  addGeneratedVideo(k, p) {
    state.generatedVideos[k] = p;
  },
  addProjectUrl(k, u) {
    state.projectUrls[k] = u;
  },
};

const n = migrateHookAssetKeys(state);
console.log('migrated count', n);
assert(n >= 5, 'migrated at least 5 assets');
assert(state.generatedAudioPaths['1_990']?.path === '/audio/hook.mp3', 'audio migrated');
assert(state.generatedPrompts['1_990']?.length === 1, 'prompts migrated');
assert(state.generatedImages['1_990_0'] === '/img/h.png', 'image migrated');
assert(state.generatedVideos['1_990_0_video'] === '/vid/h.mp4', 'video migrated');
assert(state.projectUrls['1_990_0'] === 'https://x', 'project url migrated');

// Idempotent second pass
const n2 = migrateHookAssetKeys(state);
assert(n2 === 0, 'second migrate is no-op');

const ch = 1;
const assetKey = `${ch}_${YOUTUBE_HOOK_SCENE_INDEX}`;
const imageKey = `${assetKey}_0`;
console.log('assetKey', assetKey);
console.log('imageKey', imageKey);
assert(assetKey === '1_990', 'asset key');
assert(imageKey === '1_990_0', 'image key');
assert(String(assetKey) !== `${ch}_0`, 'no collide with scene 0');

const chapters = buildYoutubeChapters([
  { title: 'Hook ~30s', durationSec: 28 },
  { title: 'Canh 1', durationSec: 60 },
]);
console.log('chapters', chapters.map((c) => c.line).join(' | '));
assert(chapters[0].line.startsWith('0:00'), 'hook at 0:00');
assert(chapters[1].startSec === 28, 'scene1 after hook');

const cut = buildCutPlan({
  chapter: 1,
  sceneIndex: YOUTUBE_HOOK_SCENE_INDEX,
  durationSec: 30,
  prompts: [{ image_prompt: 'a' }, { image_prompt: 'b' }],
});
console.log('cutPlan scene', cut.sceneIndex, 'cuts', cut.cuts.length, 'total', cut.totalDuration);
assert(cut.sceneIndex === 990, 'cut plan uses 990');
assert(cut.cuts.length === 2, '2 cuts');
assert(cut.totalDuration === 30, 'total 30');

console.log('PASS: all hook parity checks ok');
