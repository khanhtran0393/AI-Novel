/**
 * electron-builder afterPack chain:
 * 1) Restore shell sources (undo beforePack harden)
 * 2) Optional ASAR friction pad (Phase B, off by default — avoids fuse integrity fights)
 * 3) Electron fuses (existing)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { restoreShellFromBackup } = require('./lib/desktop-re-harden.cjs');
const { restoreStubs: restoreCrownStubs } = require('./lib/crown-ip-stub.cjs');
const { sealPythonCrowns } = require('./lib/crown-ip-seal.cjs');
const flipFuses = require('./electron-fuses.cjs');

/**
 * Optional lightweight ASAR size/noise pad — does NOT encrypt (fuse integrity safe).
 * Real asarmor encryption is opt-in later via AINOVEL_ASARMOR=1 (documented; not default).
 * @param {import('electron-builder').AfterPackContext} context
 */
function optionalAsarFrictionNote(context) {
  const asarPath = path.join(context.appOutDir, 'resources', 'app.asar');
  if (!fs.existsSync(asarPath)) {
    console.log('[re-harden] afterPack: no app.asar yet (ok for some targets)');
    return;
  }
  const st = fs.statSync(asarPath);
  console.log(
    JSON.stringify({
      ok: true,
      step: 'afterPack-asar-stat',
      asarBytes: st.size,
      asarmor: process.env.AINOVEL_ASARMOR === '1' ? 'requested-but-not-wired' : 'off',
      note:
        'ASAR integrity fuses remain primary. Full asarmor encryption deferred (can break fuse hash).',
    }),
  );
}

/**
 * @param {import('electron-builder').AfterPackContext} context
 */
exports.default = async function electronAfterPack(context) {
  // Always restore workspace shell first so dev tree stays readable
  try {
    const { restored } = restoreShellFromBackup();
    if (restored.length) {
      console.log('[re-harden] afterPack restored shell sources:', restored.join(', '));
    }
  } catch (err) {
    console.error('[re-harden] restore failed:', err?.message || err);
  }

  // Restore crown formula sources if a sealed build left stubs in the workspace
  try {
    const crown = restoreCrownStubs();
    if (crown.restored?.length) {
      console.log('[crown-ip] afterPack restored formula sources:', crown.restored.join(', '));
    }
  } catch (err) {
    console.error('[crown-ip] restore stubs failed:', err?.message || err);
  }

  // Seal Python analyzers inside packaged resources (leave workspace .py plain)
  try {
    const skipPy =
      process.env.AINOVEL_CROWN_PYTHON === '0' ||
      process.env.AINOVEL_CROWN_PYTHON === 'false';
    if (!skipPy) {
      const pyDir = path.join(context.appOutDir, 'resources', 'python_core');
      if (fs.existsSync(pyDir)) {
        const sealed = sealPythonCrowns(pyDir, { writeStubs: true });
        console.log(
          JSON.stringify({
            ok: true,
            step: 'afterPack-crown-python',
            count: sealed.length,
            dir: pyDir,
          }),
        );
      } else {
        console.log('[crown-ip] afterPack: no resources/python_core (skip py seal)');
      }
    }
  } catch (err) {
    console.error('[crown-ip] python seal FAILED:', err?.message || err);
    throw err;
  }

  optionalAsarFrictionNote(context);

  // Existing fuse hardening
  if (typeof flipFuses.default === 'function') {
    await flipFuses.default(context);
  } else if (typeof flipFuses === 'function') {
    await flipFuses(context);
  }
};
