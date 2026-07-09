import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { applyAudioStudioMix } from '../src/lib/audioStudio.ts';

const ffmpeg = path.join(process.cwd(), 'bin', 'ffmpeg.exe');
const tmp = path.join(process.cwd(), 'public', 'audio', 'studio_test_in.mp3');
fs.mkdirSync(path.dirname(tmp), { recursive: true });

execSync(`"${ffmpeg}" -f lavfi -i sine=frequency=440:duration=1.2 -y "${tmp}"`, {
  stdio: 'pipe',
});
const buf = fs.readFileSync(tmp);
const r = await applyAudioStudioMix(buf, {
  roomTone: true,
  bgmMix: true,
  loudnormI: -14,
});
console.log(
  JSON.stringify(
    {
      applied: r.applied,
      inBytes: buf.length,
      outBytes: r.buffer.length,
      ok: r.buffer.length > 500 && r.applied.length > 0,
    },
    null,
    2,
  ),
);
if (!(r.buffer.length > 500 && r.applied.length > 0)) {
  process.exit(1);
}
try {
  fs.unlinkSync(tmp);
} catch {
  /* ignore */
}
console.log('PASS verify-audio-studio.mjs');
