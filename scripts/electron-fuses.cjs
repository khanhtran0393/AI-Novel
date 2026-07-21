/**
 * afterPack: flip Electron fuses for packaged customer builds.
 * Makes RunAsNode / CLI inspect harder; enables asar integrity when supported.
 *
 * Invoked from scripts/electron-after-pack.cjs (after shell restore).
 */
'use strict';

const path = require('path');
const fs = require('fs');

/**
 * @param {import('electron-builder').AfterPackContext} context
 */
exports.default = async function flipElectronFuses(context) {
  const { electronPlatformName, appOutDir, packager } = context;
  if (electronPlatformName !== 'win32') {
    console.log('[fuses] skip non-win32 platform:', electronPlatformName);
    return;
  }

  let fuses;
  try {
    fuses = require('@electron/fuses');
  } catch (err) {
    console.warn('[fuses] @electron/fuses not available — skip:', err?.message || err);
    return;
  }

  const {
    flipFuses,
    FuseVersion,
    FuseV1Options,
  } = fuses;

  const productFilename =
    packager?.appInfo?.productFilename ||
    context.packager?.config?.productName ||
    'AI Novel & Script Generator';
  const exeName = `${productFilename}.exe`;
  const exePath = path.join(appOutDir, exeName);

  if (!fs.existsSync(exePath)) {
    // electron-builder sometimes uses sanitized names
    const candidates = fs
      .readdirSync(appOutDir)
      .filter((n) => n.toLowerCase().endsWith('.exe'));
    if (!candidates.length) {
      console.warn('[fuses] no exe in', appOutDir);
      return;
    }
    const picked = path.join(appOutDir, candidates[0]);
    console.log('[fuses] using exe:', picked);
    await applyFuses(flipFuses, FuseVersion, FuseV1Options, picked);
    return;
  }

  await applyFuses(flipFuses, FuseVersion, FuseV1Options, exePath);
};

async function applyFuses(flipFuses, FuseVersion, FuseV1Options, exePath) {
  // ASAR integrity validation MUST stay off unless the integrity hash is
  // re-stamped *after* every afterPack mutation (rcedit icon, portable wrap).
  // Enabling it after rcedit → "ASAR Integrity Violation" → app exits on boot
  // (Next SWC then fails with ENOTDIR when native load breaks).
  // Opt-in for fully signed CI pipelines: AINOVEL_ASAR_INTEGRITY=1
  const asarIntegrity =
    process.env.AINOVEL_ASAR_INTEGRITY === '1' ||
    process.env.AINOVEL_ASAR_INTEGRITY === 'true';

  const options = {
    version: FuseVersion.V1,
    // Hardening for customer builds
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: asarIntegrity,
    // Only load app from asar (native modules stay in asarUnpack)
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
  };

  try {
    await flipFuses(exePath, options);
    console.log(
      '[fuses] flipped OK:',
      exePath,
      asarIntegrity ? '(asar integrity ON)' : '(asar integrity OFF — boot-safe)',
    );
  } catch (err) {
    // Some Electron versions reject individual fuses — retry without OnlyLoadAppFromAsar
    console.warn(
      '[fuses] full set failed, retry without OnlyLoadAppFromAsar:',
      err?.message || err,
    );
    try {
      delete options[FuseV1Options.OnlyLoadAppFromAsar];
      await flipFuses(exePath, options);
      console.log('[fuses] flipped (partial) OK:', exePath);
    } catch (err2) {
      console.error('[fuses] FAILED:', err2?.message || err2);
      throw err2;
    }
  }
}
