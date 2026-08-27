/**
 * flow-cft.js — Thêm tài khoản Flow bằng cách mở CHROME THẬT của người dùng (không automation).
 *
 * Cách làm (hợp lệ, không qua mặt bảo mật):
 *   1. Mở Chrome (profile riêng, TRẮNG) — KHÔNG có cờ --remote-debugging / --enable-automation
 *      → với Google đây là trình duyệt bình thường → cho đăng nhập (không "browser not secure").
 *   2. Người dùng đăng nhập Google như thường.
 *   3. App ĐỌC cookie thẳng từ file profile (SQLite "Cookies") + GIẢI MÃ (đây là cookie của
 *      chính người dùng, trên máy của họ) → trả về app lưu vào kho (flow-native addAccountByCookie).
 *   4. Từ cookie, app tự bắt/làm mới token ya29 trong partition — không cần mở lại Chrome.
 *
 * Mac: cookie mã hoá AES-128-CBC, khoá = PBKDF2(mật khẩu "Chrome Safe Storage" trong Keychain).
 * Win: (đang bổ sung) DPAPI + AES-256-GCM.
 */
const { app } = require('electron');
const { spawn, execFileSync } = require('child_process');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cftRoot = () => path.join(app.getPath('userData'), 'cft');
// Bản CfT GHIM cố định — KHÔNG có banner "chỉ dành cho kiểm thử tự động" (bản v150+ mới có banner).
const PINNED_CFT = '149.0.7827.55';
const cftMarker = () => path.join(cftRoot(), 'PINNED_VERSION');
function cftIsPinned() { try { return fs.readFileSync(cftMarker(), 'utf8').trim() === PINNED_CFT; } catch { return false; } }
const FLOW_URL = 'https://labs.google/fx/tools/flow';
const LOG = (...a) => { try { console.log('[flow-cft]', ...a); } catch {} };

// Chrome còn đang mở profile này không? (nhận biết qua file khóa singleton — dùng lstat
// vì SingletonLock là symlink trỏ tới "host-pid" không tồn tại nên existsSync trả false).
function browserAlive(profileDir) {
  for (const f of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
    try { fs.lstatSync(path.join(profileDir, f)); return true; } catch {}
  }
  return false;
}

// ── Tìm Chrome trên máy ──────────────────────────────────────────────
function existing(p) { try { return p && fs.existsSync(p) ? p : null; } catch { return null; } }
function cachedCft() {
  try {
    const root = cftRoot();
    if (!fs.existsSync(root)) return null;
    const hits = [];
    (function walk(d, depth) {
      if (depth > 5) return;
      for (const f of fs.readdirSync(d)) {
        const full = path.join(d, f);
        let st; try { st = fs.statSync(full); } catch { continue; }
        if (st.isDirectory()) walk(full, depth + 1);
        else if (f === 'Google Chrome for Testing' || f === 'chrome' || f === 'chrome.exe') hits.push(full);
      }
    })(root, 0);
    return hits[0] || null;
  } catch { return null; }
}
// Chỉ Chrome for Testing (đã tải về hoặc cài sẵn) — icon RIÊNG, không đụng Chrome cá nhân của khách.
function findCft() {
  const c = cachedCft();
  if (c) return c;
  const app = process.platform === 'darwin'
    ? '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
    : null;
  if (app && existing(app)) return app;
  return null;
}
function findChrome() {
  const plat = process.platform;
  // Ưu tiên Chrome for Testing (cửa sổ riêng, tắt hẳn không đụng Chrome cá nhân) rồi mới rơi về Chrome thật.
  const cft = findCft();
  if (cft) return cft;
  const cands = plat === 'darwin' ? [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ] : plat === 'win32' ? [
    (process.env['PROGRAMFILES'] || 'C:\\Program Files') + '\\Google\\Chrome\\Application\\chrome.exe',
    (process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)') + '\\Google\\Chrome\\Application\\chrome.exe',
    (process.env['LOCALAPPDATA'] || '') + '\\Google\\Chrome\\Application\\chrome.exe',
  ] : [
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ];
  for (const p of cands) { if (existing(p)) return p; }
  return null;
}

// ── Tải Chrome for Testing (fallback nếu máy không có Chrome) ─────────
function cftPlatform() {
  const a = process.arch;
  if (process.platform === 'darwin') return a === 'arm64' ? 'mac-arm64' : 'mac-x64';
  if (process.platform === 'win32') return a === 'x64' ? 'win64' : 'win32';
  return 'linux64';
}
function httpGetJSON(url) {
  return new Promise((res, rej) => {
    https.get(url, (r) => { let d = ''; r.on('data', (c) => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej);
  });
}
function urlOk(url) {
  return new Promise((res) => {
    const req = https.request(url, { method: 'HEAD', timeout: 8000 }, (r) => { res(r.statusCode >= 200 && r.statusCode < 400); });
    req.on('error', () => res(false)); req.on('timeout', () => { req.destroy(); res(false); });
    req.end();
  });
}
function download(url, dest, onEvent) {
  return new Promise((res, rej) => {
    const file = fs.createWriteStream(dest);
    const get = (u) => https.get(u, (r) => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) { r.resume(); return get(r.headers.location); }
      if (r.statusCode !== 200) { rej(new Error('HTTP ' + r.statusCode)); return; }
      const total = parseInt(r.headers['content-length'] || '0'); let got = 0;
      r.on('data', (c) => { got += c.length; if (total && onEvent) onEvent({ type: 'download', pct: Math.round(got / total * 100) }); });
      r.pipe(file); file.on('finish', () => file.close(() => res()));
    }).on('error', rej);
    get(url);
  });
}
async function ensureChrome(onEvent) {
  // Ưu tiên Chrome for Testing thật sự (cửa sổ riêng, tắt hẳn) — tải về nếu máy chưa có.
  const cft = findCft();
  if (cft && cftIsPinned()) return cft;                 // đã là bản ghim 149 (không banner) → dùng luôn
  if (cft && !cftIsPinned()) {                          // bản cũ có banner → gỡ, tải lại bản sạch
    onEvent && onEvent({ type: 'status', msg: 'Đang thay Chrome for Testing bằng bản không có banner…' });
    try { fs.rmSync(cftRoot(), { recursive: true, force: true }); } catch {}
  } else {
    onEvent && onEvent({ type: 'status', msg: 'Đang tải Chrome for Testing (~180MB, chỉ lần đầu)…' });
  }
  const plat = cftPlatform();
  let url = `https://storage.googleapis.com/chrome-for-testing-public/${PINNED_CFT}/${plat}/chrome-${plat}.zip`;
  // Dự phòng: nếu bản ghim không tải được thì rơi về Stable mới nhất.
  try { if (!(await urlOk(url))) throw new Error('pinned 404'); }
  catch {
    try {
      const data = await httpGetJSON('https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json');
      const dl = data.channels.Stable.downloads.chrome.find((x) => x.platform === plat);
      if (dl) url = dl.url;
    } catch {}
  }
  fs.mkdirSync(cftRoot(), { recursive: true });
  const zip = path.join(cftRoot(), 'chrome.zip');
  await download(url, zip, onEvent);
  onEvent && onEvent({ type: 'status', msg: 'Đang giải nén…' });
  await unzip(zip, cftRoot());
  try { fs.unlinkSync(zip); } catch {}
  const bin = cachedCft();
  if (!bin) throw new Error('Giải nén xong nhưng không thấy chrome');
  try { fs.chmodSync(bin, 0o755); } catch {}
  try { fs.writeFileSync(cftMarker(), url.includes(PINNED_CFT) ? PINNED_CFT : 'stable'); } catch {}   // đánh dấu bản đã tải
  if (process.platform === 'darwin') {
    try {
      const appDir = bin.replace(/\/Contents\/MacOS\/.*/, '');
      await new Promise((r) => { const c = spawn('xattr', ['-dr', 'com.apple.quarantine', appDir]); c.on('close', r); c.on('error', r); });
    } catch {}
  }
  return bin;
}
function unzip(zip, dir) {
  return new Promise((res, rej) => {
    const cmd = process.platform === 'win32'
      ? spawn('powershell', ['-NoProfile', '-Command', `Expand-Archive -Force -Path "${zip}" -DestinationPath "${dir}"`])
      : spawn('unzip', ['-q', '-o', zip, '-d', dir]);
    cmd.on('close', (code) => code === 0 ? res() : rej(new Error('unzip lỗi ' + code)));
    cmd.on('error', rej);
  });
}

// ── Đọc + giải mã cookie từ profile Chrome (không cần điều khiển Chrome) ──
// Vị trí file Cookies (Chrome mới đặt trong Default/Network/).
function cookiesDbPath(profileDir) {
  const cands = [
    path.join(profileDir, 'Default', 'Network', 'Cookies'),
    path.join(profileDir, 'Default', 'Cookies'),
  ];
  for (const p of cands) { if (existing(p)) return p; }
  return null;
}

// sqlite3: Mac/Linux dùng CLI hệ thống; Windows dùng bản đóng gói kèm app (sqlite-bin/sqlite3.exe).
function sqliteBin() {
  if (process.platform !== 'win32') return 'sqlite3';
  const real = __dirname.includes('app.asar') ? __dirname.replace('app.asar', 'app.asar.unpacked') : __dirname;
  const p = path.join(real, 'sqlite-bin', 'sqlite3.exe');
  return existing(p) ? p : 'sqlite3.exe';
}

// Chép DB (kèm -wal/-shm) ra temp rồi truy vấn bằng sqlite3 CLI (tránh khoá của Chrome đang chạy).
function sqliteQuery(dbPath, sql) {
  const tdir = fs.mkdtempSync(path.join(os.tmpdir(), 'ckq-'));
  try {
    for (const suf of ['', '-wal', '-shm']) {
      try { fs.copyFileSync(dbPath + suf, path.join(tdir, 'Cookies' + suf)); } catch {}
    }
    const out = execFileSync(sqliteBin(), ['-readonly', '-separator', '\x1f', '-newline', '\x1e', path.join(tdir, 'Cookies'), sql], { encoding: 'utf8', maxBuffer: 96 * 1024 * 1024 });
    return out;
  } finally {
    try { fs.rmSync(tdir, { recursive: true, force: true }); } catch {}
  }
}

// Có cookie phiên Google chưa? (đã đăng nhập xong)
function hasLoginCookie(dbPath) {
  try {
    const out = sqliteQuery(dbPath, "SELECT name FROM cookies WHERE host_key LIKE '%google.com' AND name IN ('__Secure-1PSID','SID');");
    const names = out.split('\x1e').map((r) => r.trim()).filter(Boolean);
    return names.includes('__Secure-1PSID') || names.includes('SID');
  } catch { return false; }
}

// Lấy mật khẩu "Safe Storage" từ Keychain (Mac) để tạo khoá giải mã.
function macSafeStoragePassword(binPath) {
  let service = 'Chrome Safe Storage', account = 'Chrome';
  if (/Chromium/.test(binPath)) { service = 'Chromium Safe Storage'; account = 'Chromium'; }
  else if (/Microsoft Edge|msedge/.test(binPath)) { service = 'Microsoft Edge Safe Storage'; account = 'Microsoft Edge'; }
  else if (/for Testing/.test(binPath)) { service = 'Chromium Safe Storage'; account = 'Chromium'; }
  for (const args of [['-w', '-s', service, '-a', account], ['-w', '-s', service]]) {
    try {
      const out = execFileSync('security', ['find-generic-password', ...args], { encoding: 'utf8' }).trim();
      if (out) { LOG('lấy được khóa Keychain từ:', service); return out; }
    } catch (e) { LOG('Keychain "' + service + '" chưa lấy được:', e && e.message); }
  }
  LOG('KHÔNG lấy được khóa Keychain → dùng mặc định (giải mã có thể rỗng)');
  return 'peanuts';   // Chromium không có Keychain → khoá mặc định
}

function macKey(binPath) {
  const pw = macSafeStoragePassword(binPath);
  return crypto.pbkdf2Sync(pw, 'saltysalt', 1003, 16, 'sha1');
}

// Giải mã 1 giá trị cookie (Mac v10). Trả về chuỗi value.
function decryptMac(encHex, key, hostKey) {
  const buf = Buffer.from(encHex, 'hex');
  if (!buf.length) return '';
  const prefix = buf.slice(0, 3).toString('latin1');
  if (prefix !== 'v10' && prefix !== 'v11') return buf.toString('utf8');   // chưa mã hoá
  try {
    const iv = Buffer.alloc(16, ' ');
    const dec = crypto.createDecipheriv('aes-128-cbc', key, iv);
    dec.setAutoPadding(false);
    let out = Buffer.concat([dec.update(buf.slice(3)), dec.final()]);
    const pad = out[out.length - 1];
    if (pad > 0 && pad <= 16) out = out.slice(0, out.length - pad);   // bỏ PKCS7
    // Chrome v130+ chèn 32 byte SHA256(host_key) trước value → cắt bỏ nếu có.
    if (out.length >= 32) {
      const h = crypto.createHash('sha256').update(hostKey).digest();
      if (out.slice(0, 32).equals(h)) out = out.slice(32);
    }
    return out.toString('utf8');
  } catch { return ''; }
}

// ── Windows: khoá AES-256-GCM nằm trong "Local State", bọc bằng DPAPI (theo tài khoản Windows). ──
// Gọi DPAPI qua PowerShell (không cần native module) — truyền base64 qua biến môi trường cho gọn/an toàn.
function winDpapiUnprotect(buf) {
  const ps = `Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String($env:CKM_DPAPI); $k=[System.Security.Cryptography.ProtectedData]::Unprotect($b,$null,'CurrentUser'); [Convert]::ToBase64String($k)`;
  const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', env: { ...process.env, CKM_DPAPI: buf.toString('base64') } }).trim();
  return Buffer.from(out, 'base64');
}
// Đọc + giải bọc khoá 32 byte từ Local State của profile.
function winKey(profileDir) {
  const ls = JSON.parse(fs.readFileSync(path.join(profileDir, 'Local State'), 'utf8'));
  const enc = ls && ls.os_crypt && ls.os_crypt.encrypted_key;
  if (!enc) throw new Error('NO_ENCRYPTED_KEY');
  let raw = Buffer.from(enc, 'base64');
  if (raw.slice(0, 5).toString('latin1') === 'DPAPI') raw = raw.slice(5);   // bỏ tiền tố "DPAPI"
  const key = winDpapiUnprotect(raw);
  if (!key || key.length !== 32) throw new Error('BAD_WIN_KEY_LEN_' + (key && key.length));
  return key;
}
// Giải mã 1 giá trị cookie Windows (v10/v11 = AES-256-GCM: 'v10' + nonce(12) + ciphertext + tag(16)).
function decryptWin(encHex, key, hostKey) {
  const buf = Buffer.from(encHex, 'hex');
  if (!buf.length) return '';
  const prefix = buf.slice(0, 3).toString('latin1');
  if (prefix === 'v10' || prefix === 'v11') {
    try {
      const nonce = buf.slice(3, 15);
      const tag = buf.slice(buf.length - 16);
      const ct = buf.slice(15, buf.length - 16);
      const dec = crypto.createDecipheriv('aes-256-gcm', key, nonce);
      dec.setAuthTag(tag);
      let out = Buffer.concat([dec.update(ct), dec.final()]);
      // Chrome v130+ chèn 32 byte SHA256(host_key) trước value → cắt bỏ nếu có.
      if (out.length >= 32) { const h = crypto.createHash('sha256').update(hostKey).digest(); if (out.slice(0, 32).equals(h)) out = out.slice(32); }
      return out.toString('utf8');
    } catch { return ''; }
  }
  // Cookie cũ (không tiền tố v10) → DPAPI trực tiếp cả blob.
  try { return winDpapiUnprotect(buf).toString('utf8'); } catch { return ''; }
}

function ssName(v) {
  const n = parseInt(v);
  if (n === 0) return 'no_restriction';
  if (n === 1) return 'lax';
  if (n === 2) return 'strict';
  return 'unspecified';
}

// Đọc toàn bộ cookie Google + giải mã → mảng cho addAccountByCookie.
function harvestCookies(dbPath, binPath, profileDir) {
  const sql = "SELECT host_key,name,path,is_secure,is_httponly,expires_utc,samesite,hex(encrypted_value) FROM cookies WHERE host_key LIKE '%google.com' OR host_key LIKE '%labs.google' OR host_key LIKE '%googleusercontent.com';";
  const raw = sqliteQuery(dbPath, sql);
  const isWin = process.platform === 'win32';
  const key = process.platform === 'darwin' ? macKey(binPath) : (isWin ? winKey(profileDir) : null);
  const rows = raw.split('\x1e').map((r) => r.replace(/\n$/, '')).filter((r) => r.length);
  LOG('đọc được', rows.length, 'dòng cookie Google từ DB');
  const out = [];
  for (const line of rows) {
    const f = line.split('\x1f');
    if (f.length < 8) continue;
    const [host, name, cpath, isSecure, isHttp, expUtc, samesite, encHex] = f;
    if (!name) continue;
    let value = '';
    if (key) value = isWin ? decryptWin(encHex, key, host) : decryptMac(encHex, key, host);
    if (value === '' && name !== 'OTZ') { /* giữ cookie rỗng cũng không hại, nhưng bỏ để gọn */ }
    const expSec = (Number(expUtc) > 0) ? Math.round(Number(expUtc) / 1e6 - 11644473600) : undefined;
    out.push({
      name, value,
      domain: host,
      path: cpath || '/',
      secure: isSecure === '1',
      httpOnly: isHttp === '1',
      expirationDate: expSec,
      sameSite: ssName(samesite),
    });
  }
  return out;
}

let _current = null;   // { proc, profileDir, canceled }
function cancelAdd() { if (_current) { _current.canceled = true; try { _current.proc.kill(); } catch {} } }

// Mở Chrome (profile trắng riêng, KHÔNG automation) → chờ đăng nhập → đọc cookie sạch.
async function addAccountViaCFT(win, onEvent) {
  const emit = (o) => { onEvent && onEvent(o); };
  let chrome;
  try { chrome = await ensureChrome(emit); } catch (e) { return { error: 'Không tìm/tải được Chrome: ' + (e.message || e) }; }
  LOG('dùng Chrome:', chrome);

  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-login-'));
  const args = [
    `--user-data-dir=${profileDir}`,
    '--no-first-run', '--no-default-browser-check', '--no-service-autorun', '--disable-sync',
    '--new-window', FLOW_URL,
  ];
  LOG('mở Chrome, profile:', profileDir);
  const proc = spawn(chrome, args, { detached: false });
  let procExited = false;
  proc.on('exit', (code) => { procExited = true; LOG('tiến trình Chrome thoát, code=', code, '(browser có thể vẫn mở)'); });
  proc.on('error', (e) => { procExited = true; LOG('spawn lỗi:', e && e.message); });
  _current = { proc, profileDir, canceled: false };
  emit({ type: 'status', msg: 'Đã mở Chrome — hãy ĐĂNG NHẬP tài khoản Google. Đăng nhập xong app sẽ tự nhận (giữ cửa sổ Chrome mở).' });

  // Chờ đăng nhập: tới khi thấy cookie phiên Google trong file Cookies.
  // KHÔNG bỏ cuộc chỉ vì proc thoát (launcher Chrome hay thoát sớm còn browser vẫn mở) —
  // chỉ bỏ khi browser thực sự đóng (mất file khóa singleton) hoặc user huỷ / hết giờ.
  const start = Date.now();
  let dbPath = null, found = false, loggedDb = false, loggedAlive = false;
  while (Date.now() - start < 5 * 60 * 1000) {
    if (_current.canceled) break;
    await sleep(2000);
    if (_current.canceled) break;
    if (!dbPath) { dbPath = cookiesDbPath(profileDir); if (dbPath && !loggedDb) { loggedDb = true; LOG('thấy file Cookies:', dbPath); } }
    if (dbPath && hasLoginCookie(dbPath)) { found = true; LOG('✓ phát hiện đã đăng nhập'); break; }
    const alive = browserAlive(profileDir);
    if (!loggedAlive) { loggedAlive = true; LOG('browserAlive=', alive, 'dbPath=', !!dbPath); }
    // Chrome đã đóng hẳn (không còn khóa singleton) và cũng chưa thấy đăng nhập → dừng.
    if (procExited && !alive && Date.now() - start > 6000) { LOG('Chrome đã đóng hẳn, dừng chờ'); break; }
  }
  const wasCanceled = _current.canceled;

  if (wasCanceled || !found) {
    try { proc.kill(); } catch {}
    setTimeout(() => { try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch {} }, 1500);
    _current = null;
    LOG('kết thúc KHÔNG có cookie. canceled=', wasCanceled, 'dbPath=', !!dbPath);
    return { error: wasCanceled ? 'Đã huỷ.' : (!browserAlive(profileDir) ? 'Cửa sổ Chrome đã đóng — chưa kịp đăng nhập.' : 'Chưa đăng nhập (hết 5 phút chờ).') };
  }

  // Đợi Chrome ghi nốt cookie rồi mới đọc.
  await sleep(1500);
  emit({ type: 'status', msg: 'Đã đăng nhập — đang đọc & giải mã cookie…' });
  let mapped;
  try { mapped = harvestCookies(dbPath, chrome, profileDir); }
  catch (e) {
    try { proc.kill(); } catch {}
    setTimeout(() => { try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch {} }, 1500);
    _current = null;
    return { error: 'Không đọc được cookie: ' + (e.message || e) + (String(e.message).includes('security') ? ' (cần bấm "Cho phép" ở hộp thoại Keychain)' : '') + (String(e.message).includes('powershell') || String(e.message).includes('DPAPI') || String(e.message).includes('WIN_KEY') ? ' (Windows: cần bật PowerShell)' : '') };
  }

  try { proc.kill(); } catch {}
  setTimeout(() => { try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch {} }, 1500);
  _current = null;

  const good = mapped.filter((c) => c.value);
  LOG('giải mã xong:', good.length + '/' + mapped.length, 'cookie có giá trị');
  if (!good.length) return { error: process.platform === 'win32' ? 'Đọc được cookie nhưng giải mã rỗng (không lấy được khoá DPAPI/Local State). Thử đăng nhập lại.' : 'Đọc được cookie nhưng giải mã rỗng (Keychain bị từ chối?). Thử lại và bấm "Luôn cho phép".' };
  emit({ type: 'status', msg: `Đã lấy ${good.length} cookie — đang lưu tài khoản…` });
  return { cookies: JSON.stringify(mapped) };
}

module.exports = { addAccountViaCFT, cancelAdd, findChrome, findCft, ensureChrome, cftIsPinned };
