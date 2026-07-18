/**
 * Smoke: Piper multi-process same model (4 parallel).
 * npx tsx scripts/smoke-piper-multi.mts
 */
import { generatePiperTTS } from '../src/app/api/generate-tts/engines/piper.ts';
import { resolveTtsBatchConcurrency } from '../src/lib/ttsBatchSrt/concurrency.ts';

const model = 'manhdung.onnx';
const n = 4;
const texts = Array.from({ length: n }, (_, i) => `Cau so ${i + 1}. Piper multi process test.`);

console.log('auto concurrency', resolveTtsBatchConcurrency('piper'));
const t0 = Date.now();
const bufs = await Promise.all(
  texts.map((t, i) =>
    generatePiperTTS(t, model, 1).then((b) => {
      console.log(`  #${i + 1} ok bytes=${b.length}`);
      return b;
    }),
  ),
);
const ms = Date.now() - t0;
if (bufs.some((b) => !b?.length)) throw new Error('empty buffer');
console.log(`PASS parallel ×${n} in ${ms}ms (~${(ms / n).toFixed(0)}ms/job wall if serial would be longer)`);
