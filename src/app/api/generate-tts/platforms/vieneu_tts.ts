import fs from 'fs';
import path from 'path';
import type { TTSProvider } from '../ttsTypes';
import { generatePiperTTS } from '../engines/piper';

/** Owner: TTS platform `vieneu_tts` — Piper local; hard-fail if no onnx */
export const provider_vieneu_tts: TTSProvider = {
  name: 'VieNeu TTS',
  supportsNativeSpeed: true,
  supportsNativePitch: false,
  generate: async (text, opts) => {
    const rawVoice = (opts.voice || '').trim();
    const normalizeKey = (s: string) =>
      s
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'D')
        .toLowerCase()
        .replace(/\.onnx$/i, '')
        .replace(/\s+/g, '');

    const piperDir = path.join(process.cwd(), 'bin', 'piper_vn');
    const available = fs.existsSync(piperDir)
      ? fs.readdirSync(piperDir).filter((f) => f.endsWith('.onnx'))
      : [];

    const ALIAS: Record<string, string> = {
      adam1: 'manhdung.onnx',
      adam2: 'manhdung.onnx',
      adam3: 'manhdung.onnx',
      adam4: 'manhdung.onnx',
      adamtridung: 'manhdung.onnx',
      manhdung: 'manhdung.onnx',
      ductrung: 'manhdung.onnx',
      quanganh: 'manhdung.onnx',
      binhan: 'manhdung.onnx',
      ngochuyen: 'ngochuyen.onnx',
      chichi: 'ngochuyen.onnx',
    };

    const key = normalizeKey(rawVoice);
    let modelName =
      ALIAS[key] || (rawVoice.endsWith('.onnx') ? rawVoice : `${key}.onnx`);

    if (!available.includes(modelName)) {
      const fuzzy = available.find(
        (f) =>
          normalizeKey(f) === key ||
          normalizeKey(f).includes(key) ||
          key.includes(normalizeKey(f.replace(/\.onnx$/i, ''))),
      );
      if (fuzzy) modelName = fuzzy;
    }

    if (!available.includes(modelName)) {
      const female = /nu|female|huyen|chi|my|mai|thao|van|linh|yen/i.test(
        rawVoice + key,
      );
      const prefer = female ? 'ngochuyen.onnx' : 'manhdung.onnx';
      if (available.includes(prefer)) modelName = prefer;
      else if (available[0]) modelName = available[0];
      else {
        throw new Error(
          'VieNeu: không có model Piper .onnx trong bin/piper_vn (không fallback Edge).',
        );
      }
    }

    console.log(`[VieNeu-TTS] Piper: ${modelName}`);
    const buffer = await generatePiperTTS(text, modelName, opts.speed);
    return {
      buffer,
      method: `VieNeu-TTS (Piper: ${modelName})`,
      nativePitchApplied: false,
      nativeSpeedApplied: true,
    };
  },
};
