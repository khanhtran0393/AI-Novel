import type { TTSProvider } from '../ttsTypes';

/**
 * Platform `vbee` đã gỡ khỏi UI chọn tay.
 * Hard-fail — cấm map mẫu Edge/Piper (IRON B10: không fallback nội dung).
 */
export const provider_vbee: TTSProvider = {
  name: 'VBee (removed)',
  supportsNativeSpeed: false,
  supportsNativePitch: false,
  generate: async () => {
    throw new Error(
      'Platform VBee đã gỡ. Chọn engine TTS khác trong Cấu hình giọng (Edge / Piper / Vina / Omni / CapCut…). Không fallback mẫu Edge.',
    );
  },
};
