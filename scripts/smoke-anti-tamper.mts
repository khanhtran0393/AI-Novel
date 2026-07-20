/**
 * Adversarial smoke: keyring pin, rogue key reject, canary, packaged secret reject.
 */
import assert from 'assert';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);

async function main() {
  // Baseline: real keyring from repo must pass anti-tamper (dev)
  delete process.env.AI_NOVEL_PACKAGED;
  delete process.env.AINOVEL_PUBLISH;
  process.env.AINOVEL_ENTITLEMENT_PUBLIC_KEYS_DIR = path.join(
    root,
    'resources',
    'license',
    'public-keys',
  );
  delete process.env.AINOVEL_ENTITLEMENT_PRIVATE_KEY;
  delete process.env.AINOVEL_ENTITLEMENT_PRIVATE_KEY_FILE;

  const anti = await import('../src/lib/commercial/antiTamper.ts');
  const base = anti.evaluateAntiTamper();
  assert.ok(base.ok, 'baseline should pass: ' + base.reasons.join('; '));
  assert.ok(base.keyringKids.includes('3ac9c18a6691a09e'));
  console.log('PASS baseline keyring pin');

  // Inject attacker public key into a temp dir with ONLY attacker key
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ainovel-at-'));
  const { publicKey } = crypto.generateKeyPairSync('ed25519');
  const attackerPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const attackerKid = crypto
    .createHash('sha256')
    .update(publicKey.export({ type: 'spki', format: 'der' }))
    .digest('hex')
    .slice(0, 16);
  fs.writeFileSync(path.join(tmp, `${attackerKid}.pem`), attackerPem);

  process.env.AINOVEL_ENTITLEMENT_PUBLIC_KEYS_DIR = tmp;
  process.env.AI_NOVEL_PACKAGED = '1';
  process.env.AINOVEL_PUBLISH = '1';

  // Need fresh module state? resolveEntitlementVerificationKeys re-reads dir each call
  const rogue = anti.evaluateAntiTamper();
  assert.equal(rogue.ok, false, 'attacker-only keyring must fail');
  assert.ok(
    rogue.reasons.some(
      (r) =>
        r.includes('lạ') ||
        r.includes('pin') ||
        r.includes('SPKI') ||
        r.includes('mong đợi'),
    ),
    rogue.reasons.join('; '),
  );
  console.log('PASS reject attacker public key swap');

  // Packaged + seller secret present → fail
  process.env.AINOVEL_ENTITLEMENT_PUBLIC_KEYS_DIR = path.join(
    root,
    'resources',
    'license',
    'public-keys',
  );
  process.env.AINOVEL_ENTITLEMENT_ADMIN_KEY = 'leaked-admin-key-should-fail';
  const leak = anti.evaluateAntiTamper();
  assert.equal(leak.ok, false, 'packaged with admin key must fail');
  assert.ok(leak.reasons.some((r) => r.includes('secret') || r.includes('seller')));
  console.log('PASS packaged secret leak reject');

  delete process.env.AINOVEL_ENTITLEMENT_ADMIN_KEY;
  delete process.env.AI_NOVEL_PACKAGED;
  delete process.env.AINOVEL_PUBLISH;

  // assertAntiTamper throws on fail
  process.env.AINOVEL_ENTITLEMENT_PUBLIC_KEYS_DIR = tmp;
  process.env.AI_NOVEL_PACKAGED = '1';
  let threw = false;
  try {
    anti.assertAntiTamper('smoke');
  } catch {
    threw = true;
  }
  assert.ok(threw);
  console.log('PASS assertAntiTamper throws');

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(JSON.stringify({ ok: true, smoke: 'anti-tamper' }));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
