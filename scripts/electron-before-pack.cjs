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
  SHELL_FILES,
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

  // Release notes — stamp current package.json version into commercial/release-notes.json
  // (extraResources → resources/commercial/release-notes.json for UpdateSuccessModal)
  try {
    const { spawnSync } = require('child_process');
    const notesPrep = spawnSync(
      process.execPath,
      [path.join(ROOT, 'scripts', 'prepare-release-notes.mjs')],
      { cwd: ROOT, stdio: 'inherit', env: process.env },
    );
    if (notesPrep.status !== 0) {
      throw new Error(
        `[release-notes] prepare failed status=${notesPrep.status}. ` +
          `Run: node scripts/prepare-release-notes.mjs`,
      );
    }
    const notesFile = path.join(
      ROOT,
      'resources',
      'commercial',
      'release-notes.json',
    );
    if (!fs.existsSync(notesFile)) {
      throw new Error('[release-notes] missing resources/commercial/release-notes.json after prepare');
    }
    console.log('[release-notes] stamped for pack → extraResources commercial/');
  } catch (err) {
    console.error('[release-notes] BEFORE PACK FAIL:', err?.message || err);
    throw err;
  }

  // LA Studio / Kokoro-VI portable TTS — required for ship (platform la_studio)
  try {
    const { spawnSync } = require('child_process');
    const prep = spawnSync(
      process.execPath,
      [path.join(ROOT, 'scripts', 'prepare-la-studio-kokoro.mjs')],
      { cwd: ROOT, stdio: 'inherit', env: process.env },
    );
    if (prep.status !== 0) {
      throw new Error(
        `[la-studio-kokoro] prepare failed status=${prep.status}. ` +
          `Run: npm run prepare:la-studio-kokoro`,
      );
    }
    const kokoroCli = path.join(ROOT, 'bin', 'la-studio-kokoro', 'bin', 'kokoro-vi-cli.exe');
    const kokoroOnnx = path.join(ROOT, 'bin', 'la-studio-kokoro', 'models', 'kokoro_vi.onnx');
    if (!fs.existsSync(kokoroCli) || !fs.existsSync(kokoroOnnx)) {
      throw new Error(
        '[la-studio-kokoro] missing bin/la-studio-kokoro after prepare — TTS ship will be empty',
      );
    }
    console.log('[la-studio-kokoro] portable pack ready for extraResources');
  } catch (err) {
    console.error('[la-studio-kokoro] BEFORE PACK FAIL:', err?.message || err);
    throw err;
  }

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

  // Only restore leftover *minified* workspace files (crash mid-pack).
  // Never blanket-restore backup over clean edited sources (stale backup
  // would ship old updater.js and break auto-update).
  {
    let needRestore = false;
    for (const rel of SHELL_FILES) {
      const abs = path.join(ROOT, rel);
      try {
        if (
          fs.existsSync(abs) &&
          fs.readFileSync(abs, 'utf8').includes('ainovel-re-harden')
        ) {
          needRestore = true;
          break;
        }
      } catch {
        /* ignore */
      }
    }
    if (needRestore) {
      const prior = restoreShellFromBackup();
      if (prior.restored.length) {
        console.log(
          '[re-harden] restored leftover minified shell before re-harden:',
          prior.restored.length,
        );
      }
    }
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
