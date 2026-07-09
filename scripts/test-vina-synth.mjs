import fs from 'fs';
import { synthesizeVinaVoice } from '../src/lib/vinaVoice/engine.ts';

const r = await synthesizeVinaVoice({
  text: 'Xin chào. Đây là thử nghiệm VinaVoice độc lập trong AI Novel.',
  forceBuiltin: true,
  settings: { gender: 'male', area: 'southern', speed: 1.0, pitch_shift: -1 },
});

console.log(
  JSON.stringify(
    {
      ok: r.ok,
      method: r.method,
      chunks: r.chunks,
      error: r.error,
      warnings: r.warnings,
      path: r.audioPath,
      exists: !!(r.audioPath && fs.existsSync(r.audioPath)),
      size: r.audioPath && fs.existsSync(r.audioPath) ? fs.statSync(r.audioPath).size : 0,
    },
    null,
    2,
  ),
);

if (!r.ok || !r.audioPath || !fs.existsSync(r.audioPath)) {
  console.error('SYNTH_FAIL');
  process.exit(1);
}
console.log('SYNTH_PASS');
