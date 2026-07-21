/**
 * Sync brand assets into electron/ + build/ before packaging.
 * Ensures splash logo + window/taskbar icons ship inside ASAR (electron/**).
 *
 * Sources (first hit wins for splash logo):
 *   public/brand/logo.png | logo.jpg | logo-256.png
 *   build/app-logo.jpg | build/icon.png | logo.png (repo root)
 *
 * Always copies build/icon.ico + build/icon.png into electron/ when present.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function copyIfExists(src, dest) {
  if (!fs.existsSync(src)) return false;
  ensureDir(path.dirname(dest));
  try {
    // Skip if same file / locked (Windows EBUSY during pack)
    if (path.resolve(src) === path.resolve(dest)) return true;
    if (fs.existsSync(dest)) {
      const a = fs.statSync(src);
      const b = fs.statSync(dest);
      if (a.size === b.size && Math.abs(a.mtimeMs - b.mtimeMs) < 2) return true;
    }
    fs.copyFileSync(src, dest);
    return true;
  } catch (err) {
    console.warn('[brand] copy skip', path.basename(dest), err?.code || err?.message || err);
    return fs.existsSync(dest);
  }
}

function firstExisting(list) {
  for (const p of list) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * @returns {{ ok: boolean, copied: string[], missing: string[] }}
 */
function syncBrandAssets(root = ROOT) {
  const electronDir = path.join(root, 'electron');
  const buildDir = path.join(root, 'build');
  ensureDir(electronDir);
  ensureDir(buildDir);

  const copied = [];
  const missing = [];

  // ── Icons for taskbar / exe ──
  const icoSrc = firstExisting([
    path.join(buildDir, 'icon.ico'),
    path.join(electronDir, 'icon.ico'),
  ]);
  const pngSrc = firstExisting([
    path.join(buildDir, 'icon.png'),
    path.join(electronDir, 'icon.png'),
    path.join(root, 'public', 'brand', 'logo.png'),
  ]);

  if (icoSrc) {
    if (copyIfExists(icoSrc, path.join(electronDir, 'icon.ico'))) {
      copied.push('electron/icon.ico');
    }
    if (icoSrc !== path.join(buildDir, 'icon.ico')) {
      if (copyIfExists(icoSrc, path.join(buildDir, 'icon.ico'))) {
        copied.push('build/icon.ico');
      }
    }
  } else {
    missing.push('icon.ico');
  }

  if (pngSrc) {
    if (copyIfExists(pngSrc, path.join(electronDir, 'icon.png'))) {
      copied.push('electron/icon.png');
    }
    if (pngSrc !== path.join(buildDir, 'icon.png')) {
      if (copyIfExists(pngSrc, path.join(buildDir, 'icon.png'))) {
        copied.push('build/icon.png');
      }
    }
  } else {
    missing.push('icon.png');
  }

  // ── Splash logo (prefer photographic brand mark) ──
  const splashSrc = firstExisting([
    path.join(electronDir, 'splash-logo.jpg'),
    path.join(buildDir, 'app-logo.jpg'),
    path.join(root, 'public', 'brand', 'logo.jpg'),
    path.join(root, 'public', 'brand', 'logo-source-user.jpg'),
    path.join(root, 'public', 'brand', 'logo.png'),
    path.join(buildDir, 'icon.png'),
    path.join(electronDir, 'icon.png'),
    path.join(root, 'logo.png'),
  ]);

  if (splashSrc) {
    const dest = path.join(electronDir, 'splash-logo.jpg');
    // Keep extension-compatible filename for splash.html relative load; content may be png bytes if only png available
    const ext = path.extname(splashSrc).toLowerCase();
    if (ext === '.jpg' || ext === '.jpeg') {
      copyIfExists(splashSrc, dest);
      copied.push('electron/splash-logo.jpg');
    } else {
      // PNG/other → also write as splash-logo.jpg name only if already jpg-named elsewhere;
      // prefer copy to splash-logo.png AND keep .jpg if exists. For HTML we embed via base64 by path.
      const pngDest = path.join(electronDir, 'splash-logo.png');
      copyIfExists(splashSrc, pngDest);
      copied.push('electron/splash-logo.png');
      // Also mirror to splash-logo.jpg path so loadFile relative works if browsers sniff content
      // (JPEG file with PNG bytes is bad). If source is png, copy as splash-logo.png only;
      // splashBrand.js resolves both.
      if (!fs.existsSync(dest) && (ext === '.jpg' || ext === '.jpeg')) {
        copyIfExists(splashSrc, dest);
      }
      // When only PNG exists, copy to a dedicated name and update nothing else —
      // splashBrand prefers splash-logo.jpg then icon.png.
      if (!fs.existsSync(path.join(electronDir, 'splash-logo.jpg'))) {
        // Keep icon.png as fallback; also copy brand png as splash-logo.jpg only if jpeg.
        // For PNG brand: write electron/splash-logo.png (already done).
      }
    }
    // Always refresh splash-logo.jpg from preferred jpg sources
    const jpgOnly = firstExisting([
      path.join(buildDir, 'app-logo.jpg'),
      path.join(root, 'public', 'brand', 'logo.jpg'),
      path.join(root, 'public', 'brand', 'logo-source-user.jpg'),
      path.join(electronDir, 'splash-logo.jpg'),
    ]);
    if (jpgOnly) {
      copyIfExists(jpgOnly, path.join(electronDir, 'splash-logo.jpg'));
      if (!copied.includes('electron/splash-logo.jpg')) copied.push('electron/splash-logo.jpg');
    }
  } else {
    missing.push('splash-logo');
  }

  // Ensure splash.html exists
  const splashHtml = path.join(electronDir, 'splash.html');
  if (!fs.existsSync(splashHtml)) {
    missing.push('electron/splash.html');
  }

  const ok = missing.length === 0 || (fs.existsSync(path.join(electronDir, 'icon.png')) || fs.existsSync(path.join(electronDir, 'icon.ico')));
  console.log(
    JSON.stringify({
      ok,
      step: 'sync-brand-assets',
      copied,
      missing,
      splash: firstExisting([
        path.join(electronDir, 'splash-logo.jpg'),
        path.join(electronDir, 'splash-logo.png'),
        path.join(electronDir, 'icon.png'),
      ]),
    }),
  );
  return { ok, copied, missing };
}

module.exports = { syncBrandAssets };

if (require.main === module) {
  const r = syncBrandAssets();
  process.exit(r.ok || r.copied.length ? 0 : 1);
}
