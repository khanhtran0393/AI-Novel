import fs from 'fs';
import path from 'path';
import { synthesizeVinaVoice } from '@/lib/vinaVoice';
import type { TTSProvider } from '../ttsTypes';

/** Owner: TTS platform `vina_voice` - hard-fail on selected profile/engine errors. */
export const provider_vina_voice: TTSProvider = {
  name: 'VinaVoice (Independent)',
  supportsNativeSpeed: true,
  supportsNativePitch: true,
  generate: async (text, opts) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const extra = opts as any;
    const voice = String(opts.voice || '').trim();
    const profileLooksLikeEdge = /Neural$/i.test(voice);
    const profileLooksLikePiper = /\.onnx$/i.test(voice);
    const uiSpeed =
      typeof opts.speed === 'number' && Number.isFinite(opts.speed) ? opts.speed : 1;
    const uiPitch =
      typeof opts.pitch === 'number' && Number.isFinite(opts.pitch) ? opts.pitch : 0;
    const isPreview = extra.isPreview === true;
    const isChapter = extra.isChapter === true || Number(extra.chapterNum) > 0;

    if (!voice) {
      throw new Error(
        'VinaVoice: chưa chọn profile Zero-Shot. Mở «Cấu Hình Giọng Đọc Toàn Cục» → tab Não Zero-Shot → bấm chọn một giọng 🎤 (có file mẫu).',
      );
    }
    if (profileLooksLikeEdge || profileLooksLikePiper) {
      throw new Error(
        `VinaVoice: voice «${voice}» không phải profile Zero-Shot. ` +
          `Chọn profile trong tab Não Zero-Shot hoặc đổi platform thủ công (Engine chọn tay).`,
      );
    }

    // When a catalog profile is selected, do NOT pass stale vinaReferenceAudio.
    // speakerRegistry resolves WAV from profiles_goc/user by profile name.
    const result = await synthesizeVinaVoice({
      text,
      profileName: voice,
      universalBrainMode: extra.vinaUniversalBrain !== false,
      isPreview,
      isChapter: isChapter && !isPreview,
      settings: {
        speed: uiSpeed,
        pitch_shift: uiPitch,
        gender: extra.vinaGender || 'male',
        area: extra.vinaArea || 'southern',
        group: extra.vinaGroup || 'story',
        emotion: extra.vinaEmotion || 'neutral',
        use_clone: extra.vinaUseClone !== false,
        reference_audio: '',
        reference_audio_b64: undefined,
        reference_text: '',
        speaker_seed: extra.vinaSpeakerSeed || 2336,
        style_seed: extra.vinaStyleSeed || 4125,
        engine_url:
          extra.vinaEngineUrl ||
          process.env.VINA_ENGINE_URL ||
          'http://127.0.0.1:8765',
        samples_dir:
          process.env.VINA_SAMPLES_DIR ||
          path.join(process.cwd(), 'data', 'vina-voices', 'samples'),
      },
    });

    if (!result.ok || !result.audioPath || !fs.existsSync(result.audioPath)) {
      throw new Error(result.error || 'VinaVoice synthesize failed');
    }
    if (result.warnings?.length) {
      console.warn('[TTS vina_voice] warnings:', result.warnings.join(' | '));
    }
    const buffer = fs.readFileSync(result.audioPath);
    return {
      buffer,
      method: result.method,
      nativeSpeedApplied: true,
      nativePitchApplied: true,
    };
  },
};
