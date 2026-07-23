/**
 * Brand splash for Electron boot.
 * - Embeds logo as base64 (works inside ASAR, no relative-path breakage).
 * - Default minimum display: 5s before navigating to /workspace.
 * Pack must ship electron/splash-logo.jpg + icon.* (see scripts/lib/sync-brand-assets.cjs).
 */
'use strict';

const fs = require('fs');
const path = require('path');

/** Default: show brand logo at least 5 seconds on boot. Override: AINOVEL_SPLASH_MS */
const DEFAULT_SPLASH_MIN_MS = 5000;

function firstExisting(candidates) {
  for (const p of candidates) {
    try {
      if (p && fs.existsSync(p)) return p;
    } catch {
      /* ignore */
    }
  }
  return null;
}

/**
 * @param {string} appDir - app.getAppPath()
 * @param {string} moduleDir - __dirname of main.js (project root in dev / asar root packaged)
 */
function resolveBrandPaths(appDir, moduleDir) {
  // Prefer electron/ packaged paths first (ASAR + beforePack sync).
  // Prefer transparent PNG (no black square) over photographic JPG backdrop.
  const logo = firstExisting([
    path.join(appDir, 'electron', 'splash-logo.png'),
    path.join(moduleDir, 'electron', 'splash-logo.png'),
    path.join(appDir, 'electron', 'icon.png'),
    path.join(moduleDir, 'electron', 'icon.png'),
    path.join(moduleDir, 'build', 'icon.png'),
    path.join(moduleDir, 'public', 'brand', 'logo.png'),
    path.join(appDir, 'electron', 'splash-logo.jpg'),
    path.join(moduleDir, 'electron', 'splash-logo.jpg'),
    path.join(appDir, 'splash-logo.jpg'),
    path.join(moduleDir, 'splash-logo.jpg'),
    path.join(moduleDir, 'build', 'app-logo.jpg'),
    path.join(moduleDir, 'public', 'brand', 'logo.jpg'),
  ]);

  // Windows taskbar needs multi-size .ico for reliable brand mark.
  // PNG alone often leaves the host electron.exe atom icon on the taskbar in dev.
  const iconIco = firstExisting([
    path.join(appDir, 'electron', 'icon.ico'),
    path.join(moduleDir, 'electron', 'icon.ico'),
    path.join(moduleDir, 'build', 'icon.ico'),
  ]);
  const iconPng = firstExisting([
    path.join(appDir, 'electron', 'icon.png'),
    path.join(moduleDir, 'electron', 'icon.png'),
    path.join(moduleDir, 'build', 'icon.png'),
  ]);
  // Prefer ICO on win32 (taskbar); PNG elsewhere / fallback.
  const icon =
    process.platform === 'win32'
      ? iconIco || iconPng
      : iconPng || iconIco;

  const splashHtml = firstExisting([
    path.join(appDir, 'electron', 'splash.html'),
    path.join(moduleDir, 'electron', 'splash.html'),
  ]);

  return { logo, icon, iconIco, iconPng, splashHtml };
}

function mimeFor(filePath) {
  const ext = path.extname(filePath || '').toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.ico') return 'image/x-icon';
  return 'image/jpeg';
}

/**
 * Build data: URL splash with logo embedded (reliable in packaged Electron).
 * @param {{ logoPath?: string|null, title?: string }} [opts]
 */
function buildSplashDataUrl(opts = {}) {
  const title = opts.title || 'AI Novel';
  let logoHtml =
    '<div class="spin" role="presentation"></div>';

  const logoPath = opts.logoPath || null;
  if (logoPath) {
    try {
      const buf = fs.readFileSync(logoPath);
      const dataUri = `data:${mimeFor(logoPath)};base64,${buf.toString('base64')}`;
      // plate = solid circular disc under PNG (Windows transparent GPU often paints
      // only drop-shadow / leaves alpha logo looking like a black void).
      logoHtml = `<div class="logo" aria-hidden="true"><span class="plate"></span><img src="${dataUri}" alt="" draggable="false"/></div>`;
    } catch {
      /* keep spinner */
    }
  }

  // Transparent shell: floating logo only (no full-window panel).
  // Requires BrowserWindow { transparent: true, backgroundColor: '#00000000' }.
  const html = `<!DOCTYPE html>
<html lang="vi"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${title}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{
    width:100% !important;height:100% !important;
    margin:0 !important;padding:0 !important;
    background:transparent !important;
    overflow:hidden !important;
    user-select:none;-webkit-user-select:none;
    -webkit-app-region:drag;
  }
  .stage{
    position:fixed;inset:0;
    display:flex;align-items:center;justify-content:center;
    background:transparent !important;
  }
  .logo{
    position:relative;
    width:min(220px,42vw);height:min(220px,42vw);
    border:0;padding:0;margin:0;
    background:transparent !important;
    animation:float 2.8s ease-in-out infinite;
    -webkit-app-region:drag;
  }
  /* Solid disc + box-shadow (not filter) — survives DWM transparent-window bugs */
  .logo .plate{
    position:absolute;inset:4%;
    border-radius:50%;
    background:
      radial-gradient(circle at 35% 30%, #3f2a12 0%, #1a1208 55%, #0a0806 100%);
    box-shadow:
      0 16px 40px rgba(0,0,0,.65),
      0 0 0 1px rgba(245,158,11,.35),
      0 0 36px rgba(245,158,11,.45);
    z-index:0;
  }
  .logo img{
    position:relative;z-index:1;
    width:100%;height:100%;object-fit:contain;border-radius:50%;
    display:block;background:transparent;opacity:1;
    -webkit-user-drag:none;pointer-events:none;
  }
  .spin{
    width:72px;height:72px;border:4px solid rgba(69,26,3,.5);border-top-color:#f59e0b;
    border-radius:50%;animation:spin .9s linear infinite;
  }
  @keyframes spin{to{transform:rotate(360deg)}}
  @keyframes float{
    0%,100%{transform:translateY(0) scale(1);opacity:1}
    50%{transform:translateY(-10px) scale(1.03);opacity:.97}
  }
  @media (prefers-reduced-motion:reduce){
    .logo,.spin{animation:none!important}
  }
</style>
</head>
<body>
  <div class="stage" aria-busy="true" aria-label="${title}">
    ${logoHtml}
  </div>
</body></html>`;

  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

/**
 * Minimum splash gate: wait until both server ready AND min display elapsed.
 * @param {number} [minMs]
 */
function createSplashGate(minMs = DEFAULT_SPLASH_MIN_MS) {
  const ms = Number.isFinite(minMs) && minMs >= 0 ? Math.floor(minMs) : DEFAULT_SPLASH_MIN_MS;
  const state = {
    minMs: ms,
    shownAt: 0,
    minElapsed: ms <= 0,
    serverReady: false,
    entered: false,
    timer: null,
  };

  function arm(onReady) {
    state.shownAt = Date.now();
    state.minElapsed = ms <= 0;
    state.serverReady = false;
    state.entered = false;
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    if (ms <= 0) {
      tryEnter(onReady);
      return;
    }
    state.timer = setTimeout(() => {
      state.minElapsed = true;
      state.timer = null;
      tryEnter(onReady);
    }, ms);
  }

  function markServerReady(onReady) {
    state.serverReady = true;
    tryEnter(onReady);
  }

  function tryEnter(onReady) {
    if (state.entered) return false;
    if (!state.minElapsed || !state.serverReady) {
      return false;
    }
    state.entered = true;
    if (typeof onReady === 'function') onReady();
    return true;
  }

  function status() {
    return {
      minMs: state.minMs,
      minElapsed: state.minElapsed,
      serverReady: state.serverReady,
      entered: state.entered,
      shownForMs: state.shownAt ? Date.now() - state.shownAt : 0,
    };
  }

  return { arm, markServerReady, tryEnter, status, DEFAULT_SPLASH_MIN_MS };
}

module.exports = {
  DEFAULT_SPLASH_MIN_MS,
  resolveBrandPaths,
  buildSplashDataUrl,
  createSplashGate,
  firstExisting,
};
