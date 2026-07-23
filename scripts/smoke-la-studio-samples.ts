/**
 * Ship-safe sample bake smoke (writable data/ path).
 * npx tsx scripts/smoke-la-studio-samples.ts
 */
import fs from 'fs';
import path from 'path';
import {
  sampleWritableRoot,
  sampleDataDir,
  samplePublicDir,
  ensureFamilySamplePack,
  resolveSampleWav,
} from '../src/lib/laStudioSampleVoices';

const fam = 'vibevoice';
const id = 'vibe_nu_am';

async function main() {
  console.log('[writableRoot]', sampleWritableRoot());
  // Wipe all candidates to simulate fresh ship machine
  const wipeList = [
    path.join(sampleDataDir(fam), `${id}.wav`),
    path.join(samplePublicDir(fam), `${id}.wav`),
    path.join(
      process.cwd(),
      'bin',
      'la-studio-runtimes',
      fam,
      'models',
      'samples',
      `${id}.wav`,
    ),
  ];
  for (const p of wipeList) {
    try {
      fs.unlinkSync(p);
      console.log('[wipe]', p);
    } catch {
      /* ok */
    }
  }
  const pack = await ensureFamilySamplePack(fam);
  console.log(
    '[bake]',
    JSON.stringify({
      baked: pack.baked,
      skipped: pack.skipped.length,
      errors: pack.errors.slice(0, 3),
      voiceCount: pack.voices.length,
    }),
  );
  const hit = resolveSampleWav(fam, id);
  if (!hit || !fs.existsSync(hit.path) || fs.statSync(hit.path).size < 800) {
    console.error('[FAIL] sample missing', hit);
    process.exit(2);
  }
  console.log('[resolve]', hit.path, 'size=', fs.statSync(hit.path).size);
  console.log('[RESULT] SHIP_SAMPLE_OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
