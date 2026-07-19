/** Build the vendored Windows Cronet bridge before Electron packaging. */
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

if (process.platform !== 'win32') {
  throw new Error('CapCut runtime can only be built on Windows.');
}

const root = path.resolve(__dirname, '..');
const runtimeDir = path.join(
  root,
  'src',
  'app',
  'api',
  'generate-tts',
  'capcut_api',
  'capcut_windows',
);
const apiRoot = path.dirname(runtimeDir);
const provenancePath = path.join(apiRoot, 'capcut_provenance.json');
const buildScript = path.join(runtimeDir, 'build.bat');
const outputDll = path.join(runtimeDir, 'cronet_helper.dll');
const runtimeManifest = path.join(apiRoot, 'capcut_runtime_manifest.json');

assert.ok(fs.existsSync(buildScript), `Missing ${buildScript}`);
const provenance = JSON.parse(fs.readFileSync(provenancePath, 'utf8'));
assert.equal(provenance.schema, 1, 'Unsupported CapCut provenance schema');
assert.match(provenance.importedCommit, /^[a-f0-9]{40}$/, 'Invalid CapCut provenance commit');
const result = spawnSync('cmd.exe', ['/d', '/s', '/c', 'build.bat'], {
  cwd: runtimeDir,
  encoding: 'utf8',
  windowsHide: true,
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.status !== 0) {
  throw new Error(`CapCut runtime build failed with exit code ${result.status}`);
}
assert.ok(fs.existsSync(outputDll), `Build did not create ${outputDll}`);
assert.ok(fs.statSync(outputDll).size > 0, `Built DLL is empty: ${outputDll}`);

const packagedFiles = [
  'LICENSE',
  'NOTICE.md',
  'capcut_provenance.json',
  'capcut_windows/capcut_tts_ctypes.py',
  'capcut_windows/config.py',
  'capcut_windows/cronet_client.py',
  'capcut_windows/cronet_helper.dll',
];
const files = packagedFiles.map((relativePath) => {
  const absolutePath = path.join(apiRoot, ...relativePath.split('/'));
  assert.ok(fs.existsSync(absolutePath), `Missing CapCut runtime file: ${absolutePath}`);
  const bytes = fs.readFileSync(absolutePath);
  return {
    path: relativePath,
    bytes: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  };
});
fs.writeFileSync(
  runtimeManifest,
  `${JSON.stringify({
    schema: 1,
    repository: provenance.repository,
    importedCommit: provenance.importedCommit,
    ownership: 'first-party interoperability adapter code',
    thirdPartyCapCutBinaryPackaged: false,
    files,
  }, null, 2)}\n`,
  'utf8',
);

console.log(JSON.stringify({
  ok: true,
  outputDll,
  bytes: fs.statSync(outputDll).size,
  runtimeManifest,
  manifestFiles: files.length,
}));
console.log('PASS build-capcut-runtime');
