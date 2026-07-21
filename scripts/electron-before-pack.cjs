/**
 * electron-builder beforePack:
 * 1) Sync brand assets (splash logo + icons) into electron/ for ASAR
 * 2) Phase A/B shell harden (minify friction)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  applyShellHardenInPlace,
  restoreShellFromBackup,
} = require('./lib/desktop-re-harden.cjs');
const { syncBrandAssets } = require('./lib/sync-brand-assets.cjs');

const ROOT = path.join(__dirname, '..');
const PKG = path.join(ROOT, 'package.json');
const PKG_BAK = path.join(ROOT, 'package.json.pack-backup');

/** electron-builder may rewrite production package.json over workspace — snapshot first */
function backupPackageJson() {
  try {
    if (fs.existsSync(PKG)) {
      fs.copyFileSync(PKG, PKG_BAK);
      console.log('[pack] backed up package.json → package.json.pack-backup');
    }
  } catch (e) {
    console.warn('[pack] package.json backup failed:', e?.message || e);
  }
}

/**
 * @param {import('electron-builder').BeforePackContext} context
 */
exports.default = async function electronBeforePack(context) {
  backupPackageJson();

  // Always sync brand into electron/** before ASAR (splash logo ≥5s needs these files)
  try {
    const brand = syncBrandAssets(ROOT);
    if (brand.missing.length) {
      console.warn('[brand] missing assets:', brand.missing.join(', '));
    }
  } catch (err) {
    console.error('[brand] sync FAILED:', err?.message || err);
    throw err;
  }

  // Hard-fail pack — floating transparent logo splash (docs/BRAND_SPLASH.md LOCKED)
  const requiredBrand = [
    ['electron/splashBrand.js', '5s gate + base64 logo splash'],
    ['electron/splash.html', 'transparent splash fallback'],
    ['build/icon.ico', 'taskbar / rcedit exe icon'],
  ];
  for (const [rel, why] of requiredBrand) {
    if (!fs.existsSync(path.join(ROOT, rel))) {
      throw new Error(`[brand] Missing ${rel} (${why}). Run: npm run brand:icons && npm run brand:sync`);
    }
  }
  const splashOk =
    fs.existsSync(path.join(ROOT, 'electron', 'splash-logo.jpg')) ||
    fs.existsSync(path.join(ROOT, 'electron', 'splash-logo.png')) ||
    fs.existsSync(path.join(ROOT, 'electron', 'icon.png'));
  if (!splashOk) {
    throw new Error(
      '[brand] No splash logo in electron/ (splash-logo.jpg|png or icon.png). Run: npm run brand:icons && npm run brand:sync',
    );
  }
  // main.js must wire splashBrand + transparent window (reject leftover bad shell)
  const mainPath = path.join(ROOT, 'main.js');
  if (!fs.existsSync(mainPath)) {
    throw new Error('[brand] Missing main.js');
  }
  const mainSrc = fs.readFileSync(mainPath, 'utf8');
  if (!mainSrc.includes('splashBrand')) {
    throw new Error(
      '[brand] main.js missing splashBrand require — floating logo splash not wired. See docs/BRAND_SPLASH.md',
    );
  }
  if (
    !mainSrc.includes('transparent: true') &&
    !mainSrc.includes('transparent:!0') &&
    !mainSrc.includes('transparent: !0')
  ) {
    // Minified pack hardens to transparent:!0 — accept both
    if (!/transparent\s*:\s*true|transparent\s*:\s*!0/.test(mainSrc)) {
      throw new Error(
        '[brand] main.js must set BrowserWindow transparent:true for floating logo. See docs/BRAND_SPLASH.md',
      );
    }
  }
  console.log(
    JSON.stringify({
      ok: true,
      step: 'beforePack-brand-gate',
      splash: 'transparent-floating-logo',
      minMsDefault: 5000,
      docs: 'docs/BRAND_SPLASH.md',
    }),
  );

  const skip =
    process.env.AINOVEL_RE_HARDEN === '0' ||
    process.env.AINOVEL_RE_HARDEN === 'false';
  if (skip) {
    console.log('[re-harden] beforePack skip (AINOVEL_RE_HARDEN=0)');
    return;
  }

  // Always restore first if a previous pack left hardened sources
  const prior = restoreShellFromBackup();
  if (prior.restored.length) {
    console.log('[re-harden] restored leftover shell before re-harden:', prior.restored.length);
  }

  try {
    const { hardened, engine } = await applyShellHardenInPlace();
    console.log(
      JSON.stringify({
        ok: true,
        step: 'beforePack-re-harden',
        engine,
        files: hardened,
        platform: context?.electronPlatformName,
      }),
    );
  } catch (err) {
    restoreShellFromBackup();
    console.error('[re-harden] beforePack FAILED — sources restored');
    throw err;
  }
};
