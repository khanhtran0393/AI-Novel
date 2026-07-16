import fs from 'fs';
import path from 'path';
import type { TTSProvider } from '../ttsTypes';
import { generatePiperTTS } from '../engines/piper';

function resolvePiperModel(voice: string): string {
  const piperDir = path.join(process.cwd(), 'bin', 'piper_vn');
  const available = fs.existsSync(piperDir)
    ? fs.readdirSync(piperDir).filter((f) => f.endsWith('.onnx'))
    : [];
  let name = (voice || '').trim();
  if (!name) {
    throw new Error('Piper: chua chon model .onnx.');
  }
  if (!name.endsWith('.onnx')) name = `${name}.onnx`;
  if (available.includes(name)) return name;
  const exactCaseInsensitive = available.find((f) => f.toLowerCase() === name.toLowerCase());
  if (exactCaseInsensitive) return exactCaseInsensitive;
  throw new Error(
    `Piper: model "${voice}" khong ton tai trong bin/piper_vn. ` +
      `Co san: ${available.join(', ') || '(trong)'}.`,
  );
}

/** Owner: TTS platform `piper` - hard-fail if the selected model is missing. */
export const provider_piper: TTSProvider = {
  name: 'Piper TTS',
  supportsNativeSpeed: true,
  supportsNativePitch: false,
  generate: async (text, opts) => {
    const model = resolvePiperModel(opts.voice || '');
    const buffer = await generatePiperTTS(text, model, opts.speed);
    return {
      buffer,
      method: `Piper TTS (${model})`,
      nativeSpeedApplied: true,
      nativePitchApplied: false,
    };
  },
};
