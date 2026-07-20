import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  diagnoseCapCutInstall,
  generateCapCutTTS,
} from '../src/app/api/generate-tts/engines/capcut';

const diagnostic = diagnoseCapCutInstall();
assert.equal(diagnostic.ok, true, diagnostic.message);

const audio = await generateCapCutTTS(
  'Đây là kiểm thử CapCut TTS thực tế của AI Novel.',
  'BV074_streaming',
);
assert.ok(audio.length >= 1024, `CapCut returned only ${audio.length} bytes`);

const isId3 = audio.subarray(0, 3).toString('ascii') === 'ID3';
const isMpegFrame =
  audio[0] === 0xff &&
  audio.length > 1 &&
  [0xfb, 0xf3, 0xf2].includes(audio[1]);
assert.ok(isId3 || isMpegFrame, 'CapCut response is not recognizable MP3 data');

console.log(JSON.stringify({
  ok: true,
  bytes: audio.length,
  sha256: crypto.createHash('sha256').update(audio).digest('hex'),
  dllPath: diagnostic.dllPath,
  version: diagnostic.version,
}));
console.log('PASS smoke-capcut-live');
