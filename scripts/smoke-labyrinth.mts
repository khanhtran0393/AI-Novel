/**
 * Labyrinth + expanded bypass probe smoke.
 */
import assert from 'assert';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);

async function main() {
  delete process.env.AI_NOVEL_PACKAGED;
  delete process.env.AINOVEL_PUBLISH;
  delete process.env.AINOVEL_ELECTRON_PACKAGED;
  process.env.AINOVEL_ENTITLEMENT_PUBLIC_KEYS_DIR = path.join(
    root,
    'resources',
    'license',
    'public-keys',
  );
  process.env.AINOVEL_LABYRINTH = '1';
  process.env.AINOVEL_MIRAGE = '1';

  const lab = await import('../src/lib/commercial/labyrinth/index.ts');
  lab.clearTamperSignalsForTests();

  // --- Expanded bypass probes (clean install must pass) ---
  const probes = lab.evaluateBypassProbes();
  assert.ok(
    probes.ok,
    'clean baseline probes must pass: ' +
      probes.findings.map((f) => f.reason).join('; '),
  );
  console.log('PASS bypass probes clean baseline', {
    score: probes.score,
    categories: probes.categories,
  });

  // --- Forged pro token must be rejected by canary suite ---
  // (covered inside evaluateBypassProbes; force classify via anti-tamper)
  const anti = await import('../src/lib/commercial/antiTamper.ts');
  const baseAt = anti.evaluateAntiTamper();
  assert.ok(baseAt.ok, 'anti-tamper baseline: ' + baseAt.reasons.join('; '));
  assert.equal(typeof baseAt.bypassScore, 'number');
  console.log('PASS anti-tamper includes bypassScore');

  // --- Matrix free must not get video ---
  const { canAccessFeature } = await import(
    '../src/lib/commercial/featureMatrix.ts'
  );
  assert.equal(canAccessFeature('free', 'gen_video'), false);
  console.log('PASS matrix free !gen_video');

  // --- Decoy unlock ---
  const unlock = lab.unlockProLocal('x', { silent: true });
  assert.equal(unlock.ok, false);
  assert.equal(unlock.pro, false);
  console.log('PASS decoy unlock closed');

  // --- Tamper cascade progressive ---
  lab.clearTamperSignalsForTests();
  const session = 'smoke_tamper_cascade';
  const layers: number[] = [];
  for (let i = 0; i < 4; i++) {
    try {
      lab.denyThroughCascade({
        origin: 'anti_tamper',
        sessionKey: session,
        tamperSuspected: true,
        signalCode: 'ANTI_TAMPER_FAIL',
        strength: 3,
      });
    } catch (e) {
      const { AppError } = await import('../src/lib/errors.ts');
      assert.ok(e instanceof AppError);
      const d = e.details as { layer?: number; labyrinth?: boolean };
      assert.equal(d.labyrinth, true);
      layers.push(d.layer as number);
    }
  }
  assert.ok(layers[0] === 2);
  assert.ok(layers[layers.length - 1]! >= 3);
  console.log('PASS cascade layers', layers);

  // --- Mirage + wrong path ---
  const { AppError } = await import('../src/lib/errors.ts');
  const tamperErr = new AppError('anti-tamper fail', {
    code: 'AUTH',
    status: 403,
    details: { labyrinth: true, root: 'INTEGRITY_OR_BYPASS', layer: 2 },
  });
  assert.equal(lab.shouldServeMirage(tamperErr), true);
  const wrong = lab.runWrongFeaturePath('gen_video', { prompt: 'test' });
  assert.ok(wrong.handlers.includes('seedance_compile_clip_compat'));
  assert.ok(lab.getRecentTamperSignals().some((s) => s.code === 'WRONG_PATH_RUN'));

  const { responseForGateFailure } = await import(
    '../src/lib/commercial/apiGate.ts'
  );
  const mirageRes = responseForGateFailure(tamperErr, 'gen_video', undefined, {
    prompt: 'x',
  });
  assert.equal(mirageRes.status, 200);
  const mj = await mirageRes.json();
  assert.equal(mj.success, true);
  assert.equal(mj.videoUrl, null);
  assert.ok(mj.engine === 'compat-offline');
  console.log('PASS mirage + wrong-path');

  const legitErr = new AppError('Token không cấp quyền Pro/Trial.', {
    code: 'AUTH',
    status: 403,
    details: { labyrinth: false, origin: 'pro_access' },
  });
  assert.equal(lab.shouldServeMirage(legitErr), false);
  const denyRes = responseForGateFailure(legitErr, 'gen_video');
  assert.ok(denyRes.status === 403 || denyRes.status === 401);
  console.log('PASS legitimate no mirage');

  // --- Client probes ---
  lab.setLabyrinthClientShadow(false);
  const clientClean = lab.evaluateClientBypassProbes({
    antiTamperOk: true,
    storeIsPro: false,
  });
  assert.equal(clientClean.ok, true);

  const clientHot = lab.evaluateClientBypassProbes({
    antiTamperOk: false,
    storeIsPro: true,
  });
  assert.equal(clientHot.shouldShadow, true);
  lab.applyClientBypassProbes({ antiTamperOk: false });
  assert.equal(lab.isLabyrinthClientShadow(), true);
  const cw = lab.executeClientWrongPremium('gen_video', { prompt: 'y' });
  assert.equal(cw.ran, true);
  lab.setLabyrinthClientShadow(false);
  console.log('PASS client bypass probes + shadow');

  // --- Crack env canary ---
  process.env.AINOVEL_CRACK_ME = '1';
  const atCrack = anti.evaluateAntiTamper();
  assert.equal(atCrack.ok, false);
  assert.ok(atCrack.reasons.some((r) => /decoy env|crack/i.test(r)));
  delete process.env.AINOVEL_CRACK_ME;
  console.log('PASS crack env probe');

  // --- Public status shapes ---
  const bp = lab.getBypassProbePublicStatus();
  assert.equal(typeof bp.findingCount, 'number');
  const st = lab.getLabyrinthPublicStatus();
  assert.equal(st.version, 1);
  console.log('PASS public status');

  delete process.env.AINOVEL_LABYRINTH;
  delete process.env.AINOVEL_MIRAGE;
  console.log(
    JSON.stringify({
      ok: true,
      smoke: 'labyrinth',
      layers,
      bypassProbe: true,
      mirage: true,
      wrongPath: true,
    }),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
