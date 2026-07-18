/**
 * Smoke: parse SRT + optional full Piper batch (if binary present).
 * Run: npx tsx scripts/smoke-tts-batch-srt.mts
 */
import fs from 'fs';
import path from 'path';
import {
  parseSrt,
  srtSummary,
  formatSrtTimestamp,
  resolveTtsBatchConcurrency,
  runTtsBatchSrt,
} from '../src/lib/ttsBatchSrt/index.ts';

const sample = `1
00:00:00,000 --> 00:00:03,500
Xin chao, day la cau mot.

2
00:00:04,000 --> 00:00:08,200
Han Duc: Cau co speaker.

3
00:00:10,000 --> 00:00:14,000
[Narrator] Ket thuc doan ngan.
`;

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const cues = parseSrt(sample);
assert(cues.length === 3, `expected 3 cues, got ${cues.length}`);
assert(cues[1].speaker === 'Han Duc', `speaker parse fail: ${cues[1].speaker}`);
assert(cues[2].speaker === 'Narrator', `bracket speaker fail`);
assert(cues[0].startMs === 0, 'startMs 0');
assert(cues[1].startMs === 4000, `startMs 4000 got ${cues[1].startMs}`);
console.log('[parse] OK', srtSummary(cues));
console.log('[fmt]', formatSrtTimestamp(cues[1].startMs));
console.log('[conc] piper=', resolveTtsBatchConcurrency('piper'), 'vina=', resolveTtsBatchConcurrency('vina_voice'));

const piperExe = path.join(process.cwd(), 'bin', 'piper', 'piper.exe');
const model = path.join(process.cwd(), 'bin', 'piper_vn', 'manhdung.onnx');
if (!fs.existsSync(piperExe) || !fs.existsSync(model)) {
  console.log('[batch] SKIP full run — piper binary/model missing');
  process.exit(0);
}

console.log('[batch] running Piper sequential 3 cues…');
const result = await runTtsBatchSrt({
  srtText: sample,
  ttsConfig: {
    platform: 'piper',
    voice: 'manhdung.onnx',
    speed: 1,
    pitch: 0,
  },
  alignMode: 'timeline',
  applyLoudnorm: false,
  concurrency: 2,
  jobName: 'smoke',
});

assert(result.ok === true, 'result not ok');
assert(result.cueCount === 3, 'cueCount');
assert(result.duration > 0, 'duration');
const abs = path.join(process.cwd(), 'public', result.audioPath.replace(/^\//, ''));
assert(fs.existsSync(abs), `missing file ${abs}`);
console.log('[batch] PASS', {
  audioPath: result.audioPath,
  duration: result.duration,
  concurrency: result.concurrency,
  method: result.method,
});
