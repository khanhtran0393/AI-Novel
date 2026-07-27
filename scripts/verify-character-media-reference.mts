import assert from 'node:assert/strict';

import { resolveCastIngredientPaths } from '../src/lib/flow-bridge/castIngredients.ts';
import {
  appendImageCacheBust,
  resolveImageReferenceTransportPath,
  stripImageCacheBust,
} from '../src/lib/mediaReference.ts';

const characterName = 'Ái Nhã';
const serveUrl =
  '/api/serve-image?file=char_sheet_%C3%81i_Nh%C3%A3.png&t=123456';

const refs = resolveCastIngredientPaths({
  prompt: `Close-up of ${characterName} entering the ruined laboratory`,
  sentence: `${characterName} mở mắt.`,
  nhan_vat: [characterName],
  nhan_vat_prompts: {
    [characterName]: {
      face_ref: serveUrl,
      prompt: 'same oval face, black hair and blue luminous cracks',
    },
  },
  generatedImages: {},
});

assert.equal(
  refs[0],
  '/api/serve-image?file=char_sheet_%C3%81i_Nh%C3%A3.png',
  'Cast resolver must preserve the serve-image file query while removing only cache-bust data.',
);
assert.equal(
  appendImageCacheBust(refs[0], 999),
  '/api/serve-image?file=char_sheet_%C3%81i_Nh%C3%A3.png&t=999',
  'Cache bust must be appended as a separate query parameter.',
);
assert.equal(
  stripImageCacheBust(`${refs[0]}&t=999`),
  refs[0],
  'Removing cache-bust must preserve the file query.',
);
assert.equal(
  resolveImageReferenceTransportPath(`${refs[0]}&t=999`),
  'public/images/char_sheet_Ái_Nhã.png',
  'The API transport path must resolve back to the real public image file.',
);

console.log(
  `[verify-character-media-reference] PASS refs=${JSON.stringify(refs)}`,
);
