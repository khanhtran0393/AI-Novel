/**
 * Empirical test: OmniVoice Local resolve + synthesize
 */
import {
  probeOmniBaseUrl,
  resolveOmniRefAudioPath,
  findOmniLibraryEntry,
  synthesizeOmniVoiceLocal,
} from '../src/lib/omnivoiceLocal.ts';
import fs from 'fs';
import path from 'path';

const cwd = process.cwd();
const voice = process.argv[2] || 'omnivoice_preset_ref_tung_dang_warm';

console.log('cwd', cwd);
const base = await probeOmniBaseUrl(undefined, 2000);
console.log('probe base', base);
if (!base) {
  console.error('FAIL: server offline');
  process.exit(1);
}

const entry = findOmniLibraryEntry(voice, cwd);
console.log('library entry', entry ? { id: entry.id, voiceId: entry.voiceId } : null);
const ref = resolveOmniRefAudioPath(entry || voice, cwd);
console.log('ref audio', ref, ref && fs.existsSync(ref));

const t0 = Date.now();
const result = await synthesizeOmniVoiceLocal({
  text: 'Xin chào. Đây là kiểm tra OmniVoice local từ module AI Novel.',
  voice,
  speed: 1,
  cwd,
});
const out = path.join(cwd, 'public', 'audio', 'omnivoice_module_test.wav');
fs.writeFileSync(out, result.buffer);
console.log('OK', {
  method: result.method,
  mode: result.mode,
  baseUrl: result.baseUrl,
  bytes: result.buffer.length,
  ms: Date.now() - t0,
  out,
});
if (result.buffer.length < 1000) {
  console.error('FAIL: audio too small');
  process.exit(1);
}
console.log('PASS');
