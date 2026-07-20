/**
 * Smoke: Seedance cloud IP bridge + local core + cloud route module load.
 * Does not require live Vercel when not packaged (local path).
 */
import assert from 'assert';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);

async function main() {
  // Ensure not packaged for local path
  delete process.env.AI_NOVEL_PACKAGED;
  delete process.env.AINOVEL_PUBLISH;
  delete process.env.AINOVEL_SEEDANCE_CLOUD;

  const bridge = await import('../src/lib/commercial/ip/seedanceCloudBridge.ts');
  assert.equal(bridge.shouldUseCloudSeedanceIp(), false);

  const local = await bridge.resolveCompileSeedancePrompt({
    sceneText: 'Hai nhân vật đối thoại căng thẳng trong phòng tối, một người nắm chặt nắm đấm.',
    styleHint: 'cinematic noir',
    genre: 'tâm lý / trinh thám',
    durationSec: 8,
    secondsPerBeat: 4,
    hasStartImage: true,
  });
  assert.ok(local.prompt && local.prompt.length > 40);
  assert.ok(local.camera);
  assert.equal(local.source, 'seedance-bridge-v2');
  console.log('PASS local compile via resolve', {
    fn: local.function,
    shots: local.shotCount,
  });

  const pair = await bridge.resolveApplyDirectorFormulasToPromptPair({
    imagePrompt: 'medium shot, two figures in a dim office',
    videoPrompt: 'They argue; the taller one steps forward once.',
    styleHint: 'cinematic noir',
    genre: 'tâm lý',
    durationSec: 6,
    secondsPerBeat: 3,
  });
  assert.ok(pair.image_prompt.length > 20);
  assert.ok(pair.video_prompt.length > 20);
  console.log('PASS local director pair via resolve');

  // Force cloud mode without network → must require token
  process.env.AINOVEL_SEEDANCE_CLOUD = '1';
  assert.equal(bridge.shouldUseCloudSeedanceIp(), true);
  let denied = false;
  try {
    await bridge.resolveCompileSeedancePrompt(
      {
        sceneText: 'x',
        styleHint: 's',
        durationSec: 6,
      },
      {},
    );
  } catch (e) {
    denied = true;
    assert.ok(String((e as Error).message).includes('token') || String((e as Error).message).length > 5);
  }
  assert.ok(denied, 'cloud mode without token must fail for compile');
  console.log('PASS cloud mode fail-closed without token');

  // Free director without token still allowed (local free path)
  process.env.AINOVEL_SEEDANCE_CLOUD = '1';
  const freePair = await bridge.resolveApplyDirectorFormulasToPromptPair(
    {
      imagePrompt: 'wide shot city',
      videoPrompt: 'camera pans slowly',
      styleHint: 'urban',
      genre: 'hiện đại',
      durationSec: 6,
      secondsPerBeat: 3,
    },
    {},
  );
  assert.ok(freePair.image_prompt);
  console.log('PASS free director local fallback without token');

  delete process.env.AINOVEL_SEEDANCE_CLOUD;

  // Catalog marks seedance cloud_authority
  const cat = await import('../src/lib/commercial/ipCatalog.ts');
  const seed = cat.IP_CATALOG.find((e) => e.id === 'seedance_formula');
  assert.equal(seed?.cloudStatus, 'cloud_authority');

  // Route file exists
  const fs = await import('fs');
  assert.ok(
    fs.existsSync(path.join(root, 'src/app/api/cloud/ip/seedance/route.ts')),
  );

  // apiMap
  const { API } = await import('../src/contracts/apiMap.ts');
  assert.equal(API.cloudIpSeedance, '/api/cloud/ip/seedance');

  console.log(JSON.stringify({ ok: true, smoke: 'seedance-cloud-ip' }));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
