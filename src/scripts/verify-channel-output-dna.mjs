/**
 * Empirical check: Cấu hình đầu ra + Giọng đọc toàn cục as channel DNA rules.
 * Run: npx tsx src/scripts/verify-channel-output-dna.mjs
 */
import {
  createChannelProfile,
  applyChannelDnaToSnapshot,
  emptyProjectSnapshot,
  patchChannelOutputDna,
  patchChannelTtsDna,
  defaultOutputDna,
  defaultTtsDna,
} from '../lib/channelModel.ts';
import {
  captureProjectSnapshot,
  captureOutputDnaFromState,
  captureTtsDnaFromConfig,
  snapshotToWorkspacePatch,
} from '../lib/channelBridge.ts';

let failed = 0;
const assert = (cond, msg) => {
  if (!cond) {
    console.error('✗', msg);
    failed += 1;
  } else {
    console.log('✓', msg);
  }
};

// 1) Ship recipe must NOT wipe user Media config ratios
let ch = createChannelProfile('Test DNA', {
  defaultShipMode: 'short', // recipe 9:16
  aspectRatio: '16:9',
  outputDna: defaultOutputDna({
    imageAspectRatio: '2:3',
    videoAspectRatio: '16:9',
    imageProvider: 'grok',
    videoProvider: 'sora',
  }),
  ttsDna: defaultTtsDna({
    platform: 'vina_voice',
    voice: 'clone-A',
    speed: 0.92,
    pitch: 2,
    language: 'vi',
    syncMode: 'pro',
  }),
  narratorVoiceId: 'clone-A',
  ttsPlatform: 'vina_voice',
  visualDna: 'neon noir',
});

const snap = emptyProjectSnapshot({
  imageAspectRatio: '2:3',
  videoAspectRatio: '16:9',
});
const withDna = applyChannelDnaToSnapshot(ch, snap);
assert(
  withDna.imageAspectRatio === '2:3',
  'user imageAspect 2:3 preserved (not short recipe 9:16)',
);
assert(withDna.videoAspectRatio === '16:9', 'user videoAspect preserved');
assert(withDna.imageProvider === 'grok', 'imageProvider from outputDna');
assert(withDna.videoProvider === 'sora', 'videoProvider from outputDna');
assert(withDna.ttsDna?.speed === 0.92, 'tts speed in snap DNA');
assert(withDna.ttsDna?.pitch === 2, 'tts pitch in snap DNA');
assert(withDna.ttsVoice === 'clone-A', 'tts voice applied');

// 2) patch helpers mirror media + full TTS
ch = patchChannelOutputDna(ch, {
  imageProvider: 'openai',
  imageModel: 'gpt-image-1',
});
assert(ch.outputDna?.imageProvider === 'openai', 'patch outputDna imageProvider');
ch = patchChannelTtsDna(ch, { speed: 1.1, pitch: -1 });
assert(
  ch.ttsDna?.speed === 1.1 && ch.ttsDna?.pitch === -1,
  'patch ttsDna speed/pitch',
);
assert(ch.narratorVoiceId === 'clone-A', 'legacy narratorVoiceId kept');

// 3) capture + restore full workspace patch
const bind = {
  ten_tac_pham: 'N',
  setup: snap.setup,
  dan_y_tong_the: '',
  nhan_vat: [],
  nhan_vat_prompts: {},
  danh_sach_chuong: snap.danh_sach_chuong,
  chuong_dang_chon: 1,
  lorebook: '',
  tom_tat_cuon_chieu: '',
  tri_nho_ngan_han: [],
  voiceCast: snap.voiceCast,
  visualDnaPrompt: 'neon noir',
  mediaStylePreset: 'cinematic',
  imageAspectRatio: '2:3',
  videoAspectRatio: '16:9',
  imageProvider: 'openai',
  imageModel: 'gpt-image-1',
  imageCount: 2,
  videoProvider: 'sora',
  videoModel: 'sora',
  videoDuration: 10,
  generatedAudioPaths: {},
  generatedPrompts: {},
  generatedPromptsAnalysis: {},
  generatedImages: {},
  generatedImageVariants: {},
  generatedVideos: {},
  chapterHooks: {},
  humanEditFlags: {},
  editorReviews: {},
  da_dien_ra_entities: snap.da_dien_ra_entities,
  world_state: snap.world_state,
  userRules: snap.userRules,
  pipeline_step: 'outline',
  ttsConfig: {
    voice: 'clone-A',
    platform: 'vina_voice',
    language: 'vi',
    speed: 1.1,
    pitch: -1,
    syncMode: 'pro',
  },
};
const captured = captureProjectSnapshot(bind);
assert(captured.imageProvider === 'openai', 'capture imageProvider');
assert(captured.ttsDna?.syncMode === 'pro', 'capture tts syncMode');
const outDna = captureOutputDnaFromState(bind);
const ttsDna = captureTtsDnaFromConfig(bind.ttsConfig);
assert(outDna.imageCount === 2, 'capture imageCount');
assert(ttsDna.speed === 1.1, 'capture tts speed');

ch = { ...ch, projectSnapshot: captured, outputDna: outDna, ttsDna };
const patch = snapshotToWorkspacePatch(ch, captured);
assert(
  patch.mediaPatch?.imageProvider === 'openai',
  'restore mediaPatch imageProvider',
);
assert(patch.ttsConfigPatch?.speed === 1.1, 'restore full tts speed');
assert(patch.ttsConfigPatch?.syncMode === 'pro', 'restore syncMode');
assert(
  patch.imageAspectRatio === '2:3',
  'restore aspect 2:3 not short recipe 9:16',
);

if (failed) {
  console.error('\nTOTAL FAIL:', failed);
  process.exit(1);
}
console.log('\nALL CHANNEL OUTPUT DNA TESTS PASS');
