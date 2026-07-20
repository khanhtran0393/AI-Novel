'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  isExactOriginUrl,
  isTrustedNavigationUrl,
} = require('../electron/securityPolicy');

const origin = 'http://127.0.0.1:3000';
const splash = 'data:text/html;charset=utf-8,known-splash';
const trustedData = new Set([splash]);

assert.equal(isExactOriginUrl(`${origin}/workspace`, origin), true);
assert.equal(isExactOriginUrl(`${origin}@evil.example/workspace`, origin), false);
assert.equal(isExactOriginUrl('http://127.0.0.1:30000/workspace', origin), false);
assert.equal(isExactOriginUrl('data:text/html,<script>evil()</script>', origin), false);
assert.equal(isTrustedNavigationUrl(splash, origin, trustedData), true);
assert.equal(
  isTrustedNavigationUrl('data:text/html,<script>evil()</script>', origin, trustedData),
  false,
);

const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
assert.ok(main.includes('devTools: !app.isPackaged'), 'packaged DevTools off');
assert.ok(main.includes('before-input-event'), 'F12/devtools shortcut block');
assert.ok(main.includes('isAllowedShellOpenPath'), 'shell open path policy');
assert.ok(main.includes("process.env.AINOVEL_ENTITLEMENT_MODE = 'enforce'"));

const fusesPath = path.join(root, 'scripts', 'electron-fuses.cjs');
assert.ok(fs.existsSync(fusesPath), 'electron-fuses afterPack hook present');
const fuses = fs.readFileSync(fusesPath, 'utf8');
assert.ok(fuses.includes('EnableNodeCliInspectArguments') || fuses.includes('flipFuses'));

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
// Phase A/B: beforePack shell harden → afterPack restore + fuses
assert.equal(pkg.build.beforePack, 'scripts/electron-before-pack.cjs');
assert.equal(pkg.build.afterPack, 'scripts/electron-after-pack.cjs');
const afterPack = fs.readFileSync(path.join(root, 'scripts', 'electron-after-pack.cjs'), 'utf8');
assert.ok(afterPack.includes('electron-fuses') || afterPack.includes('flipFuses'));
assert.ok(afterPack.includes('restoreShellFromBackup'));

console.log('PASS smoke-electron-security');
