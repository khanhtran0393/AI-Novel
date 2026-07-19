/** Audit a completed unpacked Electron QA/release artifact. */
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const asar = require('@electron/asar');

const root = path.resolve(process.argv[2] || 'dist-qa/win-unpacked');
const resources = path.join(root, 'resources');
const archive = path.join(resources, 'app.asar');
assert.ok(fs.existsSync(archive), `Missing ${archive}`);
for (const rootLicense of ['LICENSE.electron.txt', 'LICENSES.chromium.html']) {
  assert.ok(fs.existsSync(path.join(root, rootLicense)), `Missing ${rootLicense}`);
}

const required = [
  'license/public-keys',
  'commercial/public.env',
  'legal/LEGAL_TOS.md',
  'legal/LEGAL_PRIVACY.md',
  'legal/LEGAL_THIRD_PARTY.md',
  'legal/THIRD_PARTY_MANIFEST.md',
  'legal/NPM_DEPENDENCY_NOTICE.json',
  'extensions/ainovel-flow/manifest.json',
  'vendor/FableCut/LICENSE',
  'vendor/FableCut/library/fonts/OFL.txt',
  'vendor/FableCut/library/fonts/SHA256SUMS.txt',
  'python_core/ainovel_host_guard.py',
  'python_core/api_nav_subtitle.py',
  'python_core/cli_bg_remove.py',
  'python_core/cli_upscale.py',
  'python_core/gpu_check.py',
  'python_core/install_gpu_worker.js',
  'python_core/install_pytorch_cuda.py',
  'python_core/gateway/host_binding.py',
  'python_core/gateway/nav_gateway.py',
  'python_core/services/gemini_with_fallback.py',
  'python_core/services/local_media_tools.py',
  'python_core/services/nav_scheduler_store.py',
  'python_core/services/script_analyzer.py',
  'python_core/services/storyboard_analyzer.py',
  'python_core/services/veo3_utils.py',
  'python_core/services/youtube_analyzer_v1.py',
  'capcut_api/LICENSE',
  'capcut_api/NOTICE.md',
  'capcut_api/capcut_provenance.json',
  'capcut_api/capcut_runtime_manifest.json',
  'capcut_api/capcut_windows/capcut_tts_ctypes.py',
  'capcut_api/capcut_windows/config.py',
  'capcut_api/capcut_windows/cronet_client.py',
  'capcut_api/capcut_windows/cronet_helper.dll',
];
for (const relative of required) {
  assert.ok(fs.existsSync(path.join(resources, relative)), `Missing ${relative}`);
}

const capcutManifestPath = path.join(resources, 'capcut_api', 'capcut_runtime_manifest.json');
const capcutManifest = JSON.parse(fs.readFileSync(capcutManifestPath, 'utf8'));
const capcutProvenance = JSON.parse(
  fs.readFileSync(path.join(resources, 'capcut_api', 'capcut_provenance.json'), 'utf8'),
);
assert.equal(capcutManifest.schema, 1, 'Unsupported CapCut runtime manifest schema');
assert.equal(capcutManifest.importedCommit, capcutProvenance.importedCommit);
assert.equal(capcutManifest.repository, capcutProvenance.repository);
assert.equal(
  capcutManifest.thirdPartyCapCutBinaryPackaged,
  false,
  'CapCut runtime manifest must prohibit packaged third-party CapCut binaries',
);
assert.ok(Array.isArray(capcutManifest.files), 'CapCut runtime manifest files must be an array');
for (const entry of capcutManifest.files) {
  assert.equal(typeof entry.path, 'string', 'Invalid CapCut manifest path');
  const absolute = path.join(resources, 'capcut_api', ...entry.path.split('/'));
  assert.ok(fs.existsSync(absolute), `Missing CapCut manifest file ${entry.path}`);
  const bytes = fs.readFileSync(absolute);
  assert.equal(bytes.length, entry.bytes, `CapCut byte size mismatch: ${entry.path}`);
  assert.equal(
    crypto.createHash('sha256').update(bytes).digest('hex'),
    entry.sha256,
    `CapCut SHA-256 mismatch: ${entry.path}`,
  );
}

const entries = asar.listPackage(archive);
const normalized = entries.map((raw) => raw.replace(/^\\/, ''));
for (const expected of [
  'main.js',
  'preload.js',
  'electron\\credentialVault.js',
  'electron\\securityPolicy.js',
  'electron\\updater.js',
]) {
  assert.ok(normalized.includes(expected), `Missing ASAR entry ${expected}`);
}
assert.equal(
  normalized.some((name) => /(^|\\)\.env(?:\.|$)/i.test(name) && !name.includes('node_modules')),
  false,
  'Application .env file leaked into ASAR',
);
const forbiddenRuntimePublicEntries = [
  /^public\\audio(?:\\|$)/i,
  /^public\\downloads(?:\\|$)/i,
  /^public\\images(?:\\|$)/i,
  /^public\\isolated(?:\\|$)/i,
  /^public\\navtools(?:\\|$)/i,
  /^public\\omnivoice-refs(?:\\|$)/i,
  /^public\\omnivoice-library\.json$/i,
  /^public\\phantom-x-bypass(?:\\|$)/i,
  /^public\\renders(?:\\|$)/i,
  /^public\\video(?:\\|$)/i,
  /^public\\watermarked(?:\\|$)/i,
];
const leakedRuntimePublicEntries = normalized.filter((name) =>
  forbiddenRuntimePublicEntries.some((pattern) => pattern.test(name)),
);
assert.deepEqual(
  leakedRuntimePublicEntries,
  [],
  `Runtime/user media leaked into ASAR: ${JSON.stringify(leakedRuntimePublicEntries.slice(0, 20))}`,
);
const forbiddenOptionalAsarEntries = normalized.filter((name) =>
  /(?:^|\\)(?:MediaCrawler|voice_refs)(?:\\|$)|^src\\app\\api\\generate-tts\\capcut_api(?:\\|$)|\.onnx$|(?:^|\\)bin\\ffmpeg(?:\.exe)?$|SFUFutura/i.test(name),
);
assert.deepEqual(
  forbiddenOptionalAsarEntries,
  [],
  `Unapproved optional component leaked into ASAR: ${JSON.stringify(forbiddenOptionalAsarEntries.slice(0, 20))}`,
);

const secretMarkers = [
  '-----BEGIN PRIVATE KEY-----',
  '-----BEGIN RSA PRIVATE KEY-----',
  'AINOVEL_ENTITLEMENT_SECRET=',
  'SUPABASE_SERVICE_ROLE_KEY=',
];
const markerHits = [];
for (const name of normalized) {
  if (!/\.(?:c?js|mjs|json|pem|key|txt|md|html|yml|yaml)$/i.test(name)) continue;
  try {
    const content = asar.extractFile(archive, name);
    for (const marker of secretMarkers) {
      if (content.includes(Buffer.from(marker))) markerHits.push({ name, marker });
    }
  } catch {
    // Directory or unpacked entry.
  }
}
const dangerousMarkerHits = markerHits.filter(
  (hit) => !/^node_modules\\.*README[^\\]*\.md$/i.test(hit.name),
);
assert.deepEqual(
  dangerousMarkerHits,
  [],
  `Secret markers found: ${JSON.stringify(dangerousMarkerHits)}`,
);

const publicKeys = fs
  .readdirSync(path.join(resources, 'license', 'public-keys'))
  .filter((name) => name.endsWith('.pem'));
assert.ok(publicKeys.length > 0, 'No packaged public key');
const publicCommercialConfig = fs.readFileSync(
  path.join(resources, 'commercial', 'public.env'),
  'utf8',
);
assert.match(
  publicCommercialConfig,
  /^AINOVEL_LICENSE_API_URL=https:\/\/[^\s]+$/m,
  'Packaged public config has no HTTPS license API',
);
for (const secretName of [
  'AINOVEL_ENTITLEMENT_PRIVATE_KEY',
  'AINOVEL_ENTITLEMENT_ADMIN_KEY',
  'AINOVEL_PAYMENT_WEBHOOK_SECRET',
  'SUPABASE_SERVICE_ROLE_KEY',
]) {
  assert.equal(
    publicCommercialConfig.includes(`${secretName}=`),
    false,
    `Secret ${secretName} leaked into packaged public config`,
  );
}

const forbiddenResourcePaths = [
  'bin',
  'fonts',
  'python_core/ffmpeg',
  'python_core/MediaCrawler',
  'python_core/assets',
];
for (const relative of forbiddenResourcePaths) {
  assert.equal(
    fs.existsSync(path.join(resources, relative)),
    false,
    `Unapproved resource leaked into package: ${relative}`,
  );
}
const approvedPythonCoreFiles = new Set([
  'ainovel_host_guard.py',
  'api_nav_subtitle.py',
  'cli_bg_remove.py',
  'cli_upscale.py',
  'gpu_check.py',
  'install_gpu_worker.js',
  'install_pytorch_cuda.py',
  'tai_ytdlp.py',
  'isolate_vocals.py',
  'diarize_audio.py',
  'cat_nho.py',
  'yt_goi_y.py',
  'watermark_audio.py',
  'extract_hardsub.py',
  'xu_ly_video.py',
  'gateway/__init__.py',
  'gateway/host_binding.py',
  'gateway/nav_gateway.py',
  'services/__init__.py',
  'services/gemini_with_fallback.py',
  'services/local_media_tools.py',
  'services/nav_scheduler_store.py',
  'services/script_analyzer.py',
  'services/storyboard_analyzer.py',
  'services/veo3_utils.py',
  'services/youtube_analyzer_v1.py',
]);
const pythonCoreRoot = path.join(resources, 'python_core');
const packagedPythonCoreFiles = [];
if (fs.existsSync(pythonCoreRoot)) {
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else packagedPythonCoreFiles.push(path.relative(pythonCoreRoot, absolute).replace(/\\/g, '/'));
    }
  };
  walk(pythonCoreRoot);
}
assert.deepEqual(
  packagedPythonCoreFiles.filter((name) => !approvedPythonCoreFiles.has(name)).sort(),
  [],
  'Unapproved Python runtime source leaked into package',
);
const vinaModelDir = path.join(resources, 'src', 'python_core', 'models', 'vina_voice');
const leakedVinaWeights = fs.existsSync(vinaModelDir)
  ? fs.readdirSync(vinaModelDir).filter((name) => name.toLowerCase().endsWith('.onnx'))
  : [];
assert.deepEqual(leakedVinaWeights, [], 'Unapproved Vina Voice ONNX weights leaked into package');

const topFiles = [];
for (const raw of entries) {
  const name = raw.replace(/^\\/, '');
  try {
    const stat = asar.statFile(archive, name);
    if (typeof stat.size === 'number') topFiles.push({ name, bytes: stat.size });
  } catch {
    // Directory entries have no file stat.
  }
}
topFiles.sort((a, b) => b.bytes - a.bytes);

console.log(
  JSON.stringify(
    {
      ok: true,
      root,
      asarBytes: fs.statSync(archive).size,
      entries: entries.length,
      publicKeys,
      privateMarkersAbsent: true,
      runtimeUserMediaAbsent: true,
      unapprovedOptionalResourcesAbsent: true,
      ignoredDocumentationMarkers: markerHits.length - dangerousMarkerHits.length,
      topFiles: topFiles.slice(0, 12),
    },
    null,
    2,
  ),
);
console.log('PASS audit-packaged-artifact');
