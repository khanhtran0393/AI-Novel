import fs from 'fs';
import path from 'path';
import type { TTSProvider } from '../ttsTypes';
import { generateCapCutTTS } from '../engines/capcut';

/** Owner: TTS platform `capcut_tts` — hard-fail khi thiếu CapCut/sscronet */
export const provider_capcut_tts: TTSProvider = {
  name: 'CapCut TTS',
  supportsNativeSpeed: false,
  supportsNativePitch: false,
  generate: async (text, opts) => {
    const localAppData =
      process.env.LOCALAPPDATA ||
      path.join(process.env.USERPROFILE || '', 'AppData', 'Local');
    const capcutAppsDir = path.join(localAppData, 'CapCut', 'Apps');
    let capcutInstalled = false;
    if (fs.existsSync(capcutAppsDir)) {
      try {
        const versions = fs
          .readdirSync(capcutAppsDir)
          .filter((f) => fs.statSync(path.join(capcutAppsDir, f)).isDirectory());
        for (const v of versions) {
          if (fs.existsSync(path.join(capcutAppsDir, v, 'sscronet.dll'))) {
            capcutInstalled = true;
            break;
          }
        }
      } catch {
        capcutInstalled = false;
      }
    }

    if (!capcutInstalled) {
      throw new Error(
        'CapCut TTS: thiếu CapCut/sscronet.dll — cài CapCut hoặc chọn platform khác (không fallback Edge).',
      );
    }

    const buffer = await generateCapCutTTS(text, opts.voice);
    return {
      buffer,
      method: `CapCut TTS (${opts.voice})`,
      nativeSpeedApplied: false,
      nativePitchApplied: false,
    };
  },
};
