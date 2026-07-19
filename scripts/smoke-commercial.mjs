/** Static commercial release invariants (no network). */
import assert from 'assert';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const required = [
  'electron/credentialVault.js',
  'electron/updater.js',
  'resources/license/public-keys',
  'src/lib/entitlement.ts',
  'src/lib/commercial/sellerRuntime.ts',
  'src/app/api/entitlement/activate/route.ts',
  'src/app/api/entitlement/issue/route.ts',
  'src/app/api/entitlement/trial/route.ts',
  'src/app/api/commercial/status/route.ts',
  'docs/COMMERCIAL.md',
  'docs/LEGAL_TOS.md',
  'docs/LEGAL_PRIVACY.md',
  'scripts/gen-commercial-secrets.mjs',
  'scripts/issue-license.mjs',
  'scripts/ship-check.mjs',
];
for (const relative of required) {
  assert.ok(fs.existsSync(path.join(root, relative)), `missing ${relative}`);
}

const entitlement = fs.readFileSync(path.join(root, 'src/lib/entitlement.ts'), 'utf8');
assert.ok(entitlement.includes("crypto.sign(null"));
assert.ok(entitlement.includes("crypto.verify("));
assert.ok(!entitlement.includes('createHmac'));
assert.ok(!entitlement.includes('AINOVEL_ENTITLEMENT_SECRET'));

const matrix = fs.readFileSync(path.join(root, 'src/lib/commercial/featureMatrix.ts'), 'utf8');
assert.ok(matrix.includes("export type PlanTier = 'free' | 'trial' | 'pro'"));
assert.ok(!matrix.includes("| 'vip'"));

const persistence = fs.readFileSync(path.join(root, 'src/store/novelStorePersistence.ts'), 'utf8');
for (const forbidden of ['apiKey: state.apiKey', 'googleStudioCookie: state.googleStudioCookie']) {
  assert.ok(!persistence.includes(forbidden), `plaintext persistence: ${forbidden}`);
}
assert.ok(persistence.includes('ttsConfigWithoutSecrets'));

const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
assert.ok(main.includes('AINOVEL_ENTITLEMENT_PUBLIC_KEYS_DIR'));
assert.ok(main.includes('assertTrustedIpc'));
assert.ok(main.includes("sandbox: true"));

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const data = Buffer.from('AI Novel commercial smoke');
const signature = crypto.sign(null, data, privateKey);
assert.ok(crypto.verify(null, data, publicKey, signature));

console.log(JSON.stringify({ ok: true, files: required.length, algorithm: 'Ed25519' }));
console.log('PASS smoke-commercial');
