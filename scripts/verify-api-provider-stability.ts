import assert from 'node:assert/strict';

import {
  resolveAiProvider,
  type AiProviderSelection,
} from '../src/contracts/aiProvider';
import {
  DEFAULT_GEMINI_TEXT_MODEL,
  GEMINI_IMAGE_MODEL,
  GEMINI_INTERACTIONS_ENDPOINT,
  GEMINI_TEXT_MODEL_OPTIONS,
  GEMINI_TEXT_MODELS,
  GEMINI_TTS_MODEL,
  GEMINI_VEO_MODELS,
  RETIRED_GOOGLE_MODELS,
  assertSupportedGeminiTextModel,
  isSupportedGeminiTextModel,
  normalizePersistedGeminiTextModel,
} from '../src/lib/geminiModels';
import {
  classifyLimitMessage,
  assertPoolHasCapacity,
  clearAllKeyState,
  getKeyRotateSnapshot,
  getPoolWaitInfo,
  markKeyAttempt,
  markKeyLimited,
} from '../src/lib/apiKeyRotate';
import {
  normalizeGeminiCompatibleEndpoint,
  normalizeOpenAiCompatibleEndpoint,
  redactUrlSecrets,
} from '../src/lib/apiSecurity';
import { splitTtsText } from '../src/app/api/generate-tts/audioUtils';
import { cleanAndParseJson } from '../src/app/api/generate/modelClients';

function provider(input: Partial<AiProviderSelection> & Pick<AiProviderSelection, 'model'>) {
  return resolveAiProvider({
    model: input.model,
    explicitProvider: input.explicitProvider,
    customApiBaseUrl: input.customApiBaseUrl,
    customApiProtocol: input.customApiProtocol,
    firstKey: input.firstKey,
  });
}

assert.equal(provider({ model: 'gemini-3.6-flash' }), 'gemini');
assert.equal(provider({ model: 'gpt-4o' }), 'openai');
assert.equal(provider({ model: 'o3-mini' }), 'openai');
assert.equal(provider({ model: 'claude-sonnet-5' }), 'anthropic');
assert.equal(
  provider({
    model: 'grok-4.5',
    explicitProvider: 'grok',
    firstKey: 'gsk_not_an_xai_key',
  }),
  'grok',
);
assert.equal(
  provider({
    model: 'llama-3.3-70b-versatile',
    explicitProvider: 'grok',
    firstKey: 'gsk_groq_key',
  }),
  'groq',
);
assert.equal(
  provider({
    model: 'deepseek-chat',
    explicitProvider: 'custom',
    customApiBaseUrl: 'https://openrouter.ai/api',
    customApiProtocol: 'openai',
  }),
  'custom-openai',
);
assert.throws(
  () => provider({ model: 'deepseek-chat' }),
  /Custom Base URL|provider/i,
);

assert.equal(DEFAULT_GEMINI_TEXT_MODEL, 'gemini-3.6-flash');
assert.ok(GEMINI_TEXT_MODELS.includes('gemini-3.6-flash'));
assert.deepEqual(
  GEMINI_TEXT_MODEL_OPTIONS.map((model) => model.value),
  [...GEMINI_TEXT_MODELS],
);
assert.equal(isSupportedGeminiTextModel('gemini-3.5-flash'), true);
assert.equal(isSupportedGeminiTextModel('gemini-2.5-pro'), true);
assert.equal(
  normalizePersistedGeminiTextModel('gemini-2.0-flash'),
  DEFAULT_GEMINI_TEXT_MODEL,
);
assert.throws(
  () => assertSupportedGeminiTextModel('gemini-2.0-flash'),
  /ngừng|stable|deprecated|shut/iu,
);
assert.throws(
  () => assertSupportedGeminiTextModel('gemini-3-flash-preview'),
  /ngừng|stable|preview/iu,
);
assert.equal(GEMINI_IMAGE_MODEL, 'gemini-3.1-flash-image');
assert.equal(
  GEMINI_INTERACTIONS_ENDPOINT,
  'https://generativelanguage.googleapis.com/v1beta/interactions',
);
assert.equal(GEMINI_TTS_MODEL, 'gemini-3.1-flash-tts-preview');
assert.deepEqual(GEMINI_VEO_MODELS, [
  'veo-3.1-fast-generate-preview',
  'veo-3.1-generate-preview',
  'veo-3.1-lite-generate-preview',
]);
for (const model of RETIRED_GOOGLE_MODELS) {
  assert.ok(!GEMINI_TEXT_MODELS.includes(model));
  assert.ok(!GEMINI_VEO_MODELS.includes(model));
}

clearAllKeyState();
const duplicateKey = 'AIza-DUPLICATE-STABILITY-ABCD';
markKeyLimited(
  duplicateKey,
  'models/gemini-2.0-flash is not found for API version v1',
  404,
);
assert.equal(classifyLimitMessage('model is not found', 404), 'model');
assert.equal(
  classifyLimitMessage(
    'models/gemini-3-flash-preview is not supported for generateContent',
    400,
  ),
  'model',
);
assert.equal(
  classifyLimitMessage(
    'Your API key was reported as leaked. Please use another API key.',
    403,
  ),
  'auth',
);
assert.equal(getPoolWaitInfo(Array(16).fill(duplicateKey)), null);
assert.equal(
  getKeyRotateSnapshot(Array(16).fill(duplicateKey)).keys.length,
  1,
);

clearAllKeyState();
markKeyLimited(duplicateKey, 'API key not valid', 400);
const authWait = getPoolWaitInfo([duplicateKey]);
assert.equal(authWait?.reason, 'auth');
assert.equal(authWait?.waitMs, 0);
assert.match(authWait?.message || '', /Chờ không thể khôi phục/);
assert.throws(
  () => assertPoolHasCapacity([duplicateKey]),
  (error: unknown) =>
    error instanceof Error &&
    (error as Error & { code?: string }).code === 'AUTH' &&
    (error as Error & { status?: number }).status === 401,
);

clearAllKeyState();
markKeyAttempt(duplicateKey);
clearAllKeyState();
const cleared = getKeyRotateSnapshot([duplicateKey]).keys[0];
assert.equal(cleared.rpmUsed, 0);
assert.equal(cleared.rpdUsed, 0);
assert.equal(cleared.available, true);

const secretUrl =
  'https://generativelanguage.googleapis.com/v1/models/test?key=SUPER_SECRET&token=ALSO_SECRET';
const redacted = redactUrlSecrets(secretUrl);
assert.ok(!redacted.includes('SUPER_SECRET'));
assert.ok(!redacted.includes('ALSO_SECRET'));
assert.match(redacted, /REDACTED/);
assert.equal(
  new URL(
    normalizeOpenAiCompatibleEndpoint(
      'https://proxy.example/api/v1?tenant=test',
    ),
  ).pathname,
  '/api/v1/chat/completions',
);
assert.equal(
  new URL(
    normalizeGeminiCompatibleEndpoint(
      'https://proxy.example/google?tenant=test',
      'gemini-3.6-flash',
    ),
  ).pathname,
  '/google/v1beta/models/gemini-3.6-flash:generateContent',
);

const chapterText = Array.from({ length: 4250 }, (_, index) => `tu${index}`).join(
  ' ',
);
const chunks = splitTtsText(chapterText, 900);
assert.ok(chunks.length > 1);

assert.deepEqual(
  cleanAndParseJson('```json\n[{"slot":1},{"slot":2}]\n```'),
  [{ slot: 1 }, { slot: 2 }],
);
assert.deepEqual(
  cleanAndParseJson('Provider note: [{"slot":1},{"slot":2}] end'),
  [{ slot: 1 }, { slot: 2 }],
);
assert.deepEqual(
  cleanAndParseJson('{"title":"ok","items":[1,2'),
  { title: 'ok', items: [1, 2] },
);

console.log(
  JSON.stringify({
    verdict: 'API_PROVIDER_STABILITY_OK',
    providers: {
      gemini: provider({ model: 'gemini-3.6-flash' }),
      openai: provider({ model: 'gpt-4o' }),
      anthropic: provider({ model: 'claude-sonnet-5' }),
      custom: provider({
        model: 'deepseek-chat',
        explicitProvider: 'custom',
        customApiBaseUrl: 'https://openrouter.ai/api',
        customApiProtocol: 'openai',
      }),
    },
    gemini: {
      defaultText: DEFAULT_GEMINI_TEXT_MODEL,
      image: GEMINI_IMAGE_MODEL,
      tts: GEMINI_TTS_MODEL,
      veo: GEMINI_VEO_MODELS,
    },
    quota: {
      duplicatePoolDeduped: true,
      retiredModelDoesNotCooldown: true,
      fullResetClearsUsage: true,
    },
    ttsChunkCount: chunks.length,
    jsonRepair: true,
    secretRedaction: true,
  }),
);
