import fs from 'fs';
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
 * OmniVoice Local only — no Edge / Piper / foreign-engine fallback (B10).
 * Preview + durable user-clone (lsc_*): may play saved ref sample when Omni inference fails.
 */
export const provider_omnivoice_local: TTSProvider = {
  name: 'OmniVoice Local',
  supportsNativeSpeed: true,
  supportsNativePitch: false,
  generate: async (text, opts) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const extra = opts as any;
    const isPreview = extra.isPreview === true;
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

    // Cold model + GPU queue can exceed 3 min; no Edge fallback (B10).
    const timeoutMs = DESIGN_PRESETS.has(voice.toLowerCase()) ? 320_000 : 360_000;

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
      // Preview only: durable Voice Clone sample so Nghe thử / ▶ never dead-ends
      // when Omni runtime is broken (libtorchcodec, OOM, …). Full gen still hard-fails.
      if (isPreview && /^lsc_/i.test(voice)) {
        try {
          const { resolveCloneAudioPath } = await import('@/lib/laStudioClones');
          const hit = resolveCloneAudioPath(voice);
          if (hit && fs.existsSync(hit.path)) {
            const buffer = fs.readFileSync(hit.path);
            if (buffer.length > 400) {
              console.warn(
                `[OmniVoice] preview fallback user-clone sample id=${voice} after: ${msg.slice(0, 120)}`,
              );
              return {
                buffer,
                method: `OmniVoice-UserCloneSample:${voice}`,
                nativeSpeedApplied: false,
                nativePitchApplied: false,
              };
            }
          }
        } catch {
          /* rethrow original */
        }
      }
      throw new Error(
        msg.startsWith('OmniVoice') || msg.startsWith('GPU TTS')
          ? msg
          : `OmniVoice: ${msg}`,
      );
    }
  },
};
