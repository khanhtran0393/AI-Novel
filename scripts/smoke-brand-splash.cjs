'use strict';

const fs = require('fs');
const path = require('path');
const {
  DEFAULT_SPLASH_MIN_MS,
  resolveBrandPaths,
  buildSplashDataUrl,
  createSplashGate,
} = require('../electron/splashBrand');

const root = path.join(__dirname, '..');
const paths = resolveBrandPaths(root, root);

if (DEFAULT_SPLASH_MIN_MS !== 5000) {
  console.error('FAIL default ms', DEFAULT_SPLASH_MIN_MS);
  process.exit(1);
}
if (!paths.logo || !fs.existsSync(paths.logo)) {
  console.error('FAIL logo missing', paths.logo);
  process.exit(1);
}

const url = buildSplashDataUrl({ logoPath: paths.logo, title: 'AI Novel' });
const html = decodeURIComponent(url.slice(url.indexOf(',') + 1));
if (!html.includes('data:image')) {
  console.error('FAIL no embedded image in splash');
  process.exit(1);
}
if (!html.includes('<img')) {
  console.error('FAIL no img tag');
  process.exit(1);
}
// Floating logo = transparent HTML (no solid panel backdrop)
if (!html.includes('transparent')) {
  console.error('FAIL splash HTML must be transparent (floating logo)');
  process.exit(1);
}
if (html.includes('class="panel"') || html.includes("class='panel'")) {
  console.error('FAIL splash must not use solid panel — logo-only');
  process.exit(1);
}

const mainSrc = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
for (const needle of [
  'splashBrand',
  'requestEnterWorkspace',
  'SPLASH_MIN_MS',
  'createSplashGate',
  'buildSplashDataUrl',
]) {
  if (!mainSrc.includes(needle)) {
    console.error('FAIL main.js missing', needle);
    process.exit(1);
  }
}
if (
  !/transparent\s*:\s*true|transparent\s*:\s*!0/.test(mainSrc) &&
  !mainSrc.includes("backgroundColor: '#00000000'") &&
  !mainSrc.includes('backgroundColor:"#00000000"')
) {
  console.error('FAIL main.js must use transparent window for floating logo splash');
  process.exit(1);
}
if (mainSrc.includes('/* ainovel-re-harden esbuild main.js */')) {
  console.warn(
    'WARN main.js is re-harden minified — afterPack should restore; restoreShellFromBackup if stuck',
  );
}

const g = createSplashGate(200);
let enteredAt = 0;
const t0 = Date.now();
g.arm(() => {
  enteredAt = Date.now() - t0;
});
setTimeout(() => g.markServerReady(() => {
  enteredAt = Date.now() - t0;
}), 40);

setTimeout(() => {
  if (!enteredAt || enteredAt < 180) {
    console.error('FAIL gate entered too early', enteredAt);
    process.exit(1);
  }
  console.log(
    JSON.stringify({
      ok: true,
      step: 'smoke-brand-splash',
      defaultMs: DEFAULT_SPLASH_MIN_MS,
      logo: paths.logo,
      icon: paths.icon,
      splashUrlChars: url.length,
      gateEnteredMs: enteredAt,
    }),
  );
  process.exit(0);
}, 400);
