/**
 * Embed build/icon.ico into node_modules/electron/dist/electron.exe
 * so Windows taskbar shows brand mark when running `npm run dev:desktop` (electron .).
 * Packaged builds use afterPack rcedit on AI Novel.exe instead.
 *
 * Safe to re-run; no-op if rcedit/icon missing. Fails soft if electron.exe is locked.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

/**
 * @param {string} [root]
 * @returns {{ ok: boolean, skipped?: boolean, reason?: string, exe?: string, icon?: string }}
 */
function patchElectronDevIcon(root = path.join(__dirname, '..', '..')) {
  const iconPath = path.join(root, 'build', 'icon.ico');
  const electronExe = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
  const rceditBin = path.join(
    root,
    'node_modules',
    'electron-winstaller',
    'vendor',
    'rcedit.exe',
  );

  if (process.platform !== 'win32') {
    return { ok: true, skipped: true, reason: 'not-win32' };
  }
  if (!fs.existsSync(iconPath)) {
    return { ok: false, reason: 'missing-build-icon-ico' };
  }
  if (!fs.existsSync(electronExe)) {
    return { ok: true, skipped: true, reason: 'no-electron-exe' };
  }
  if (!fs.existsSync(rceditBin)) {
    return { ok: false, reason: 'missing-rcedit' };
  }

  try {
    execFileSync(rceditBin, [electronExe, '--set-icon', iconPath], {
      stdio: 'pipe',
      windowsHide: true,
    });
    return {
      ok: true,
      exe: electronExe,
      icon: iconPath,
      bytes: fs.statSync(electronExe).size,
    };
  } catch (err) {
    const msg = String(err?.message || err || '');
    const locked = /EBUSY|EPERM|sharing|denied|used by another/i.test(msg);
    return {
      ok: false,
      reason: locked ? 'electron-exe-locked' : 'rcedit-failed',
      detail: msg.slice(0, 240),
      exe: electronExe,
      icon: iconPath,
    };
  }
}

module.exports = { patchElectronDevIcon };

if (require.main === module) {
  const result = patchElectronDevIcon();
  console.log(JSON.stringify({ step: 'patch-electron-dev-icon', ...result }, null, 2));
  if (!result.ok && !result.skipped) process.exit(1);
}
