/**
 * Build the self-contained XinChao-Cut native desktop runtime from the vendored
 * source and place the executable beside its backend tree.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

if (process.platform !== 'win32') {
  throw new Error('XinChao-Cut native runtime currently targets Windows only.');
}

const root = path.resolve(__dirname, '..');
const editorRoot = path.join(root, 'tools', 'xinchao-cut');
const npmCli = process.env.npm_execpath;
assert.ok(npmCli && fs.existsSync(npmCli), 'npm_execpath is unavailable');
const userProfile = process.env.USERPROFILE || '';
const cargoBin = userProfile ? path.join(userProfile, '.cargo', 'bin') : '';
const buildEnv = {
  ...process.env,
  PATH: cargoBin
    ? `${cargoBin}${path.delimiter}${process.env.PATH || ''}`
    : process.env.PATH,
};

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    stdio: 'inherit',
    env: buildEnv,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit ${result.status}`);
  }
}

function commandAvailable(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    stdio: 'pipe',
    env: buildEnv,
  });
  return result.status === 0;
}

run(process.execPath, [path.join(root, 'scripts', 'verify-xinchao-vendor.mjs')]);

const cargoCommand = cargoBin && fs.existsSync(path.join(cargoBin, 'cargo.exe'))
  ? path.join(cargoBin, 'cargo.exe')
  : 'cargo.exe';
const rustcCommand = cargoBin && fs.existsSync(path.join(cargoBin, 'rustc.exe'))
  ? path.join(cargoBin, 'rustc.exe')
  : 'rustc.exe';

if (
  !commandAvailable(cargoCommand, ['--version']) ||
  !commandAvailable(rustcCommand, ['--version'])
) {
  throw new Error(
    'Rust MSVC toolchain is required to build the independent XinChao-Cut desktop runtime.',
  );
}

run(process.execPath, [
  npmCli,
  '--prefix',
  editorRoot,
  'run',
  'tauri',
  '--',
  'build',
  '--no-bundle',
]);

const builtExe = path.join(
  editorRoot,
  'src-tauri',
  'target',
  'release',
  'xinchao-cut.exe',
);
const runtimeExe = path.join(editorRoot, 'XinChao-Cut.exe');
assert.ok(fs.existsSync(builtExe), `Tauri build did not create ${builtExe}`);
fs.copyFileSync(builtExe, runtimeExe);

const bytes = fs.readFileSync(runtimeExe);
assert.ok(bytes.length > 1_000_000, `Native runtime is unexpectedly small: ${bytes.length}`);
assert.equal(bytes.subarray(0, 2).toString('ascii'), 'MZ', 'Native runtime is not a PE executable');
assert.ok(
  fs.existsSync(path.join(editorRoot, 'backend', 'run-backend.bat')),
  'Vendored backend launcher is missing',
);

console.log(
  JSON.stringify({
    ok: true,
    editorRoot,
    builtExe,
    runtimeExe,
    bytes: bytes.length,
  }),
);
console.log('BUILD_OK xinchao-native-runtime');
