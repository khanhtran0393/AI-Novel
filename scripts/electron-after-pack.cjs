/**
 * electron-builder afterPack chain (order LOCKED for security):
 * 1) Restore shell sources (undo beforePack harden)
 * 2) Embed win icon via rcedit (mutates .exe PE resources only)
 * 3) Crown Python seal + gateway compile (resources tree)
 * 4) Optional ASAR friction note (no encrypt by default)
 * 5) Electron fuses LAST (ASAR integrity hash stamped after all resource mutations)
 *
 * Do NOT re-order fuses before rcedit/icon — integrity fuse must be last.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { restoreShellFromBackup } = require('./lib/desktop-re-harden.cjs');
const { restoreStubs: restoreCrownStubs } = require('./lib/crown-ip-stub.cjs');
const { sealPythonCrowns } = require('./lib/crown-ip-seal.cjs');
const { compileGateway } = require('./compile-python-gateway.cjs');
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
function restorePackageJsonIfStripped() {
  const root = path.join(__dirname, '..');
  const pkgPath = path.join(root, 'package.json');
  const bak = path.join(root, 'package.json.pack-backup');
  try {
    if (!fs.existsSync(bak)) return;
    let needRestore = false;
    try {
      const cur = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (!cur.scripts || !cur.scripts['pack:unsigned:qa'] || !cur.build) {
        needRestore = true;
      }
    } catch {
      needRestore = true;
    }
    if (needRestore) {
      fs.copyFileSync(bak, pkgPath);
      console.log('[pack] restored package.json from package.json.pack-backup (electron-builder strip)');
    }
    try {
      fs.unlinkSync(bak);
    } catch {
      /* keep backup if delete fails */
    }
  } catch (e) {
    console.warn('[pack] package.json restore skip:', e?.message || e);
  }
}

/**
 * Force-embed build/icon.ico into the Windows .exe (taskbar / Explorer).
 * Needed when signAndEditExecutable was skipped or rcedit did not run.
 * @param {import('electron-builder').AfterPackContext} context
 */
async function ensureWindowsExeIcon(context) {
  if (process.platform !== 'win32' && context?.electronPlatformName !== 'win32') {
    return;
  }
  const root = path.join(__dirname, '..');
  const iconPath = path.join(root, 'build', 'icon.ico');
  if (!fs.existsSync(iconPath)) {
    console.warn('[icon] afterPack: missing build/icon.ico — skip exe icon');
    return;
  }

  const productName =
    context?.packager?.appInfo?.productFilename ||
    context?.packager?.appInfo?.productName ||
    'AI Novel & Script Generator';
  const exeName = productName.endsWith('.exe') ? productName : `${productName}.exe`;
  let resolvedExe = path.join(context.appOutDir, exeName);
  if (!fs.existsSync(resolvedExe)) {
    // portable / nsis may use different casing — scan once
    const found = fs
      .readdirSync(context.appOutDir)
      .find((f) => f.toLowerCase().endsWith('.exe') && !/uninstall/i.test(f));
    if (!found) {
      console.warn('[icon] afterPack: no .exe in', context.appOutDir);
      return;
    }
    resolvedExe = path.join(context.appOutDir, found);
  }

  const rceditBin = path.join(
    root,
    'node_modules',
    'electron-winstaller',
    'vendor',
    'rcedit.exe',
  );
  if (!fs.existsSync(rceditBin)) {
    console.warn('[icon] afterPack: rcedit.exe not found — rely on electron-builder win.icon');
    return;
  }

  try {
    const { execFileSync } = require('child_process');
    execFileSync(rceditBin, [resolvedExe, '--set-icon', iconPath], {
      stdio: 'pipe',
      windowsHide: true,
    });
    console.log(
      JSON.stringify({
        ok: true,
        step: 'afterPack-win-icon',
        exe: path.basename(resolvedExe),
        icon: 'build/icon.ico',
      }),
    );
  } catch (err) {
    console.warn('[icon] afterPack rcedit failed:', err?.message || err);
  }
}

exports.default = async function electronAfterPack(context) {
  // electron-builder production filter can wipe workspace package.json scripts/build
  restorePackageJsonIfStripped();

  // Embed brand icon into .exe (taskbar) even if signing/edit was partial
  try {
    await ensureWindowsExeIcon(context);
  } catch (err) {
    console.warn('[icon] afterPack ensure failed:', err?.message || err);
  }

  // Verify brand splash files landed in app resources (ASAR or app dir)
  try {
    const resApp = path.join(context.appOutDir, 'resources', 'app.asar');
    const resUnpacked = path.join(context.appOutDir, 'resources', 'app');
    const checks = [
      'electron/splashBrand.js',
      'electron/splash-logo.jpg',
      'electron/splash.html',
      'electron/icon.ico',
    ];
    let probeRoot = null;
    if (fs.existsSync(resUnpacked)) probeRoot = resUnpacked;
    // asar: list via @electron/asar if present, else just log expected
    let asarOk = null;
    if (fs.existsSync(resApp)) {
      try {
        const asar = require('@electron/asar');
        asarOk = checks.map((rel) => {
          try {
            asar.statFile(resApp, rel);
            return { rel, ok: true };
          } catch {
            // splash-logo may be .png only
            if (rel.endsWith('splash-logo.jpg')) {
              try {
                asar.statFile(resApp, 'electron/splash-logo.png');
                return { rel: 'electron/splash-logo.png', ok: true };
              } catch {
                return { rel, ok: false };
              }
            }
            return { rel, ok: false };
          }
        });
      } catch {
        asarOk = null;
      }
    }
    console.log(
      JSON.stringify({
        ok: true,
        step: 'afterPack-brand-verify',
        asar: fs.existsSync(resApp),
        unpackedApp: !!probeRoot,
        files: asarOk,
        note: 'Boot shows logo ≥5s via electron/splashBrand.js (AINOVEL_SPLASH_MS)',
      }),
    );
  } catch (err) {
    console.warn('[brand] afterPack verify skip:', err?.message || err);
  }

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

  // Seal Python analyzers + compile gateway allowlist inside packaged resources
  try {
    const skipPy =
      process.env.AINOVEL_CROWN_PYTHON === '0' ||
      process.env.AINOVEL_CROWN_PYTHON === 'false';
    if (!skipPy) {
      const pyDir = path.join(context.appOutDir, 'resources', 'python_core');
      if (fs.existsSync(pyDir)) {
        // 1) Cython/Nuitka/pyc gateway friction (host_binding, ainovel_host_guard)
        try {
          const gw = compileGateway(pyDir, { inplace: false });
          console.log(
            JSON.stringify({
              ok: true,
              step: 'afterPack-gateway-compile',
              engine: gw.engine,
              count: gw.compiled?.length || 0,
            }),
          );
        } catch (e) {
          console.warn(
            '[gateway-compile] soft-fail (seal continues):',
            e?.message || e,
          );
        }
        // 2) Crown seal analyzers
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

  // Never ship developer scratch / novel_store_backup in install tree
  try {
    const scratchDir = path.join(context.appOutDir, 'resources', 'scratch');
    if (fs.existsSync(scratchDir)) {
      fs.rmSync(scratchDir, { recursive: true, force: true });
      console.log('[afterPack] removed leaked resources/scratch');
    }
    const rootScratch = path.join(context.appOutDir, 'scratch');
    if (fs.existsSync(rootScratch)) {
      fs.rmSync(rootScratch, { recursive: true, force: true });
      console.log('[afterPack] removed leaked appRoot/scratch');
    }
  } catch (err) {
    console.warn('[afterPack] scratch cleanup:', err?.message || err);
  }

  optionalAsarFrictionNote(context);

  // Existing fuse hardening
  if (typeof flipFuses.default === 'function') {
    await flipFuses.default(context);
  } else if (typeof flipFuses === 'function') {
    await flipFuses(context);
  }
};
