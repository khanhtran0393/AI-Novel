/**
 * electron-builder beforePack — Phase A/B shell harden (minify friction).
 * Backs up main/preload/electron then overwrites with hardened sources for ASAR.
 */
'use strict';

const {
  applyShellHardenInPlace,
  restoreShellFromBackup,
} = require('./lib/desktop-re-harden.cjs');

/**
 * @param {import('electron-builder').BeforePackContext} context
 */
exports.default = async function electronBeforePack(context) {
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
