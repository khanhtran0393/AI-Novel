/**
 * Empirical: new Piper VN voices (rhasspy + multi-speaker) synth OK.
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import {
  listPiperOnnxModels,
  listPiperVoiceOptions,
  resolvePiperModelPath,
} from '../src/lib/tts/piperPaths.ts';
import { generatePiperTTS } from '../src/app/api/generate-tts/engines/piper.ts';
import { provider_piper } from '../src/app/api/generate-tts/platforms/piper.ts';

const outDir = path.join(process.cwd(), 'scratch', 'piper-new-voices');
fs.mkdirSync(outDir, { recursive: true });

const models = listPiperOnnxModels();
console.log('onnxFiles', models);
assert.ok(models.includes('vi_VN-vais1000-medium.onnx'), 'vais model on disk');
assert.ok(models.includes('vi_VN-25hours_single-low.onnx'), '25h model on disk');
assert.ok(models.includes('vi_VN-vivos-x_low.onnx'), 'vivos model on disk');

const voices = listPiperVoiceOptions();
console.log('voiceCount', voices.length);
assert.ok(voices.length >= 5, `expected expanded voices, got ${voices.length}`);
// vivos multi → many speakers
const vivos = voices.filter((v) => v.modelName === 'vi_VN-vivos-x_low.onnx');
assert.ok(vivos.length >= 10, `vivos speakers expanded: ${vivos.length}`);

const sampleIds = [
  'ngochuyen.onnx',
  'manhdung.onnx',
  'vi_VN-vais1000-medium.onnx',
  'vi_VN-25hours_single-low.onnx',
  vivos[0]?.id || 'vi_VN-vivos-x_low.onnx#0',
  vivos[Math.min(5, vivos.length - 1)]?.id,
].filter(Boolean) as string[];

const text = 'Xin chào. Đây là kiểm tra giọng Piper tiếng Việt.';

for (const id of sampleIds) {
  const ref = resolvePiperModelPath(id);
  console.log('gen', id, '→', ref.modelName, 'spk', ref.speakerId);
  const buf = await generatePiperTTS(text, id, 1);
  assert.ok(buf.length > 44, `${id} buffer too small ${buf.length}`);
  const safe = id.replace(/[^\w.-]+/g, '_');
  const wav = path.join(outDir, `engine_${safe}.wav`);
  fs.writeFileSync(wav, buf);
  console.log('  OK', buf.length, wav);

  const viaProvider = await provider_piper.generate(text, {
    voice: id,
    speed: 1,
    pitch: 1,
    volume: 1,
  } as never);
  assert.ok(viaProvider.buffer.length > 44, `provider ${id}`);
  console.log('  provider', viaProvider.method, viaProvider.buffer.length);
}

console.log(
  JSON.stringify({
    ok: true,
    onnx: models.length,
    voices: voices.length,
    vivosSpeakers: vivos.length,
    sampled: sampleIds,
  }),
);
console.log('PASS smoke-piper-new-voices');
