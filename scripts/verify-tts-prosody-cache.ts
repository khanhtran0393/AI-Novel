import { buildClientPreviewKey } from '../src/app/workspace/modules/tts/previewClientCache';
import crypto from 'crypto';
import {
  buildPreviewCacheId,
  type PreviewCacheKeyInput,
} from '../src/lib/tts/previewCache';
import {
  buildSceneCacheId,
  type SceneCacheKeyInput,
} from '../src/lib/tts/sceneAudioCache';
import { buildTtsCacheVariantKey } from '../src/lib/tts/prosodyVariant';

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function shortHash(value: string): string {
  return crypto.createHash('sha1').update(value, 'utf8').digest('hex').slice(0, 12);
}

const baseVariant = {
  platform: 'vina_voice',
  vinaGender: 'male',
  vinaArea: 'southern',
  vinaGroup: 'story',
  vinaEmotion: 'neutral',
  vinaReferenceAudio: 'D:/sample/a.wav',
  vinaReferenceText: 'Xin chao mau giong.',
};

const happyVariant = {
  ...baseVariant,
  vinaEmotion: 'happy',
};

const northVariant = {
  ...baseVariant,
  vinaArea: 'northern',
};

const basePreview: PreviewCacheKeyInput = {
  platform: 'vina_voice',
  voice: 'Demo Voice',
  speed: 1,
  pitch: 0,
  text: 'Xin chao, day la ban nghe thu.',
  speakerSeed: 2336,
  styleSeed: 4125,
  nfeStep: 12,
  variantKey: buildTtsCacheVariantKey(baseVariant),
};

const baseScene: SceneCacheKeyInput = {
  platform: 'vina_voice',
  voice: 'Demo Voice',
  speed: 1,
  pitch: 0,
  text: 'Mot canh dai dung de sinh TTS theo kich ban.',
  speakerSeed: 2336,
  styleSeed: 4125,
  nfeStep: 20,
  variantKey: buildTtsCacheVariantKey(baseVariant),
};

const neutralPreview = buildPreviewCacheId(basePreview);
const happyPreview = buildPreviewCacheId({
  ...basePreview,
  variantKey: buildTtsCacheVariantKey(happyVariant),
});
const northPreview = buildPreviewCacheId({
  ...basePreview,
  variantKey: buildTtsCacheVariantKey(northVariant),
});
const fasterPreview = buildPreviewCacheId({ ...basePreview, speed: 1.2 });

const neutralScene = buildSceneCacheId(baseScene);
const happyScene = buildSceneCacheId({
  ...baseScene,
  variantKey: buildTtsCacheVariantKey(happyVariant),
});
const fasterScene = buildSceneCacheId({ ...baseScene, speed: 1.2 });

const neutralClient = buildClientPreviewKey({
  voice: 'Demo Voice',
  text: basePreview.text,
  speed: 1,
  pitch: 0,
  speakerSeed: 2336,
  styleSeed: 4125,
  ...baseVariant,
});
const happyClient = buildClientPreviewKey({
  voice: 'Demo Voice',
  text: basePreview.text,
  speed: 1,
  pitch: 0,
  speakerSeed: 2336,
  styleSeed: 4125,
  ...happyVariant,
});
const fasterClient = buildClientPreviewKey({
  voice: 'Demo Voice',
  text: basePreview.text,
  speed: 1.2,
  pitch: 0,
  speakerSeed: 2336,
  styleSeed: 4125,
  ...baseVariant,
});

assert(neutralPreview !== happyPreview, 'preview cache must vary by Vina emotion');
assert(neutralPreview !== northPreview, 'preview cache must vary by Vina area');
assert(neutralPreview !== fasterPreview, 'preview cache must vary by speed');
assert(neutralScene !== happyScene, 'scene cache must vary by Vina emotion');
assert(neutralScene !== fasterScene, 'scene cache must vary by speed');
assert(neutralClient !== happyClient, 'client preview key must vary by Vina emotion');
assert(neutralClient !== fasterClient, 'client preview key must vary by speed');

console.log(
  JSON.stringify(
    {
      ok: true,
      preview: { neutralPreview, happyPreview, northPreview, fasterPreview },
      scene: { neutralScene, happyScene, fasterScene },
      client: {
        neutral: shortHash(neutralClient),
        happy: shortHash(happyClient),
        faster: shortHash(fasterClient),
      },
    },
    null,
    2,
  ),
);
