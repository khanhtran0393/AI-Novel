import type { TTSProvider } from '../ttsTypes';

/** Owner: TTS platform `elevenlabs` — hard-fail khi thiếu key / API fail */
export const provider_elevenlabs: TTSProvider = {
  name: 'ElevenLabs',
  supportsNativeSpeed: false,
  supportsNativePitch: false,
  generate: async (text, opts) => {
    const apiKey =
      (Array.isArray(opts.apiKeys) && opts.apiKeys[0]) ||
      process.env.ELEVENLABS_API_KEY ||
      '';

    if (!apiKey) {
      throw new Error(
        'ElevenLabs: chưa có API Key — thêm key hoặc chọn platform khác (không fallback Edge).',
      );
    }
    if (!opts.voice) {
      throw new Error('ElevenLabs: chưa chọn voice id.');
    }

    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(opts.voice)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': String(apiKey),
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_multilingual_v2',
        }),
        signal: AbortSignal.timeout(45_000),
      },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(
        `ElevenLabs API fail HTTP ${res.status}: ${body.slice(0, 160)} (không fallback Edge).`,
      );
    }
    const ab = await res.arrayBuffer();
    return {
      buffer: Buffer.from(ab),
      method: `ElevenLabs (${opts.voice})`,
      nativeSpeedApplied: false,
      nativePitchApplied: false,
    };
  },
};
