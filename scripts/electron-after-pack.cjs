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

  optionalAsarFrictionNote(context);

  // Existing fuse hardening
  if (typeof flipFuses.default === 'function') {
    await flipFuses.default(context);
  } else if (typeof flipFuses === 'function') {
    await flipFuses(context);
  }
};
