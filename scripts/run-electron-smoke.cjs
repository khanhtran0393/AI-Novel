/**
 * Launch an Electron smoke script with ELECTRON_RUN_AS_NODE cleared.
 * Usage: node scripts/run-electron-smoke.cjs scripts/smoke-credential-vault.cjs
 */
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const electron = require('electron');

const script = process.argv[2];
if (!script) {
  console.error('Usage: node scripts/run-electron-smoke.cjs <relative-script.cjs>');
  process.exit(2);
}

// ELECTRON_RUN_AS_NODE must be fully absent (empty string still breaks Electron).
const env = { ...process.env };
for (const key of Object.keys(env)) {
  if (key.toUpperCase() === 'ELECTRON_RUN_AS_NODE') delete env[key];
}

const electronPath =
  typeof electron === 'string'
    ? electron
    : path.join(
        path.dirname(require.resolve('electron/package.json')),
        'dist',
        process.platform === 'win32' ? 'electron.exe' : 'electron',
      );

const result = spawnSync(electronPath, [path.resolve(script)], {
  stdio: 'inherit',
  env,
  cwd: path.resolve(__dirname, '..'),
  windowsHide: true,
  // Do not inherit parent ELECTRON_RUN_AS_NODE via shell
  shell: false,
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}
process.exit(typeof result.status === 'number' ? result.status : 1);
