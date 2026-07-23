/**
 * LA Studio local TTS — HTTP bridge to running LA Studio desktop API.
 * B10: no silent fallback to Edge/Piper/other engines for full scene gen.
 * Preview only: may play baked family sample WAV (honest demo).
 */
import fs from 'fs';
import {
  synthesizeLaStudioSpeech,
  resolveLaStudioBaseUrl,
  resolveLaStudioApiKey,
} from '@/lib/laStudioLocal';
import {
  ensureFamilySamplePack,
  resolveSampleWav,
} from '@/lib/laStudioSampleVoices';
import type { TTSProvider } from '../ttsTypes';

export const provider_la_studio: TTSProvider = {
  name: 'LA Studio (Local API)',
  supportsNativeSpeed: true,
  supportsNativePitch: false,
  generate: async (text, opts) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const extra = opts as any;
    const voice = String(opts.voice || '').trim();
    if (!voice) {
      throw new Error(
        'LA Studio: chưa chọn giọng. Chọn voice trong Voice library rồi Nghe thử / gen.',
      );
    }

    const speed =
      typeof opts.speed === 'number' && Number.isFinite(opts.speed) && opts.speed > 0
        ? opts.speed
        : 1;

    const baseUrl = resolveLaStudioBaseUrl(
      extra.laStudioBaseUrl || extra.laStudioUrl || '',
    );
    const apiKey = resolveLaStudioApiKey(extra.laStudioApiKey || '');
    const model =
      typeof extra.laStudioModel === 'string' ? extra.laStudioModel.trim() : '';
    const language =
      typeof extra.language === 'string' ? extra.language.trim() : '';
    const isPreview = extra.isPreview === true;
    const familyId =
      typeof extra.laStudioFamily === 'string'
        ? extra.laStudioFamily.trim()
        : '';
    const timeoutMs = isPreview ? 300_000 : 420_000;
    const voiceNfc = voice.normalize('NFC');

    // Durable Voice Clone (lsc_*): always serve saved ref sample on preview
    // and re-register for full synth inside synthesizeLaStudioSpeech.
    if (/^lsc_/i.test(voiceNfc)) {
      try {
        const { resolveCloneAudioPath } = await import('@/lib/laStudioClones');
        const cloneHit = resolveCloneAudioPath(voiceNfc);
        if (cloneHit && fs.existsSync(cloneHit.path)) {
          if (isPreview) {
            const buffer = fs.readFileSync(cloneHit.path);
            if (buffer.length > 400) {
              console.log(
                `[LA Studio] preview user-clone sample id=${voiceNfc} bytes=${buffer.length}`,
              );
              return {
                buffer,
                method: `LAStudio-UserCloneSample:${voiceNfc}`,
                nativeSpeedApplied: false,
                nativePitchApplied: false,
              };
            }
          }
        } else if (isPreview) {
          throw new Error(
            `Giọng clone «${voiceNfc}» không còn trên máy. Mở tab Voice Clone và tạo lại.`,
          );
        }
      } catch (e) {
        if (isPreview) {
          throw e instanceof Error
            ? e
            : new Error(String(e));
        }
        /* full gen: continue to synthesizeLaStudioSpeech re-register */
      }
    }

    // Preview: bake/play sample WAV for non-Kokoro family voices (honest demo)
    // so list giọng mới tải vẫn ▶ được dù chưa có full GGUF engine.
    if (isPreview) {
      const fam = String(familyId || extra.laStudioFamily || '').trim();
      // Scan all families — UI often still has laStudioFamily=kokoro while voice is VieNeu.
      let hit = resolveSampleWav(fam || undefined, voiceNfc);
      if (!hit) {
        try {
          const bakeFam = fam || 'vieneu-tts-v3-turbo';
          await ensureFamilySamplePack(bakeFam);
          const { ensureDiskPresetSampleWavs } = await import(
            '@/lib/laStudioSampleVoices'
          );
          await ensureDiskPresetSampleWavs(
            bakeFam,
            [{ id: voiceNfc, name: voiceNfc }],
            { maxVoices: 1 },
          );
          hit = resolveSampleWav(undefined, voiceNfc);
        } catch (e) {
          console.warn(
            '[LA Studio] sample bake',
            e instanceof Error ? e.message : e,
          );
        }
      }
      if (hit && fs.existsSync(hit.path)) {
        const buffer = fs.readFileSync(hit.path);
        if (buffer.length > 800) {
          console.log(
            `[LA Studio] preview sample WAV family=${hit.familyId} voice=${voiceNfc} bytes=${buffer.length}`,
          );
          return {
            buffer,
            method: `LAStudio-SampleDemo:${hit.familyId}:${voiceNfc}`,
            // FFmpeg applies UI speed + pitch from ttsConfig (global)
            nativeSpeedApplied: false,
            nativePitchApplied: false,
          };
        }
      }
    }

    try {
      // Ensure background engine (API) + synth via API-if-loaded else Kokoro CLI
      const result = await synthesizeLaStudioSpeech({
        text,
        voice,
        model: model || undefined,
        speed,
        language: language || undefined,
        baseUrl,
        apiKey: apiKey || undefined,
        timeoutMs,
      });

      console.log(
        `[LA Studio] OK method=${result.method} bytes=${result.buffer.length} nativeSpeed=${result.nativeSpeedApplied !== false}`,
      );

      return {
        buffer: result.buffer,
        method: result.method,
        // CLI path: speed via FFmpeg post; API path: native speed
        nativeSpeedApplied: result.nativeSpeedApplied !== false,
        nativePitchApplied: false,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Last chance preview: sample across any family + bake if missing
      if (isPreview) {
        try {
          const voiceNfc = voice.normalize('NFC');
          const bakeFam = familyId || 'vieneu-tts-v3-turbo';
          await ensureFamilySamplePack(bakeFam);
          const { ensureDiskPresetSampleWavs } = await import(
            '@/lib/laStudioSampleVoices'
          );
          await ensureDiskPresetSampleWavs(
            bakeFam,
            [{ id: voiceNfc, name: voiceNfc }],
            { maxVoices: 1 },
          );
          const hit = resolveSampleWav(undefined, voiceNfc);
          if (hit && fs.existsSync(hit.path)) {
            const buffer = fs.readFileSync(hit.path);
            if (buffer.length > 800) {
              return {
                buffer,
                method: `LAStudio-SampleDemo-fallback:${hit.familyId}:${voiceNfc}`,
                nativeSpeedApplied: false,
                nativePitchApplied: false,
              };
            }
          }
        } catch {
          /* fall through */
        }
      }
      throw new Error(msg.startsWith('LA Studio') ? msg : `LA Studio: ${msg}`);
    }
  },
};
