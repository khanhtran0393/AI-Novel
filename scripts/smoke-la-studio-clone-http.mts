/**
 * Live HTTP E2E against running Next server (127.0.0.1:3000):
 * POST save clone → GET list → GET sample-audio → POST generate-tts isPreview
 *
 *   npx tsx scripts/smoke-la-studio-clone-http.mts
 */
import fs from 'fs';
import path from 'path';

const BASE = process.env.AINOVEL_SMOKE_BASE || 'http://127.0.0.1:3000';
const cwd = process.cwd();

function fail(msg: string): never {
  console.error('[FAIL]', msg);
  process.exit(1);
}

function makeWav(pcmBytes = 10000): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcmBytes, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24);
  header.writeUInt32LE(32000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcmBytes, 40);
  const pcm = Buffer.alloc(pcmBytes);
  for (let i = 0; i < pcmBytes; i += 2) {
    const t = i / 2 / 16000;
    pcm.writeInt16LE(((Math.sin(2 * Math.PI * 330 * t) * 5000) | 0), i);
  }
  return Buffer.concat([header, pcm]);
}

const realSample = path.join(cwd, 'data', 'cache', 'omni-preview-clone-thanh-ngoc.wav');
const audioBuf = fs.existsSync(realSample)
  ? fs.readFileSync(realSample)
  : makeWav(12000);
const audioBase64 = audioBuf.toString('base64');
const name = `HTTP E2E Clone ${Date.now().toString(36)}`;

console.log('[base]', BASE);
console.log('[audio bytes]', audioBuf.length);

// 1) POST create
const postRes = await fetch(`${BASE}/api/la-studio/voices`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name,
    audioBase64,
    language: 'vi',
    sourceName: 'http-e2e.wav',
    familyId: 'omnivoice',
    preferOmni: true,
  }),
});
const postJson = (await postRes.json()) as {
  ok?: boolean;
  error?: string;
  voice?: { id: string; name: string; previewUrl?: string };
  message?: string;
  saved?: boolean;
  userClones?: Array<{ id: string }>;
  registerNotes?: string[];
};
console.log('[POST]', postRes.status, postJson.message || postJson.error || '');
if (!postRes.ok || !postJson.voice?.id) {
  fail(`POST create failed: ${postRes.status} ${postJson.error || JSON.stringify(postJson)}`);
}
const voiceId = postJson.voice.id;
console.log('[voice]', voiceId, 'saved=', postJson.saved, 'notes=', postJson.registerNotes);

// 2) GET list user clones
const getRes = await fetch(
  `${BASE}/api/la-studio/voices?familyId=user-clones&includeClones=1`,
  { cache: 'no-store' },
);
const getJson = (await getRes.json()) as {
  error?: string;
  userClones?: Array<{ id: string; name: string; previewUrl?: string }>;
  userCloneCount?: number;
};
console.log('[GET]', getRes.status, 'userCloneCount=', getJson.userCloneCount);
if (!getRes.ok) fail(`GET list: ${getJson.error}`);
if (!getJson.userClones?.some((c) => c.id === voiceId)) {
  fail(`voice ${voiceId} missing from userClones list`);
}
console.log('[OK] listed in userClones');

// 3) GET sample audio stream
const sampleUrl = `${BASE}/api/la-studio/sample-audio?familyId=user-clones&voiceId=${encodeURIComponent(voiceId)}`;
const sampleRes = await fetch(sampleUrl, { cache: 'no-store' });
const ct = sampleRes.headers.get('content-type') || '';
const sampleAb = await sampleRes.arrayBuffer();
console.log('[SAMPLE]', sampleRes.status, ct, 'bytes=', sampleAb.byteLength);
if (!sampleRes.ok || sampleAb.byteLength < 1000) {
  const errTxt = Buffer.from(sampleAb).toString('utf8').slice(0, 200);
  fail(`sample-audio failed: ${sampleRes.status} ${errTxt}`);
}
const sampleOut = path.join(cwd, 'data', 'cache', 'http-e2e-clone-sample.wav');
fs.writeFileSync(sampleOut, Buffer.from(sampleAb));
console.log('[OK] sample artifact', sampleOut, fs.statSync(sampleOut).size);

// 4) Preview TTS via generate-tts (isPreview)
const ttsRes = await fetch(`${BASE}/api/generate-tts`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    sceneText: 'Xin chào, đây là nghe thử giọng clone đã lưu.',
    chapterNum: 0,
    sceneIndex: 999,
    isPreview: true,
    voice: voiceId,
    voiceName: voiceId,
    ten_tac_pham: 'Smoke Clone',
    ttsConfig: {
      platform: 'la_studio',
      voice: voiceId,
      language: 'vi',
      speed: 1,
      pitch: 0,
      laStudioFamily: 'user-clones',
    },
    applyLoudnorm: false,
    injectBreathPauses: false,
    roomTone: false,
    bgmMix: false,
  }),
});
const ttsJson = (await ttsRes.json()) as {
  success?: boolean;
  error?: string;
  audioPath?: string;
  method?: string;
  bytes?: number;
};
console.log(
  '[TTS preview]',
  ttsRes.status,
  ttsJson.success,
  ttsJson.method || ttsJson.error,
  ttsJson.audioPath,
);
if (!ttsRes.ok || !ttsJson.success) {
  fail(`generate-tts preview: ${ttsJson.error || ttsRes.status}`);
}
// Resolve audio file on disk if local path
let audioOk = false;
if (ttsJson.audioPath) {
  const p = ttsJson.audioPath;
  const candidates = [
    p,
    path.join(cwd, p.replace(/^\//, '')),
    path.join(cwd, 'public', p.replace(/^\//, '')),
    path.join(cwd, 'data', p.replace(/^\//, '')),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).size > 400) {
      console.log('[OK] preview audio on disk', c, fs.statSync(c).size);
      audioOk = true;
      break;
    }
  }
  // HTTP path under public
  if (!audioOk && p.startsWith('/')) {
    const url = `${BASE}${p}`;
    const aRes = await fetch(url, { cache: 'no-store' });
    const ab = await aRes.arrayBuffer();
    console.log('[AUDIO URL]', aRes.status, ab.byteLength, url);
    if (aRes.ok && ab.byteLength > 400) {
      const out = path.join(cwd, 'data', 'cache', 'http-e2e-clone-tts-preview.wav');
      fs.writeFileSync(out, Buffer.from(ab));
      console.log('[OK] downloaded preview', out, ab.byteLength);
      audioOk = true;
    }
  }
}
if (!audioOk) fail('preview audio not found on disk/URL');

// 5) DELETE
const delRes = await fetch(
  `${BASE}/api/la-studio/voices?id=${encodeURIComponent(voiceId)}`,
  { method: 'DELETE' },
);
const delJson = (await delRes.json()) as { ok?: boolean; error?: string };
console.log('[DELETE]', delRes.status, delJson.ok || delJson.error);
if (!delRes.ok || !delJson.ok) fail(`delete failed: ${delJson.error}`);

// Confirm gone
const get2 = await fetch(
  `${BASE}/api/la-studio/voices?familyId=user-clones&includeClones=1`,
  { cache: 'no-store' },
);
const get2j = (await get2.json()) as { userClones?: Array<{ id: string }> };
if (get2j.userClones?.some((c) => c.id === voiceId)) {
  fail('still listed after delete');
}
console.log('[OK] deleted from list');

console.log('[smoke-la-studio-clone-http] PASS');
