import fs from 'fs';
import crypto from 'crypto';
import {
  inspectTtsAudioFile,
  type TtsAudioQuality,
} from '../src/lib/tts/audioQuality';
import {
  buildPreviewCacheId,
  normalizePreviewCacheInput,
  type PreviewCacheKeyInput,
} from '../src/lib/tts/previewCache';
import { ttsPreviewTimeoutMs } from '../src/app/workspace/modules/tts/previewTimeout';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const goodFiles = [
  'data/vina-voices/samples/Long_Tieng_Phim_Nu_Tre_1.wav',
  'data/vina-voices/samples/Long_Tieng_Phim_Nam_Gia_1.wav',
];

const knownBadFiles = [
  'data/tts-preview-cache/pv_vina_voice_0c3516ddf84be7d62da5.wav',
  'data/tts-preview-cache/pv_omnivoice_local_4a873432d15850bdac33.wav',
  'data/tts-preview-cache/pv_omnivoice_local_053dafd7fb9abf1db92b.wav',
].filter((file) => fs.existsSync(file));

const goodResults: Record<string, TtsAudioQuality> = {};
for (const file of goodFiles) {
  assert(fs.existsSync(file), `missing production reference sample: ${file}`);
  const quality = inspectTtsAudioFile(file);
  assert(quality.ok, `production reference rejected: ${file}: ${quality.reasons.join('; ')}`);
  goodResults[file] = quality;
}

const rejectedResults: Record<string, TtsAudioQuality> = {};
for (const file of knownBadFiles) {
  const quality = inspectTtsAudioFile(file);
  assert(!quality.ok, `known corrupt production cache unexpectedly passed: ${file}`);
  rejectedResults[file] = quality;
}

assert(
  ttsPreviewTimeoutMs('vina_voice') >= 250_000,
  'Vina UI timeout must exceed the 240s daemon budget',
);
assert(
  ttsPreviewTimeoutMs('edge_tts') >= 100_000,
  'Edge UI timeout must cover cold WS (server first try 55s + retries)',
);
assert(
  ttsPreviewTimeoutMs('omnivoice_local') >= 300_000,
  'OmniVoice UI timeout must cover cold model load',
);

const cacheInput: PreviewCacheKeyInput = {
  platform: 'vina_voice',
  voice: 'Lồng Tiếng Phim - Nữ Trẻ 1',
  speed: 1,
  pitch: 0,
  text: 'Kiểm tra phiên bản cache.',
  speakerSeed: 2336,
  styleSeed: 4125,
  nfeStep: 20,
};
const normalized = normalizePreviewCacheInput(cacheInput);
const oldPayload = [
  normalized.platform,
  normalized.voice,
  String(normalized.speed),
  String(normalized.pitch),
  normalized.text,
  String(normalized.speakerSeed ?? ''),
  String(normalized.styleSeed ?? ''),
  String(normalized.nfeStep ?? ''),
  String(normalized.variantKey ?? ''),
  'nosample',
].join('|');
const oldId = crypto
  .createHash('sha1')
  .update(oldPayload, 'utf8')
  .digest('hex')
  .slice(0, 20);
const newId = buildPreviewCacheId(cacheInput);
assert(newId !== oldId, 'preview cache version must invalidate pre-fix audio');

console.log(
  JSON.stringify(
    {
      ok: true,
      vinaTimeoutMs: ttsPreviewTimeoutMs('vina_voice'),
      cacheVersionChanged: { oldId, newId },
      accepted: Object.fromEntries(
        Object.entries(goodResults).map(([file, quality]) => [
          file,
          {
            durationSec: quality.durationSec,
            rmsDb: quality.rmsDb,
            zeroCrossingRate: quality.zeroCrossingRate,
          },
        ]),
      ),
      rejected: Object.fromEntries(
        Object.entries(rejectedResults).map(([file, quality]) => [
          file,
          quality.reasons,
        ]),
      ),
    },
    null,
    2,
  ),
);
