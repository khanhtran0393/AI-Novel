import {
  synthesizeOmniVoiceLocal,
  isForeignOmniVoiceId,
} from '@/lib/omnivoiceLocal';
import type { TTSProvider } from '../ttsTypes';

const DESIGN_PRESETS = new Set([
  'alloy',
  'ash',
  'ballad',
  'cedar',
  'coral',
  'echo',
  'fable',
  'marin',
  'nova',
  'onyx',
  'sage',
  'shimmer',
  'verse',
  'auto',
]);

/**
 * OmniVoice Local only — no Edge / Piper / sample fallback.
 * Fail with clear Error if server offline, wrong voice, or clone missing ref.
 */
export const provider_omnivoice_local: TTSProvider = {
  name: 'OmniVoice Local',
  supportsNativeSpeed: true,
  supportsNativePitch: false,
  generate: async (text, opts) => {
    const voice = String(opts.voice || '').trim();
    if (!voice) {
      throw new Error(
        'OmniVoice: chưa chọn giọng. Chọn preset (alloy/nova…) hoặc clone trong library.',
      );
    }

    if (!DESIGN_PRESETS.has(voice.toLowerCase()) && isForeignOmniVoiceId(voice)) {
      throw new Error(
        `OmniVoice: "${voice}" là giọng engine khác (Edge/Piper/TikTok…). ` +
          `Đổi dropdown Giọng sang clone Omni (omnivoice_…) hoặc preset alloy/nova.`,
      );
    }

    const speed =
      typeof opts.speed === 'number' && Number.isFinite(opts.speed) ? opts.speed : 1;
    const pitch =
      typeof opts.pitch === 'number' && Number.isFinite(opts.pitch) ? opts.pitch : 0;

    // Timeout inside GPU exclusive slot (always releases lock; no Edge fallback)
    const timeoutMs = DESIGN_PRESETS.has(voice.toLowerCase()) ? 150_000 : 180_000;

    try {
      const result = await synthesizeOmniVoiceLocal({
        text,
        voice,
        speed,
        pitch,
        timeoutMs,
      });

      console.log(
        `[OmniVoice] OK mode=${result.mode} method=${result.method} bytes=${result.buffer.length}`,
      );

      // Omni JSON API applies speed; pitch is not in payload → FFmpeg post (nativePitchApplied:false)
      return {
        buffer: result.buffer,
        method: result.method,
        nativeSpeedApplied: true,
        nativePitchApplied: false,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(msg.startsWith('OmniVoice') || msg.startsWith('GPU TTS') ? msg : `OmniVoice: ${msg}`);
    }
  },
};
