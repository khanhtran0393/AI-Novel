import fs from 'fs';
import path from 'path';
import { synthesizeVinaVoice } from '@/lib/vinaVoice';
import { synthesizeOmniVoiceLocal } from '@/lib/omnivoiceLocal';
import type { TTSProvider } from '../ttsTypes';
import { generatePiperTTS } from '../engines/piper';
import { generateEdgeTTS } from '../engines/edge';
import { generateGeminiTTS } from '../engines/gemini';
import { generateTikTokTTS } from '../engines/tiktok';
import { generateCapCutTTS } from '../engines/capcut';
import { generateOpenAICompatibleTTS } from '../engines/openaiCompat';
import { generateGoogleCloudTts } from '../engines/google';
import { mapVbeeSampleVoice, mapGoogleSampleVoice } from '../engines/sampleMaps';

/** Owner: TTS platform `vbee` only */
export const provider_vbee: TTSProvider = {
    name: 'VBee Studio (giọng mẫu local)',
    supportsNativeSpeed: true,
    supportsNativePitch: false,
    generate: async (text, opts) => {
      const mapped = mapVbeeSampleVoice(opts.voice);
      if (mapped.kind === 'piper') {
        const buffer = await generatePiperTTS(text, mapped.id, opts.speed);
        return {
          buffer,
          method: mapped.label,
          nativeSpeedApplied: true,
          nativePitchApplied: false,
        };
      }
      const speed =
        typeof opts.speed === 'number' && Number.isFinite(opts.speed) ? opts.speed : 1;
      const pitch =
        typeof opts.pitch === 'number' && Number.isFinite(opts.pitch) ? opts.pitch : 0;
      const buffer = await generateEdgeTTS(text, mapped.id, speed, pitch);
      return {
        buffer,
        method: mapped.label,
        nativeSpeedApplied: true,
        nativePitchApplied: false,
      };
    },
  };
