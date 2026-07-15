import fs from 'fs';
import path from 'path';
import { synthesizeVinaVoice } from '@/lib/vinaVoice';
import type { TTSProvider } from '../ttsTypes';

/** Owner: TTS platform `vina_voice` — hard-fail khi engine offline/timeout (không Edge ngầm) */
export const provider_vina_voice: TTSProvider = {
  name: 'VinaVoice (Independent)',
  supportsNativeSpeed: true,
  supportsNativePitch: true,
  generate: async (text, opts) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const extra = opts as any;
    const profileLooksLikeEdge =
      typeof opts.voice === 'string' && /Neural$/i.test(opts.voice);
    const uiSpeed =
      typeof opts.speed === 'number' && Number.isFinite(opts.speed) ? opts.speed : 1;
    const uiPitch =
      typeof opts.pitch === 'number' && Number.isFinite(opts.pitch) ? opts.pitch : 0;
    const isPreview = extra.isPreview === true;
    const isChapter = extra.isChapter === true || Number(extra.chapterNum) > 0;
    // Edge Neural id is not a Vina/ONNX profile — user must pick Zero-Shot profile or switch platform.
    if (profileLooksLikeEdge && extra.vinaUseClone === false) {
      throw new Error(
        `VinaVoice: giọng "${opts.voice}" là Edge Neural — không map ngầm sang Edge. ` +
          `Chọn profile Zero-Shot (tab Não Zero-Shot) hoặc chọn platform Edge TTS thủ công.`,
      );
    }

    const profileName = profileLooksLikeEdge ? undefined : String(opts.voice || '').trim();
    // When a catalog profile is selected, do NOT pass stale vinaReferenceAudio —
    // speakerRegistry resolves WAV from profiles_goc by name (each voice differs).
    const adHocOnly = !profileName;

    // Timeout lives inside GPU slot (exclusive engine) — no outer race that leaks mutex
    const result = await synthesizeVinaVoice({
      text,
      profileName: profileName || undefined,
      universalBrainMode: extra.vinaUniversalBrain !== false,
      isPreview,
      isChapter: isChapter && !isPreview,
      settings: {
        speed: uiSpeed,
        pitch_shift: uiPitch,
        gender:
          extra.vinaGender ||
          (profileLooksLikeEdge && /HoaiMy|female|Nu/i.test(opts.voice)
            ? 'female'
            : 'male'),
        area: extra.vinaArea || 'southern',
        group: extra.vinaGroup || 'story',
        emotion: extra.vinaEmotion || 'neutral',
        use_clone: extra.vinaUseClone !== false,
        reference_audio: adHocOnly ? extra.vinaReferenceAudio || '' : '',
        reference_audio_b64: adHocOnly
          ? extra.vinaReferenceAudioB64 || undefined
          : undefined,
        reference_text: adHocOnly ? extra.vinaReferenceText || '' : '',
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
