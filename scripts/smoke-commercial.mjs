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
assert.ok(main.includes("process.env.AINOVEL_ENTITLEMENT_MODE = 'enforce'"));
assert.ok(main.includes("process.env.AINOVEL_ALLOW_LOCAL_TRIAL = '0'"));
assert.ok(main.includes('devTools: !app.isPackaged'));
assert.ok(main.includes('isAllowedShellOpenPath'));
assert.ok(main.includes('before-input-event'));

assert.ok(entitlement.includes('isCustomerPackagedRuntime'));
assert.ok(entitlement.includes("return 'enforce'"));
assert.ok(entitlement.includes('getHwidV2'));
assert.ok(entitlement.includes('hwidMatchesClaim'));

assert.ok(matrix.includes('FREE_TTS_PLATFORMS'));
assert.ok(matrix.includes('SERVER_GATED_FEATURES'));
assert.ok(matrix.includes("id: 'tts_premium'") && matrix.includes('serverGated: true'));
assert.ok(matrix.includes("id: 'toolbox_labs'") && matrix.includes('serverGated: true'));

const apiGate = fs.readFileSync(path.join(root, 'src/lib/commercial/apiGate.ts'), 'utf8');
assert.ok(apiGate.includes('requireFeature'));
assert.ok(apiGate.includes('requireTtsPlatformAccess'));

const fuses = fs.readFileSync(path.join(root, 'scripts/electron-fuses.cjs'), 'utf8');
assert.ok(fuses.includes('flipFuses') || fuses.includes('@electron/fuses'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
assert.equal(pkg.build?.afterPack, 'scripts/electron-fuses.cjs');

assert.ok(fs.existsSync(path.join(root, 'docs/DEFENSE_LAYERS.md')));

// Gate wire presence on critical routes
const gatedSnippets = [
  ['src/app/api/generate-tts/route.ts', 'requireTtsPlatformAccess'],
  ['src/app/api/navtools/gateway/route.ts', "requireFeature(req, 'toolbox_labs'"],
  ['src/app/api/integrations/seedance/route.ts', "requireFeature(req, 'integrations_pipeline'"],
  ['src/app/api/flow/accounts/route.ts', "requireFeature(req, 'flow_multi_account'"],
  ['src/app/api/suggest-channels/route.ts', "requireFeature(req, 'multi_channel'"],
];
for (const [rel, needle] of gatedSnippets) {
  const src = fs.readFileSync(path.join(root, rel), 'utf8');
  assert.ok(src.includes(needle), `missing gate in ${rel}: ${needle}`);
}

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const data = Buffer.from('AI Novel commercial smoke');
const signature = crypto.sign(null, data, privateKey);
assert.ok(crypto.verify(null, data, publicKey, signature));

console.log(JSON.stringify({ ok: true, files: required.length, algorithm: 'Ed25519', defense: true }));
console.log('PASS smoke-commercial');
