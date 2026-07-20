/**
 * Labyrinth smoke: decoy fail-closed, tamper cascade progressive layers,
 * legitimate deny stays single-message (no hydra without tamper).
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
  // Force sticky cascade in this smoke (dev is not packaged)
  process.env.AINOVEL_LABYRINTH = '1';

  const lab = await import('../src/lib/commercial/labyrinth/index.ts');
  lab.clearTamperSignalsForTests();

  // --- Decoy never grants Pro ---
  const unlock = lab.unlockProLocal('crack-code');
  assert.equal(unlock.ok, false);
  assert.equal(unlock.pro, false);
  assert.ok(lab.getRecentTamperSignals().some((s) => s.code === 'DECOY_UNLOCK_HIT'));
  console.log('PASS decoy unlockProLocal fail-closed');

  assert.equal(lab.forceOpenEntitlementMode(), false);
  let threwDerive = false;
  try {
    lab.deriveModuleKeyFromToken('AINOVEL2.fake');
  } catch (e) {
    threwDerive = true;
    assert.ok(String((e as Error).message).includes('FORBIDDEN'));
  }
  assert.ok(threwDerive);
  console.log('PASS decoy derive/forceOpen');

  // --- Legitimate deny: no labyrinth flag ---
  lab.clearTamperSignalsForTests();
  let legitDetails: unknown;
  try {
    lab.denyThroughCascade({
      origin: 'token_verify',
      sessionKey: 'smoke_legit',
      tamperSuspected: false,
      originalError: new (await import('../src/lib/errors.ts')).AppError(
        'Token không cấp quyền Pro/Trial.',
        { code: 'AUTH', status: 403 },
      ),
    });
  } catch (e) {
    const { AppError } = await import('../src/lib/errors.ts');
    assert.ok(e instanceof AppError);
    assert.equal(e.message, 'Token không cấp quyền Pro/Trial.');
    legitDetails = e.details;
  }
  assert.ok(legitDetails && (legitDetails as { labyrinth?: boolean }).labyrinth === false);
  console.log('PASS legitimate single-message deny');

  // --- Tamper cascade progressive (same session) ---
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
        detail: `smoke-round-${i}`,
      });
    } catch (e) {
      const { AppError } = await import('../src/lib/errors.ts');
      assert.ok(e instanceof AppError);
      const d = e.details as { labyrinth?: boolean; root?: string; layer?: number };
      assert.equal(d.labyrinth, true);
      assert.equal(d.root, 'INTEGRITY_OR_BYPASS');
      assert.ok(typeof d.layer === 'number');
      layers.push(d.layer as number);
      assert.equal(e.message, lab.CASCADE_LAYER_MESSAGES[d.layer as 1 | 2 | 3 | 4 | 5]);
    }
  }
  // base layer 2 for anti_tamper; then 2,3,4,5 as attempts advance
  assert.ok(layers[0] === 2, `first layer expected 2 got ${layers[0]}`);
  assert.ok(layers[1]! >= layers[0]!, `layers should not decrease: ${layers.join(',')}`);
  assert.ok(layers[layers.length - 1]! >= 3, `should progress: ${layers.join(',')}`);
  console.log('PASS tamper cascade progressive layers', layers);

  // --- classify anti-tamper reasons ---
  const classified = lab.classifyAntiTamperReasons([
    'CANARY FAIL: verifyEntitlementToken chấp nhận token rác',
    'Keyring kid lạ bị từ chối: deadbeef',
  ]);
  assert.ok(classified.codes.includes('CANARY_VERIFY_NOP'));
  assert.ok(classified.codes.includes('KEYRING_INJECT'));
  assert.equal(classified.strength, 4);
  console.log('PASS classifyAntiTamperReasons');

  // --- anti-tamper decoy env ---
  process.env.AINOVEL_CRACK_ME = '1';
  const anti = await import('../src/lib/commercial/antiTamper.ts');
  const report = anti.evaluateAntiTamper();
  assert.equal(report.ok, false);
  assert.ok(report.reasons.some((r) => r.toLowerCase().includes('decoy env')));
  delete process.env.AINOVEL_CRACK_ME;
  console.log('PASS decoy env canary in evaluateAntiTamper');

  // --- public status shape ---
  const st = lab.getLabyrinthPublicStatus();
  assert.equal(st.version, 1);
  assert.ok(typeof st.signalCount === 'number');
  console.log('PASS labyrinth public status');

  delete process.env.AINOVEL_LABYRINTH;
  console.log(JSON.stringify({ ok: true, smoke: 'labyrinth', layers }));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
