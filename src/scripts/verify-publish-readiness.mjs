/**
 * Smoke: publish readiness + timestamp sync + genre packs.
 * Run: npx tsx src/scripts/verify-publish-readiness.mjs
 */
import { evaluatePublishReadiness } from '../lib/publishReadiness.ts';
import {
  resyncPromptTimestamps,
  timestampsNeedResync,
} from '../lib/timestampSync.ts';
import { GENRE_PACKS, applyGenrePackDefaults } from '../lib/genrePacks.ts';
import { evaluateCredentialHealth } from '../lib/credentialHealth.ts';
import { createChannelProfile } from '../lib/channelModel.ts';
import { mergeLiveSettingsIntoChannel } from '../lib/outputCriteria.ts';
import { evaluateShipGate, healthInputFromStore } from '../lib/shipGate.ts';

let failed = 0;
const assert = (c, m) => {
  if (!c) {
    console.error('✗', m);
    failed += 1;
  } else console.log('✓', m);
};

const ready = evaluatePublishReadiness({
  chapterNum: 1,
  script: 'A '.repeat(5000) + '\n[CẢNH 1]\nx\n[CẢNH 2]\ny\n[CẢNH 3]\nz',
  soTuChuong: 4250,
  hook: 'Một đêm mưa, cửa sổ kẹt lại và tiếng gõ vọng từ phía trong…',
  thumbnailLine: 'CỬA SỔ KẸT',
  seoTitle: 'Bí mật sau cánh cửa sổ kẹt — bạn sẽ không tin',
  seoDescription:
    'CỬA SỔ KẸT\n\nĐêm ấy tiếng gõ không phải từ ngoài… Xem full chương để biết sự thật.\n\n#matthe #truyen',
  thumbnailPrompt: 'cinematic youtube thumbnail still, 16:9, high contrast',
  thumbnailImagePath: 'D:/tmp/thumb.png',
  ttsPlatform: 'vina_voice',
  visualDna: 'foggy alley',
  generatedAudioPaths: { '1_0': { path: 'a.mp3', duration: 12 } },
  generatedImages: {
    '1_0_0': 'img.png',
    '1_0_1': 'img2.png',
    '1_0_2': 'img3.png',
  },
  youtubeSafe: { enforceEditorGate: false, requireHumanEdit: false },
});
assert(ready.fail === 0, 'publish ready when assets complete');
assert(ready.ready === true, 'ready flag true');

const notReady = evaluatePublishReadiness({
  chapterNum: 1,
  script: '',
  youtubeSafe: { enforceEditorGate: false, requireHumanEdit: false },
});
assert(notReady.ready === false, 'empty script not ready');

const prompts = [
  { timestamp: '0-10s', prompt: 'a' },
  { timestamp: '10-20s', prompt: 'b' },
];
assert(timestampsNeedResync(prompts, 100, 0.15), 'detect drift');
const synced = resyncPromptTimestamps(prompts, 40);
assert(synced[0].timestamp?.startsWith('0'), 'resync start');
assert(synced.length === 2, 'resync count');

assert(GENRE_PACKS.length >= 4, 'genre packs present');
const applied = applyGenrePackDefaults(GENRE_PACKS[0]);
assert(!!applied.visualDna && !!applied.ttsDna.platform, 'genre apply');

const health = evaluateCredentialHealth({
  apiKey: 'x',
  imageProvider: 'gemini',
  ttsConfig: { platform: 'edge_tts', voice: 'vi-VN-HoaiMyNeural' },
});
assert(health.fail === 0, 'health ok with gemini key');

// Ship gate: settings + credential + assets
const ch = mergeLiveSettingsIntoChannel(
  createChannelProfile('Gate', { defaultShipMode: 'short' }),
  {
    imageProvider: 'gemini',
    imageAspectRatio: '9:16',
    videoAspectRatio: '9:16',
    videoProvider: 'veo',
  },
  { platform: 'edge_tts', voice: 'vi-VN-HoaiMyNeural', speed: 1 },
);
const gateOk = evaluateShipGate({
  channel: ch,
  mode: 'short',
  health: healthInputFromStore({
    apiKey: 'x',
    imageProvider: 'gemini',
    videoProvider: 'veo',
    ttsConfig: { platform: 'edge_tts', voice: 'vi-VN-HoaiMyNeural' },
  }),
  hasAudio: true,
  hasImages: true,
  hasVideos: false,
});
assert(gateOk.ok && !gateOk.blocked, 'ship gate ok with assets+creds');

const gateBlock = evaluateShipGate({
  channel: ch,
  mode: 'short',
  health: healthInputFromStore({
    imageProvider: 'grok',
    ttsConfig: { platform: 'edge_tts', voice: 'x' },
  }),
  hasAudio: false,
  hasImages: false,
  hasVideos: false,
  requireVisualAssets: true,
});
assert(gateBlock.blocked === true, 'ship gate blocks missing assets/creds');

// Media DNA mismatch warn
const { stampAudioDna, evaluateMediaDnaMatch } = await import(
  '../lib/mediaDnaMatch.ts'
);
const dnaReport = evaluateMediaDnaMatch({
  chapterNum: 1,
  audioKeys: ['1_0'],
  stamps: {
    '1_0': stampAudioDna({
      ttsPlatform: 'google',
      ttsVoice: 'old',
      ttsSpeed: 1,
      ttsPitch: 0,
    }),
  },
  live: {
    ttsPlatform: 'edge_tts',
    ttsVoice: 'vi-VN-HoaiMyNeural',
    ttsSpeed: 1,
    ttsPitch: 0,
  },
});
assert(dnaReport.hasIssues === true, 'media DNA detects platform mismatch');

if (failed) {
  console.error('FAIL', failed);
  process.exit(1);
}
console.log('\nALL PUBLISH/INFRA SMOKE PASS');

