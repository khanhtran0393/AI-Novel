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
// Auto-update: seller-controlled github provider must load from public.env
assert.ok(main.includes('AINOVEL_UPDATE_PROVIDER'));
assert.ok(main.includes('AINOVEL_UPDATE_GITHUB_OWNER'));
assert.ok(main.includes('AINOVEL_UPDATE_GITHUB_REPO'));
assert.ok(main.includes('AINOVEL_UPDATE_ALLOW_UNSIGNED'));

const updaterJs = fs.readFileSync(path.join(root, 'electron/updater.js'), 'utf8');
assert.ok(updaterJs.includes("provider: 'github'"), 'updater must support github provider');
assert.ok(updaterJs.includes('listFeedCandidates'), 'dual-feed candidates required');
assert.ok(updaterJs.includes('autoDownload = true'), 'policy C: auto download');
assert.ok(updaterJs.includes('autoInstallOnAppQuit = false'), 'policy C: no install on quit');
assert.ok(updaterJs.includes('update-pending.json'), 'stage flag for next-launch install');
assert.ok(updaterJs.includes('acknowledgeJustUpdated'));
// NsisUpdater setter ignores falsy — must assign async () => null
assert.ok(
  updaterJs.includes('verifyUpdateCodeSignature = async () => null'),
  'ALLOW_UNSIGNED must set verifyUpdateCodeSignature to async () => null',
);
assert.ok(!/verifyUpdateCodeSignature\s*=\s*false/.test(updaterJs), 'false is a no-op for signature skip');
assert.ok(
  fs.existsSync(path.join(root, 'scripts/verify-github-update-feed.mjs')),
  'missing verify-github-update-feed.mjs',
);
assert.ok(
  fs.existsSync(path.join(root, 'scripts/ship-update-ready.mjs')),
  'missing ship-update-ready.mjs',
);
const publicEnv = fs.readFileSync(
  path.join(root, 'resources/commercial/public.env'),
  'utf8',
);
assert.ok(/AINOVEL_UPDATE_PROVIDER\s*=\s*github/.test(publicEnv));
assert.ok(/AINOVEL_UPDATE_GITHUB_OWNER\s*=/.test(publicEnv));
assert.ok(/AINOVEL_UPDATE_CHECK_ON_LAUNCH\s*=\s*1/.test(publicEnv));
assert.ok(
  /AINOVEL_UPDATE_FEED_URL\s*=\s*https:\/\/azlizrbjkqcyqnsmuccv\.supabase\.co/.test(
    publicEnv,
  ),
  'dual-feed requires generic FEED_URL enabled',
);

const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
assert.ok(preload.includes('ackChangelog'));
assert.ok(preload.includes('ainovel-update-ack-changelog'));

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
// Phase A/B: beforePack shell harden → afterPack restore + fuses
assert.equal(pkg.build?.beforePack, 'scripts/electron-before-pack.cjs');
assert.equal(pkg.build?.afterPack, 'scripts/electron-after-pack.cjs');
const afterPack = fs.readFileSync(path.join(root, 'scripts/electron-after-pack.cjs'), 'utf8');
assert.ok(afterPack.includes('electron-fuses') || afterPack.includes('flipFuses'));
assert.ok(fs.existsSync(path.join(root, 'src/lib/commercial/ipCatalog.ts')));
assert.ok(fs.existsSync(path.join(root, 'src/lib/commercial/onlineRevalidate.ts')));

assert.ok(fs.existsSync(path.join(root, 'docs/DEFENSE_LAYERS.md')));
const defense = fs.readFileSync(path.join(root, 'docs/DEFENSE_LAYERS.md'), 'utf8');
assert.ok(defense.includes('Phase A') && defense.includes('Phase C'));

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
