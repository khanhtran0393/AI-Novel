/**
 * electron-builder beforePack — Phase A/B shell harden (minify friction).
 * Backs up main/preload/electron then overwrites with hardened sources for ASAR.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  applyShellHardenInPlace,
  restoreShellFromBackup,
} = require('./lib/desktop-re-harden.cjs');

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
