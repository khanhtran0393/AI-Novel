/**
 * Live: save clone → Omni register → generate-tts omnivoice_local isPreview
 *   npx tsx scripts/smoke-la-studio-clone-omni-tts.mts
 */
import fs from 'fs';
import path from 'path';

const BASE = process.env.AINOVEL_SMOKE_BASE || 'http://127.0.0.1:3000';
const cwd = process.cwd();
const real = path.join(cwd, 'data', 'cache', 'omni-preview-clone-thanh-ngoc.wav');
if (!fs.existsSync(real)) {
  console.error('[FAIL] missing sample', real);
  process.exit(2);
}
const audioBuf = fs.readFileSync(real);

const post = await fetch(`${BASE}/api/la-studio/voices`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'Omni TTS Clone',
    audioBase64: audioBuf.toString('base64'),
    language: 'vi',
    sourceName: 'x.wav',
    familyId: 'omnivoice',
    preferOmni: true,
  }),
});
const pj = (await post.json()) as {
  voice?: { id: string };
  registerNotes?: string[];
  error?: string;
  message?: string;
};
console.log('[POST]', post.status, pj.voice?.id, pj.registerNotes || pj.error);
if (!post.ok || !pj.voice?.id) process.exit(1);
const voiceId = pj.voice.id;

const tts = await fetch(`${BASE}/api/generate-tts`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    sceneText: 'Xin chào, kiểm tra clone Omni thật.',
    chapterNum: 0,
    sceneIndex: 998,
    isPreview: true,
    voice: voiceId,
    voiceName: voiceId,
    ten_tac_pham: 'Smoke',
    ttsConfig: {
      platform: 'omnivoice_local',
      voice: voiceId,
      language: 'vi',
      speed: 1,
      pitch: 0,
      laStudioFamily: 'omnivoice',
    },
    applyLoudnorm: false,
    injectBreathPauses: false,
    roomTone: false,
    bgmMix: false,
  }),
});
const tj = (await tts.json()) as {
  success?: boolean;
  method?: string;
  audioPath?: string;
  error?: string;
};
console.log('[TTS]', tts.status, tj.success, tj.method, tj.audioPath, tj.error || '');

let fileOk = false;
if (tj.audioPath) {
  const candidates = [
    path.join(cwd, 'public', tj.audioPath.replace(/^\//, '')),
    path.join(cwd, tj.audioPath.replace(/^\//, '')),
    path.join(cwd, 'public', 'audio', 'previews', path.basename(tj.audioPath)),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).size > 800) {
      console.log('[FILE]', c, fs.statSync(c).size);
      fileOk = true;
      break;
    }
  }
  if (!fileOk && tj.audioPath.startsWith('/')) {
    const aRes = await fetch(`${BASE}${tj.audioPath}`);
    const ab = await aRes.arrayBuffer();
    console.log('[URL]', aRes.status, ab.byteLength);
    if (aRes.ok && ab.byteLength > 800) {
      const out = path.join(cwd, 'data', 'cache', 'http-e2e-omni-clone-tts.wav');
      fs.writeFileSync(out, Buffer.from(ab));
      console.log('[FILE]', out, ab.byteLength);
      fileOk = true;
    }
  }
}

const del = await fetch(
  `${BASE}/api/la-studio/voices?id=${encodeURIComponent(voiceId)}`,
  { method: 'DELETE' },
);
console.log('[DEL]', del.status, (await del.json() as { ok?: boolean }).ok);

if (!tj.success || !fileOk) {
  console.error('[smoke-la-studio-clone-omni-tts] FAIL');
  process.exit(3);
}
console.log('[smoke-la-studio-clone-omni-tts] PASS method=', tj.method);
