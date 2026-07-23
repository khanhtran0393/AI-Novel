/**
 * Empirical: durable LA Studio user-clone library CRUD + sample resolve.
 * npx tsx scripts/smoke-la-studio-clones.mts
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
  updateLaStudioUserClone,
  userClonesAsVoiceOptions,
} from '../src/lib/laStudioClones.ts';

const cwd = process.cwd();

function makeTinyWav(pcmBytes = 2000): Buffer {
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
  return Buffer.concat([header, Buffer.alloc(pcmBytes, 0)]);
}

const wav = makeTinyWav(2400);
const saved = saveLaStudioUserClone({
  name: 'Smoke Clone Test',
  audioBuffer: wav,
  ext: '.wav',
  language: 'vi',
  sourceName: 'smoke.wav',
  cwd,
});

if (!isLaStudioUserCloneId(saved.id)) {
  console.error('[FAIL] id not lsc_*', saved.id);
  process.exit(1);
}
const hit = resolveCloneAudioPath(saved.id, cwd);
if (!hit || !fs.existsSync(hit.path)) {
  console.error('[FAIL] audio missing');
  process.exit(2);
}
const size = fs.statSync(hit.path).size;
if (size < 1000) {
  console.error('[FAIL] audio too small', size);
  process.exit(3);
}

const list1 = listLaStudioUserClones(cwd);
if (!list1.some((c) => c.id === saved.id)) {
  console.error('[FAIL] not in list');
  process.exit(4);
}

const updated = updateLaStudioUserClone(
  saved.id,
  { laStudioApiId: 'voice_smoke', omniProfileId: 'omni_smoke' },
  cwd,
);
if (!updated?.laStudioApiId || !updated.omniProfileId) {
  console.error('[FAIL] update meta');
  process.exit(5);
}

const opts = userClonesAsVoiceOptions(listLaStudioUserClones(cwd));
const row = opts.find((o) => o.id === saved.id);
if (!row?.previewUrl?.includes(saved.id)) {
  console.error('[FAIL] voice option previewUrl', row);
  process.exit(6);
}

const url = cloneSamplePublicUrl(saved.id);
if (!url.includes('user-clones') || !url.includes(encodeURIComponent(saved.id))) {
  console.error('[FAIL] sample url', url);
  process.exit(7);
}

// Root path exists
const root = path.join(cwd, 'data', 'la-studio', 'user-clones', saved.id);
if (!fs.existsSync(path.join(root, 'meta.json'))) {
  console.error('[FAIL] meta.json missing');
  process.exit(8);
}

const del = deleteLaStudioUserClone(saved.id, cwd);
if (!del || listLaStudioUserClones(cwd).some((c) => c.id === saved.id)) {
  console.error('[FAIL] delete');
  process.exit(9);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      id: saved.id,
      size,
      url,
      root,
    },
    null,
    2,
  ),
);
console.log('[smoke-la-studio-clones] PASS');
