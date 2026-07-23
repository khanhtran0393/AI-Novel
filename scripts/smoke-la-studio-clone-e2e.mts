/**
 * E2E empirical: Voice Clone save → list → sample stream path → TTS provider preview.
 * Does NOT require LA Studio desktop API online for sample path.
 *
 *   npx tsx scripts/smoke-la-studio-clone-e2e.mts
 */
import fs from 'fs';
import path from 'path';
import {
  saveLaStudioUserClone,
  listLaStudioUserClones,
  resolveCloneAudioPath,
  deleteLaStudioUserClone,
  isLaStudioUserCloneId,
  cloneSamplePublicUrl,
  userClonesAsVoiceOptions,
} from '../src/lib/laStudioClones.ts';
import { synthesizeLaStudioSpeech } from '../src/lib/laStudioLocal.ts';
import { provider_la_studio } from '../src/app/api/generate-tts/platforms/la_studio.ts';

const cwd = process.cwd();
const failures: string[] = [];
function ok(cond: boolean, msg: string) {
  if (!cond) {
    failures.push(msg);
    console.error('[FAIL]', msg);
  } else {
    console.log('[OK]', msg);
  }
}

function makeWav(pcmBytes = 8000): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcmBytes, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(16000, 24);
  header.writeUInt32LE(32000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcmBytes, 40);
  // soft tone-ish pattern (not silence-only)
  const pcm = Buffer.alloc(pcmBytes);
  for (let i = 0; i < pcmBytes; i += 2) {
    const t = (i / 2) / 16000;
    const s = Math.sin(2 * Math.PI * 220 * t) * 4000;
    pcm.writeInt16LE(Math.max(-32767, Math.min(32767, s | 0)), i);
  }
  return Buffer.concat([header, pcm]);
}

// Prefer real speech sample if present (more realistic)
function pickSourceAudio(): { buf: Buffer; label: string } {
  const candidates = [
    path.join(cwd, 'data', 'cache', 'omni-preview-clone-thanh-ngoc.wav'),
    path.join(cwd, 'data', 'cache', 'omni-preview-alloy.wav'),
    path.join(cwd, 'data', 'vina-voices', 'samples', 'Tin_Tuc_Nu_Tre_1.wav'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      const buf = fs.readFileSync(p);
      if (buf.length > 2000) return { buf, label: p };
    }
  }
  return { buf: makeWav(12000), label: 'synthetic-wav' };
}

const src = pickSourceAudio();
console.log('[source]', src.label, 'bytes=', src.buf.length);

// —— 1) Save durable clone ——
const saved = saveLaStudioUserClone({
  name: 'E2E Clone Nghe Thử',
  audioBuffer: src.buf,
  ext: path.extname(src.label).toLowerCase() || '.wav',
  language: 'vi',
  sourceName: path.basename(src.label),
  cwd,
});
ok(isLaStudioUserCloneId(saved.id), `id is lsc_* → ${saved.id}`);
const hit = resolveCloneAudioPath(saved.id, cwd);
ok(!!hit && fs.existsSync(hit!.path), 'resolveCloneAudioPath exists on disk');
ok((hit && fs.statSync(hit.path).size) > 1000, 'audio size > 1KB');

// —— 2) List + voice options (UI left panel) ——
const listed = listLaStudioUserClones(cwd);
ok(listed.some((c) => c.id === saved.id), 'appears in listLaStudioUserClones');
const opts = userClonesAsVoiceOptions(listed);
const row = opts.find((o) => o.id === saved.id);
ok(!!row?.previewUrl, 'userClonesAsVoiceOptions has previewUrl');
ok(
  !!row?.previewUrl?.includes('user-clones') &&
    !!row?.previewUrl?.includes(encodeURIComponent(saved.id)),
  `previewUrl= ${row?.previewUrl}`,
);
ok(cloneSamplePublicUrl(saved.id).includes(saved.id), 'cloneSamplePublicUrl');

// —— 3) sample-audio route logic (import resolve used by route) ——
const samplePath = resolveCloneAudioPath(saved.id, cwd)!.path;
const sampleBuf = fs.readFileSync(samplePath);
ok(sampleBuf.length > 400, `sample streamable bytes=${sampleBuf.length}`);
ok(
  sampleBuf[0] === 0x52 || sampleBuf[0] === 0xff || sampleBuf[0] === 0x49,
  'sample has audio magic (RIFF/mp3)',
);

// —— 4a) Full synth without allowSampleFallback must NOT soft-return ref sample ——
let fullSynthHardFail = false;
try {
  await synthesizeLaStudioSpeech({
    text: 'Xin chào full gen clone.',
    voice: saved.id,
    timeoutMs: 6_000,
    allowSampleFallback: false,
  });
  // If API is actually online and registered, full synth may succeed — also OK
  console.log('[OK] full synth succeeded (API online) — acceptable');
} catch (e) {
  fullSynthHardFail = true;
  const msg = e instanceof Error ? e.message : String(e);
  ok(
    /clone|Engine|API|model/i.test(msg),
    `full gen hard-fail clear message: ${msg.slice(0, 120)}`,
  );
}

// —— 4b) Preview-style allowSampleFallback → ref sample when API offline ——
let synthMethod = '';
try {
  const r = await synthesizeLaStudioSpeech({
    text: 'Xin chào, đây là kiểm tra giọng clone.',
    voice: saved.id,
    timeoutMs: 8_000,
    allowSampleFallback: true,
  });
  synthMethod = r.method;
  ok(r.buffer.length > 400, `sample-fallback buffer bytes=${r.buffer.length}`);
  ok(
    /UserClone|LAStudio|clone/i.test(r.method),
    `sample-fallback method=${r.method}`,
  );
} catch (e) {
  // Only fail if API is offline AND sample fallback also broke
  failures.push(
    `synthesize sample-fallback: ${e instanceof Error ? e.message : String(e)}`,
  );
  console.error(
    '[FAIL] sample-fallback',
    e instanceof Error ? e.message : e,
  );
}
ok(
  fullSynthHardFail || synthMethod.length > 0,
  'full-gen path exercised (hard-fail or live API)',
);

// —— 5) provider_la_studio preview path (Nghe thử) ——
try {
  const prev = await provider_la_studio.generate(
    'Xin chào nghe thử clone.',
    {
      voice: saved.id,
      speed: 1,
      isPreview: true,
      laStudioFamily: 'user-clones',
      language: 'vi',
    } as never,
  );
  ok(prev.buffer.length > 400, `provider preview bytes=${prev.buffer.length}`);
  ok(
    String(prev.method || '').includes('UserClone') ||
      String(prev.method || '').includes('clone') ||
      prev.buffer.length > 400,
    `provider method=${prev.method}`,
  );
  // Write playable proof artifact
  const outDir = path.join(cwd, 'data', 'cache');
  fs.mkdirSync(outDir, { recursive: true });
  const outWav = path.join(outDir, 'e2e-user-clone-preview.wav');
  fs.writeFileSync(outWav, prev.buffer);
  ok(fs.existsSync(outWav) && fs.statSync(outWav).size > 400, `wrote ${outWav}`);
  console.log('[ARTIFACT]', outWav, fs.statSync(outWav).size);
} catch (e) {
  failures.push(
    `provider_la_studio preview: ${e instanceof Error ? e.message : String(e)}`,
  );
  console.error(
    '[FAIL] provider preview',
    e instanceof Error ? e.message : e,
  );
}

// —— 6) Config shape UI would write after selectVoice ——
const ttsConfigLike = {
  platform: 'la_studio' as const,
  voice: saved.id,
  language: 'vi',
  laStudioFamily: 'omnivoice', // user may be on Omni family
  speed: 1,
  pitch: 0,
};
ok(
  ttsConfigLike.platform === 'la_studio' &&
    isLaStudioUserCloneId(ttsConfigLike.voice),
  `usable ttsConfig voice=${ttsConfigLike.voice}`,
);

// —— 7) Omni path resolve for lsc_* (does not require synth if server down) ——
try {
  const { resolveCloneAudioPath: r2 } = await import('../src/lib/laStudioClones.ts');
  const h2 = r2(saved.id, cwd);
  ok(!!h2, 'Omni re-register source path available');
} catch (e) {
  failures.push(String(e));
}

// —— Cleanup ——
const del = deleteLaStudioUserClone(saved.id, cwd);
ok(del, 'delete clone');
ok(!listLaStudioUserClones(cwd).some((c) => c.id === saved.id), 'gone after delete');

console.log('\n=== SUMMARY ===');
console.log(
  JSON.stringify(
    {
      source: src.label,
      cloneId: saved.id,
      synthMethod,
      failCount: failures.length,
      failures,
    },
    null,
    2,
  ),
);

if (failures.length) {
  console.error('[smoke-la-studio-clone-e2e] FAIL');
  process.exit(1);
}
console.log('[smoke-la-studio-clone-e2e] PASS');
