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
  if (!name.endsWith('.onnx')) name = `${name}.onnx`;
  if (available.includes(name)) return name;
  const key = name.replace(/\.onnx$/i, '').toLowerCase();
  const fuzzy = available.find(
    (f) => f.toLowerCase().includes(key) || key.includes(f.replace(/\.onnx$/i, '').toLowerCase()),
  );
  if (fuzzy) return fuzzy;
  if (/nu|female|huyen|my|chi/i.test(voice || '')) {
    if (available.includes('ngochuyen.onnx')) return 'ngochuyen.onnx';
  }
  if (available.includes('manhdung.onnx')) return 'manhdung.onnx';
  if (available[0]) return available[0];
  throw new Error('Piper: không có model .onnx trong bin/piper_vn');
}

/** Owner: TTS platform `piper` — hard-fail if models missing */
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
