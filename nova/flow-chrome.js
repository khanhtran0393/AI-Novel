/**
 * flow-chrome.js — Engine "Chrome THẬT đa profile" (giống mô hình đối thủ).
 *
 * Mỗi account = 1 profile Chrome for Testing BỀN VỮNG (lưu ở userData/chrome-accounts/acc-<id>):
 *   - ĐĂNG NHẬP: mở Chrome KHÔNG cờ debug → Google coi là trình duyệt thường → cho đăng nhập.
 *               User đăng nhập xong → ĐÓNG cửa sổ → bấm "Đã xong".
 *   - VẬN HÀNH: mở lại đúng profile đó CÓ --remote-debugging-port → điều khiển qua CDP:
 *       • bắt token ya29 (Network.requestWillBeSent)
 *       • đọc cookie ĐÃ GIẢI MÃ (Network.getAllCookies) → khỏi giải mã đĩa/DPAPI, chạy được cả Windows
 *       • gọi API Flow bằng fetch TRONG trang (Runtime.evaluate) → đúng origin + vân tay Chrome thật
 *
 * Hợp lệ: trình duyệt thật + đăng nhập thật + thao tác trên chính phiên đó. KHÔNG stealth/giả mạo.
 * (GĐ1: chỉ login + verify token/credits để chứng minh khả thi. Gen sẽ port ở GĐ2.)
 */
const { app, net } = require('electron');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const { findChrome, findCft, ensureChrome, cftIsPinned } = require('./flow-cft');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let _logSink = null;
function setLogSink(fn) { _logSink = fn; }
const LOG = (...a) => { try { console.log('[flow-chrome]', ...a); } catch {} try { _logSink && _logSink(a.map((x) => (x && typeof x === 'object') ? JSON.stringify(x) : String(x)).join(' ')); } catch {} };

const FLOW_URL = 'https://labs.google/fx/tools/flow';
const FLOW_API_BASE = 'https://aisandbox-pa.googleapis.com';
const FLOW_API_KEY = 'AIzaSyBtrm0o5ab1c-Ec8ZuLcGt3oJAA5VWt3pY';

const profilesRoot = () => path.join(app.getPath('userData'), 'chrome-accounts');
const profileDir = (id) => path.join(profilesRoot(), 'acc-' + id);
const storeFile = () => path.join(profilesRoot(), 'chrome-accounts.json');

// ── Kho account (bền vững) ────────────────────────────────────────────
const accounts = new Map();   // id -> { id, email, tier, credits, cookieExpiry, enabled, proxy }
let order = [];
let nextId = 1;
function persist() {
  try {
    fs.mkdirSync(profilesRoot(), { recursive: true });
    const data = order.map((id) => { const a = accounts.get(id); const tk = tokens.get(id); return { id: a.id, email: a.email, tier: a.tier, credits: a.credits, cookieExpiry: a.cookieExpiry || null, enabled: a.enabled !== false, proxy: a.proxy || null, projectId: a.projectId || null, useImage: a.useImage !== false, useVideo: a.useVideo !== false, token: (tk && tk.token) || null, tokenExpiry: (tk && tk.expiry) || null }; });
    fs.writeFileSync(storeFile(), JSON.stringify({ nextId, accounts: data }, null, 2));
  } catch (e) { LOG('persist lỗi', e && e.message); }
}
function restore() {
  _loadCapMode();   // nạp chế độ máy captcha (guest/account) đã lưu
  try {
    const d = JSON.parse(fs.readFileSync(storeFile(), 'utf8'));
    nextId = d.nextId || 1; order = [];
    for (const a of (d.accounts || [])) {
      accounts.set(a.id, { id: a.id, email: a.email || null, tier: a.tier || null, credits: a.credits ?? null, cookieExpiry: a.cookieExpiry || null, enabled: a.enabled !== false, proxy: a.proxy || null, projectId: a.projectId || null, useImage: a.useImage !== false, useVideo: a.useVideo !== false });
      order.push(a.id);
      // Khôi phục token cache nếu CÒN HẠN (24h) → mở app KHỎI mint lại (không mở Chrome).
      if (a.token && a.tokenExpiry && Date.now() < a.tokenExpiry - 5 * 60 * 1000) tokens.set(a.id, { token: a.token, at: Date.now(), expiry: a.tokenExpiry });
    }
    if (order.length) LOG('khôi phục', order.length, 'account Chrome');
  } catch { /* chưa có */ }
  // Tải sẵn Chrome for Testing (bản ghim, không banner) 1 lần (nền). Thay luôn nếu đang là bản cũ có banner.
  if (!findCft() || !cftIsPinned()) {
    LOG(findCft() ? 'phát hiện CfT bản cũ có banner — thay bằng bản 149 (nền)…' : 'chưa có Chrome for Testing — tải nền lần đầu…');
    Promise.resolve().then(() => ensureChrome((e) => e && e.msg && LOG(e.msg)))
      .then((p) => LOG('Chrome for Testing (không banner) sẵn sàng:', p))
      .catch((e) => LOG('tải Chrome for Testing lỗi (tạm dùng Chrome máy):', e.message || e));
  }
}
function statusPayload() {
  return { engine: 'chrome', count: order.length, accounts: order.map((id) => {
    const a = accounts.get(id); const tk = tokens.get(id);
    return { id: a.id, email: a.email || ('Chrome ' + a.id), tier: a.tier, credits: a.credits, cookieExpiry: a.cookieExpiry || null,
      tokenExpiry: tk ? (tk.expiry || (tk.at + 55 * 60 * 1000)) : null, enabled: a.enabled !== false, proxy: a.proxy || null,
      hasToken: !!tk, needLogin: a.needLogin === true, useImage: a.useImage !== false, useVideo: a.useVideo !== false };
  }) };
}
function setUse(id, kind, val) {
  const a = accounts.get(id); if (!a) return { error: 'NO_ACC' };
  if (kind === 'video') a.useVideo = !!val; else a.useImage = !!val;
  persist(); return { ok: true };
}
function profileLoggedIn(id) {
  // Có thư mục + đã từng đăng nhập (có file Cookies) → coi như profile hợp lệ.
  for (const p of ['Default/Network/Cookies', 'Default/Cookies']) {
    try { if (fs.existsSync(path.join(profileDir(id), p))) return true; } catch {}
  }
  return false;
}

// ── CDP ──────────────────────────────────────────────────────────────
function readDevToolsPort(dir, ms = 15000) {
  return new Promise((res, rej) => {
    const f = path.join(dir, 'DevToolsActivePort');
    const t0 = Date.now();
    const t = setInterval(() => {
      try { const port = parseInt(fs.readFileSync(f, 'utf8').split('\n')[0]); if (port) { clearInterval(t); res(port); return; } } catch {}
      if (Date.now() - t0 > ms) { clearInterval(t); rej(new Error('Không mở được cổng điều khiển Chrome (còn cửa sổ Chrome cũ chưa đóng?)')); }
    }, 300);
  });
}
function httpJSON(url) {
  return new Promise((res, rej) => { http.get(url, (r) => { let d = ''; r.on('data', (c) => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej); });
}
async function flowPageWs(port) {
  let lastSeen = '';
  for (let i = 0; i < 40; i++) {   // chờ tới ~30s (máy tải nặng trang Flow lâu hiện)
    let list; try { list = await httpJSON(`http://127.0.0.1:${port}/json`); } catch { await sleep(700); continue; }
    const pages = list.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    lastSeen = pages.map((p) => (p.url || '').slice(0, 40)).join(' | ');
    let pg = pages.find((t) => /labs\.google\/fx/.test(t.url || ''));
    if (!pg) pg = pages.find((t) => !/^chrome:|^devtools:/.test(t.url || ''));   // tab thường bất kỳ
    if (!pg) pg = pages[0];
    if (pg && pg.webSocketDebuggerUrl) return pg.webSocketDebuggerUrl;
    await sleep(750);
  }
  throw new Error('Không thấy tab Flow trong Chrome (tab thấy: ' + (lastSeen || 'không có') + ')');
}
function cdpConnect(wsUrl) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(wsUrl, { perMessageDeflate: false, maxPayload: 512 * 1024 * 1024 });
    let id = 0; const pend = {}; const listeners = [];
    ws.on('open', () => res({
      send: (method, params) => new Promise((rs, rj) => {
        const i = ++id; const to = setTimeout(() => { if (pend[i]) { delete pend[i]; rj(new Error('CDP_TIMEOUT ' + method)); } }, 45000);
        pend[i] = { rs: (v) => { clearTimeout(to); rs(v); }, rj: (e) => { clearTimeout(to); rj(e); } };
        try { ws.send(JSON.stringify({ id: i, method, params: params || {} })); } catch (e) { clearTimeout(to); delete pend[i]; rj(e); }
      }),
      on: (fn) => listeners.push(fn),
      close: () => { try { ws.close(); } catch {} },
    }));
    ws.on('message', (buf) => { let m; try { m = JSON.parse(buf); } catch { return; } if (m.id && pend[m.id]) { m.error ? pend[m.id].rj(new Error(m.error.message)) : pend[m.id].rs(m.result); delete pend[m.id]; } else if (m.method) { for (const fn of listeners) try { fn(m); } catch {} } });
    ws.on('error', (e) => rej(e));
    ws.on('close', () => { for (const k of Object.keys(pend)) { try { pend[k].rj(new Error('WS_CLOSED')); } catch {} delete pend[k]; } });
  });
}
async function evalInPage(cdp, expr) {
  const r = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text || 'eval error');
  return r.result && r.result.value;
}
// evalInPage nhưng FAIL NHANH: nếu Runtime.evaluate treo (Windows hay bị) thì bỏ sau `ms` để thử lại ngay,
// thay vì đứng chờ hết 45s timeout CDP. Nuốt lỗi muộn của promise thua race để khỏi unhandled-rejection.
function evalInPageT(cdp, expr, ms = 10000) {
  let timer; const p = evalInPage(cdp, expr); p.catch(() => {});
  const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('EVAL_TIMEOUT')), ms); });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

// ── Tiến trình Chrome ─────────────────────────────────────────────────
const running = new Map();   // id -> { proc, port, cdp }

function launchChrome(id, { debug }) {
  const dir = profileDir(id);
  fs.mkdirSync(dir, { recursive: true });
  // Dọn khoá Singleton còn SÓT (cửa sổ trước tắt bằng SIGTERM có thể để lại) → nếu không, cửa sổ mới mở cùng profile
  // thấy "profile đang dùng" rồi RELAY sang instance cũ (đã chết) và THOÁT NGAY LẬP TỨC → CDP chết → bắt token EVAL_TIMEOUT.
  for (const lk of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) { try { fs.unlinkSync(path.join(dir, lk)); } catch {} }
  const args = [
    `--user-data-dir=${dir}`,
    '--no-first-run', '--no-default-browser-check', '--no-service-autorun', '--disable-sync',
    // Vì app TẮT CỨNG Chrome (để không còn tab dưới dock) → Chrome coi là "thoát không đúng cách".
    // Các cờ này ẩn bong bóng "Khôi phục trang" + KHÔNG khôi phục tab cũ (tránh tab dồn lại).
    '--hide-crash-restore-bubble', '--disable-session-crashed-bubble', '--no-restore-session-state',
  ];
  // Proxy RIÊNG từng account (như đối thủ): mỗi account đi 1 IP, tránh Google liên kết cùng IP.
  const a = accounts.get(id); const proxy = a && a.proxy;
  if (proxy) args.push('--proxy-server=' + proxy);
  if (debug) args.push('--remote-debugging-port=0');
  args.push('--new-window', FLOW_URL);
  const chrome = findChrome();
  if (!chrome) return null;
  LOG('mở Chrome acc', id, debug ? '(điều khiển)' : '(đăng nhập)');
  return spawn(chrome, args, { detached: false });
}

// Tắt HẲN Chrome của profile (mọi tiến trình + cửa sổ) — không để tab lởn vởn trên dock.
function killProfileChrome(id) {
  const dir = profileDir(id);
  try {
    if (process.platform === 'win32') {
      const ps = "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { $_.CommandLine -like '*" + dir.replace(/'/g, "''") + "*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }";
      require('child_process').execFileSync('powershell', ['-NoProfile', '-Command', ps], { stdio: 'ignore', timeout: 8000 });
    } else {
      require('child_process').execFileSync('pkill', ['-f', 'user-data-dir=' + dir], { stdio: 'ignore', timeout: 4000 });
    }
  } catch {}
}

// Đánh dấu "đã thoát sạch" vào Preferences → Chrome KHÔNG hiện bong bóng "Khôi phục trang / không tắt đúng cách".
function markCleanExit(id) {
  for (const rel of ['Default/Preferences', 'Preferences']) {
    const pref = path.join(profileDir(id), rel);
    try {
      const j = JSON.parse(fs.readFileSync(pref, 'utf8'));
      if (!j.profile) j.profile = {};
      j.profile.exit_type = 'Normal';
      j.profile.exited_cleanly = true;
      // KHÔNG khôi phục tab lần trước (5 = mở trang mới) → hết cảnh tab dồn 10+ mỗi lần mở.
      if (!j.session) j.session = {};
      j.session.restore_on_startup = 5;
      j.session.startup_urls = [];
      fs.writeFileSync(pref, JSON.stringify(j));
    } catch {}
  }
}
// Xoá các file lưu phiên/tab của Chrome → lần mở sau KHÔNG bung lại tab cũ.
function wipeSessions(id) {
  const dir = profileDir(id);
  for (const rel of ['Default/Current Session', 'Default/Current Tabs', 'Default/Last Session', 'Default/Last Tabs']) {
    try { fs.unlinkSync(path.join(dir, rel)); } catch {}
  }
  try { fs.rmSync(path.join(dir, 'Default', 'Sessions'), { recursive: true, force: true }); } catch {}
}

async function closeChrome(id) {
  const r = running.get(id);
  if (r) {
    // Đóng ÊM qua CDP trước (Chrome tự ghi "thoát sạch" → không có bong bóng khôi phục ở lần mở sau).
    try { if (r.cdp) { await r.cdp.send('Browser.close', {}); await sleep(500); } } catch {}
    try { r.cdp && r.cdp.close(); } catch {}
    try { r.proc && r.proc.kill(); } catch {}
    running.delete(id);
  }
  killProfileChrome(id);   // lưới an toàn: tắt HẲN mọi tiến trình còn sót → không tab dưới dock
  markCleanExit(id);       // chắc ăn: nếu phải kill cứng thì vẫn đánh dấu thoát sạch cho lần sau
}

// Giải phóng profile trước khi mở: kill Chrome cũ còn giữ profile + xoá file cổng debug cũ + đánh dấu thoát sạch.
function freeProfile(id) {
  killProfileChrome(id);
  markCleanExit(id);
  wipeSessions(id);   // xoá tab phiên cũ → mở lên chỉ có đúng cửa sổ Flow mới, không dồn tab
  try { fs.unlinkSync(path.join(profileDir(id), 'DevToolsActivePort')); } catch {}
}

// Chỉ mở 1 Chrome tại một thời điểm (tránh nghẽn khi gen song song gọi ồ ạt).
let _openChain = Promise.resolve();
function openForOperation(id) {
  const run = () => _openForOperation(id);
  const p = _openChain.then(run, run);
  _openChain = p.catch(() => {});
  return p;
}
async function _openForOperation(id) {
  await closeChrome(id);
  freeProfile(id);          // kill Chrome cũ giữ profile + xoá cổng debug cũ
  await sleep(800);         // chờ hệ điều hành nhả khoá profile
  const proc = launchChrome(id, { debug: true });
  if (!proc) throw new Error('Không tìm thấy Chrome trên máy (cài Google Chrome trước).');
  running.set(id, { proc, port: null, cdp: null });   // track sớm để dọn được nếu lỗi
  try {
    const port = await readDevToolsPort(profileDir(id));
    const wsUrl = await flowPageWs(port);
    const cdp = await cdpConnect(wsUrl);
    await cdp.send('Page.enable', {});
    await cdp.send('Network.enable', {});
    await cdp.send('Runtime.enable', {});
    const rec = { proc, port, cdp, videoUrls: [] };
    // Gắn listener TỪ TRƯỚC khi navigate → bắt luôn: (a) URL file video cho resolve, (b) token ya29 ngay LẦN TẢI ĐẦU (captureToken khỏi phải reload lần nữa + chờ 3.5s).
    cdp.on((m) => {
      if (m.method !== 'Network.requestWillBeSent') return;
      const req = m.params.request || {};
      const u = req.url;
      if (u && /(flow-content\.google|\/video\/|googlevideo|videoplayback)/i.test(u)) { rec.videoUrls.push({ url: u, at: Date.now() }); if (rec.videoUrls.length > 24) rec.videoUrls.shift(); }
      const auth = (req.headers && (req.headers.Authorization || req.headers.authorization)) || '';
      if (typeof auth === 'string' && auth.startsWith('Bearer ya29.')) cdp._earlyYa29 = auth.slice(7).trim();
    });
    running.set(id, rec);
    try { await cdp.send('Page.navigate', { url: FLOW_URL }); await sleep(2500); } catch {}   // navigate SAU khi gắn listener → request auth (ya29) được bắt ngay
    // Thu nhỏ cửa sổ cho gọn (gen dựa trên fetch/JS nên vẫn chạy khi minimize).
    try { const w = await cdp.send('Browser.getWindowForTarget', {}); if (w && w.windowId) await cdp.send('Browser.setWindowBounds', { windowId: w.windowId, bounds: { windowState: 'minimized' } }); } catch {}
    return rec;
  } catch (e) {
    try { proc.kill(); } catch {}
    running.delete(id);
    throw e;
  }
}

// Lấy token. Ưu tiên token ĐẦY ĐỦ từ endpoint /fx/api/auth/session (dài ~2000, như đối thủ —
// chạy được createProject cross-account); fallback token ya29 ngắn bắt từ webRequest.
async function captureToken(cdp, ms = 22000) {
  // Token bắt SỚM lúc openForOperation tải trang lần đầu (dùng 1 lần) → khỏi reload + chờ 3.5s.
  let ya29 = (cdp && cdp._earlyYa29) || null;
  if (cdp) { try { delete cdp._earlyYa29; } catch {} }   // xoá sau khi lấy: lần bắt sau (cache stale) phải reload lấy token tươi
  cdp.on((m) => {
    if (m.method === 'Network.requestWillBeSent') {
      const h = (m.params.request && m.params.request.headers) || {};
      const auth = h.Authorization || h.authorization || '';
      if (typeof auth === 'string' && auth.startsWith('Bearer ya29.')) ya29 = auth.slice(7).trim();
    }
  });
  if (!ya29) {
    // Chưa bắt được token sớm (SPA tải chậm) → reload để kích hoạt request auth rồi bắt (đường cũ).
    try { await cdp.send('Page.reload', { ignoreCache: false }); } catch {}
    await sleep(3500);   // chờ SPA boot
  } else {
    await sleep(600);    // đã có token sớm + trang đã tải → chỉ chờ nhẹ cho SPA sẵn sàng fetch session (token 24h)
  }
  // Đợi trang tải xong (readyState=complete) trước khi fetch — tránh evaluate treo do SPA chưa sẵn sàng (Windows hay bị).
  for (let i = 0; i < 12; i++) {
    if (ya29) break;
    try { const rs = await evalInPageT(cdp, 'document.readyState', 3500); if (rs === 'complete') break; } catch {}
    await sleep(500);
  }
  // Token từ endpoint /fx/api/auth/session — field access_token + expires (~24h, đúng như đối thủ).
  _lastTokenExpiry = null;
  for (let i = 0; i < 2; i++) {   // 2 lần đủ: treo lần 1 mà có ya29 là bail luôn; vòng ngoài (loginAuto/reloginAuto) còn retry verifyAccount → khỏi phí 3×10s
    try {
      // FAIL NHANH 10s: treo là bỏ, thử lại ngay (không đứng chờ 45s).
      const info = await evalInPageT(cdp, `(async()=>{try{const c=new AbortController();const t=setTimeout(()=>c.abort(),7000);const r=await fetch('https://labs.google/fx/api/auth/session',{credentials:'include',signal:c.signal});clearTimeout(t);const d=await r.json();return {expires:(d&&d.expires)||null, token:(d&&d.access_token)||null};}catch(e){return {err:String(e&&e.message||e)};}})()`, 10000);
      if (info && info.token && String(info.token).length > 100) {
        _lastTokenExpiry = info.expires ? (Date.parse(info.expires) || null) : null;
        LOG('✓ token (session) len', String(info.token).length, '· hết hạn', info.expires || '?');
        return info.token;
      }
      if (info && info.err) LOG('session fetch:', info.err);
    } catch (e) {
      LOG('session fetch lỗi', e && e.message);
      if (/WS_CLOSED/.test(String(e && e.message))) break;   // kết nối chết → khỏi cố, dùng ya29 nếu có
    }
    // Đã bắt được ya29 từ network + session vừa lỗi 1 lần → dùng ya29 luôn (Windows session hay treo, ya29 vẫn gen tốt).
    if (ya29 && i >= 0) { LOG('dùng token ya29 (webRequest) len', ya29.length, '— session chập chờn, khỏi đợi thêm'); return ya29; }
    await sleep(1500);
  }
  // Fallback cuối: chờ ya29 xuất hiện.
  const t0 = Date.now();
  while (!ya29 && Date.now() - t0 < Math.min(ms, 8000)) await sleep(300);
  if (ya29) LOG('token ya29 (webRequest) len', ya29.length);
  return ya29 || null;
}
async function readCookies(cdp) { try { const r = await cdp.send('Network.getAllCookies', {}); return (r && r.cookies) || []; } catch { return []; } }
function cookieExpiryOf(cookies) {
  const gg = (cookies || []).filter((c) => /google\.com$/.test((c.domain || '').replace(/^\./, '')) && c.expires > 0);
  // Cookie đăng nhập BỀN (sống ~2 năm) — KHÔNG lấy *SIDTS (cookie xoay vòng ngắn ~1 ngày, Google tự làm mới) để hạn cookie không bị hiện ngắn giả.
  const durable = gg.filter((c) => /^(SID|SSID|HSID|SAPISID|APISID|__Secure-1PSID|__Secure-3PSID|LSID)$/.test(c.name));
  const pick = durable.length ? durable : gg.filter((c) => /^__Secure-\dPSID$/.test(c.name));   // dự phòng nếu chưa thấy cookie bền
  return pick.length ? Math.round(Math.min(...pick.map((c) => c.expires)) * 1000) : null;
}
// Gọi API Flow bằng fetch TRONG trang (đúng origin/cookie, vân tay Chrome thật).
async function apiFetch(cdp, { url, method = 'GET', headers = {}, body = null }) {
  const expr = `(async()=>{try{const r=await fetch(${JSON.stringify(url)},{method:${JSON.stringify(method)},headers:${JSON.stringify(headers)},body:${body == null ? 'null' : JSON.stringify(body)},credentials:'include'});const t=await r.text();return{ok:r.ok,status:r.status,text:t};}catch(e){return{ok:false,status:0,text:String(e&&e.message||e)};}})()`;
  return await evalInPage(cdp, expr);
}

// ── Đăng nhập (không debug) ───────────────────────────────────────────
let _login = null;   // { id, proc }
let _busy = false;   // đang có thao tác Chrome (đăng nhập lại / lấy token) → chặn thao tác khác xen vào
function loginStart() {
  // id tạm cho profile mới — dùng timestamp để không đụng account cũ.
  const id = 'new-' + Date.now();
  const proc = launchChrome(id, { debug: false });
  if (!proc) return { error: 'Không tìm thấy Chrome trên máy. Cài Google Chrome rồi thử lại.' };
  _login = { id, proc };
  return { ok: true, id };
}
function loginCancel() { if (_login) { try { _login.proc.kill(); } catch {} _login = null; } return { ok: true }; }

// User báo đã đăng nhập xong (nên đã đóng cửa sổ) → verify bằng debug → LƯU account.
async function loginFinish(tempId) {
  if (_login && _login.id === tempId) { try { _login.proc.kill(); } catch {} _login = null; }
  await sleep(1500);   // chờ Chrome cũ nhả profile
  if (!profileLoggedIn(tempId)) return { error: 'Chưa thấy dữ liệu đăng nhập trong profile — bạn đã đăng nhập Google chưa?' };
  const v = await verifyAccount(tempId);
  if (v.error) return v;
  // Lưu: cấp id bền, đổi tên thư mục profile new-… → acc-<id>.
  const id = nextId++;
  try { fs.renameSync(profileDir(tempId), profileDir(id)); }
  catch (e) { return { error: 'Lưu profile lỗi: ' + (e.message || e) }; }
  const _tkNew = tokens.get(tempId); if (_tkNew) { tokens.set(id, _tkNew); tokens.delete(tempId); }   // giữ token vừa bắt cho id thật → HOẠT ĐỘNG ngay
  accounts.set(id, { id, email: v.email || null, tier: v.tier || null, credits: v.credits ?? null, cookieExpiry: v.cookieExpiry || null, enabled: true, proxy: null });
  order.push(id); persist();
  LOG('đã lưu account Chrome', id, v.email || '');
  return { ok: true, id, email: v.email, tier: v.tier, credits: v.credits, saved: true };
}
// Đăng nhập LẠI tại chỗ (giữ id/email/proxy) — mở đúng profile cũ bằng Chrome for Testing.
// Dùng khi đổi trình duyệt (Chrome thường → CfT) khiến cookie cũ không giải mã được.
function reloginStart(id) {
  if (!accounts.has(id)) return { error: 'NO_ACC' };
  freeProfile(id);
  // Xoá profile cũ → đăng nhập lại SẠCH (tránh xung đột cookie/phiên bản Chrome cũ). launchChrome tự tạo lại thư mục.
  try { fs.rmSync(profileDir(id), { recursive: true, force: true }); } catch {}
  const proc = launchChrome(id, { debug: false });
  if (!proc) return { error: 'Không mở được Chrome for Testing.' };
  _login = { id, proc, relogin: true };
  return { ok: true, id };
}
async function reloginFinish(id) {
  if (_login && _login.id === id) { try { _login.proc.kill(); } catch {} _login = null; }
  killProfileChrome(id);
  await sleep(1500);   // chờ nhả profile
  const v = await verifyAccount(id);
  if (v.error) return v;
  const a = accounts.get(id);
  if (v.email) a.email = v.email; if (v.tier) a.tier = v.tier;
  if (v.credits != null) a.credits = v.credits; if (v.cookieExpiry) a.cookieExpiry = v.cookieExpiry;
  a.needLogin = false; persist();
  LOG('đăng nhập lại xong acc', id, a.email || '');
  return { ok: true, id, email: a.email, credits: a.credits };
}

// Đã đăng nhập Google trong profile chưa? — đọc account_info trong Preferences (JSON thường, không cần giải mã, chạy cả Win/Mac).
function profileHasGoogleAccount(id) {
  for (const rel of ['Default/Preferences', 'Preferences']) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(profileDir(id), rel), 'utf8'));
      if (Array.isArray(j.account_info) && j.account_info.length > 0) return true;
    } catch {}
  }
  return false;
}

// Đóng ÊM (SIGTERM) rồi CHỜ Chrome thoát hẳn để nó GHI COOKIE PHIÊN ra đĩa.
// (Kill cứng ngay sẽ mất login vừa nhập vì Chrome giữ cookie trong RAM, chỉ ghi khi thoát êm.)
async function gracefulQuit(proc, id) {
  await new Promise((res) => {
    let done = false; const fin = () => { if (done) return; done = true; res(); };
    try { proc.on('exit', fin); proc.on('close', fin); } catch {}
    try {
      if (process.platform === 'win32' && proc.pid) {
        // Windows KHÔNG có SIGTERM thật (proc.kill = tắt cứng) → taskkill KHÔNG /F gửi WM_CLOSE → Chrome thoát êm, kịp ghi cookie.
        require('child_process').execFile('taskkill', ['/PID', String(proc.pid), '/T'], () => {});
      } else {
        proc.kill('SIGTERM');
      }
    } catch { fin(); }
    setTimeout(() => { try { killProfileChrome(id); } catch {} fin(); }, 10000);   // quá 10s mới kill cứng
  });
  await sleep(2000);   // chờ ghi nốt xuống đĩa
}

// Đăng nhập lại TỰ ĐỘNG: mở CfT → user đăng nhập → app TỰ nhận biết (poll account_info) → tự đóng + bắt token.
// KHÔNG cần bấm OK, KHÔNG cần tự đóng cửa sổ.
async function reloginAuto(id, onProgress) {
  if (!accounts.has(id)) return { error: 'NO_ACC' };
  if (_busy) return { error: 'Đang bận một thao tác Chrome khác — thử lại sau vài giây.' };
  _busy = true;   // KHOÁ: chặn auto-refresh / thao tác khác xen vào cùng profile (tránh mở chồng tab)
  try {
    freeProfile(id);
    try { fs.rmSync(profileDir(id), { recursive: true, force: true }); } catch {}
    const proc = launchChrome(id, { debug: false });   // ĐĂNG NHẬP phải mở cửa sổ KHÔNG debug — có --remote-debugging-port thì Google chặn "trình duyệt không an toàn". Bắt token ở bước mở lại (có debug) phía sau.
    if (!proc) return { error: 'Không mở được Chrome for Testing.' };
    _login = { id, proc, relogin: true };
    let procDead = false; proc.on('exit', () => { procDead = true; }); proc.on('close', () => { procDead = true; });
    LOG('acc', id, '→ mở CfT, chờ bạn đăng nhập Google (app tự nhận biết, không cần bấm gì)…');
    // Poll tới khi thấy đăng nhập (account_info) hoặc user tự đóng cửa sổ, tối đa 5 phút.
    const deadline = Date.now() + 5 * 60 * 1000;
    let loggedIn = false;
    while (Date.now() < deadline) {
      await sleep(2500);
      if (profileHasGoogleAccount(id)) { loggedIn = true; break; }
      if (procDead) { loggedIn = profileHasGoogleAccount(id); break; }   // user đóng cửa sổ → kiểm tra lần cuối
    }
    // ĐÓNG ÊM cửa sổ đăng nhập để Chrome ghi cookie phiên ra đĩa (không kill cứng kẻo mất login vừa nhập).
    const loginProc = _login && _login.proc; _login = null;
    if (loginProc) { LOG('acc', id, '→ đang đóng êm cửa sổ đăng nhập để lưu phiên…'); await gracefulQuit(loginProc, id); }
    markCleanExit(id);
    if (!loggedIn) return { error: 'Chưa thấy bạn đăng nhập (hết 5 phút chờ). Bấm 🔑 thử lại và đăng nhập Google trong cửa sổ vừa mở.' };
    LOG('acc', id, '→ đã nhận biết đăng nhập, đang bắt token…');
    await sleep(2000);   // chờ phiên vừa login "ấm" (gracefulQuit đã chờ ~2s ghi cookie nên khỏi cần 4s)
    let v = null; for (let i = 0; i < 2; i++) { v = await verifyAccount(id); if (!v.error) break; LOG('acc', id, 'bắt token chưa được, thử lại…'); await sleep(3000); }
    if (v.error) return v;
    const a = accounts.get(id);
    if (v.email) a.email = v.email; if (v.tier) a.tier = v.tier;
    if (v.credits != null) a.credits = v.credits; if (v.cookieExpiry) a.cookieExpiry = v.cookieExpiry;
    a.needLogin = false; persist();
    LOG('✅ đăng nhập lại xong acc', id, a.email || '');
    return { ok: true, id, email: a.email, credits: a.credits };
  } finally { _busy = false; }
}
// Thêm tài khoản MỚI tự động: mở CfT → user đăng nhập → tự nhận biết (account_info) → đóng êm → bắt token → LƯU.
async function loginAuto() {
  if (_busy) return { error: 'Đang bận thao tác Chrome khác — thử lại sau vài giây.' };
  _busy = true;
  const tempId = 'new-' + Date.now();
  try {
    const proc = launchChrome(tempId, { debug: false });   // ĐĂNG NHẬP phải mở cửa sổ KHÔNG debug — có cờ --remote-debugging-port thì Google chặn "trình duyệt không an toàn". Bắt token ở bước mở lại (có debug) phía sau.
    if (!proc) return { error: 'Không mở được Chrome for Testing.' };
    _login = { id: tempId, proc };
    let procDead = false; proc.on('exit', () => { procDead = true; }); proc.on('close', () => { procDead = true; });
    LOG('→ mở CfT thêm tài khoản mới, chờ bạn đăng nhập Google (app tự nhận biết)…');
    const deadline = Date.now() + 5 * 60 * 1000; let ok = false;
    while (Date.now() < deadline) { await sleep(2500); if (profileHasGoogleAccount(tempId)) { ok = true; break; } if (procDead) { ok = profileHasGoogleAccount(tempId); break; } }
    const lp = _login && _login.proc; _login = null;
    if (lp) { LOG('→ đóng êm cửa sổ đăng nhập để lưu phiên…'); await gracefulQuit(lp, tempId); }
    markCleanExit(tempId);
    if (!ok) { try { fs.rmSync(profileDir(tempId), { recursive: true, force: true }); } catch {} return { error: 'Chưa thấy bạn đăng nhập (hết 5 phút chờ).' }; }
    LOG('→ đã nhận biết đăng nhập, đang bắt token…');
    await sleep(2000);   // chờ phiên vừa login "ấm" (gracefulQuit đã chờ ~2s ghi cookie nên khỏi cần 4s)
    let v = null; for (let i = 0; i < 2; i++) { v = await verifyAccount(tempId); if (!v.error) break; await sleep(3000); }
    if (v.error) { try { fs.rmSync(profileDir(tempId), { recursive: true, force: true }); } catch {} return v; }
    const id = nextId++;
    try { fs.renameSync(profileDir(tempId), profileDir(id)); } catch (e) { return { error: 'Lưu profile lỗi: ' + (e.message || e) }; }
    const _tkNew = tokens.get(tempId); if (_tkNew) { tokens.set(id, _tkNew); tokens.delete(tempId); }   // giữ token vừa bắt cho id thật → HOẠT ĐỘNG ngay, khỏi mở Chrome lại
    accounts.set(id, { id, email: v.email || null, tier: v.tier || null, credits: v.credits ?? null, cookieExpiry: v.cookieExpiry || null, enabled: true, proxy: null, useImage: true, useVideo: true });
    order.push(id); persist();
    LOG('✅ đã thêm tài khoản', id, v.email || '');
    return { ok: true, id, email: v.email, tier: v.tier, credits: v.credits, saved: true };
  } finally { _busy = false; }
}
function setEnabled(id, en) { const a = accounts.get(id); if (!a) return { error: 'NO_ACC' }; a.enabled = !!en; persist(); return { ok: true }; }
function setProxy(id, proxy) { const a = accounts.get(id); if (!a) return { error: 'NO_ACC' }; a.proxy = proxy || null; persist(); return { ok: true }; }
function removeAccount(id) {
  if (!accounts.has(id)) return { error: 'NO_ACC' };
  closeChrome(id);
  try { fs.rmSync(profileDir(id), { recursive: true, force: true }); } catch {}
  accounts.delete(id); order = order.filter((x) => x !== id); persist();
  return { ok: true };
}
// Làm mới 1 account đã lưu (mở lại có debug → cập nhật token/credits/hạn).
async function refreshOne(id) {
  if (!accounts.has(id)) return { error: 'NO_ACC' };
  const v = await verifyAccount(id);
  if (v.error) return v;
  const a = accounts.get(id);
  if (v.email) a.email = v.email; if (v.tier) a.tier = v.tier;
  if (v.credits != null) a.credits = v.credits; if (v.cookieExpiry) a.cookieExpiry = v.cookieExpiry;
  persist();
  return { ok: true, id, email: a.email, credits: a.credits };
}

// ── Verify (GĐ1): mở có debug → token + cookie + credits + email ───────
// Thân chung: đã có cdp (dù mở mới hay gắn vào cửa sổ đang mở) → bắt token + email + credits.
async function _verifyBody(id, cdp) {
  LOG('acc', id, 'đang bắt token…');
  const token = await captureToken(cdp);
  if (!token) {
    // Mở được Chrome điều khiển nhưng KHÔNG ra token → profile đã ĐĂNG XUẤT (Flow bắt đăng nhập lại).
    // Bật needLogin + BỎ token cache cũ để UI báo "CẦN ĐN LẠI" thay vì "HOẠT ĐỘNG" ảo.
    const a = accounts.get(id); if (a) { a.needLogin = true; persist(); }
    tokens.delete(id);
    return { error: 'Không bắt được token — profile có thể chưa đăng nhập, hoặc còn cửa sổ Chrome cũ chưa đóng.', needLogin: true };
  }
  const a0 = accounts.get(id); if (a0 && a0.needLogin) { a0.needLogin = false; }   // bắt được token → đã đăng nhập lại
  // Lưu token vào map NGAY → account hiện "còn hạn" liền (trước đây verify xong token bị bỏ đi → UI báo HẾT HẠN oan tới tận lần gen đầu).
  tokens.set(id, { token, at: Date.now(), expiry: _lastTokenExpiry });
  // Sau khi CÓ TOKEN (thứ cốt lõi): cookies/credits/email chỉ là PHỤ → nếu CDP đóng giữa chừng (WS_CLOSED) cũng
  // KHÔNG hủy token, KHÔNG throw (tránh verifyAccount báo lỗi → loginAuto retry CẢ VÒNG, chậm gấp đôi). Lấy được gì hay nấy.
  let credits = null, tier = null, email = null, cookieExpiry = null, crStatus = null;
  try { cookieExpiry = cookieExpiryOf(await readCookies(cdp)); } catch (e) { LOG('acc', id, 'cookie (bỏ qua):', e && e.message); }
  try {
    const em = await evalInPageT(cdp, `(async()=>{try{const c=new AbortController();const t=setTimeout(()=>c.abort(),6000);const r=await fetch('https://labs.google/fx/api/auth/session',{credentials:'include',signal:c.signal});clearTimeout(t);const d=await r.json();return (d&&d.user&&d.user.email)||null;}catch(e){return null;}})()`, 9000);
    if (em) email = em;
  } catch {}
  try {
    const cr = await apiFetch(cdp, { url: FLOW_API_BASE + '/v1/credits?key=' + encodeURIComponent(FLOW_API_KEY), method: 'GET', headers: { authorization: 'Bearer ' + token } });
    crStatus = cr.status;
    if (cr.ok) { try { const d = JSON.parse(cr.text); if (typeof d.credits === 'number') credits = d.credits; if (d.userPaygateTier === 'PAYGATE_TIER_ONE' || d.userPaygateTier === 'PAYGATE_TIER_TWO') tier = d.userPaygateTier; if (!email && (d.email || d.userEmail)) email = d.email || d.userEmail; } catch {} }
    if (!email) { const ui = await apiFetch(cdp, { url: 'https://www.googleapis.com/oauth2/v2/userinfo', method: 'GET', headers: { authorization: 'Bearer ' + token } }); if (ui.ok) { try { const d = JSON.parse(ui.text); if (d.email) email = d.email; } catch {} } }
  } catch (e) { LOG('acc', id, 'credits/email (bỏ qua):', e && e.message); }
  LOG('acc', id, '→ ✓ token OK · credits', credits, '· tier', tier, '· email', email, '· creditsHTTP', crStatus);
  return { ok: true, id, hasToken: true, token, tokenExpiry: _lastTokenExpiry, credits, tier, email, cookieExpiry, creditsStatus: crStatus };
}
async function verifyAccount(id) {
  let op;
  try { op = await openForOperation(id); }
  catch (e) { return { error: 'Mở Chrome điều khiển lỗi: ' + (e.message || e) }; }
  try {
    return await _verifyBody(id, op.cdp);
  } catch (e) { return { error: 'Verify lỗi: ' + (e.message || e) }; }
  finally { await closeChrome(id); }   // GĐ1: đóng lại cho gọn (GĐ2 sẽ giữ mở để chạy gen)
}

// ── Giữ Chrome sống + token (cho gen) ─────────────────────────────────
const tokens = new Map();     // id -> { token, at, expiry }
let _lastTokenExpiry = null;  // hạn thật của token vừa bắt (từ field expires của session, ~24h)
const _liveLocks = new Map();  // id -> Promise (chống mở trùng khi gen song song)
function ensureLive(id) {
  if (_liveLocks.has(id)) return _liveLocks.get(id);
  const p = (async () => {
    let rec = running.get(id);
    if (rec && rec.cdp) {
      const t = tokens.get(id);
      if (t && Date.now() - t.at < 45 * 60 * 1000) return { cdp: rec.cdp, token: t.token };
      try { const tok = await captureToken(rec.cdp, 12000); if (tok) { tokens.set(id, { token: tok, at: Date.now(), expiry: _lastTokenExpiry }); return { cdp: rec.cdp, token: tok }; } } catch {}
    }
    rec = await openForOperation(id);
    const tok = await captureToken(rec.cdp);
    if (!tok) { await closeChrome(id); throw new Error('Không bắt được token (profile chưa đăng nhập?)'); }
    tokens.set(id, { token: tok, at: Date.now(), expiry: _lastTokenExpiry });
    return { cdp: rec.cdp, token: tok };
  })();
  _liveLocks.set(id, p);
  p.then(() => _liveLocks.delete(id), () => _liveLocks.delete(id));   // dọn khóa, không tạo rejection lạc
  return p;
}
// ── CHẾ ĐỘ NHẸ (như đối thủ): 1 Chrome "máy captcha" dùng chung + token của TỪNG account ──
let _captchaId = null;
// XOAY máy captcha (như đối thủ): sau N token HOẶC khi gặp "unusual activity" → đổi sang profile
// account KHÁC → reset điểm reCAPTCHA + đi proxy khác của account đó. Chỉ 1 account thì mở lại phiên mới.
let _capTokenCount = 0, _capRotatePending = false;
const MAX_CAP_PER_SESSION = 30;
// Chế độ máy captcha: 'guest' (như G-Labs: profile TRỐNG dùng-1-lần, không đụng account) | 'account' (xoay account thật).
let _capMode = 'guest';
const _capModeFile = () => path.join(app.getPath('userData'), 'chrome-accounts', 'captcha-mode.txt');
function _loadCapMode() { try { const m = fs.readFileSync(_capModeFile(), 'utf8').trim(); if (m === 'account' || m === 'guest') _capMode = m; } catch {} }
function setCaptchaMode(m) { _capMode = (m === 'account') ? 'account' : 'guest'; try { fs.mkdirSync(path.dirname(_capModeFile()), { recursive: true }); fs.writeFileSync(_capModeFile(), _capMode); } catch {} return { ok: true, mode: _capMode }; }
function getCaptchaMode() { return _capMode; }
function rotateCaptcha() { _capRotatePending = true; _guestRotatePending = true; }   // flow-native gọi khi thấy UNUSUAL_ACTIVITY
function _pickCaptchaId(exclude) {
  for (const id of order) { const a = accounts.get(id); if (a && a.enabled !== false && id !== exclude) return id; }
  for (const id of order) { const a = accounts.get(id); if (a && a.enabled !== false) return id; }
  return null;
}
async function ensureCaptcha() {
  // Xoay nếu cần: đủ N token hoặc bị nghi → đổi máy captcha (đóng cũ, chọn account khác).
  if (_captchaId != null && (_capRotatePending || _capTokenCount >= MAX_CAP_PER_SESSION)) {
    const old = _captchaId, why = _capRotatePending ? 'unusual-activity' : ('đủ ' + MAX_CAP_PER_SESSION + ' token');
    _capRotatePending = false; _capTokenCount = 0;
    const next = _pickCaptchaId(old);
    try { await closeChrome(old); } catch {}
    _captchaId = (next != null) ? next : old;   // nhiều account → đổi; 1 account → mở lại chính nó (phiên mới)
    LOG('xoay máy captcha (' + why + '):', old, '→', _captchaId);
  }
  // Nhanh: máy captcha đang chạy sẵn.
  if (_captchaId != null && accounts.has(_captchaId) && running.has(_captchaId)) { try { return await ensureLive(_captchaId); } catch {} }
  // Mở đúng _captchaId đã chọn (kể cả vừa xoay) trước khi rơi về account khác.
  if (_captchaId != null) { const a = accounts.get(_captchaId); if (a && a.enabled !== false) { try { const live = await ensureLive(_captchaId); LOG('máy captcha = account', _captchaId); return live; } catch (e) { LOG('máy captcha', _captchaId, 'lỗi, thử account khác:', e && e.message); } } }
  for (const id of order) { const a = accounts.get(id); if (a && a.enabled !== false) { try { const live = await ensureLive(id); _captchaId = id; LOG('máy captcha = account', id); return live; } catch (e) { LOG('account', id, 'không làm captcha được:', e && e.message); } } }
  throw new Error('Chưa có account Chrome nào để làm máy captcha');
}

// ── MÁY CAPTCHA GUEST (như G-Labs) — Chrome profile TRỐNG (không login) mint token reCAPTCHA. ──
// Đã test: guest vào labs.google/fx/tools/flow không bị bắt login, grecaptcha.enterprise.execute ra token
// đầy đủ (~2318 ký tự). Token tách rời account → ghép cookie+Bearer account thật khi gen. Xoay profile
// guest mới + proxy khác sau N token / khi bị nghi → điểm reCAPTCHA luôn tươi, KHÔNG đốt account thật.
let _guest = null, _guestRotatePending = false, _guestProxyIdx = 0, _guestOpening = null;
function _guestProxies() { const ps = []; for (const id of order) { const a = accounts.get(id); if (a && a.proxy) ps.push(a.proxy); } return ps; }
function _launchGuest(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const args = [`--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check', '--no-service-autorun', '--disable-sync', '--hide-crash-restore-bubble', '--disable-session-crashed-bubble', '--no-restore-session-state', '--remote-debugging-port=0'];
  const ps = _guestProxies(); if (ps.length) { const p = ps[_guestProxyIdx++ % ps.length]; args.push('--proxy-server=' + p); LOG('máy captcha guest đi proxy', p); }
  args.push('--new-window', FLOW_URL);
  const chrome = findChrome(); if (!chrome) return null;
  return spawn(chrome, args, { detached: false });
}
async function _closeGuest() {
  const g = _guest; _guest = null; if (!g) return;
  try { if (g.cdp) { await g.cdp.send('Browser.close', {}); await sleep(300); } } catch {}
  try { g.proc.kill('SIGKILL'); } catch {}
  try { require('child_process').execFileSync(process.platform === 'win32' ? 'powershell' : 'pkill', process.platform === 'win32' ? ['-NoProfile', '-Command', `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${g.dir}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`] : ['-f', 'user-data-dir=' + g.dir], { stdio: 'ignore', timeout: 4000 }); } catch {}
  try { fs.rmSync(g.dir, { recursive: true, force: true }); } catch {}   // xoá profile guest — dùng 1 lần rồi bỏ
}
async function _openGuest() {
  const dir = path.join(app.getPath('userData'), 'chrome-captcha-guest', 'g-' + Date.now());
  const proc = _launchGuest(dir);
  if (!proc) throw new Error('Không tìm thấy Chrome (cần cài Google Chrome / CFT).');
  const g = { proc, dir, port: null, cdp: null, tokens: 0 }; _guest = g;
  try {
    const port = await readDevToolsPort(dir);
    const cdp = await cdpConnect(await flowPageWs(port));
    await cdp.send('Page.enable', {}); await cdp.send('Runtime.enable', {});
    g.port = port; g.cdp = cdp;
    try { await cdp.send('Page.navigate', { url: FLOW_URL }); } catch {}
    // Chờ grecaptcha sẵn sàng (guest không login vẫn có — đã test).
    try { await evalInPageT(cdp, `(async()=>{const s=Date.now();while(!(window.grecaptcha&&window.grecaptcha.enterprise&&window.grecaptcha.enterprise.execute)){if(Date.now()-s>20000)return false;await new Promise(r=>setTimeout(r,300));}return true;})()`, 22000); } catch {}
    try { const w = await cdp.send('Browser.getWindowForTarget', {}); if (w && w.windowId) await cdp.send('Browser.setWindowBounds', { windowId: w.windowId, bounds: { windowState: 'minimized' } }); } catch {}
    LOG('máy captcha GUEST sẵn sàng');
    return g;
  } catch (e) { try { proc.kill(); } catch {} _guest = null; throw e; }
}
async function ensureGuestCaptcha() {
  if (_guest && (_guestRotatePending || _guest.tokens >= MAX_CAP_PER_SESSION)) {
    LOG('xoay máy captcha GUEST (' + (_guestRotatePending ? 'unusual-activity' : ('đủ ' + MAX_CAP_PER_SESSION + ' token')) + ')');
    _guestRotatePending = false; await _closeGuest();
  }
  if (_guest && _guest.cdp) return _guest;
  if (!_guestOpening) _guestOpening = _openGuest().finally(() => { _guestOpening = null; });   // tránh mở chồng
  return await _guestOpening;
}

// Lấy token của 1 account: mở Chrome nó 1 NHỊP để bắt token rồi đóng (chỉ giữ máy captcha luôn mở).
async function getTokenFresh(id) {
  if (!accounts.has(id)) throw new Error('NO_ACC');
  if (_captchaId == null) _captchaId = id;   // account đầu tiên lấy token = luôn làm máy captcha (khỏi mở lại)
  const t = tokens.get(id);
  if (t && Date.now() - t.at < 45 * 60 * 1000) return t.token;
  const live = await ensureLive(id);
  const tok = live.token;
  if (id !== _captchaId) { try { await closeChrome(id); } catch {} }
  return tok;
}
// Lấy token + tạo project TRONG phiên riêng của account (project chui ĐÚNG account). Cache project_id.
async function getAccountData(id) {
  if (!accounts.has(id)) throw new Error('NO_ACC');
  const a = accounts.get(id);
  const live = await ensureLive(id);   // Chrome của CHÍNH account id → phiên riêng của nó
  const token = live.token;
  // Lấy EMAIL từ session endpoint (trả user.email) để hiện tên account thật thay "Chrome N".
  if (a && !a.email) {
    try {
      const em = await evalInPageT(live.cdp, `(async()=>{try{const c=new AbortController();const t=setTimeout(()=>c.abort(),6000);const r=await fetch('https://labs.google/fx/api/auth/session',{credentials:'include',signal:c.signal});clearTimeout(t);const d=await r.json();return (d&&d.user&&d.user.email)||null;}catch(e){return null;}})()`, 9000);
      if (em) { a.email = em; persist(); LOG('acc', id, 'email', em); }
    } catch {}
  }
  let projectId = a && a.projectId;
  if (!projectId && token) {
    try {
      const pr = await apiFetch(live.cdp, { url: TRPC_CREATE_PROJECT, method: 'POST', headers: { 'content-type': 'application/json', accept: '*/*', authorization: 'Bearer ' + token }, body: JSON.stringify({ json: { projectTitle: 'Nova pool', toolName: 'PINHOLE' } }) });
      let pd; try { pd = JSON.parse(pr.text); } catch { pd = null; }
      projectId = pd ? deepFindProjectId(pd) : null;
      if (projectId && a) { a.projectId = projectId; persist(); LOG('acc', id, 'project riêng', projectId); }
      else LOG('acc', id, 'tạo project lỗi:', String(pr.text).slice(0, 120));
    } catch (e) { LOG('acc', id, 'createProject lỗi', e && e.message); }
  }
  tokens.set(id, { token, at: Date.now(), expiry: _lastTokenExpiry });
  persist();   // lưu token + hạn xuống đĩa → tắt/mở app còn hạn thì xài lại, khỏi mở Chrome
  try { await closeChrome(id); } catch {}   // lấy xong ĐÓNG HẲN — không giữ cửa sổ nào (gen chạy ở extension)
  return { token, projectId };
}

async function pageEval(id, code) {   // gen chạy trên MÁY CAPTCHA; đếm token để xoay
  const isCap = /grecaptcha/.test(code);
  if (isCap && _capMode === 'guest') {
    try { const g = await ensureGuestCaptcha(); g.tokens++; return await evalInPage(g.cdp, code); }
    catch (e) { LOG('máy captcha GUEST lỗi → rơi về account:', e && e.message); }   // fallback an toàn
  }
  const { cdp } = await ensureCaptcha();
  if (isCap) _capTokenCount++;
  return evalInPage(cdp, code);
}
// Tải ảnh ở TIẾN TRÌNH CHÍNH (né CORS/referer của trang). URL flow-content.google đã ký sẵn
// (Expires+Signature) nên tải thẳng được; nếu cần cookie thì đính cookie google từ CDP.
async function pageFetchImage(id, url) {
  let cookieHeader = '';
  try {
    const cap = await ensureCaptcha();
    if (cap && cap.cdp) { const cks = await readCookies(cap.cdp); cookieHeader = (cks || []).filter((c) => /google/.test(c.domain || '')).map((c) => c.name + '=' + c.value).join('; '); }
  } catch {}
  return new Promise((resolve, reject) => {
    let done = false; const fin = (fn, v) => { if (!done) { done = true; fn(v); } };
    const req = net.request(url);
    if (cookieHeader) { try { req.setHeader('cookie', cookieHeader); } catch {} }
    req.on('response', (res) => {
      if (res.statusCode >= 400) { fin(reject, new Error('IMG_HTTP_' + res.statusCode)); return; }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { const buf = Buffer.concat(chunks); const b64 = buf.toString('base64'); let mime = res.headers['content-type'] || 'image/png'; if (Array.isArray(mime)) mime = mime[0]; fin(resolve, { dataUrl: 'data:' + mime + ';base64,' + b64, b64, mime }); });
      res.on('error', (e) => fin(reject, new Error(e.message || 'IMG_READ_FAILED')));
    });
    req.on('error', (e) => fin(reject, new Error(e.message || 'IMG_FETCH_FAILED')));
    req.end();
  });
}
function getToken(id) { const t = tokens.get(id); return t ? t.token : null; }

// ── Hàm thuần (copy từ flow-native để test độc lập, không đụng engine cũ) ──
const TRPC_CREATE_PROJECT = 'https://labs.google/fx/api/trpc/project.createProject';
const SITE_KEY = '6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV';
function genImageUrl(projectId) { return `${FLOW_API_BASE}/v1/projects/${projectId}/flowMedia:batchGenerateImages`; }
function cryptoRandomUUID() { try { return require('crypto').randomUUID(); } catch { return 'b-' + Date.now(); } }
function deepFindProjectId(o, d = 0) { if (!o || typeof o !== 'object' || d > 8) return null; if (typeof o.projectId === 'string' && o.projectId) return o.projectId; for (const k of Object.keys(o)) { const v = deepFindProjectId(o[k], d + 1); if (v) return v; } return null; }
function extractApiError(data) { const e = data && typeof data === 'object' ? data.error : null; if (!e || typeof e !== 'object') return null; const reason = (e.details || []).map((x) => x && x.reason).find(Boolean); const msg = e.message || e.status || 'API error'; return reason ? `${reason}: ${msg}` : String(msg); }
function extractApiError(data) { const e = data && typeof data === 'object' ? data.error : null; if (!e || typeof e !== 'object') return null; const reason = (e.details || []).map((x) => x && x.reason).find(Boolean); const msg = e.message || e.status || 'API error'; return reason ? `${reason}: ${msg}` : String(msg); }
function extractMediaEntries(data) { const media = (data && data.media) || (data && data.data && data.data.media); if (!Array.isArray(media)) return []; const out = []; for (const m of media) { if (!m || typeof m !== 'object') continue; const id = m.name; if (typeof id !== 'string' || !id) continue; let url = null; const gen = m.image && m.image.generatedImage; if (gen) url = gen.fifeUrl || gen.servingUri || gen.servingUrl || gen.url || null; if (!url) { const u = _vAnyUrl(m); if (u.length) url = u[u.length - 1]; } out.push({ media_id: id, url }); } return out; }
function buildImageBody({ prompt, projectId, aspect, modelName, tier, variantCount }) {
  const n = Math.max(1, Math.min(Number(variantCount) || 1, 4)); const ts = Date.now();
  const ctx = { projectId: String(projectId), recaptchaContext: { applicationType: 'RECAPTCHA_APPLICATION_TYPE_WEB', token: '' }, sessionId: `;${ts}`, tool: 'PINHOLE', userPaygateTier: tier };
  const requests = [];
  for (let i = 0; i < n; i++) requests.push({ clientContext: { ...ctx, recaptchaContext: { ...ctx.recaptchaContext }, sessionId: `;${ts + i}` }, seed: (ts + i * 9973) % 1000000, structuredPrompt: { parts: [{ text: prompt }] }, imageAspectRatio: aspect, imageModelName: modelName });
  return { clientContext: ctx, mediaGenerationContext: { batchId: cryptoRandomUUID() }, useNewMedia: true, requests };
}
function captchaCode(action) {
  return `(async () => {
    const s = Date.now();
    while (!(window.grecaptcha && window.grecaptcha.enterprise && window.grecaptcha.enterprise.execute)) { if (Date.now()-s>15000) throw new Error('grecaptcha not available'); await new Promise(r=>setTimeout(r,200)); }
    var key=null; try{ if(typeof ___grecaptcha_cfg!=='undefined'&&___grecaptcha_cfg.clients){ var cs=___grecaptcha_cfg.clients,ids=Object.keys(cs); outer:for(var i=0;i<ids.length;i++){var c=cs[ids[i]];for(var k in c){var o=c[k];if(o&&typeof o==='object')for(var k2 in o){var v=o[k2];if(v&&typeof v==='object'&&v.sitekey){key=v.sitekey;break outer;}}}} } }catch(e){}
    if(!key){ try{ var sc=document.querySelectorAll('script[src*="recaptcha"]'); for(var j=0;j<sc.length;j++){ var m=sc[j].src.match(/[?&]render=([^&]+)/); if(m&&m[1]&&m[1]!=='explicit'){ key=m[1]; break; } } }catch(e){} }
    if(!key)key=${JSON.stringify(SITE_KEY)};
    await new Promise(function(res){ try{ window.grecaptcha.enterprise.ready(res); }catch(e){ res(); } });   // chờ grecaptcha init xong
    return await Promise.race([
      window.grecaptcha.enterprise.execute(key,{action:${JSON.stringify(action)}}),
      new Promise(function(_,rej){ setTimeout(function(){ rej(new Error('CAPTCHA_TIMEOUT')); }, 25000); })   // chống treo vô hạn
    ]);
  })()`;
}

// Test tạo 1 ảnh trên 1 account Chrome (chứng minh gen qua CDP chạy).
async function genTest(id, prompt, tokenId) {
  if (!accounts.has(id)) return { error: 'NO_ACC' };
  let live; try { live = await ensureLive(id); } catch (e) { return { error: 'Mở Chrome lỗi: ' + (e.message || e) }; }
  const { cdp } = live; let token = live.token; let a = accounts.get(id);
  // TEST token-only: dùng Chrome của account `id` (chỉ để giải captcha) + TOKEN của account `tokenId`.
  if (tokenId && tokenId !== id && accounts.has(tokenId)) {
    try { const t2 = await ensureLive(tokenId); token = t2.token; await closeChrome(tokenId); a = accounts.get(tokenId); LOG('TEST token-only: Chrome acc', id, '+ token acc', tokenId); }
    catch (e) { return { error: 'Lấy token acc ' + tokenId + ' lỗi: ' + (e.message || e) }; }
  }
  try {
    LOG('acc', id, 'genTest: tạo project…');
    const pr = await apiFetch(cdp, { url: TRPC_CREATE_PROJECT, method: 'POST', headers: { 'content-type': 'application/json', accept: '*/*', authorization: 'Bearer ' + token }, body: JSON.stringify({ json: { projectTitle: 'Nova Chrome', toolName: 'PINHOLE' } }) });
    let pd; try { pd = JSON.parse(pr.text); } catch { pd = pr.text; }
    if (!pr.ok) return { error: 'PROJECT_' + pr.status + ': ' + (extractApiError(pd) || String(pr.text).slice(0, 150)) };
    const projectId = deepFindProjectId(pd);
    if (!projectId) return { error: 'NO_PROJECT_ID' };
    LOG('acc', id, 'genTest: giải captcha…');
    let capToken; try { capToken = await evalInPage(cdp, captchaCode('IMAGE_GENERATION')); } catch (e) { return { error: 'CAPTCHA: ' + (e.message || e) }; }
    if (!capToken) return { error: 'CAPTCHA_EMPTY' };
    const body = buildImageBody({ prompt, projectId, aspect: 'IMAGE_ASPECT_RATIO_LANDSCAPE', modelName: 'GEM_PIX_2', tier: a.tier || null, variantCount: 1 });
    body.clientContext.recaptchaContext.token = capToken;
    for (const rq of body.requests) { if (rq.clientContext && rq.clientContext.recaptchaContext) rq.clientContext.recaptchaContext.token = capToken; }
    LOG('acc', id, 'genTest: gọi batchGenerateImages…');
    const gr = await apiFetch(cdp, { url: genImageUrl(projectId), method: 'POST', headers: { 'content-type': 'text/plain;charset=UTF-8', accept: '*/*', authorization: 'Bearer ' + token }, body: JSON.stringify(body) });
    let gd; try { gd = JSON.parse(gr.text); } catch { gd = gr.text; }
    if (!gr.ok) return { error: 'GEN_' + gr.status + ': ' + (extractApiError(gd) || String(gr.text).slice(0, 150)) };
    const entries = extractMediaEntries(gd);
    if (!entries.length) LOG('acc', id, 'genTest 0 ảnh — Flow trả:', String(gr.text).slice(0, 500));
    LOG('acc', id, 'genTest → ✓', entries.length, 'ảnh; url0', entries[0] && String(entries[0].url).slice(0, 60));
    return { ok: entries.length > 0, count: entries.length, url: entries[0] && entries[0].url, raw: entries.length ? undefined : String(gr.text).slice(0, 300) };
  } catch (e) { return { error: 'genTest lỗi: ' + (e.message || e) }; }
}

// ═══════════ VIDEO — công thức bê từ extension (đã "học" request thật) ═══════════
const UPLOAD_IMAGE_URL = `${FLOW_API_BASE}/v1/flow/uploadImage`;
const DEFAULT_VIDEO = { "genText": { "url": "https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoText", "body": "{\"mediaGenerationContext\":{\"batchId\":\"\",\"audioFailurePreference\":\"BLOCK_SILENCED_VIDEOS\"},\"clientContext\":{\"projectId\":\"\",\"tool\":\"PINHOLE\",\"userPaygateTier\":\"PAYGATE_TIER_ONE\",\"sessionId\":\"\",\"recaptchaContext\":{\"token\":\"\",\"applicationType\":\"RECAPTCHA_APPLICATION_TYPE_WEB\"}},\"requests\":[{\"aspectRatio\":\"VIDEO_ASPECT_RATIO_LANDSCAPE\",\"textInput\":{\"structuredPrompt\":{\"parts\":[{\"text\":\"\"}]}},\"videoModelKey\":\"veo_3_1_t2v\",\"seed\":0,\"metadata\":{}}],\"useV2ModelConfig\":true}" }, "genImage": { "url": "https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoReferenceImages", "body": "{\"mediaGenerationContext\":{\"batchId\":\"\",\"audioFailurePreference\":\"BLOCK_SILENCED_VIDEOS\"},\"clientContext\":{\"projectId\":\"\",\"tool\":\"PINHOLE\",\"userPaygateTier\":\"PAYGATE_TIER_ONE\",\"sessionId\":\"\",\"recaptchaContext\":{\"token\":\"\",\"applicationType\":\"RECAPTCHA_APPLICATION_TYPE_WEB\"}},\"requests\":[{\"aspectRatio\":\"VIDEO_ASPECT_RATIO_LANDSCAPE\",\"textInput\":{\"structuredPrompt\":{\"parts\":[{\"text\":\"\"}]}},\"videoModelKey\":\"veo_3_1_r2v_lite\",\"seed\":0,\"metadata\":{},\"referenceImages\":[{\"mediaId\":\"\",\"imageUsageType\":\"IMAGE_USAGE_TYPE_ASSET\"}]}],\"useV2ModelConfig\":true}" }, "poll": { "url": "https://aisandbox-pa.googleapis.com/v1/video:batchCheckAsyncVideoGenerationStatus", "body": "{\"media\":[{\"name\":\"\",\"projectId\":\"\"}]}" }, "modelKeys": { "omni-flash": "abra_t2v_8s", "veo31-fast": "veo_3_1_t2v_fast", "veo31-lite": "veo_3_1_t2v_lite", "veo31-quality": "veo_3_1_t2v" } };
function _vDeepSet(o, pred, val) { if (!o || typeof o !== 'object') return; for (const k of Object.keys(o)) { if (pred(k)) o[k] = val; else if (o[k] && typeof o[k] === 'object') _vDeepSet(o[k], pred, val); } }
function _vDeepSet2(o, pred, fn) { if (!o || typeof o !== 'object') return; for (const k of Object.keys(o)) { if (pred(k)) o[k] = fn(o[k]); else if (o[k] && typeof o[k] === 'object') _vDeepSet2(o[k], pred, fn); } }
function _vSetPrompt(o, prompt) { (function w(x) { if (!x || typeof x !== 'object') return; if (x.structuredPrompt && Array.isArray(x.structuredPrompt.parts)) x.structuredPrompt.parts.forEach((p) => { if (p && 'text' in p) p.text = prompt; }); for (const k of Object.keys(x)) if (x[k] && typeof x[k] === 'object') w(x[k]); })(o); }
function _vAnyUrl(data) { const out = []; (function w(v) { if (!v) return; if (typeof v === 'string') { if (/^https?:\/\/\S{8,}/.test(v)) out.push(v); } else if (Array.isArray(v)) v.forEach(w); else if (typeof v === 'object') for (const k in v) w(v[k]); })(data); return out; }
const _VID_URL_RE = /(flow-content\.google|\/video\/|videoplayback|\.mp4)/i;
// Tìm ĐÚNG link video của mediaId trong cây JSON projectInitialData.
// URL phục vụ (fife/serving) KHÔNG chứa mediaId, nên phải khớp theo ENTRY (name===mediaId) rồi lấy URL trong entry đó.
function _findVideoUrlForMedia(d, mediaId) {
  if (!d || !mediaId) return null;
  const mid = String(mediaId);
  const hit = (v) => typeof v === 'string' && (v === mid || (mid.length >= 12 && v.includes(mid)));
  let found = null;
  (function w(o) {
    if (found || !o || typeof o !== 'object') return;
    if (Array.isArray(o)) { for (const x of o) { w(x); if (found) return; } return; }
    if (hit(o.name) || hit(o.mediaId) || hit(o.mediaGenerationId) || hit(o.id)) {
      const gv = (o.video && o.video.generatedVideo) || o.generatedVideo || null;
      let u = null;
      if (gv && typeof gv === 'object') u = gv.fifeUrl || gv.servingUri || gv.servingUrl || gv.url || gv.downloadUri || null;
      if (!u) { const arr = _vAnyUrl(o).filter((x) => _VID_URL_RE.test(x)); if (arr.length) u = arr[arr.length - 1]; }
      if (u) { found = u; return; }
    }
    for (const k in o) { w(o[k]); if (found) return; }
  })(d);
  return found;
}
function _vLearnedFor(imageMediaId) { return imageMediaId ? DEFAULT_VIDEO.genImage : DEFAULT_VIDEO.genText; }
function _vResolveModelKey(modelKey) { if (modelKey && DEFAULT_VIDEO.modelKeys[modelKey]) return DEFAULT_VIDEO.modelKeys[modelKey]; return modelKey; }
function _vBodyFromLearned({ prompt, projectId, imageMediaId, capToken, modelKey, durationSecs }) {
  const tpl = _vLearnedFor(imageMediaId); if (!tpl || !tpl.body) return null;
  let body; try { body = JSON.parse(tpl.body); } catch { return null; }
  _vDeepSet(body, (k) => k === 'token', capToken);
  _vDeepSet(body, (k) => k === 'projectId', String(projectId));
  _vDeepSet(body, (k) => k === 'seed', Math.floor(Date.now() % 100000));
  _vDeepSet(body, (k) => k === 'sessionId', ';' + Date.now());
  if (modelKey) { const wantType = imageMediaId ? 'r2v' : 't2v'; const typed = _vResolveModelKey(modelKey).replace(/(^|_)(t2v|r2v|i2v)(?=_|$)/, '$1' + wantType); _vDeepSet(body, (k) => k === 'videoModelKey', typed); }
  if (durationSecs) _vDeepSet2(body, (k) => k === 'videoModelKey', (cur) => (typeof cur === 'string' ? cur.replace(/_(\d+)s\b/, '_' + durationSecs + 's') : cur));
  if (prompt) _vSetPrompt(body, prompt);
  if (imageMediaId) (function w(o) { if (!o || typeof o !== 'object') return; if (Array.isArray(o.referenceImages)) o.referenceImages.forEach((ri) => { if (ri && typeof ri === 'object' && 'mediaId' in ri) ri.mediaId = imageMediaId; }); for (const k of Object.keys(o)) if (o[k] && typeof o[k] === 'object') w(o[k]); })(body);
  return body;
}

const _vProjects = new Map();   // id -> projectId (cache/account)
async function vEnsureProject(id, token) {
  if (_vProjects.has(id)) return _vProjects.get(id);
  const { cdp } = await ensureLive(id);
  const r = await apiFetch(cdp, { url: TRPC_CREATE_PROJECT, method: 'POST', headers: { 'content-type': 'application/json', accept: '*/*', authorization: 'Bearer ' + token }, body: JSON.stringify({ json: { projectTitle: 'Nova Chrome video', toolName: 'PINHOLE' } }) });
  let d; try { d = JSON.parse(r.text); } catch { d = r.text; }
  if (!r.ok) throw new Error('PROJECT_' + r.status);
  const pid = deepFindProjectId(d); if (!pid) throw new Error('NO_PROJECT_ID');
  _vProjects.set(id, pid); return pid;
}
async function vUploadImage(id, token, projectId, { base64, mime, fileName }) {
  const { cdp } = await ensureLive(id);
  const clean = String(base64 || '').replace(/^data:[^;]+;base64,/, '');
  const body = { clientContext: { projectId: String(projectId), tool: 'PINHOLE' }, fileName: fileName || 'ref.png', imageBytes: clean, isHidden: false, isUserUploaded: true, mimeType: mime || 'image/png' };
  const r = await apiFetch(cdp, { url: UPLOAD_IMAGE_URL, method: 'POST', headers: { 'content-type': 'text/plain;charset=UTF-8', accept: '*/*', authorization: 'Bearer ' + token }, body: JSON.stringify(body) });
  let d; try { d = JSON.parse(r.text); } catch { d = r.text; }
  if (!r.ok) return { error: extractApiError(d) || 'UPLOAD_' + r.status };
  const mediaId = d && d.media && d.media.name; if (!mediaId) return { error: 'NO_MEDIA_ID' };
  return { media_id: mediaId };
}
async function vSubmit(id, { token, prompt, projectId, imageMediaId, modelKey, durationSecs }) {
  const { cdp } = await ensureLive(id);
  let capToken; try { capToken = await evalInPage(cdp, captchaCode('VIDEO_GENERATION')); } catch (e) { return { error: 'CAPTCHA: ' + (e.message || e) }; }
  if (!capToken) return { error: 'CAPTCHA_EMPTY' };
  const body = _vBodyFromLearned({ prompt, projectId, imageMediaId, capToken, modelKey, durationSecs });
  if (!body) return { error: 'VIDEO_BODY_NULL' };
  const tpl = _vLearnedFor(imageMediaId);
  const r = await apiFetch(cdp, { url: tpl.url, method: 'POST', headers: { 'content-type': 'text/plain;charset=UTF-8', accept: '*/*', authorization: 'Bearer ' + token }, body: JSON.stringify(body) });
  let d; try { d = JSON.parse(r.text); } catch { d = r.text; }
  if (!r.ok) return { error: extractApiError(d) || 'VIDEO_' + r.status };
  const ie = extractApiError(d); if (ie) return { error: ie };
  const first = d && Array.isArray(d.media) && d.media[0]; const mediaId = first && first.name;
  if (!mediaId) return { error: 'NO_MEDIA_ID' };
  return { mediaId, projectId: (first && first.projectId) || projectId };
}
async function vPoll(id, { token, projectId, mediaId }) {
  const { cdp } = await ensureLive(id);
  let url = DEFAULT_VIDEO.poll.url, body;
  try { body = JSON.parse(DEFAULT_VIDEO.poll.body); _vDeepSet(body, (k) => k === 'projectId', String(projectId)); (function w(o) { if (!o || typeof o !== 'object') return; if (Array.isArray(o.media)) o.media.forEach((m) => { if (m && typeof m === 'object') { if ('name' in m) m.name = mediaId; if ('mediaId' in m) m.mediaId = mediaId; } }); for (const k of Object.keys(o)) if (o[k] && typeof o[k] === 'object') w(o[k]); })(body); } catch { body = { media: [{ name: mediaId, projectId: String(projectId) }] }; }
  const r = await apiFetch(cdp, { url, method: 'POST', headers: { 'content-type': 'text/plain;charset=UTF-8', accept: '*/*', authorization: 'Bearer ' + token }, body: JSON.stringify(body) });
  let d; try { d = JSON.parse(r.text); } catch { d = r.text; }
  if (!r.ok) return { error: extractApiError(d) || 'POLL_' + r.status };
  const first = d && Array.isArray(d.media) && d.media[0];
  const status = (first && first.mediaMetadata && first.mediaMetadata.mediaStatus && first.mediaMetadata.mediaStatus.mediaGenerationStatus) || '';
  const done = /SUCCESSFUL/i.test(status), failed = /FAIL|ERROR|REJECT|BLOCK/i.test(status);
  const vf = first && first.video; let videoUrl = null;
  if (vf && typeof vf === 'object') { videoUrl = vf.fifeUrl || vf.servingUri || vf.servingUrl || vf.url || vf.downloadUri || (vf.generatedVideo && (vf.generatedVideo.fifeUrl || vf.generatedVideo.servingUri || vf.generatedVideo.servingUrl || vf.generatedVideo.url)) || null; if (!videoUrl) { const u = _vAnyUrl(vf); if (u.length) videoUrl = u[u.length - 1]; } }
  if (!videoUrl) { const u = _vAnyUrl(d); if (u.length) videoUrl = u[u.length - 1]; }
  const credits = (d && typeof d.remainingCredits === 'number') ? d.remainingCredits : null;
  return { status, done, failed, credits, videoUrl };
}
// Tải video ở tiến trình chính (né CORS) — như ảnh.
async function fetchVideoData(id, url) {
  let cookieHeader = '';
  try { const rec = running.get(id); if (rec && rec.cdp) { const cks = await readCookies(rec.cdp); cookieHeader = (cks || []).filter((c) => /google/.test(c.domain || '')).map((c) => c.name + '=' + c.value).join('; '); } } catch {}
  return new Promise((resolve, reject) => {
    let done = false; const fin = (fn, v) => { if (!done) { done = true; fn(v); } };
    const req = net.request(url); if (cookieHeader) { try { req.setHeader('cookie', cookieHeader); } catch {} }
    req.on('response', (res) => { if (res.statusCode >= 400) { fin(reject, new Error('VID_HTTP_' + res.statusCode)); return; } const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => { const buf = Buffer.concat(chunks); let mime = res.headers['content-type'] || 'video/mp4'; if (Array.isArray(mime)) mime = mime[0]; fin(resolve, { b64: buf.toString('base64'), mime, size: buf.length }); }); res.on('error', (e) => fin(reject, new Error(e.message || 'VID_READ'))); });
    req.on('error', (e) => fin(reject, new Error(e.message || 'VID_FETCH_FAILED')));
    req.end();
  });
}
// Lấy link video: mở trang project trong Chrome, phát video, chộp URL /video/<id> (CDP Network) hoặc <video>.currentSrc.
let _vResolveChain = Promise.resolve();
function resolveVideo(id, opts) { const run = () => _resolveVideo(id, opts); const p = _vResolveChain.then(run, run); _vResolveChain = p.catch(() => {}); return p; }
async function _resolveVideo(id, { projectId, mediaId, withData }) {
  const { cdp } = await ensureLive(id);
  const rec = running.get(id); if (rec) rec.videoUrls = (rec.videoUrls || []).filter((r) => !r.url.includes(mediaId));
  const setWin = async (st) => { try { const w = await cdp.send('Browser.getWindowForTarget', {}); if (w && w.windowId) await cdp.send('Browser.setWindowBounds', { windowId: w.windowId, bounds: { windowState: st } }); } catch {} };
  // TỐI ƯU: bắt THẲNG response projectInitialData (chứa link video, chạy bằng cookie phiên) → khỏi phát video + cào, giữ cửa sổ ẩN.
  let _piaUrl = null; const _piaReq = new Set();
  const _piaCatch = async (m) => {
    try {
      if (m.method === 'Network.responseReceived') { const u = m.params.response && m.params.response.url; if (u && /projectInitialData/i.test(u)) _piaReq.add(m.params.requestId); }
      else if (m.method === 'Network.loadingFinished' && _piaReq.has(m.params.requestId)) {
        _piaReq.delete(m.params.requestId);
        const b = await cdp.send('Network.getResponseBody', { requestId: m.params.requestId }).catch(() => null);
        if (b && b.body) {
          const raw = b.base64Encoded ? Buffer.from(b.body, 'base64').toString('utf8') : String(b.body);
          let d; try { d = JSON.parse(raw); } catch { d = null; }
          // 1) Khớp CHÍNH XÁC theo entry mediaId (đáng tin nhất — tránh lấy nhầm video cũ trong project).
          const exact = d ? _findVideoUrlForMedia(d, mediaId) : null;
          if (exact) { _piaUrl = exact; return; }
          // 2) Không có mediaId → mới được phép lấy video mới nhất trong response.
          if (!mediaId) {
            const urls = d ? _vAnyUrl(d) : (raw.match(/https?:\\?\/\\?\/[^"'\\ ]+/g) || []).map((u) => u.replace(/\\\//g, '/'));
            const vids = urls.filter((u) => _VID_URL_RE.test(u));
            if (vids.length) _piaUrl = vids[vids.length - 1];
          }
          // Có mediaId nhưng chưa khớp → KHÔNG lấy bừa; để vòng lặp chờ/response sau khớp đúng.
        }
      }
    } catch {}
  };
  cdp.on(_piaCatch);
  await setWin('minimized');   // lấy link từ API → không cần bung cửa sổ/phát video
  try { await cdp.send('Page.navigate', { url: `${FLOW_URL}/project/${projectId}` }); } catch {}
  for (let i = 0; i < 24 && !_piaUrl; i++) await sleep(500);   // chờ projectInitialData trả về (tối đa ~12s)
  if (!_piaUrl && mediaId) {   // chưa khớp mediaId → reload 1 lần (video vừa tạo có thể chưa vào projectInitialData) rồi thử lại khớp chính xác
    try { await cdp.send('Page.navigate', { url: `${FLOW_URL}/project/${projectId}?_r=1` }); } catch {}
    for (let i = 0; i < 20 && !_piaUrl; i++) await sleep(500);
  }
  let vurl = _piaUrl;
  // FALLBACK: API không ra link → cách cũ (bung cửa sổ, phát video, cào URL).
  if (!vurl) {
    await setWin('normal'); await sleep(3000);
    const grab = () => { const arr = (rec && rec.videoUrls) || []; const hit = arr.filter((r) => r.url && /\/video\//.test(r.url) && (!mediaId || r.url.includes(mediaId))); return hit.length ? hit[hit.length - 1].url : null; };
    for (let i = 0; i < 20; i++) {
      vurl = grab(); if (vurl) break;
      try {
        const s = await evalInPage(cdp, `(async()=>{const nap=ms=>new Promise(r=>setTimeout(r,ms));for(const v of document.querySelectorAll('video')){try{v.muted=true;v.preload='auto';const p=v.play();if(p&&p.catch)p.catch(()=>{});}catch(e){}}const cards=Array.from(document.querySelectorAll('img,video,[role="button"]')).filter(el=>(el.clientWidth||0)>150).slice(0,6);for(const c of cards){try{['mouseover','mouseenter','pointerover'].forEach(ev=>c.dispatchEvent(new MouseEvent(ev,{bubbles:true})));}catch(e){}}await nap(400);for(const c of cards){try{c.click();}catch(e){}}await nap(600);for(const v of document.querySelectorAll('video')){try{v.muted=true;v.play&&v.play().catch(()=>{});}catch(e){}}await nap(500);const MID=${JSON.stringify(mediaId || '')};for(const v of document.querySelectorAll('video')){const u=v.currentSrc||v.src;if(u&&/^https?:/.test(u)&&(MID?(u.includes(MID)||/\\/video\\//.test(u)):/\\/video\\//.test(u)))return u;}return null;})()`);
        if (s) { vurl = s; break; }
      } catch {}
      vurl = grab(); if (vurl) break;
      await sleep(2200);
    }
    await setWin('minimized');
  } else { LOG('acc', id, 'lấy link video nhanh từ projectInitialData ✓'); }
  if (!vurl) return { videoUrl: null };
  let vid = null;
  if (withData && !/^blob:/.test(vurl)) { try { vid = await fetchVideoData(id, vurl); } catch (e) { vid = { fetchError: e.message }; } }
  return { videoUrl: /^blob:/.test(vurl) ? null : vurl, video: vid };
}

// ── UPSCALE VIDEO 1080p (học request 1 lần trên Flow → replay hàng loạt) ─────────
// Video 1080p/4K của Flow là bước NÂNG ĐỘ PHÂN GIẢI riêng (như ảnh 2K/4K). App học request khi
// user bấm Tải xuống → 1080p 1 lần, rồi tự replay cho các video khác. Sạch: phiên thật, không giả header.
const VUP_FILE = () => path.join(app.getPath('userData'), 'flow-video-upscale.json');
let vUpTpl = null;   // { url, body, at }
let _vUpArm = null;  // { id } đang chờ user bấm 1080p
try { const _d = JSON.parse(fs.readFileSync(VUP_FILE(), 'utf8')); if (_d && _d.url) vUpTpl = _d; } catch {}
function _saveVUp() { try { fs.writeFileSync(VUP_FILE(), JSON.stringify(vUpTpl)); } catch {} }
// Nhận diện request NÂNG độ phân giải video (endpoint tên chưa biết chắc → xét cả url lẫn body).
function _looksVUp(u, pd) {
  if (!u) return false;
  if (/(projectInitialData|auth\/session|recaptcha|batchCheckAsync|CheckAsyncVideoGenerationStatus)/i.test(u)) return false;   // loại poll/session/captcha
  if (/(upsampl|upscal|superres|super_res|enhanc|highres|increaseresolution|highResolution)/i.test(u)) return true;           // endpoint upscale rõ ràng
  // dự phòng: body nhắc 1080/upscale mà KHÔNG phải submit gen 720p thường
  if (pd && /(1080|UPSAMPLE|UPSCALE|SUPER_?RES|HIGH_?RES|ENHANCE|RECONSTRUCT)/i.test(pd) && !/VIDEO_RESOLUTION_720P/i.test(pd)) return true;
  return false;
}
function videoUpscaleStatus() { return { learned: !!vUpTpl, url: vUpTpl && vUpTpl.url, at: vUpTpl && vUpTpl.at }; }
function videoUpscaleDump() { return vUpTpl ? { url: vUpTpl.url, body: String(vUpTpl.body || '').slice(0, 4000), at: vUpTpl.at } : null; }
// Bật học: mở CfT của account (hiện cửa sổ), chờ user bấm 1080p → CDP chộp POST request.
function _firstEnabledId() { return order.find((x) => { const a = accounts.get(x); return a && a.enabled !== false; }) || null; }
async function armVideoUpscale(id) {
  // id chỉ định → dùng nếu đang BẬT; không thì lấy tài khoản BẬT đầu tiên (không mở account đã tắt).
  let realId = (id != null && accounts.has(id) && accounts.get(id).enabled !== false) ? id : _firstEnabledId();
  if (!realId) return { error: 'Chưa có tài khoản nào ĐANG BẬT. Bật 1 tài khoản trước rồi thử lại.' };
  const { cdp } = await ensureLive(realId);
  try { const w = await cdp.send('Browser.getWindowForTarget', {}); if (w && w.windowId) await cdp.send('Browser.setWindowBounds', { windowId: w.windowId, bounds: { windowState: 'normal' } }); } catch {}
  try { await cdp.send('Page.navigate', { url: FLOW_URL }); } catch {}
  _vUpArm = { id: realId, at: Date.now() };
  const rec = running.get(realId);
  if (rec && rec.cdp && !rec._vUpHooked) {
    rec._vUpHooked = true;
    rec.cdp.on((m) => {
      try {
        if (!_vUpArm) return;
        if (m.method === 'Network.requestWillBeSent' && m.params.request && m.params.request.method === 'POST') {
          const u = m.params.request.url; const pd = m.params.request.postData;
          if (!u || !/googleapis\.com|labs\.google/i.test(u)) return;
          if (/(auth\/session|recaptcha|projectInitialData|batchCheckAsync)/i.test(u)) return;   // bỏ nhiễu
          LOG('  [học 1080p] POST', u.replace(/\?.*$/, ''));   // ghi mọi request để soi nếu bắt hụt
          if (pd && _looksVUp(u, pd)) {
            vUpTpl = { url: u, body: pd, at: Date.now() }; _saveVUp(); _vUpArm = null;
            LOG('acc', realId, '✔ ĐÃ HỌC upscale video:', u);
            LOG('  BODY:', String(pd).slice(0, 1500));
          }
        }
      } catch {}
    });
  }
  return { ok: true, note: 'Đã mở Chrome. Trong Flow, bấm ⋮ (hoặc nút Tải xuống) → chọn 1080p trên 1 video bất kỳ. App sẽ tự HỌC và lưu lại.' };
}

// ── TẮT WATERMARK (nhìn thấy) hàng loạt: học request Google gửi khi gạt "Visible watermarking" → phát lại cho mọi tài khoản.
// Chỉ tắt watermark HIỂN THỊ (Google cho phép tắt sẵn trong menu); SynthID ẩn của Google KHÔNG đụng tới.
const WM_FILE = () => path.join(app.getPath('userData'), 'flow-watermark.json');
let wmTpl = null;   // { url, method, body, at }
let _wmArm = null;
try { const _d = JSON.parse(fs.readFileSync(WM_FILE(), 'utf8')); if (_d && _d.url) wmTpl = _d; } catch {}
function _saveWM() { try { fs.writeFileSync(WM_FILE(), JSON.stringify(wmTpl)); } catch {} }
function _looksWM(u, pd) {
  const url = u || ''; const s = url + ' ' + (pd || '');
  if (/(auth\/session|recaptcha|projectInitialData|batchCheckAsync|GenerateVideo|GenerateImage|AsyncGenerate)/i.test(url)) return false;   // loại gen/poll/session/captcha
  return /(watermark|synth ?id|visible.?mark|imagewatermark|mediawatermark|showwatermark|disablewatermark|mark_?visib)/i.test(s);
}
// Endpoint tắt/bật watermark hiển thị đã xác định (KHÔNG phụ thuộc tài khoản — chỉ 1 cờ, account theo phiên).
const WM_URL = 'https://aisandbox-pa.googleapis.com/v1/flow/userSettings';
function _wmBody(enabled) { return JSON.stringify({ userSettings: { isWatermarkEnabledByUser: !!enabled }, updateMask: 'isWatermarkEnabledByUser' }); }
function watermarkStatus() { return { learned: true, url: WM_URL, at: (wmTpl && wmTpl.at) || null }; }   // luôn sẵn (bake sẵn request), khách khỏi học
function watermarkDump() { return wmTpl ? { url: wmTpl.url, method: wmTpl.method, body: String(wmTpl.body || '').slice(0, 3000), at: wmTpl.at } : null; }
async function armWatermarkLearn(id) {
  let realId = (id != null && accounts.has(id) && accounts.get(id).enabled !== false) ? id : _firstEnabledId();
  if (!realId) return { error: 'Chưa có tài khoản nào ĐANG BẬT. Bật 1 tài khoản rồi thử lại.' };
  const { cdp } = await ensureLive(realId);
  try { const w = await cdp.send('Browser.getWindowForTarget', {}); if (w && w.windowId) await cdp.send('Browser.setWindowBounds', { windowId: w.windowId, bounds: { windowState: 'normal' } }); } catch {}
  try { await cdp.send('Page.navigate', { url: FLOW_URL }); } catch {}
  _wmArm = { id: realId, at: Date.now() };
  const rec = running.get(realId);
  if (rec && rec.cdp && !rec._wmHooked) {
    rec._wmHooked = true;
    rec.cdp.on((m) => {
      try {
        if (!_wmArm) return;
        if (m.method === 'Network.requestWillBeSent' && m.params.request && /^(POST|PUT|PATCH)$/i.test(m.params.request.method || '')) {
          const u = m.params.request.url; const pd = m.params.request.postData;
          if (!u || !/googleapis\.com|labs\.google/i.test(u)) return;
          if (/(auth\/session|recaptcha|projectInitialData|batchCheckAsync)/i.test(u)) return;
          LOG('  [học watermark] ' + m.params.request.method + ' ' + u.replace(/\?.*$/, ''));   // ghi mọi request để soi nếu bắt hụt
          if (_looksWM(u, pd)) {
            wmTpl = { url: u, method: m.params.request.method, body: pd || '', at: Date.now() }; _saveWM(); _wmArm = null;
            LOG('acc', realId, '✔ ĐÃ HỌC tắt watermark:', u);
            LOG('  BODY:', String(pd || '').slice(0, 1200));
          }
        }
      } catch {}
    });
  }
  return { ok: true, id: realId, note: 'Đã mở Chrome. Bấm avatar (góc phải Flow) → gạt "Visible watermarking" sang ĐANG TẮT. App sẽ tự HỌC (chỉ cần làm 1 lần).' };
}
async function applyWatermarkOne(id, off) {
  const live = await ensureLive(id);   // mở phiên RIÊNG của account → request áp đúng account đó
  const r = await apiFetch(live.cdp, { url: WM_URL, method: 'PATCH', headers: { 'content-type': 'application/json', accept: '*/*', authorization: 'Bearer ' + live.token }, body: _wmBody(off === false) });   // off (mặc định) → isWatermarkEnabledByUser=false
  if (id !== _captchaId) { try { await closeChrome(id); } catch {} }   // đóng lại cho gọn (giữ máy captcha)
  return { ok: !!(r && r.ok), status: r && r.status };
}
async function applyWatermarkAll() {
  const ids = order.filter((x) => { const a = accounts.get(x); return a && a.enabled !== false; });
  if (!ids.length) return { error: 'Chưa có tài khoản nào đang bật.' };
  const out = [];
  for (const id of ids) {
    try { const r = await applyWatermarkOne(id); out.push({ id, ok: r.ok, status: r.status }); LOG('acc', id, r.ok ? '✔ đã tắt watermark hiển thị' : ('⚠️ tắt watermark trả HTTP ' + (r.status || '?'))); }
    catch (e) { out.push({ id, ok: false, error: e && e.message }); LOG('acc', id, '❌ tắt watermark lỗi:', e && e.message); }
  }
  return { ok: true, results: out, done: out.filter((x) => x.ok).length, total: ids.length };
}
function _uuid() { try { return require('crypto').randomUUID(); } catch { return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = Math.floor(Math.random() * 16); const v = c === 'x' ? r : (r & 0x3) | 0x8; return v.toString(16); }); } }
// Replay upscale 1080p cho 1 video (endpoint đã học: video:batchAsyncGenerateVideoUpsampleVideo).
// Body: requests[0].videoInput.mediaId = video nguồn, clientContext.projectId, recaptchaContext.token.
async function upsampleVideo(id, { mediaId, projectId, aspect, withData }) {
  if (!vUpTpl) return { error: 'CHƯA_HỌC_UPSCALE' };
  const { cdp, token } = await ensureLive(id);
  let capToken = ''; try { capToken = await evalInPage(cdp, captchaCode('VIDEO_GENERATION')); } catch {}
  if (!capToken) return { error: 'CAPTCHA_EMPTY' };
  let body; try { body = JSON.parse(vUpTpl.body); } catch { return { error: 'TPL_BODY_BAD' }; }
  // Điền đúng cấu trúc đã học.
  if (body.clientContext) { body.clientContext.projectId = String(projectId); if (body.clientContext.recaptchaContext) body.clientContext.recaptchaContext.token = capToken; }
  else { _vDeepSet(body, (k) => k === 'projectId', String(projectId)); _vDeepSet(body, (k) => k === 'token', capToken); }
  if (body.mediaGenerationContext) body.mediaGenerationContext.batchId = _uuid();
  const reqs = Array.isArray(body.requests) ? body.requests : [];
  for (const rq of reqs) {
    if (rq && typeof rq === 'object') {
      if (rq.videoInput && typeof rq.videoInput === 'object') rq.videoInput.mediaId = String(mediaId); else rq.videoInput = { mediaId: String(mediaId) };
      if (aspect) rq.aspectRatio = aspect;
      if (rq.metadata && typeof rq.metadata === 'object') rq.metadata.workflowId = _uuid();
    }
  }
  if (!reqs.length) _vDeepSet(body, (k) => k === 'mediaId', String(mediaId));   // dự phòng nếu cấu trúc khác
  const r = await apiFetch(cdp, { url: vUpTpl.url, method: 'POST', headers: { 'content-type': 'text/plain;charset=UTF-8', accept: '*/*', authorization: 'Bearer ' + token }, body: JSON.stringify(body) });
  let d; try { d = JSON.parse(r.text); } catch { d = r.text; }
  if (!r.ok) return { error: extractApiError(d) || ('UPSCALE_HTTP_' + r.status) };
  const ie = extractApiError(d); if (ie) return { error: ie };
  const first = d && Array.isArray(d.media) && d.media[0]; const opName = (first && first.name) || (d && d.name) || null;
  if (!opName) return { error: 'NO_UPSCALE_MEDIA_ID' };
  // Poll như video thường tới khi bản 1080p xong → lấy link. (nâng 1080p hay ~5-6 phút → chờ tới 8 phút)
  let vurl = null; const started = Date.now();
  while (Date.now() - started < 480000) {
    await sleep(5000);
    const p = await vPoll(id, { token, projectId, mediaId: opName });
    if (p.failed) return { error: 'UPSCALE_FAIL' };
    if (p.done && p.videoUrl) { vurl = p.videoUrl; break; }
    if (p.videoUrl) { vurl = p.videoUrl; break; }
  }
  if (!vurl) { const rv = await resolveVideo(id, { projectId, mediaId: opName, withData: false }); vurl = rv.videoUrl; }
  if (!vurl) return { error: 'NO_UPSCALE_URL' };
  let vid = null;
  if (withData !== false && !/^blob:/.test(vurl)) { try { vid = await fetchVideoData(id, vurl); } catch (e) { vid = { fetchError: e.message }; } }
  return { mediaId: opName || mediaId, videoUrl: vurl, video: vid };
}

// Tạo 1 video trên 1 account Chrome (mirror runVideoOnToken của extension). Trả {ok,...}|{error}.
async function genVideo(id, params) {
  if (!accounts.has(id)) return { error: 'NO_ACC' };
  let token; try { token = (await ensureLive(id)).token; } catch (e) { return { error: 'Mở Chrome lỗi: ' + (e.message || e) }; }
  let projectId; try { projectId = await vEnsureProject(id, token); } catch (e) { return { error: e.message || 'NO_PROJECT' }; }
  let imageMediaId = null;
  if (params.image && params.image.base64) {
    const up = await vUploadImage(id, token, projectId, { base64: params.image.base64, mime: params.image.mime || 'image/png', fileName: (params.sceneId || 'frame') + '.png' });
    if (up.error) return { error: 'UPLOAD: ' + up.error };
    imageMediaId = up.media_id;
  }
  const sub = await vSubmit(id, { token, prompt: params.prompt, projectId, imageMediaId, modelKey: params.modelKey || params.modelName, durationSecs: params.durationSecs });
  if (sub.error) return { error: sub.error };
  const started = Date.now(); let videoUrl = null, credits = null, done = false;
  while (Date.now() - started < 360000) {
    await sleep(6000);
    const p = await vPoll(id, { token, projectId: sub.projectId, mediaId: sub.mediaId });
    if (p.credits != null) credits = p.credits;
    if (p.error) return { error: p.error, mediaId: sub.mediaId };
    if (p.failed) return { error: 'Flow báo tạo video THẤT BẠI (' + (p.status || '?') + ')', mediaId: sub.mediaId };
    if (p.done) { videoUrl = p.videoUrl; done = true; break; }
  }
  if (!done) return { error: 'TIMEOUT chờ video', mediaId: sub.mediaId };
  let vid = null;
  // Poll trả link theo ĐÚNG mediaId → tải bytes THẲNG từ đó (tránh cào projectInitialData lấy nhầm video cũ trong project).
  if (videoUrl && !/^blob:/.test(videoUrl) && params.withData) {
    try { vid = await fetchVideoData(id, videoUrl); } catch (e) { vid = null; }
  }
  // Chưa có link, hoặc tải thẳng lỗi → resolve qua projectInitialData (đã khớp mediaId chính xác trong JSON).
  if (!videoUrl || (params.withData && (!vid || vid.fetchError))) {
    const rv = await resolveVideo(id, { projectId: sub.projectId, mediaId: sub.mediaId, withData: params.withData });
    if (!videoUrl) videoUrl = rv.videoUrl;
    if (!vid || vid.fetchError) vid = rv.video || vid;
  }
  // NÂNG 1080p (tuỳ chọn) — video gốc là 720p; nếu user chọn 1080p và đã học request thì nâng độ phân giải.
  let resolution = '720p';
  if (/1080/.test(String(params.resolution || ''))) {
    if (!vUpTpl) { LOG('acc', id, '⚠️ chưa học nâng 1080p — giữ 720p (vào Tạo Video → "Học nâng 1080p")'); }
    else {
      LOG('acc', id, '⬆ nâng 1080p…');
      try {
        const up = await upsampleVideo(id, { mediaId: sub.mediaId, projectId: sub.projectId, aspect: params.aspect, withData: params.withData });
        if (up && !up.error && (up.videoUrl || up.video?.b64)) { videoUrl = up.videoUrl || videoUrl; if (up.video) vid = up.video; resolution = '1080p'; LOG('acc', id, '✔ đã nâng 1080p'); }
        else { LOG('acc', id, '⚠️ nâng 1080p lỗi (' + ((up && up.error) || '?') + ') — giữ 720p'); }
      } catch (e) { LOG('acc', id, '⚠️ nâng 1080p lỗi: ' + (e.message || e) + ' — giữ 720p'); }
    }
  }
  return { ok: true, mediaId: sub.mediaId, projectId: sub.projectId, videoUrl, video: vid, credits, resolution };
}

// Extension mode: video gen ở extension nhưng KHÔNG tải được file (phiên trình duyệt ≠ chủ project).
// → App resolve giúp: mở Chrome for Testing của CHÍNH tài khoản đó (đúng phiên) để lấy link + tải file.
async function resolveVideoForApp({ email, projectId, mediaId, resolution, aspect, withData }) {
  let id = null;
  for (const aid of order) { const a = accounts.get(aid); if (a && a.email && email && a.email.toLowerCase() === String(email).toLowerCase()) { id = aid; break; } }
  if (id == null) return { error: 'Không tìm thấy tài khoản CfT khớp email ' + email + ' để resolve video.' };
  try {
    // Chọn 1080p (chế độ Extension) → NÂNG trước khi tải (nếu đã học request).
    if (/1080/.test(String(resolution || ''))) {
      if (!vUpTpl) LOG('acc', id, '⚠️ chưa học nâng 1080p — giữ 720p');
      else {
        LOG('acc', id, '⬆ nâng 1080p…');
        const up = await upsampleVideo(id, { mediaId, projectId, aspect, withData: withData !== false });
        if (up && !up.error && (up.videoUrl || up.video?.b64)) { LOG('acc', id, '✔ đã nâng 1080p'); return { ok: true, videoUrl: up.videoUrl || null, video: up.video || null, resolution: '1080p' }; }
        LOG('acc', id, '⚠️ nâng 1080p lỗi (' + ((up && up.error) || '?') + ') — giữ 720p');
      }
    }
    const rv = await resolveVideo(id, { projectId, mediaId, withData: withData !== false });
    return { ok: true, videoUrl: rv.videoUrl || null, video: rv.video || null, resolution: '720p' };
  } catch (e) { return { error: 'RESOLVE lỗi: ' + (e.message || e) }; }
}

// Gom token TƯƠI của tất cả account (mở Chrome từng cái 1 nhịp) → để bơm sang extension.
async function getAllTokens(force) {
  if (_busy) { LOG('bỏ qua làm mới token: đang bận thao tác khác'); return []; }   // không xen vào đăng nhập lại
  _busy = true;
  try {
    const out = [];
    for (const id of order) {
      const a = accounts.get(id);
      if (!a || a.enabled === false) continue;
      if (force) tokens.delete(id);   // ép mint token MỚI
      // Token cache CÒN HẠN THẬT (24h) + đã có project + email → DÙNG LẠI, KHỎI mở Chrome (chuyển chế độ/refresh không mở Chrome vô ích).
      const tk = tokens.get(id);
      if (!force && tk && tk.token && tk.expiry && Date.now() < tk.expiry - 5 * 60 * 1000 && a.projectId) {   // bỏ yêu cầu email (Windows hay null) → cache vẫn dùng lại được
        a.needLogin = false;
        out.push({ email: a.email, token: tk.token, project_id: a.projectId, tier: a.tier || null, credits: a.credits ?? null });
        LOG('acc', id, 'dùng token cache (còn hạn) — khỏi mở Chrome');
        continue;
      }
      try {
        const d = await getAccountData(id);
        if (d.token) { a.needLogin = false; out.push({ email: a.email || ('Chrome ' + id), token: d.token, project_id: d.projectId || null, tier: a.tier || null, credits: a.credits ?? null }); }
        LOG('cho extension: acc', id, d.token ? 'token OK' : 'rỗng', 'proj', d.projectId || '-');
      } catch (e) {
        a.needLogin = true;   // profile không ra token → cần đăng nhập lại (thường do đổi trình duyệt)
        LOG('⚠️ acc', id, (a.email || '') + ': chưa đăng nhập bằng Chrome for Testing — bấm "Đăng nhập lại" cho tài khoản này (1 lần).');
      }
    }
    return out;
  } finally { _busy = false; }
}

async function handle(action, payload = {}) {
  switch (action) {
    case 'PING':          return { ok: true, engine: 'chrome' };
    case 'GET_ACCOUNTS':  return statusPayload();
    case 'GET_ALL_TOKENS': return { accounts: await getAllTokens(payload.force) };
    case 'GEN_TEST':      return await genTest(payload.id, payload.prompt || 'a cute cat astronaut, cinematic', payload.tokenId);
    case 'LOGIN_START':   return loginStart();
    case 'LOGIN_CANCEL':  return loginCancel();
    case 'LOGIN_FINISH':  return await loginFinish(payload.id);
    case 'RESOLVE_VIDEO': return await resolveVideoForApp(payload || {});
    case 'VIDEO_UPSCALE_ARM':    return await armVideoUpscale(payload.id);
    case 'VIDEO_UPSCALE_STATUS': return videoUpscaleStatus();
    case 'VIDEO_UPSCALE_DUMP':   return videoUpscaleDump();
    case 'WATERMARK_ARM':        return await armWatermarkLearn(payload.id);
    case 'WATERMARK_STATUS':     return watermarkStatus();
    case 'WATERMARK_DUMP':       return watermarkDump();
    case 'WATERMARK_APPLY_ALL':  return await applyWatermarkAll();
    case 'LOGIN_AUTO':    return await loginAuto();
    case 'RELOGIN':       return await reloginAuto(payload.id);
    case 'RELOGIN_START': return reloginStart(payload.id);
    case 'RELOGIN_FINISH':return await reloginFinish(payload.id);
    case 'REFRESH':       return await refreshOne(payload.id);
    case 'SET_ENABLED':   return setEnabled(payload.id, payload.enabled);
    case 'SET_USE':       return setUse(payload.id, payload.kind, payload.val);
    case 'SET_PROXY':     return setProxy(payload.id, payload.proxy);
    case 'SET_CAPTCHA_MODE': return setCaptchaMode(payload.mode);
    case 'GET_CAPTCHA_MODE': return { mode: getCaptchaMode() };
    case 'REMOVE':        return removeAccount(payload.id);
    default:              return { error: 'UNKNOWN_ACTION: ' + action };
  }
}

function listAccounts() { return order.map((id) => accounts.get(id)).filter(Boolean); }
module.exports = { handle, restore, setLogSink, ensureLive, ensureCaptcha, getTokenFresh, pageEval, pageFetchImage, getToken, listAccounts, setEnabled, setProxy, removeAccount, refreshOne, genVideo, videoUpscaleStatus, upsampleVideo, rotateCaptcha, setCaptchaMode, getCaptchaMode, closeGuestCaptcha: _closeGuest };
