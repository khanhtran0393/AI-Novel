import assert from 'node:assert/strict';

import { callConfiguredProvider } from '../src/app/api/generate/providerClients';
import { clearAllKeyState } from '../src/lib/apiKeyRotate';
import { checkSingleKeyHealth } from '../src/lib/keyHealthTracker';
import { generateGeminiTtsPcmChunk } from '../src/app/api/generate-tts/engines/gemini';

type Probe = {
  label: string;
  expectedProvider: string;
  run: () => Promise<unknown>;
};

async function expectProviderFailure(probe: Probe) {
  try {
    await probe.run();
    assert.fail(`${probe.label} unexpectedly succeeded with an invalid key`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert.ok(
      message.includes(`[${probe.expectedProvider}/`),
      `${probe.label} reached the wrong provider: ${message}`,
    );
    return { label: probe.label, routedTo: probe.expectedProvider };
  }
}

async function main() {
  clearAllKeyState();
  process.env.AI_NOVEL_PROVIDER_TIMEOUT_MS = '15000';

  const routing = await Promise.all([
  expectProviderFailure({
    label: 'Claude text',
    expectedProvider: 'anthropic',
    run: () =>
      callConfiguredProvider(
        'Reply with OK.',
        [],
        'sk-ant-invalid-routing-check',
        { provider: 'claude', model: 'claude-sonnet-5' },
      ),
  }),
  expectProviderFailure({
    label: 'OpenAI vision',
    expectedProvider: 'openai',
    run: () =>
      callConfiguredProvider(
        'Describe this pixel.',
        [{ mimeType: 'image/png', data: 'iVBORw0KGgo=' }],
        'sk-invalid-openai-routing-check',
        { provider: 'openai', model: 'gpt-4.1-mini' },
      ),
  }),
  expectProviderFailure({
    label: 'Custom DeepSeek',
    expectedProvider: 'custom-openai',
    run: () =>
      callConfiguredProvider(
        'Reply with OK.',
        [],
        'sk-or-invalid-routing-check',
        {
          provider: 'custom',
          model: 'deepseek-chat',
          customApiModel: 'deepseek-chat',
          customApiBaseUrl: 'https://openrouter.ai/api',
          customApiProtocol: 'openai',
        },
      ),
  }),
  expectProviderFailure({
    label: 'xAI Grok',
    expectedProvider: 'grok',
    run: () =>
      callConfiguredProvider(
        'Reply with OK.',
        [],
        'xai-invalid-routing-check',
        { provider: 'grok', model: 'grok-4.5' },
      ),
  }),
  expectProviderFailure({
    label: 'Gemini text',
    expectedProvider: 'gemini',
    run: () =>
      callConfiguredProvider(
        'Reply with OK.',
        [],
        'AIzaSy-invalid-routing-check',
        { provider: 'gemini', model: 'gemini-3.6-flash' },
      ),
  }),
  ]);

  await assert.rejects(
    callConfiguredProvider(
      'Reply with OK.',
      [],
      'sk-invalid-deepseek-without-custom',
      { model: 'deepseek-chat' },
    ),
    /Custom Base URL|provider/iu,
  );
  await assert.rejects(
    callConfiguredProvider(
      'Reply with OK.',
      [],
      'gsk_wrong-provider-key',
      { provider: 'grok', model: 'grok-4.5' },
    ),
    /Groq.*xAI|xAI.*Groq/iu,
  );
  await assert.rejects(
    generateGeminiTtsPcmChunk(
      'Đây là phép thử tuyến TTS.',
      'AIzaSy-invalid-interactions-tts-key',
      'Kore',
    ),
    (error: unknown) =>
      error instanceof Error &&
      Number((error as Error & { providerStatus?: number }).providerStatus) >=
        400,
  );

  const fakeGeminiKey = 'AIzaSy-invalid-health-check-secret';
  const health = await checkSingleKeyHealth(fakeGeminiKey, {
    provider: 'gemini',
    model: 'gemini-3.6-flash',
  });
  assert.notEqual(health.status, 'active');
  assert.ok(!JSON.stringify(health).includes(fakeGeminiKey));

  console.log(
    JSON.stringify({
      verdict: 'LIVE_PROVIDER_ROUTING_OK',
      routing,
      deepseekWithoutCustomRejectedBeforeRouting: true,
      groqKeyRejectedForXaiModel: true,
      geminiTtsInteractionsReached: true,
      fakeKeyHealth: health.status,
      rawKeyReturned: false,
    }),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
