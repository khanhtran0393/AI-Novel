/** Commercial release preflight. Strict mode fails closed on external release inputs. */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const strict = process.argv.includes('--strict');
let failures = 0;

function pass(message) {
  console.log(`  OK  ${message}`);
}

function fail(message) {
  failures += 1;
  console.error(`  ERR ${message}`);
}

function check(condition, message) {
  if (condition) pass(message);
  else fail(message);
}

function realHttps(value) {
  try {
    const url = new URL(String(value || '').trim());
    return (
      url.protocol === 'https:' &&
      url.hostname !== 'example.com' &&
      !url.hostname.endsWith('.example.com')
    );
  } catch {
    return false;
  }
}

const required = [
  'build/icon.ico',
  'build/icon.png',
  'electron/credentialVault.js',
  'electron/securityPolicy.js',
  'electron/updater.js',
  'resources/license/public-keys',
  'resources/commercial/public.env',
  'extensions/ainovel-flow',
  'vendor/FableCut',
  'docs/LEGAL_TOS.md',
  'docs/LEGAL_PRIVACY.md',
  'docs/LEGAL_THIRD_PARTY.md',
  'docs/LEGAL_FLOW_DISCLAIMER.md',
  'docs/THIRD_PARTY_MANIFEST.md',
  'docs/NPM_DEPENDENCY_NOTICE.json',
  'src/app/api/generate-tts/capcut_api/LICENSE',
  'src/app/api/generate-tts/capcut_api/NOTICE.md',
  'src/app/api/generate-tts/capcut_api/capcut_provenance.json',
  'scripts/build-capcut-runtime.cjs',
  'scripts/smoke-capcut-live.mts',
  'vendor/FableCut/library/fonts/SHA256SUMS.txt',
  'scripts/issue-license.mjs',
  'scripts/gen-commercial-secrets.mjs',
  'scripts/smoke-electron-security.cjs',
  'scripts/electron-before-pack.cjs',
  'scripts/electron-after-pack.cjs',
  'scripts/electron-fuses.cjs',
  'scripts/lib/desktop-re-harden.cjs',
  'scripts/smoke-re-harden.cjs',
  'src/lib/commercial/ipCatalog.ts',
  'src/lib/commercial/onlineRevalidate.ts',
  'src/lib/commercial/ip/seedanceCloudBridge.ts',
  'src/lib/commercial/ip/psychCloudBridge.ts',
  'src/lib/commercial/ip/cloudIpAuth.ts',
  'src/app/api/cloud/ip/seedance/route.ts',
  'src/app/api/cloud/ip/psych/route.ts',
  'scripts/smoke-seedance-cloud-ip.mts',
  'scripts/smoke-seedance-cloud-live.mts',
  'scripts/smoke-psych-cloud-live.mts',
  'scripts/publish-desktop-update.mjs',
  'scripts/test-desktop-update-release.mjs',
  'scripts/smoke-installed-desktop.ps1',
  'scripts/smoke-desktop-update.ps1',
  'scripts/cleanup-release-qa-trial.mjs',
  'scripts/cleanup-release-qa-pro.mjs',
  '.github/workflows/release-desktop.yml',
];
console.log('[ship-check] required artifacts');
for (const relative of required) {
  check(fs.existsSync(path.join(root, relative)), relative);
}

console.log('[ship-check] license public keys');
const publicDir = path.join(root, 'resources', 'license', 'public-keys');
const publicKeys = fs.existsSync(publicDir)
  ? fs.readdirSync(publicDir).filter((name) => name.endsWith('.pem'))
  : [];
check(publicKeys.length > 0, 'at least one packaged Ed25519 public key');
for (const name of publicKeys) {
  try {
    const key = crypto.createPublicKey(fs.readFileSync(path.join(publicDir, name), 'utf8'));
    check(key.asymmetricKeyType === 'ed25519', `${name} is Ed25519`);
  } catch {
    fail(`${name} is a valid public PEM`);
  }
}

console.log('[ship-check] package hardening');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
check(pkg.build?.beforePack === 'scripts/electron-before-pack.cjs', 'beforePack re-harden hook');
check(pkg.build?.afterPack === 'scripts/electron-after-pack.cjs', 'afterPack restore+fuses hook');
const files = pkg.build?.files || [];
const resources = JSON.stringify(pkg.build?.extraResources || []);
check(
  files.some((f) => String(f).includes('!**/*.map') || String(f) === '!**/*.map'),
  'build.files excludes source maps',
);
check(
  files.some((f) => String(f).includes('!docs/')),
  'build.files excludes docs from ASAR',
);
check(pkg.build?.asar === true, 'asar enabled');
check(pkg.build?.forceCodeSigning === true, 'forceCodeSigning enabled');
check(pkg.build?.win?.signAndEditExecutable === true, 'Windows signing enabled');
check(
  Array.isArray(pkg.build?.win?.signtoolOptions?.publisherName),
  'Windows publisher verification configured',
);
check(pkg.build?.win?.verifyUpdateCodeSignature === true, 'update signature verification enabled');
check(
  String(pkg.scripts?.['build:desktop'] || '').includes('--publish never'),
  'desktop build cannot auto-publish before signature verification',
);
check(
  String(pkg.scripts?.['build:desktop'] || '').includes('npm run build'),
  'desktop build creates fresh Next production output',
);
check(
  !JSON.stringify(pkg.build?.win?.target || []).includes('portable'),
  'production Windows target is signed NSIS only',
);
const releaseWorkflow = fs.readFileSync(
  path.join(root, '.github', 'workflows', 'release-desktop.yml'),
  'utf8',
);
const installedSmoke = fs.readFileSync(
  path.join(root, 'scripts', 'smoke-installed-desktop.ps1'),
  'utf8',
);
check(
  releaseWorkflow.includes('needs: build-sign-verify'),
  'publication waits for the verified build job',
);
check(
  releaseWorkflow.includes('environment: production'),
  'publication is protected by the production environment',
);
check(
  releaseWorkflow.includes('smoke-installed-desktop.ps1'),
  'signed installer is installed and exercised before publication',
);
check(
  releaseWorkflow.includes('/api/cloud/license/issue') &&
    releaseWorkflow.includes('PaidProToken') &&
    releaseWorkflow.includes('PaidProLicenseId') &&
    releaseWorkflow.includes('secrets.AINOVEL_ENTITLEMENT_ADMIN_KEY'),
  'paid Pro is cloud-persisted, activated and gate-checked before publication',
);
check(
  installedSmoke.includes('/api/cloud/license/verify') &&
    installedSmoke.includes("authority -ne 'supabase'") &&
    installedSmoke.includes('PaidProLicenseId'),
  'paid Pro smoke verifies Supabase heartbeat authority',
);
check(
  releaseWorkflow.includes('cleanup-release-qa-pro.mjs') &&
    releaseWorkflow.includes('QA_PRO_LICENSE_ID'),
  'exact cloud Pro QA row is cleaned in release workflow',
);
check(
  releaseWorkflow.includes('smoke-desktop-update.ps1'),
  'signed updater performs a real staged download and installation',
);
check(
  releaseWorkflow.includes('--cleanup-bucket'),
  'disposable updater feed is removed before production publication',
);
check(
  releaseWorkflow.indexOf('smoke-desktop-update.ps1') <
    releaseWorkflow.indexOf('npm run release:publish'),
  'real updater smoke precedes production update-feed publication',
);
check(
  releaseWorkflow.indexOf('PaidProToken') <
    releaseWorkflow.indexOf('npm run release:publish'),
  'paid Pro smoke precedes production update-feed publication',
);
check(files.includes('!.next/dev/**/*'), '.next/dev excluded');
check(files.includes('!.next/cache/**/*'), '.next/cache excluded');
check(!files.includes('src/**/*'), 'full TypeScript source excluded');
for (const runtimePublicPath of [
  '!public/audio/**/*',
  '!public/downloads/**/*',
  '!public/images/**/*',
  '!public/isolated/**/*',
  '!public/navtools/**/*',
  '!public/omnivoice-refs/**/*',
  '!public/omnivoice-library.json',
  '!public/phantom-x-bypass/**/*',
  '!public/renders/**/*',
  '!public/video/**/*',
  '!public/watermarked/**/*',
]) {
  check(files.includes(runtimePublicPath), `${runtimePublicPath.slice(1)} excluded`);
}
check(resources.includes('extensions/ainovel-flow'), 'Flow extension packaged');
check(resources.includes('vendor/FableCut'), 'FableCut packaged');
check(resources.includes('resources/license'), 'license public keys packaged');
check(resources.includes('resources/commercial'), 'public commercial defaults packaged');
check(resources.includes('LEGAL_*.md'), 'legal notices packaged');
check(resources.includes('NPM_DEPENDENCY_NOTICE.json'), 'npm dependency notice packaged');
check(resources.includes('capcut_runtime_manifest.json'), 'CapCut runtime manifest packaged');
check(resources.includes('capcut_windows/cronet_helper.dll'), 'first-party CapCut adapter DLL packaged');
check(!resources.includes('"from":"bin"'), 'unverified bundled binaries excluded');
check(!resources.includes('"from":"fonts"'), 'unverified root fonts excluded');
for (const excludedResource of [
  '!ffmpeg/**',
  '!MediaCrawler/**',
  '!assets/**',
  '!models/vina_voice/*.onnx',
]) {
  check(resources.includes(excludedResource), `${excludedResource.slice(1)} excluded`);
}

console.log('[ship-check] secret separation');
const customerTemplate = fs.readFileSync(path.join(root, '.env.commercial.example'), 'utf8');
const publicCommercialConfig = fs.readFileSync(
  path.join(root, 'resources', 'commercial', 'public.env'),
  'utf8',
);
for (const secret of [
  'AINOVEL_ENTITLEMENT_SECRET=',
  'AINOVEL_ENTITLEMENT_PRIVATE_KEY=',
  'AINOVEL_ENTITLEMENT_ADMIN_KEY=',
  'AINOVEL_PAYMENT_WEBHOOK_SECRET=',
  'SUPABASE_SERVICE_ROLE_KEY=',
  'AINOVEL_ENTITLEMENT_PUBLIC_KEY=',
  'AINOVEL_ENTITLEMENT_PUBLIC_KEY_FILE=',
  'AINOVEL_ENTITLEMENT_PUBLIC_KEYS=',
]) {
  check(!customerTemplate.split(/\r?\n/).some((line) => line.startsWith(secret)), `${secret.slice(0, -1)} absent from customer config`);
  check(!publicCommercialConfig.split(/\r?\n/).some((line) => line.startsWith(secret)), `${secret.slice(0, -1)} absent from packaged public config`);
}
const publicLicenseApi = publicCommercialConfig
  .split(/\r?\n/)
  .find((line) => line.startsWith('AINOVEL_LICENSE_API_URL='))
  ?.slice('AINOVEL_LICENSE_API_URL='.length);
check(realHttps(publicLicenseApi), 'packaged public config has real HTTPS license API');
const publicUpdateFeed = publicCommercialConfig
  .split(/\r?\n/)
  .find((line) => line.startsWith('AINOVEL_UPDATE_FEED_URL='))
  ?.slice('AINOVEL_UPDATE_FEED_URL='.length);
const packagedUpdateFeed = pkg.build?.publish?.find(
  (entry) => entry?.provider === 'generic',
)?.url;
check(realHttps(publicUpdateFeed), 'packaged public config has real HTTPS update feed');
check(
  packagedUpdateFeed === publicUpdateFeed,
  'electron-builder feed matches packaged public update feed',
);
const entitlement = fs.readFileSync(path.join(root, 'src/lib/entitlement.ts'), 'utf8');
check(!entitlement.includes('createHmac'), 'license verifier contains no shared HMAC');
check(entitlement.includes('crypto.verify'), 'Ed25519 verification wired');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
check(main.includes('AINOVEL_ENTITLEMENT_PUBLIC_KEYS_DIR'), 'packaged public key ring wired');
check(main.includes("path.join(runtimeRoot, 'commercial', 'public.env')"), 'packaged public commercial defaults wired');
check(
  main.includes("'AINOVEL_ENTITLEMENT_PUBLIC_KEY_FILE',") &&
    main.indexOf("'AINOVEL_ENTITLEMENT_PUBLIC_KEY_FILE',") > main.indexOf('including values inherited'),
  'packaged shell clears customer-controlled public-key overrides',
);
check(main.includes('assertTrustedIpc'), 'IPC sender validation wired');
check(main.includes('sandbox: true'), 'renderer sandbox enabled');
check(
  main.includes("process.env.AINOVEL_ENTITLEMENT_MODE = 'enforce'"),
  'packaged shell force-enforces entitlement mode',
);
check(
  main.includes("process.env.AINOVEL_ALLOW_LOCAL_TRIAL = '0'"),
  'packaged shell disables local trial escape',
);
// Customer .env.commercial must not be able to flip MODE / local trial
check(
  !/customerEnvKeys\s*=\s*new Set\(\[[\s\S]*?'AINOVEL_ENTITLEMENT_MODE'/.test(main),
  'customer env whitelist excludes AINOVEL_ENTITLEMENT_MODE',
);
check(
  !/customerEnvKeys\s*=\s*new Set\(\[[\s\S]*?'AINOVEL_ALLOW_LOCAL_TRIAL'/.test(main),
  'customer env whitelist excludes AINOVEL_ALLOW_LOCAL_TRIAL',
);
const entitlementSrc = fs.readFileSync(
  path.join(root, 'src', 'lib', 'entitlement.ts'),
  'utf8',
);
check(
  entitlementSrc.includes('isCustomerPackagedRuntime') &&
    /if\s*\(\s*isCustomerPackagedRuntime\(\)\s*\)\s*return\s*'enforce'/.test(entitlementSrc),
  'entitlement.ts forces enforce on packaged/publish runtime',
);
check(
  fs.existsSync(path.join(root, 'docs', 'DEFENSE_LAYERS.md')) ||
    fs.existsSync(path.join(root, 'scripts', 'electron-fuses.cjs')),
  'defense-in-depth artifacts present (docs or fuses hook)',
);

const thirdPartyManifest = fs.readFileSync(
  path.join(root, 'docs', 'THIRD_PARTY_MANIFEST.md'),
  'utf8',
);
const thirdPartyBlockers = (thirdPartyManifest.match(/\*\*BLOCKED\*\*/g) || []).length;
const capcutManifestRow = thirdPartyManifest
  .split(/\r?\n/)
  .find((line) => line.includes('CapCut interoperability adapter')) || '';
const capcutProvenance = JSON.parse(
  fs.readFileSync(
    path.join(root, 'src', 'app', 'api', 'generate-tts', 'capcut_api', 'capcut_provenance.json'),
    'utf8',
  ),
);
const capcutNotice = fs.readFileSync(
  path.join(root, 'src', 'app', 'api', 'generate-tts', 'capcut_api', 'NOTICE.md'),
  'utf8',
);
check(
  capcutManifestRow.includes(capcutProvenance.importedCommit) &&
    capcutManifestRow.includes('READY-WITH-DISCLOSURE') &&
    capcutManifestRow.includes('Never package CapCut/Jianying') &&
    capcutNotice.includes(capcutProvenance.importedCommit) &&
    capcutNotice.includes(capcutProvenance.repository),
  'CapCut adapter provenance and disclosure recorded',
);
const npmNotice = JSON.parse(
  fs.readFileSync(path.join(root, 'docs', 'NPM_DEPENDENCY_NOTICE.json'), 'utf8'),
);
check(npmNotice.version === pkg.version, 'npm notice matches app version');
check(npmNotice.packages?.length > 0, 'npm dependency notice is non-empty');
check(
  npmNotice.packages.every((entry) => entry.name && entry.version && entry.license !== 'UNKNOWN'),
  'npm dependency notice records name/version/license',
);
const fontDir = path.join(root, 'vendor', 'FableCut', 'library', 'fonts');
const fontChecksumLines = fs
  .readFileSync(path.join(fontDir, 'SHA256SUMS.txt'), 'utf8')
  .trim()
  .split(/\r?\n/)
  .filter(Boolean);
const fontChecksumOk = fontChecksumLines.length > 0 && fontChecksumLines.every((line) => {
  const match = line.match(/^([a-f0-9]{64})  (.+)$/);
  if (!match) return false;
  const fontPath = path.join(fontDir, match[2]);
  if (!fs.existsSync(fontPath)) return false;
  const actual = crypto.createHash('sha256').update(fs.readFileSync(fontPath)).digest('hex');
  return actual === match[1];
});
check(fontChecksumOk, 'FableCut font SHA-256 manifest matches shipped files');
if (strict) {
  check(thirdPartyBlockers === 0, 'third-party redistribution evidence complete');
} else if (thirdPartyBlockers > 0) {
  console.warn(`  WARN third-party manifest has ${thirdPartyBlockers} release blocker(s)`);
} else {
  pass('third-party redistribution evidence complete');
}

if (strict) {
  console.log('[ship-check] external production inputs');
  const effectiveUpdateFeed = process.env.AINOVEL_UPDATE_FEED_URL || publicUpdateFeed;
  check(realHttps(effectiveUpdateFeed), 'real HTTPS update feed');
  if (realHttps(effectiveUpdateFeed)) {
    try {
      const markerResponse = await fetch(
        `${String(effectiveUpdateFeed).replace(/\/$/, '')}/feed-ready.json?check=${Date.now()}`,
        { cache: 'no-store', signal: AbortSignal.timeout(15_000) },
      );
      const marker = markerResponse.ok ? await markerResponse.json() : null;
      check(
        markerResponse.ok &&
          marker?.schema === 1 &&
          marker?.appId === pkg.build?.appId &&
          marker?.feedUrl === String(effectiveUpdateFeed).replace(/\/$/, ''),
        'public update feed marker reachable and matches appId',
      );
    } catch {
      fail('public update feed marker reachable and matches appId');
    }
  }
  check(
    realHttps(process.env.AINOVEL_LICENSE_API_URL || publicLicenseApi),
    'real HTTPS license API',
  );
  check(
    Boolean(
      process.env.CSC_LINK ||
      process.env.WIN_CSC_LINK ||
      process.env.WIN_CSC_SUBJECT_NAME,
    ),
    'Windows code-signing certificate configured',
  );
  check(Boolean(process.env.WIN_CSC_PUBLISHER_NAME), 'WIN_CSC_PUBLISHER_NAME configured');
  check(
    /^[A-F0-9]{40}$/i.test(String(process.env.WIN_CSC_CERTIFICATE_SHA1 || '').replace(/\s/g, '')),
    'WIN_CSC_CERTIFICATE_SHA1 configured',
  );
}

console.log('');
if (failures > 0) {
  console.error(`[ship-check] FAIL (${failures})`);
  process.exitCode = 1;
} else {
  console.log(`[ship-check] PASS${strict ? ' strict' : ''}`);
}
