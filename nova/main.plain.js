/**
 * Nova Studio Desktop (Electron) — Cách B: đóng gói UI vào app + auto-update.
 * - Production: phục vụ web/index.html qua local server chỉ lắng nghe trên 127.0.0.1.
 * - Dev: đặt NOVA_STUDIO_DEV_URL=http://localhost:5500 để load bản đang sửa.
 * - Auto-update tùy chọn, chỉ bật khi có máy chủ phát hành riêng của Nova.
 */

const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, shell, Menu, dialog, ipcMain } = require('electron');

// Identity và vùng dữ liệu riêng của Nova Studio.
// Phải cấu hình trước app.whenReady() để Electron không dùng lại profile của app khác.
const NOVA_APP_ID = 'com.novastudio.independent';
const NOVA_PARTITION = 'persist:nova-studio-independent';
try {
  app.setName('Nova Studio');
  if (process.platform === 'win32' && app.setAppUserModelId) app.setAppUserModelId(NOVA_APP_ID);
  const novaUserData = path.join(app.getPath('appData'), 'Nova Studio Independent');
  app.setPath('userData', novaUserData);
  fs.mkdirSync(novaUserData, { recursive: true });
} catch (error) {
  console.warn('[startup] không thể chuẩn bị vùng dữ liệu Nova:', error && error.message);
}
// Tắt bớt log rác nội bộ của Chromium (vd "ffmpeg_common Unsupported pixel format") cho terminal sạch.
// KHÔNG ảnh hưởng log console.log của app (Node) — vẫn thấy các dòng [flow].
try { app.commandLine.appendSwitch('log-level', '3'); } catch (e) { /* */ }
const http = require('http');
const os = require('os');
const { autoUpdater } = require('electron-updater');
const flowNative = require('./flow-native.plain');
const flowCft = require('./flow-cft.plain');
const flowChrome = require('./flow-chrome');
const flowExtBridge = require('./flow-bridge.plain');
const nativeTools = require('./native-tools.plain');
const upscaleNative = require('./upscale-native');
const parallaxNative = require('./parallax-native');
const cliBridge = require('./cli-bridge-native.plain');
const mcpBridge = require('./mcp-bridge-native');
const voiceNative = require('./voice-native.plain');
const watermarkNative = require('./watermark-native');
const { userDataPath } = require('./core/paths');
const { registerSettingsIpc } = require('./storage/settings-store');

const WEB_DIR = path.join(__dirname, 'web');
// Bundle "Nova Scene" — bộ THÔNG DỊCH cảnh do ta tự build (editor-pro/nova-remotion).
// AI sinh SPEC JSON cho từng cảnh, engine cố định diễn giải → thời lượng luôn bằng đúng giây của cảnh.
const NOVA_REMOTION_DIR = path.join(__dirname, 'editor-pro', 'nova-remotion', 'bundle');
const AUTH_HOSTS = /(^|\.)(accounts\.google\.com|google\.com|firebaseapp\.com|novastudio\.com)$/i;

// Bắt lỗi toàn cục để KHÔNG hiện hộp "A JavaScript error occurred" khó hiểu cho khách.
// Lỗi hay gặp: ENOSPC (ổ đĩa đầy khi tải video/ghi file) → hiện thông báo tiếng Việt rõ ràng, không văng app.
function _friendlyMainError(err) {
  const msg = String((err && (err.message || err)) || '');
  if (/ENOSPC|no space left/i.test(msg)) return 'Ổ đĩa đã ĐẦY — không còn chỗ để lưu file.\n\nHãy dọn bớt dung lượng (xoá file không dùng, dọn Thùng rác), để trống ít nhất vài GB rồi thử lại. Bạn cũng có thể chọn thư mục lưu ở ổ đĩa khác còn trống.';
  if (/EACCES|EPERM/i.test(msg)) return 'Không có quyền ghi vào thư mục lưu.\n\nHãy chọn thư mục lưu khác (vd Desktop) hoặc chạy app với quyền phù hợp.';
  if (/EROFS/i.test(msg)) return 'Thư mục lưu ở ổ chỉ-đọc.\n\nHãy chọn thư mục lưu khác còn ghi được.';
  return null; // không phải lỗi "đã biết" → để cơ chế mặc định xử lý
}
process.on('uncaughtException', (err) => {
  const friendly = _friendlyMainError(err);
  if (friendly) {
    try { closeSplashWindow(true); } catch (_) {}
    try { dialog.showErrorBox('Không thể lưu file', friendly); } catch (e) { /* */ }
    return;
  }
  try { closeSplashWindow(true); } catch (_) {}
  try { dialog.showErrorBox('Lỗi', String((err && (err.message || err)) || err)); } catch (e) { /* */ }
  console.error('[uncaught]', err);
});
process.on('unhandledRejection', (reason) => {
  const friendly = _friendlyMainError(reason);
  if (friendly) {
    try { closeSplashWindow(true); } catch (_) {}
    try { dialog.showErrorBox('Không thể lưu file', friendly); } catch (e) { /* */ }
    return;
  }
  try { closeSplashWindow(true); } catch (_) {}
  console.error('[unhandledRejection]', reason);
});

let mainWindow = null;
let splashWindow = null;
let serverPort = 0;
let localServer = null;
let isQuitting = false;
let splashCloseTimer = null;

const SPLASH_MIN_MS = 1400;
const SPLASH_MAX_MS = 12000;

function ensureBrandAsset() {
  const target = path.join(WEB_DIR, 'brand-logo.ico');
  if (fs.existsSync(target)) return target;
  const candidates = [
    path.join(__dirname, 'build', 'novastudio.ico'),
    path.join(__dirname, 'build', 'icon.ico'),
    path.join(process.resourcesPath || '', 'novastudio.ico'),
  ];
  for (const source of candidates) {
    try {
      if (source && fs.existsSync(source)) {
        fs.copyFileSync(source, target);
        return target;
      }
    } catch (_) { /* try the next packaged/source fallback */ }
  }
  return null;
}

function brandIconPath() {
  const candidates = [
    path.join(WEB_DIR, 'brand-logo.ico'),
    path.join(__dirname, 'build', 'novastudio.ico'),
    path.join(__dirname, 'build', 'icon.ico'),
    path.join(process.resourcesPath || '', 'novastudio.ico'),
  ];
  return candidates.find((candidate) => {
    try { return fs.existsSync(candidate); } catch (_) { return false; }
  });
}

function createSplashWindow() {
  if (isQuitting) return null;
  ensureBrandAsset();
  splashWindow = new BrowserWindow({
    width: 520,
    height: 420,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    // Không ghim splash lên trên mọi cửa sổ. Đây là cửa sổ tạm thời; nếu tiến trình
    // bị kill đột ngột, alwaysOnTop có thể để lại một mảng đen nổi trên desktop.
    alwaysOnTop: false,
    skipTaskbar: true,
    show: false,
    backgroundColor: '#050505',
    icon: brandIconPath(),
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  splashWindow.loadFile(path.join(__dirname, 'electron', 'splash.html'));
  splashWindow.webContents.once('did-finish-load', () => {
    const iconPath = brandIconPath();
    if (!iconPath) return;
    try {
      const dataUri = `data:image/x-icon;base64,${fs.readFileSync(iconPath).toString('base64')}`;
      splashWindow.webContents.executeJavaScript(
        `document.querySelector('.logo').src = ${JSON.stringify(dataUri)};`,
      ).catch(() => {});
    } catch (_) { /* fallback mark in splash.html remains visible */ }
  });
  splashWindow.once('ready-to-show', () => {
    if (splashWindow && !splashWindow.isDestroyed()) splashWindow.show();
  });
  splashWindow.webContents.once('did-fail-load', () => closeSplashWindow(true));
  splashWindow.on('closed', () => { splashWindow = null; });
  return splashWindow;
}

function closeSplashWindow(immediate = false) {
  if (splashCloseTimer) {
    clearTimeout(splashCloseTimer);
    splashCloseTimer = null;
  }
  if (!splashWindow || splashWindow.isDestroyed()) return;
  const current = splashWindow;
  splashWindow = null;
  if (immediate) {
    try { current.setAlwaysOnTop(false); } catch (_) {}
    try { current.destroy(); } catch (_) { /* already closed */ }
    return;
  }
  try {
    current.webContents.executeJavaScript(`document.body.style.transition = 'opacity .28s ease'; document.body.style.opacity = '0';`)
      .catch(() => {})
      .finally(() => {
        splashCloseTimer = setTimeout(() => {
          splashCloseTimer = null;
          if (!current.isDestroyed()) current.close();
        }, 300);
      });
  } catch (_) {
    try { current.close(); } catch (_) { /* ignore */ }
  }
}

// ── Local static server riêng của Nova (chỉ bind loopback, không phụ thuộc app cũ) ──
function startLocalServer() {
  return new Promise((resolve) => {
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon', '.wasm': 'application/wasm', '.map': 'application/json', '.mp4': 'video/mp4', '.gif': 'image/gif', '.webp': 'image/webp', '.woff2': 'font/woff2' };
    // CHỈ CÒN bundle Nova Scene. Bundle Remotion cũ (remotion-bundle, kèm 77 MB
    // public/ toàn tài sản demo) chỉ phục vụ bàn dựng Editor Pro — đã gỡ, xem
    // chú thích ở khối "Editor Pro đã gỡ" bên dưới. Bundle nhúng đường dẫn
    // TUYỆT ĐỐI ("/bundle.js", "/<n>.bundle.js") vì webpack publicPath = "/",
    // nên phải map thẳng ở gốc chứ không đặt dưới thư mục con.
    const chunkOwner = (name) =>
      fs.existsSync(path.join(NOVA_REMOTION_DIR, name)) ? NOVA_REMOTION_DIR : null;
    // → { root, rel } hoặc { html, root } khi cần viết lại index.html
    const remotionRoute = (p) => {
      if (p === '/nova.html')            return { html: true, root: NOVA_REMOTION_DIR, entry: '/nova-bundle.js' };
      if (p === '/nova-bundle.js')       return { root: NOVA_REMOTION_DIR, rel: 'bundle.js' };
      if (p === '/nova-bundle.js.map')   return { root: NOVA_REMOTION_DIR, rel: 'bundle.js.map' };
      if (/^\/\d+\.bundle\.js(\.map)?$/.test(p)) {
        const name = p.slice(1); const root = chunkOwner(name);
        return root ? { root, rel: name } : null;
      }
      if (p === '/source-map-helper.wasm' || p === '/favicon.ico') {
        const name = p.slice(1); const root = chunkOwner(name);
        return root ? { root, rel: name } : null;
      }
      return null;
    };
    const server = http.createServer((req, res) => {
      let p = decodeURIComponent((req.url || '/').split('?')[0]);
      if (p === '/' || p === '') p = '/index.html';
      const r = remotionRoute(p);
      if (r && r.html) {
        // index.html của bundle trỏ src="/bundle.js" — đổi sang tên riêng để hai bundle sống chung.
        fs.readFile(path.join(r.root, 'index.html'), 'utf8', (err, txt) => {
          if (err) { res.writeHead(404); return res.end('not found'); }
          res.writeHead(200, { 'Content-Type': types['.html'] });
          res.end(txt.replace('src="/bundle.js"', 'src="' + r.entry + '"'));
        });
        return;
      }
      const root = r ? r.root : WEB_DIR;
      if (p === '/brand-logo.ico') {
        const iconPath = brandIconPath();
        if (iconPath) {
          fs.readFile(iconPath, (err, data) => {
            if (err) { res.writeHead(404); return res.end('not found'); }
            res.writeHead(200, { 'Content-Type': 'image/x-icon', 'Cache-Control': 'no-cache' });
            res.end(data);
          });
          return;
        }
      }
      const filePath = path.join(root, r ? r.rel : p);
      if (!filePath.startsWith(root)) { res.writeHead(403); return res.end(); }
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); return res.end('not found'); }
        res.writeHead(200, { 'Content-Type': types[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
        res.end(data);
      });
    });
    localServer = server;
    // Ưu tiên port ổn định để localStorage của Nova giữ nguyên origin giữa các lần mở.
    // Nếu các port này bận (kể cả do app khác), Nova tự chọn port trống thay vì gây lỗi.
    const PREFERRED = [47280, 47281, 47282, 47283, 0];   // 0 = ngẫu nhiên (fallback cuối cùng)
    let idx = 0;
    const tryListen = () => {
      const port = PREFERRED[idx];
      server.once('error', (e) => {
        if (e && e.code === 'EADDRINUSE' && idx < PREFERRED.length - 1) { idx++; setTimeout(tryListen, 60); }
        else { console.warn('[server] listen error:', e && e.message); idx = PREFERRED.length - 1; server.listen(0, '127.0.0.1', () => { serverPort = server.address().port; resolve(); }); }
      });
      server.listen(port, '127.0.0.1', () => { serverPort = server.address().port; resolve(); });
    };
    tryListen();
  });
}

async function resolveStartUrl() {
  if (process.env.NOVA_STUDIO_DEV_URL) return process.env.NOVA_STUDIO_DEV_URL;   // dev: load URL Nova được chỉ định
  await startLocalServer();
  // Dùng "localhost" (Firebase mặc định cho phép domain này) → tránh auth/unauthorized-domain.
  return `http://localhost:${serverPort}/index.html`;    // production: bản đóng gói
}

function createWindow(startUrl) {
  mainWindow = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1024, minHeight: 640,
    autoHideMenuBar: true,   // ẩn thanh menu Tệp/Sửa/Xem (Windows/Linux) — nhấn Alt để hiện tạm; phím tắt copy/paste vẫn chạy
    title: 'Nova Studio', backgroundColor: '#050505', show: false,
    icon: brandIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
      partition: NOVA_PARTITION,
      webviewTag: true,   // cho phép nhúng Editor Pro qua <webview>
    },
  });
  let shown = false;
  let appPageStarted = false;
  const startedAt = Date.now();
  const splashPath = path.join(__dirname, 'electron', 'splash.html');
  const startAppPage = () => {
    if (appPageStarted || !mainWindow || mainWindow.isDestroyed()) return;
    appPageStarted = true;
    mainWindow.loadURL(startUrl).catch(() => reveal());
  };
  const reveal = () => {
    if (shown || !mainWindow || mainWindow.isDestroyed()) return;
    shown = true;
    const wait = Math.max(0, SPLASH_MIN_MS - (Date.now() - startedAt));
    setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.show();
      closeSplashWindow();
    }, wait);
  };
  // Hiển thị splash branded trong chính mainWindow, không tạo BrowserWindow thứ hai.
  // Nhờ vậy Windows không thể giữ lại một cửa sổ frameless 520x420 sau khi app crash.
  mainWindow.webContents.on('did-finish-load', () => {
    if (!appPageStarted) {
      if (!mainWindow.isVisible()) mainWindow.show();
      setTimeout(startAppPage, Math.max(0, SPLASH_MIN_MS - (Date.now() - startedAt)));
    } else {
      reveal();
    }
  });
  mainWindow.webContents.on('did-fail-load', (_event, _code, _description, _validatedURL, isMainFrame) => {
    if (!isMainFrame) return;
    if (!appPageStarted) startAppPage();
    else reveal();
  });
  setTimeout(() => {
    if (!appPageStarted) startAppPage();
    else reveal();
  }, SPLASH_MAX_MS);
  mainWindow.loadFile(splashPath).catch(() => startAppPage());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      if (AUTH_HOSTS.test(new URL(url).hostname)) {
        return { action: 'allow', overrideBrowserWindowOptions: { width: 500, height: 660, autoHideMenuBar: true, webPreferences: { partition: NOVA_PARTITION, contextIsolation: true, nodeIntegration: false } } };
      }
    } catch {}
    shell.openExternal(url);
    return { action: 'deny' };
  });
  attachContextMenu(mainWindow.webContents);
  mainWindow.on('closed', () => {
    mainWindow = null;
    closeSplashWindow(true);
  });
}

// Menu chuột phải: Cắt / Sao chép / Dán / Chọn tất cả (cho ô nhập).
function attachContextMenu(wc) {
  wc.on('context-menu', (_e, params) => {
    const canText = params.isEditable || (params.selectionText && params.selectionText.trim().length);
    if (!canText) return;
    const items = [];
    if (params.editFlags.canCut) items.push({ role: 'cut', label: 'Cắt' });
    if (params.editFlags.canCopy) items.push({ role: 'copy', label: 'Sao chép' });
    if (params.editFlags.canPaste) items.push({ role: 'paste', label: 'Dán' });
    if (params.isEditable && params.editFlags.canSelectAll) items.push({ type: 'separator' }, { role: 'selectAll', label: 'Chọn tất cả' });
    if (items.length) Menu.buildFromTemplate(items).popup({ window: BrowserWindow.fromWebContents(wc) });
  });
}

// ── Auto-update (giống DgtAutoTTS): kiểm → hỏi → tải → cài khi khởi động lại ──
function setupAutoUpdate() {
  autoUpdater.autoDownload = false;   // hỏi trước khi tải
  const sendUpd = (payload) => { try { mainWindow && mainWindow.webContents.send('update-status', payload); } catch (_) {} };
  autoUpdater.on('update-available', (info) => {
    let notes = '';
    if (typeof info.releaseNotes === 'string') notes = info.releaseNotes.replace(/<[^>]+>/g, '').trim();
    // Thông báo gọn ở góc trên phải (thay vì bật hộp thoại ngay).
    sendUpd({ state: 'available', version: info.version, current: app.getVersion(), notes: (notes || '').slice(0, 500) });
  });
  autoUpdater.on('download-progress', (p) => sendUpd({ state: 'downloading', percent: Math.round(p.percent || 0) }));
  autoUpdater.on('update-downloaded', () => sendUpd({ state: 'downloaded' }));
  autoUpdater.on('error', (e) => { console.warn('[update] lỗi:', e?.message || e); sendUpd({ state: 'error' }); });
  try { autoUpdater.checkForUpdates(); } catch (e) { console.warn('[update]', e?.message || e); }
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { label: 'Tệp', submenu: [isMac ? { role: 'close' } : { role: 'quit' }] },
    // Menu Sửa: cho phép Cmd/Ctrl + C/V/X/A hoạt động trong ô nhập.
    { label: 'Sửa', submenu: [
      { role: 'undo', label: 'Hoàn tác' }, { role: 'redo', label: 'Làm lại' }, { type: 'separator' },
      { role: 'cut', label: 'Cắt' }, { role: 'copy', label: 'Sao chép' }, { role: 'paste', label: 'Dán' },
      ...(isMac ? [{ role: 'pasteAndMatchStyle', label: 'Dán theo định dạng' }, { role: 'delete', label: 'Xoá' }, { role: 'selectAll', label: 'Chọn tất cả' }]
                : [{ role: 'delete', label: 'Xoá' }, { type: 'separator' }, { role: 'selectAll', label: 'Chọn tất cả' }]),
    ] },
    { label: 'Xem', submenu: [
      { role: 'reload', label: 'Tải lại' }, { role: 'forceReload', label: 'Tải lại (bỏ cache)' },
      { role: 'toggleDevTools', label: 'Công cụ nhà phát triển' }, { type: 'separator' },
      { role: 'resetZoom', label: 'Cỡ mặc định' }, { role: 'zoomIn', label: 'Phóng to' }, { role: 'zoomOut', label: 'Thu nhỏ' },
      { type: 'separator' }, { role: 'togglefullscreen', label: 'Toàn màn hình' },
    ] },
  ]));
}

// ── Kho cài đặt (API key…) → FILE trong userData ────────────────────────────
// localStorage của UI gắn vào origin "http://localhost:<port>". Port có thể đổi
// (47280 bận → 47281/47282/… → ngẫu nhiên), và Chromium cũng có quyền dọn kho
// localStorage của origin http → "nhập key, thoát ra vào lại là mất trắng".
// File này không dính origin nên key sống qua mọi lần mở app / đổi port.
// sendSync: preload nạp kho TRƯỚC khi script trang chạy; ghi atomic xong mới trả về.
registerSettingsIpc(ipcMain, {
  file: path.join(userDataPath(app), 'nova-settings.json'),
  logger: console,
});

// ── Flow native (tích hợp sẵn): UI gọi qua window.native.flow → ipc 'flow' ──
try { flowNative.restore(); } catch (e) { console.warn('[flow] restore:', e && e.message); }
ipcMain.handle('flow', (_e, action, payload) => flowNative.handle(action, payload));
// Thêm tài khoản Flow bằng cách điều khiển Chrome (profile trắng riêng) → lấy cookie → lưu vào kho.
ipcMain.handle('flow-cft-add', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const onEvent = (o) => { try { if (win && !win.isDestroyed()) win.webContents.send('flow-cft-progress', o); } catch (_) {} };
  const r = await flowCft.addAccountViaCFT(win, onEvent);
  if (r.error) { console.log('[flow-cft] addAccountViaCFT lỗi:', r.error); return r; }
  const saved = await flowNative.handle('ADD_ACCOUNT_COOKIE', { cookies: r.cookies });
  console.log('[flow-cft] ADD_ACCOUNT_COOKIE →', JSON.stringify(saved));
  return saved;
});
ipcMain.handle('flow-cft-cancel', () => { flowCft.cancelAdd(); return { ok: true }; });
// Engine Chrome thật đa profile (GĐ2: login + lưu account bền vững + CDP).
try { flowChrome.restore(); } catch (e) { console.warn('[flow-chrome] restore:', e && e.message); }
// Đẩy log tiến trình chính (làm mới token…) sang tab Nhật ký của renderer.
try { flowChrome.setLogSink((line) => { try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('nova-log', line); } catch (e) {} }); } catch (e) {}
ipcMain.handle('flowChrome', (_e, action, payload) => flowChrome.handle(action, payload));
// Chế độ "1 tab + N token": gom token N account (flow-chrome) → bơm sang extension để nó tự xoay vòng.
ipcMain.handle('flow-push-ext', async () => {
  const r = await flowChrome.handle('GET_ALL_TOKENS', { force: false });   // dùng token cache còn hạn → chuyển chế độ KHÔNG mở lại Chrome
  const list = (r && r.accounts) || [];
  if (!list.length) return { error: 'Chưa có tài khoản Chrome nào. Thêm bằng "Thêm bằng Chrome" trước.' };
  const push = await flowExtBridge.call('SET_ACCOUNTS', { accounts: list });
  console.log('[flow] đẩy', list.length, 'token sang extension →', JSON.stringify(push));
  return { ok: !!(push && push.ok), pushed: list.length, ext: push };
});
// TỰ làm mới token + đẩy sang extension (khi mở app + định kỳ) — như đối thủ: mở Chrome lấy token rồi tự đóng.
let _autoPushBusy = false;
let _autoPushStartTimer = null;
let _autoPushInterval = null;
async function autoPushExt() {
  if (_autoPushBusy) return;
  try {
    const accs = flowChrome.handle ? await flowChrome.handle('GET_ACCOUNTS') : null;
    if (!accs || !(accs.count > 0)) return;       // chưa có account Chrome nào
    _autoPushBusy = true;
    // Tự lấy token: lần đầu (cache rỗng) mở Chrome mint; các lần sau token còn hạn 24h → dùng cache, KHỎI mở Chrome.
    const r = await flowChrome.handle('GET_ALL_TOKENS', { force: false });
    const list = (r && r.accounts) || [];
    console.log('[flow] auto làm mới', list.length, 'token');
    // Chỉ ĐẨY sang extension nếu extension đang kết nối (không thì thôi, token vẫn đã làm mới sẵn).
    const st = flowExtBridge.status();
    if (st && st.extensionConnected && list.length) {
      await flowExtBridge.call('SET_ACCOUNTS', { accounts: list });
      console.log('[flow] auto đẩy', list.length, 'token sang extension');
    }
  } catch (e) { console.warn('[flow] autoPushExt', e && e.message); }
  finally { _autoPushBusy = false; }
}
_autoPushStartTimer = setTimeout(autoPushExt, 15000);                    // mở app 15s → tự làm mới (+ đẩy nếu có extension)
_autoPushInterval = setInterval(autoPushExt, 40 * 60 * 1000);            // mỗi 40 phút (token ~1h) → làm mới trước khi hết

// ── Flow qua Extension (Chrome thật): app ↔ bridge HTTP ↔ extension ──
flowExtBridge.start().catch((e) => console.warn('[flow-bridge]', e && e.message));
ipcMain.handle('flowExt', (_e, action, payload) => flowExtBridge.call(action, payload));
// Version extension MỚI NHẤT (đọc từ manifest đóng gói trong app) → so với version extension đang chạy để nhắc cập nhật.
let _bundledExtVer = null;
function bundledExtVersion() {
  // Đọc THẲNG mỗi lần (không cache) → bump version manifest là phản ánh ngay, khỏi restart mới thấy.
  try {
    const base = __dirname.includes('app.asar') ? __dirname.replace('app.asar', 'app.asar.unpacked') : __dirname;
    let mp = path.join(base, 'flow-extension', 'manifest.json');
    if (!fs.existsSync(mp)) mp = path.join(__dirname, 'flow-extension', 'manifest.json');
    return JSON.parse(fs.readFileSync(mp, 'utf8')).version || null;
  } catch { return null; }
}
ipcMain.handle('flowBridgeStatus', () => ({ ...flowExtBridge.status(), latestExtVersion: bundledExtVersion() }));

// ── Native tools chạy local (FFmpeg dựng video, sắp có Whisper) ──
ipcMain.handle('render-video', (e, payload) => nativeTools.renderVideo(payload, BrowserWindow.fromWebContents(e.sender)));
ipcMain.handle('ffmpeg-info', () => nativeTools.ffmpegInfo());
ipcMain.handle('render-video-cancel', () => nativeTools.cancelRender());

// ── Editor Pro đã gỡ khỏi bản này ────────────────────────────────────────
// Bàn dựng nâng cao (tab "Edit Video") bị gỡ khỏi giao diện, và nó là lối vào
// DUY NHẤT — không nút nào còn gọi openEditorPro/editorProPaths. Toàn bộ phần
// giao diện của nó (editor/ renderer/ locales/ shared/ vendor/ preload.js
// _main.js remotion-bundle/ — 163 MB) đã chuyển sang nova-luu-tru/editor-pro-ui/.
// Muốn đưa lại thì chép ngược vào rồi khôi phục hai handler này từ git/sao lưu.
// CÁC MODULE IPC của editor-pro (ipc-clips, ipc-nguon-web, nova-remotion…) VẪN
// DÙNG và không bị đụng tới — chúng phục vụ app chính, không phải bàn dựng cũ.

// --- Nâng cấp ảnh (Real-ESRGAN local) ---
ipcMain.handle('upscale-probe', () => { try { return upscaleNative.probe(); } catch (e) { return { ok: false }; } });
ipcMain.handle('upscale-pick-images', () => upscaleNative.pickImages());
ipcMain.handle('upscale-pick-folder', () => upscaleNative.pickFolderImages());
ipcMain.handle('upscale-pick-outdir', () => upscaleNative.pickOutputDir());
ipcMain.handle('upscale-run', (e, payload) => upscaleNative.runUpscale(payload, BrowserWindow.fromWebContents(e.sender)));
ipcMain.handle('upscale-cancel', () => upscaleNative.cancel());
ipcMain.handle('nova:parallaxClip', (e, payload) => parallaxNative.renderParallax(payload, BrowserWindow.fromWebContents(e.sender)));   // ảnh tĩnh → clip 3D parallax (depth AI)
ipcMain.handle('wm-inpaint', (e, a) => { try { return upscaleNative.inpaintBase64(a && a.base64, a && a.mime); } catch (_) { return null; } });   // xoá dấu ✦ bằng AI (MI-GAN) cho bước Tạo Ảnh
ipcMain.handle('open-path', (_e, p) => { try { require('electron').shell.openPath(p); return true; } catch { return false; } });
// Gọi API LLM (Claude/OpenAI/gateway bên thứ 3) Ở TIẾN TRÌNH CHÍNH → KHÔNG dính CORS như renderer.
// Trả nguyên văn status + body → renderer đọc được LỖI THẬT (thay vì "Failed to fetch" trơ trọi khi gateway
// trả lỗi mà thiếu header CORS). Timeout mặc định 120s (kịch bản dài có thể lâu).
ipcMain.handle('llm-fetch', async (_e, opts) => {
  const { url, method, headers, body, timeoutMs } = opts || {};
  if (!url) return { ok: false, error: 'NO_URL' };
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), Math.max(1000, timeoutMs || 120000));
  try {
    const r = await fetch(url, { method: method || 'POST', headers: headers || {}, body: body || undefined, signal: ctrl.signal });
    const text = await r.text();
    return { ok: r.ok, status: r.status, text };
  } catch (e) {
    const msg = (e && e.name === 'AbortError') ? 'Quá thời gian chờ máy chủ' : String((e && e.message) || e);
    return { ok: false, error: msg };
  } finally { clearTimeout(to); }
});
// Như llm-fetch nhưng cho phản hồi NHỊ PHÂN (audio của TTS). Trả base64 vì
// IPC không bê Buffer qua contextBridge được. Lỗi thì trả nguyên văn body dạng
// chữ để renderer đọc được thông báo thật của nhà cung cấp.
ipcMain.handle('tts-fetch', async (_e, opts) => {
  const { url, method, headers, body, timeoutMs } = opts || {};
  if (!url) return { ok: false, error: 'NO_URL' };
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), Math.max(1000, timeoutMs || 180000));
  try {
    const r = await fetch(url, { method: method || 'POST', headers: headers || {}, body: body || undefined, signal: ctrl.signal });
    const mime = r.headers.get('content-type') || '';
    if (!r.ok || /json|text/i.test(mime)) {
      return { ok: r.ok, status: r.status, mime, text: await r.text() };
    }
    const buf = Buffer.from(await r.arrayBuffer());
    return { ok: true, status: r.status, mime, b64: buf.toString('base64') };
  } catch (e) {
    const msg = (e && e.name === 'AbortError') ? 'Quá thời gian chờ máy chủ' : String((e && e.message) || e);
    return { ok: false, error: msg };
  } finally { clearTimeout(to); }
});
ipcMain.handle('read-file-b64', (_e, p) => {
  try {
    const b = fs.readFileSync(p);
    const ext = (path.extname(p).slice(1).toLowerCase() || 'png').replace('jpg', 'jpeg');
    const VID = { mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/x-m4v', ogv: 'video/ogg' };
    const AUD = { mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg', aac: 'audio/aac' };
    const mime = VID[ext] || AUD[ext] || ('image/' + ext);   // ảnh/video/âm thanh → đúng mime
    return { ok: true, dataUrl: 'data:' + mime + ';base64,' + b.toString('base64') };
  } catch (e) { return { error: String(e.message || e) }; }
});
// Thu nhỏ cửa sổ khi ở màn đăng nhập, phóng lại khi vào app.
ipcMain.handle('login-window', (_e, isLogin) => {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (isLogin) {
      if (mainWindow.isMaximized()) mainWindow.unmaximize();
      mainWindow.setResizable(false);
      mainWindow.setMinimumSize(420, 560);
      mainWindow.setSize(460, 720, true);
      mainWindow.center();
    } else {
      mainWindow.setResizable(true);
      mainWindow.setMinimumSize(1024, 640);
      mainWindow.setSize(1440, 900, true);
      mainWindow.center();
    }
  } catch (e) {}
});

// ── Tự động lưu ảnh/video về máy (chọn thư mục + ghi file, ghi đè khi tạo lại) ──
ipcMain.handle('pick-folder', async () => {
  try {
    const r = await dialog.showOpenDialog(mainWindow, { title: 'Chọn thư mục lưu', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths || !r.filePaths[0]) return { canceled: true };
    return { path: r.filePaths[0] };
  } catch (e) { return { error: e.message || String(e) }; }
});
// Chọn 1 file ảnh/video cho ô media của lớp đồ hoạ.
// Vì sao trả ĐƯỜNG DẪN chứ không base64: 1 clip 50MB nhúng base64 thành ~67MB chuỗi,
// nhét vào workData là vỡ giới hạn doc Firestore và phình IndexedDB. Lúc xuất,
// stageLocalAssets tự chép file vào bundle nên đường dẫn dùng được bình thường.
ipcMain.handle('pick-media-file', async (_e, kind) => {
  try {
    const filters = kind === 'video'
      ? [{ name: 'Video', extensions: ['mp4', 'mov', 'webm', 'm4v', 'mkv'] }]
      : [{ name: 'Ảnh và video', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'mp4', 'mov', 'webm', 'm4v', 'mkv'] }];
    const r = await dialog.showOpenDialog(mainWindow, { title: 'Chọn ảnh hoặc video', properties: ['openFile'], filters });
    if (r.canceled || !r.filePaths || !r.filePaths[0]) return { canceled: true };
    const p = r.filePaths[0];
    return { path: p, video: /\.(mp4|mov|webm|m4v|mkv)$/i.test(p) };
  } catch (e) { return { error: e.message || String(e) }; }
});

// ── Thông số hệ thống THẬT cho thanh trạng thái (RAM/CPU) ──
ipcMain.handle('sys-stats', () => {
  try {
    const total = os.totalmem(), free = os.freemem();
    return { ramTotal: total, ramUsed: total - free, cpuCount: (os.cpus() || []).length, platform: os.platform() };
  } catch (e) { return { error: e.message }; }
});
ipcMain.handle('save-file', async (_e, payload = {}) => {
  try {
    const { dir, subdir, name, base64 } = payload;
    if (!dir || !name) return { error: 'THIẾU_THƯ_MỤC_HOẶC_TÊN' };
    const clean = String(base64 || '').replace(/^data:[^;]+;base64,/, '');
    if (!clean) return { error: 'THIẾU_DỮ_LIỆU' };
    const safe = (s) => String(s).replace(/[/\\:*?"<>|]+/g, '_').replace(/\.\.+/g, '_');
    let target = dir;
    if (subdir) target = path.join(dir, safe(subdir));
    fs.mkdirSync(target, { recursive: true });
    const file = path.join(target, safe(name));
    fs.writeFileSync(file, Buffer.from(clean, 'base64'));   // ghi đè nếu đã tồn tại
    return { ok: true, path: file };
  } catch (e) { return { error: _friendlyMainError(e) || e.message || String(e) }; }
});

// ── CLI bridge native: app tự chạy gói Claude/ChatGPT của user (localhost:8795/8796) ──
try { cliBridge.startAll(); } catch (e) { console.warn('[cli-bridge]', e && e.message); }

// ── MCP bridge native: cho AI agent (MCP) điều khiển dựng video/nâng cấp/xoá watermark (localhost:8794) ──
try {
  mcpBridge.startAll({
    nativeTools, upscaleNative, watermarkNative,
    getWindow: () => (mainWindow && !mainWindow.isDestroyed() ? mainWindow : BrowserWindow.getFocusedWindow()),
  });
} catch (e) { console.warn('[mcp-bridge]', e && e.message); }

// ── Voice native: khởi động backend giọng nói (OmniVoice) khi mở tab Tạo giọng nói ──
ipcMain.handle('voice-start', () => voiceNative.start());
ipcMain.handle('voice-status', () => voiceNative.status());
ipcMain.handle('voice-probe', () => { try { return voiceNative.probe(); } catch (e) { return { hasRoot: false, hasPython: false }; } });
ipcMain.handle('voice-pick-root', async () => {
  try {
    const r = await dialog.showOpenDialog(mainWindow, { title: 'Chọn thư mục voice-studio đã cài', properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths || !r.filePaths[0]) return { canceled: true };
    return voiceNative.setRoot(r.filePaths[0]);
  } catch (e) { return { error: String(e) }; }
});
// Chép backend giọng nói (đóng gói sẵn trong app) ra máy khách + tự đặt đường dẫn
ipcMain.handle('voice-install-backend', async () => {
  try {
    const r = await dialog.showOpenDialog(mainWindow, { title: 'Chọn nơi cài backend giọng nói (sẽ tạo thư mục voice-studio)', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths || !r.filePaths[0]) return { canceled: true };
    const dest = path.join(r.filePaths[0], 'voice-studio');
    // File nằm trong app.asar.unpacked (asarUnpack) — dùng đường dẫn THẬT để cpSync/opendir đọc được
    const base = __dirname.includes('app.asar') ? __dirname.replace('app.asar', 'app.asar.unpacked') : __dirname;
    let src = path.join(base, 'voice-backend');
    if (!fs.existsSync(path.join(src, 'backend', 'app.py'))) {
      const alt = path.join(__dirname, 'voice-backend');   // dự phòng (dev/npm start)
      if (fs.existsSync(path.join(alt, 'backend', 'app.py'))) src = alt;
      else return { error: 'Không tìm thấy backend đóng gói trong app.' };
    }
    fs.cpSync(src, dest, { recursive: true });
    const set = voiceNative.setRoot(dest);
    try { shell.openPath(dest); } catch {}
    return { ok: true, path: dest, warn: set && set.error ? set.error : null };
  } catch (e) { return { error: String(e) }; }
});
// Chép extension Flow (đóng gói sẵn trong app) ra máy khách để "Tải tiện ích chưa đóng gói" vào Chrome
ipcMain.handle('flow-ext-export', async () => {
  try {
    const r = await dialog.showOpenDialog(mainWindow, { title: 'Chọn nơi lưu Extension (sẽ tạo thư mục nova-studio)', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths || !r.filePaths[0]) return { canceled: true };
    const dest = path.join(r.filePaths[0], 'nova-studio');
    // File nằm trong app.asar.unpacked (asarUnpack) — dùng đường dẫn THẬT để cpSync đọc được
    const base = __dirname.includes('app.asar') ? __dirname.replace('app.asar', 'app.asar.unpacked') : __dirname;
    let src = path.join(base, 'flow-extension');
    if (!fs.existsSync(path.join(src, 'manifest.json'))) {
      const alt = path.join(__dirname, 'flow-extension');   // dự phòng (dev/npm start)
      if (fs.existsSync(path.join(alt, 'manifest.json'))) src = alt;
      else return { error: 'Không tìm thấy extension đóng gói trong app.' };
    }
    fs.cpSync(src, dest, { recursive: true });
    try { shell.openPath(dest); } catch {}
    return { ok: true, path: dest };
  } catch (e) { return { error: String(e) }; }
});
ipcMain.handle('app-version', () => app.getVersion());
ipcMain.handle('export-dir', () => { try { return app.getPath('videos') || app.getPath('downloads'); } catch (e) { return app.getPath('downloads'); } });
ipcMain.handle('update-download', () => { try { autoUpdater.downloadUpdate(); return true; } catch (e) { return false; } });
ipcMain.handle('update-install', () => { try { autoUpdater.quitAndInstall(); return true; } catch (e) { return false; } });
voiceNative.onLog((line) => { try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('voice-log', line); } catch {} });

// ── Watermark native: xoá watermark/logo (đặc biệt watermark Flow/Veo) bằng WatermarkRemover-AI ──
ipcMain.handle('wm-probe', () => { try { return watermarkNative.probe(); } catch (e) { return { hasRoot: false, hasPython: false }; } });
ipcMain.handle('wm-remove-file', (e, { input, output, opts } = {}) => watermarkNative.removeFile(input, output, opts).catch((err) => ({ error: String(err && err.message || err) })));
ipcMain.handle('wm-remove-folder', (e, { input, output, opts } = {}) => watermarkNative.removeFolder(input, output, opts).catch((err) => ({ error: String(err && err.message || err) })));
ipcMain.handle('wm-preview', (e, { input, opts } = {}) => watermarkNative.preview(input, opts).catch((err) => ({ error: String(err && err.message || err) })));
ipcMain.handle('wm-cancel', () => { try { watermarkNative.cancel(); return true; } catch { return false; } });
ipcMain.handle('wm-pick-root', async () => {
  try {
    const r = await dialog.showOpenDialog(mainWindow, { title: 'Chọn thư mục WatermarkRemover-AI đã cài (chứa remwm.py)', properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths || !r.filePaths[0]) return { canceled: true };
    return watermarkNative.setRoot(r.filePaths[0]);
  } catch (e) { return { error: String(e) }; }
});
// Thử 1 ảnh: chọn file → xoá watermark ra bản _clean (giữ ảnh gốc) → mở cả 2 để so sánh.
ipcMain.handle('wm-test-file', async (e, { opts } = {}) => {
  try {
    const r = await dialog.showOpenDialog(mainWindow, { title: 'Chọn 1 ảnh để thử xoá watermark', properties: ['openFile'], filters: [{ name: 'Ảnh', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
    if (r.canceled || !r.filePaths || !r.filePaths[0]) return { canceled: true };
    const input = r.filePaths[0];
    const ext = path.extname(input);
    const output = path.join(path.dirname(input), path.basename(input, ext) + '_clean' + ext);
    await watermarkNative.removeFile(input, output, opts || {});
    try { shell.openPath(output); } catch {}
    try { shell.showItemInFolder(output); } catch {}
    return { ok: true, input, output };
  } catch (err) { return { error: String(err && err.message || err) }; }
});
watermarkNative.onLog((line) => { try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('wm-log', line); } catch {} });

let _shutdownDone = false;
function shutdownOwnedResources() {
  if (_shutdownDone) return;
  _shutdownDone = true;
  if (_autoPushStartTimer) { clearTimeout(_autoPushStartTimer); _autoPushStartTimer = null; }
  if (_autoPushInterval) { clearInterval(_autoPushInterval); _autoPushInterval = null; }
  try { flowExtBridge.stop(); } catch (_) {}
  try { cliBridge.stopAll(); } catch (_) {}
  try { mcpBridge.stopAll(); } catch (_) {}
  try { voiceNative.stop(); } catch (_) {}
  try { watermarkNative.cancel(); } catch (_) {}
  try { flowChrome.closeGuestCaptcha && flowChrome.closeGuestCaptcha(); } catch (_) {}
}

app.on('before-quit', () => {
  isQuitting = true;
  try { closeSplashWindow(true); } catch (_) {}
  try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide(); } catch (_) {}
  try { if (localServer) { localServer.close(); localServer = null; } } catch (_) {}
  shutdownOwnedResources();
});
app.on('will-quit', () => {
  isQuitting = true;
  try { closeSplashWindow(true); } catch (_) {}
  try { if (localServer) { localServer.close(); localServer = null; } } catch (_) {}
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.destroy();
    }
  } catch (_) {}
});

app.whenReady().then(async () => {
  // Không tạo BrowserWindow splash riêng. Cửa sổ frameless tạm thời có thể bị
  // Windows giữ lại thành một mảng đen nếu tiến trình cũ bị kill/crash. Giao diện
  // chính vẫn được giữ show:false và chỉ hiện sau khi load xong ở createWindow().
  // Icon trên Dock (macOS) ngay cả bản dev — dùng logo AutoVideo Studio.
  if (process.platform === 'darwin' && app.dock) {
    try { const ic = path.join(__dirname, 'build', 'icon.png'); if (fs.existsSync(ic)) app.dock.setIcon(ic); } catch (e) { /* */ }
  }
  buildMenu();
  // Đăng ký IPC của Editor Pro (nhúng qua <webview>) — dùng chung userData Nova nhưng không dùng session app khác.
  try {
    require('./editor-pro/register').registerEditorPro(ipcMain, { userDataDir: app.getPath('userData') });
  } catch (e) { console.warn('[EditorPro] register:', e && e.message); }
  try {
    const startUrl = await resolveStartUrl();
    if (!isQuitting) createWindow(startUrl);
  } catch (err) {
    console.error('[startup]', err);
    closeSplashWindow(true);
    app.quit();
  }
  // Bản private không đọc app-update.yml/repository của Nova Studio.
  // Khi có release server riêng, bật lại bằng AI_VIDEO_STUDIO_ENABLE_UPDATES=1.
  if (app.isPackaged && process.env.AI_VIDEO_STUDIO_ENABLE_UPDATES === '1') setupAutoUpdate();
  app.on('activate', async () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(await resolveStartUrl()); });
});

app.on('window-all-closed', () => {
  shutdownOwnedResources();
  if (process.platform !== 'darwin') app.quit();
});
