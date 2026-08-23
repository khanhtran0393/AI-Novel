/**
 * Flow Image Gen — Service Worker
 *
 * Tự chứa (không cần agent Python). Nhiệm vụ:
 *   1. Bắt Bearer token (ya29.*) của NHIỀU tài khoản từ request labs.google/aisandbox.
 *   2. Hỏi /v1/credits để biết gói (paygate tier) + credit từng tài khoản.
 *   3. Giải reCAPTCHA Enterprise qua tab Flow (content.js + injected.js).
 *   4. Tạo project (tRPC) + batchGenerateImages. Có POOL_GEN round-robin nhiều account.
 */

const FLOW_API_BASE       = 'https://aisandbox-pa.googleapis.com';
const FLOW_API_KEY        = 'AIzaSyBtrm0o5ab1c-Ec8ZuLcGt3oJAA5VWt3pY';
const CREDITS_URL         = `${FLOW_API_BASE}/v1/credits`;
const TRPC_CREATE_PROJECT = 'https://labs.google/fx/api/trpc/project.createProject';
const UPLOAD_IMAGE_URL    = `${FLOW_API_BASE}/v1/flow/uploadImage`;
const FLOW_TAB_URL        = 'https://labs.google/fx/tools/flow';
const SESSION_URL         = 'https://labs.google/fx/api/auth/session'; // lấy access_token trực tiếp
const CAPTCHA_IMAGE       = 'IMAGE_GENERATION';
const CAPTCHA_VIDEO       = 'VIDEO_GENERATION';

const FLOW_TAB_MATCH = [
  'https://labs.google/fx/tools/flow*',
  'https://labs.google/fx/*/tools/flow*',
];

const API_HEADERS = {
  'content-type': 'text/plain;charset=UTF-8',
  'accept': '*/*',
  'origin': 'https://labs.google',
  'referer': 'https://labs.google/',
};

// ─── Kho tài khoản ──────────────────────────────────────────
// accounts[email] = { email, token, capturedAt, tier, credits }
let accounts     = {};
let accountOrder = [];          // thứ tự email cho round-robin
let seenTokens   = new Set();   // token đã phân loại (tránh xử lý lại)
let _appManaged  = false;       // app đã bơm token farm → tab chỉ để giải captcha, KHÔNG thêm account của tab vào pool

// "Primary" = tài khoản mới nhất — dùng cho popup + đường đơn-tài-khoản cũ.
let flowKey        = null;
let tokenCapturedAt = null;
let paygateTier    = null;
let credits        = null;
let userEmail      = null;

// ─── Khởi động ──────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(restore);
chrome.runtime.onStartup.addListener(restore);
// MV3: service worker ngủ dậy KHÔNG bắn onStartup → gọi trực tiếp để mỗi lần SW khởi động đều nạp lại kho farm.
let _readyP = restore();

async function restore() {
  const d = await chrome.storage.local.get(['flowKey', 'tokenCapturedAt', 'paygateTier', 'credits', 'userEmail', 'appAccounts', 'appManaged']);
  // ƯU TIÊN kho farm do app bơm (nếu có) → SW ngủ dậy vẫn gen bằng token farm, KHÔNG dùng account của tab captcha.
  if (d.appManaged && Array.isArray(d.appAccounts) && d.appAccounts.length) {
    setAccountsFromApp(d.appAccounts);
    console.log('[FlowImageGen] khôi phục kho farm', d.appAccounts.length, 'account (app-managed)');
    return;
  }
  if (d.flowKey)         flowKey         = d.flowKey;
  if (d.tokenCapturedAt) tokenCapturedAt = d.tokenCapturedAt;
  if (d.paygateTier)     paygateTier     = d.paygateTier;
  if (typeof d.credits === 'number') credits = d.credits;
  if (d.userEmail)       userEmail       = d.userEmail;
  // Khôi phục primary vào pool để dùng ngay khi SW vừa dậy.
  if (flowKey && userEmail) {
    accounts[userEmail] = { email: userEmail, token: flowKey, capturedAt: tokenCapturedAt, tier: paygateTier, credits };
    accountOrder = [userEmail];
    seenTokens.add(flowKey);
  }
}
restore();

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('app.html') });
});

// ─── Tải file về máy (đặt tên tuỳ chỉnh) ───────────────────
// Map: url tải → tên file mong muốn (set trước khi gọi downloads.download).
const pendingDownloadNames = new Map();
if (chrome.downloads?.onDeterminingFilename) {
  chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
    const name = pendingDownloadNames.get(item.url) || pendingDownloadNames.get(item.finalUrl);
    if (name) {
      pendingDownloadNames.delete(item.url);
      pendingDownloadNames.delete(item.finalUrl);
      suggest({ filename: name, conflictAction: 'uniquify' });
    } else suggest();
  });
}

async function downloadFile({ url, filename }) {
  if (!chrome.downloads) return { error: 'NO_DOWNLOADS_PERMISSION' };
  if (!url) return { error: 'NO_URL' };
  if (filename) pendingDownloadNames.set(url, filename);
  try {
    const downloadId = await chrome.downloads.download({ url, filename, conflictAction: 'uniquify' });
    return { ok: true, downloadId };
  } catch (e) {
    return { error: e.message || 'DOWNLOAD_FAILED' };
  }
}

// ─── App bơm N token vào kho (mô hình "1 tab captcha + N token" như đối thủ) ───
// Extension chỉ cần 1 tab Flow (account bất kỳ) để giải captcha; gen chạy bằng token app đưa.
function setAccountsFromApp(list) {
  if (!Array.isArray(list)) return { error: 'BAD_LIST' };
  const newAcc = {}; const newOrder = [];
  for (const a of list) {
    if (!a || !a.token) continue;
    const email = a.email || ('app-' + String(a.token).slice(-6));
    newAcc[email] = { email, token: a.token, capturedAt: Date.now(), tier: a.tier || null, credits: (typeof a.credits === 'number') ? a.credits : null, projectId: a.project_id || null };
    newOrder.push(email); seenTokens.add(a.token);
  }
  if (newOrder.length) {
    accounts = newAcc; accountOrder = newOrder; flowKey = newAcc[newOrder[0]].token; userEmail = newOrder[0]; _appManaged = true;
    // LƯU kho farm vào storage → service worker (MV3) ngủ dậy vẫn dùng token farm, KHÔNG rơi về account tab.
    try { chrome.storage.local.set({ appAccounts: list, appManaged: true }); } catch {}
  }
  console.log('[FlowImageGen] app bơm', newOrder.length, 'token vào kho (app-managed, bỏ qua account tab captcha)');
  return { ok: true, count: accountOrder.length };
}

// ─── Bắt Bearer token (đa tài khoản) ───────────────────────

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    const h = details.requestHeaders?.find((x) => x.name?.toLowerCase() === 'authorization');
    const val = h?.value || '';
    if (!val.startsWith('Bearer ya29.')) return;
    const tok = val.replace(/^Bearer\s+/i, '').trim();
    if (!tok || seenTokens.has(tok)) return;
    seenTokens.add(tok);
    if (seenTokens.size > 40) seenTokens = new Set([...seenTokens].slice(-20));
    classifyToken(tok);
  },
  { urls: ['https://aisandbox-pa.googleapis.com/*', 'https://labs.google/*'] },
  ['requestHeaders', 'extraHeaders'],
);

// Phân loại token mới → tìm email + tier + credit → lưu vào kho tài khoản.
async function classifyToken(token) {
  try { await _readyP; } catch {}   // đợi nạp cờ app-managed từ storage trước khi quyết định
  if (_appManaged) return;   // app quản pool (token farm) → bỏ qua token của tab captcha (không gen bằng nó)
  const email = await fetchUserEmail(token);
  if (!email) return; // không xác định được account → bỏ (token có thể của dịch vụ khác)
  const cr = await fetchCredits(token);
  const isNew = !accounts[email];
  accounts[email] = {
    email,
    token,
    capturedAt: Date.now(),
    tier: cr.tier || accounts[email]?.tier || null,
    credits: (typeof cr.credits === 'number') ? cr.credits : accounts[email]?.credits ?? null,
  };
  if (isNew) accountOrder.push(email);

  // Cập nhật primary = account vừa bắt.
  flowKey = token; tokenCapturedAt = accounts[email].capturedAt;
  paygateTier = accounts[email].tier; credits = accounts[email].credits; userEmail = email;
  chrome.storage.local.set({ flowKey, tokenCapturedAt, paygateTier, credits, userEmail });
  console.log(`[FlowImageGen] Tài khoản: ${email} (tổng ${accountOrder.length})`);
  broadcastStatus();
}

// ─── API phụ trợ (theo token) ──────────────────────────────

async function fetchCredits(token) {
  if (!token) return {};
  try {
    const resp = await fetch(`${CREDITS_URL}?key=${encodeURIComponent(FLOW_API_KEY)}`, {
      headers: { authorization: `Bearer ${token}`, origin: 'https://labs.google', referer: 'https://labs.google/' },
    });
    if (!resp.ok) return {};
    const data = await resp.json();
    const tier = (data.userPaygateTier === 'PAYGATE_TIER_ONE' || data.userPaygateTier === 'PAYGATE_TIER_TWO') ? data.userPaygateTier : null;
    return { tier, credits: typeof data.credits === 'number' ? data.credits : null };
  } catch { return {}; }
}

async function fetchUserEmail(token) {
  if (!token) return null;
  try {
    const resp = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { authorization: `Bearer ${token}` } });
    if (!resp.ok) return null;
    const info = await resp.json();
    return info?.email || null;
  } catch { return null; }
}

// Lấy access_token trực tiếp từ session labs.google (không cần sniff webRequest).
// Dùng làm fallback khi kho tài khoản đang rỗng (vừa mở, chưa bắt được ya29).
async function getSessionToken() {
  try {
    const resp = await fetch(SESSION_URL, { credentials: 'include' });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data?.access_token || null;
  } catch { return null; }
}

// Đảm bảo có ít nhất 1 tài khoản: nếu kho rỗng, lấy token qua session rồi phân loại.
// Trả về token primary (flowKey) hoặc null.
async function ensureSessionAccount() {
  if (flowKey) return flowKey;
  const tok = await getSessionToken();
  if (!tok) return null;
  if (!seenTokens.has(tok)) {
    seenTokens.add(tok);
    await classifyToken(tok); // tìm email + tier + credit, cập nhật primary
  }
  return flowKey;
}

// Làm mới credit/tier cho MỌI tài khoản (nút Quét lại).
async function scanAllAccounts() {
  await Promise.all(accountOrder.map(async (email) => {
    const a = accounts[email];
    if (!a?.token) return;
    const cr = await fetchCredits(a.token);
    if (cr.tier) a.tier = cr.tier;
    if (typeof cr.credits === 'number') a.credits = cr.credits;
    if (email === userEmail) { paygateTier = a.tier; credits = a.credits; }
  }));
  chrome.storage.local.set({ paygateTier, credits });
  broadcastStatus();
}

// ─── Trạng thái ─────────────────────────────────────────────

function statusPayload() {
  return {
    hasToken: !!flowKey,
    tokenAge: tokenCapturedAt ? Date.now() - tokenCapturedAt : null,
    paygateTier,
    credits,
    userEmail,
    accountCount: accountOrder.length,
    accounts: accountOrder.map((e) => ({ email: e, tier: accounts[e].tier, credits: accounts[e].credits })),
  };
}

function broadcastStatus() {
  chrome.runtime.sendMessage({ type: 'STATUS_PUSH', status: statusPayload() }).catch(() => {});
}

// ─── Mở / tìm tab Flow ──────────────────────────────────────

async function openFlowTab(active = false) {
  try {
    return await chrome.tabs.create({ url: FLOW_TAB_URL, active });
  } catch (e) {
    if (!String(e?.message || '').includes('No current window')) throw e;
    const win = await chrome.windows.create({ url: FLOW_TAB_URL, focused: false, state: 'minimized' });
    return win.tabs?.[0] ?? null;
  }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ─── Giải reCAPTCHA (không phụ thuộc tài khoản) ────────────

async function requestCaptchaFromTab(tabId, requestId, pageAction) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: 'GET_CAPTCHA', requestId, pageAction });
  } catch (error) {
    const msg = error?.message || '';
    if (!(msg.includes('Receiving end does not exist') || msg.includes('Could not establish connection'))) throw error;
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    await sleep(250);
    return await chrome.tabs.sendMessage(tabId, { type: 'GET_CAPTCHA', requestId, pageAction });
  }
}

async function reviveTab(tab) {
  if (!tab?.discarded) return tab;
  try {
    await chrome.tabs.reload(tab.id);
    await sleep(2500);
    return await chrome.tabs.get(tab.id);
  } catch { return null; }
}

async function solveCaptcha(requestId, action) {
  // Dùng CHUNG 1 tab Flow (tab có overlay) → KHÔNG mở cửa sổ thứ 2 không overlay.
  const gid = await _flowTab();
  await sleep(300);
  let tabs = [];
  if (gid != null) { try { const t = await chrome.tabs.get(gid); if (t) tabs = [t]; } catch {} }
  if (!tabs.length) tabs = await chrome.tabs.query({ url: FLOW_TAB_MATCH });
  for (const tab of tabs) {
    const live = await reviveTab(tab);
    if (!live) continue;
    try {
      return await Promise.race([
        requestCaptchaFromTab(live.id, requestId, action),
        new Promise((_, rej) => setTimeout(() => rej(new Error('CAPTCHA_TIMEOUT')), 30000)),
      ]);
    } catch (e) {
      const m = e?.message || '';
      if (m.includes('No current window') || m.includes('No tab with id') || m.includes('Receiving end does not exist')) continue;
      return { error: m };
    }
  }
  return { error: 'NO_FLOW_TAB' };
}

// ─── Gọi API tạo ảnh (theo token) ──────────────────────────

let _reqSeq = 0;

async function apiRequestWithCaptcha(url, body, action, token) {
  const bearer = token || flowKey;
  if (!bearer) return { error: 'NO_FLOW_KEY' };
  overlayTick(action === CAPTCHA_VIDEO ? 'Tạo video' : 'Tạo ảnh');

  const requestId = `req_${Date.now()}_${_reqSeq++}`;
  const cap = await solveCaptcha(requestId, action);
  const capToken = cap?.token;
  if (!capToken) return { error: `CAPTCHA_FAILED: ${cap?.error || 'unknown'}` };

  const finalBody = JSON.parse(JSON.stringify(body));
  if (finalBody.clientContext?.recaptchaContext) finalBody.clientContext.recaptchaContext.token = capToken;
  if (Array.isArray(finalBody.requests)) {
    for (const r of finalBody.requests) {
      if (r.clientContext?.recaptchaContext) r.clientContext.recaptchaContext.token = capToken;
    }
  }

  try {
    const resp = await inPageFetch(url, {
      method: 'POST',
      headers: { ...API_HEADERS, authorization: `Bearer ${bearer}` },
      body: JSON.stringify(finalBody),
    });
    const text = await resp.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    const err = !resp.ok ? (extractApiError(data) || `API_${resp.status}`) : extractApiError(data);
    if (err) return { error: err, status: resp.status };   // để renderer tự retry (self-heal); KHÔNG reload tab (reload phá gen song song)
    return { status: resp.status, data };
  } catch (e) {
    return { error: e.message || 'API_REQUEST_FAILED' };
  }
}

function extractApiError(data) {
  const err = data && typeof data === 'object' ? data.error : null;
  if (!err || typeof err !== 'object') return null;
  const reason = (err.details || []).map((d) => d?.reason).find(Boolean);
  const msg = err.message || err.status || 'API error';
  return reason ? `${reason}: ${msg}` : String(msg);
}

// ─── tRPC: tạo project (theo token) ────────────────────────

// Tìm sâu key 'projectId' trong mọi cấu trúc phản hồi (object/array lồng nhau).
function deepFindProjectId(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 8) return null;
  if (typeof obj.projectId === 'string' && obj.projectId) return obj.projectId;
  for (const k of Object.keys(obj)) {
    const v = deepFindProjectId(obj[k], depth + 1);
    if (v) return v;
  }
  return null;
}

// Chạy fetch NGAY TRONG TAB Flow (origin = labs.google) → Google chấp nhận cross-account token
// (fetch ở background service worker có origin extension → 401 khi token khác phiên đăng nhập).
let _genTabId = null;
let _flowTabP = null;   // khoá: nhiều luồng gen gọi cùng lúc → dùng CHUNG 1 tab, không mở tab thứ 2
async function _flowTab() {
  if (_genTabId != null) { try { await chrome.tabs.get(_genTabId); return _genTabId; } catch { _genTabId = null; } }
  if (_flowTabP) return _flowTabP;   // đang mở dở → chờ chung
  _flowTabP = (async () => {
    const tabs = await chrome.tabs.query({ url: FLOW_TAB_MATCH });
    if (tabs.length) {
      _genTabId = tabs[0].id;
      // Dọn tab Flow dư (nếu nhiều luồng lỡ mở nhiều) → chỉ giữ 1.
      for (let i = 1; i < tabs.length; i++) { try { await chrome.tabs.remove(tabs[i].id); } catch {} }
      return _genTabId;
    }
    const t = await openFlowTab(true); _genTabId = t && t.id; return _genTabId;   // tự mở 1 tab Flow (hiện lên) để chạy + thấy overlay
  })();
  try { return await _flowTabP; } finally { _flowTabP = null; }
}

// Overlay "đang xử lý — đừng tắt" trên tab Flow (như đối thủ) để người dùng hiểu tab đó đang chạy.
// active=true → đang xử lý; active=false → trạng thái "sẵn sàng" (VẪN HIỆN, không ẩn/tắt được).
async function _setOverlay(active, label, count) {
  const tabId = await _flowTab();
  if (!tabId) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId }, world: 'MAIN',
      func: (on, lbl, n) => {
        let el = document.getElementById('__nova_ov');
        if (!el) {
          el = document.createElement('div'); el.id = '__nova_ov';
          el.style.cssText = 'position:fixed;z-index:2147483647;left:50%;top:44%;transform:translate(-50%,-50%);width:400px;max-width:92vw;padding:32px 36px;border-radius:22px;background:rgba(17,18,28,.95);backdrop-filter:blur(14px);box-shadow:0 30px 90px -14px rgba(0,0,0,.75);border:1px solid rgba(255,255,255,.10);color:#fff;font-family:-apple-system,system-ui,sans-serif;text-align:center;pointer-events:none';
          (document.body || document.documentElement).appendChild(el);
        }
        el.style.display = 'block';
        const status = on
          ? '<div style="font-size:14px;color:#4ade80;margin-bottom:8px">● Đang xử lý…</div><div style="font-size:24px;font-weight:800;color:#60a5fa;margin-bottom:14px">' + (lbl || 'Đang chạy') + (n != null ? ' #' + n : '') + '</div><div style="font-size:12.5px;color:#8b95a5">🤖 App đang tự động tạo qua tab này</div>'
          : '<div style="font-size:14px;color:#4ade80;margin-bottom:8px">● Sẵn sàng</div><div style="font-size:20px;font-weight:800;color:#60a5fa;margin-bottom:14px">Nova Studio đang giữ tab</div><div style="font-size:12.5px;color:#8b95a5">🤖 Tab này để app tạo ảnh/video tự động</div>';
        el.innerHTML = '<div style="width:66px;height:66px;margin:0 auto 13px;border-radius:18px;background:linear-gradient(135deg,#7c3aed,#c2410c);display:flex;align-items:center;justify-content:center;font-size:34px;font-weight:800;color:#fff">N</div>'
          + '<div style="font-weight:800;font-size:19px">Nova Studio</div>'
          + '<div style="font-size:11px;letter-spacing:1.8px;color:#94a3b8;margin-bottom:15px">TỰ ĐỘNG XÁC THỰC</div>'
          + status
          + '<div style="font-size:12px;color:#8b95a5;margin-top:5px">Tab do Nova Studio quản lý — <b style="color:#fca5a5">ĐỪNG TẮT</b></div>';
      },
      args: [active, label || 'Đang chạy', (typeof count === 'number' ? count : null)],
    });
  } catch {}
}
let _ovCount = 0, _ovTimer = null;
function overlayTick(label) {
  _ovCount++;
  _setOverlay(true, label, _ovCount);
  if (_ovTimer) clearTimeout(_ovTimer);
  _ovTimer = setTimeout(() => _setOverlay(false), 9000);   // hết việc 9s → chuyển "Sẵn sàng" (VẪN HIỆN, không ẩn)
}
async function inPageFetch(url, opts = {}) {
  const tabId = await _flowTab();
  const mk = (ok, status, text) => ({ ok, status, text: async () => text });
  if (!tabId) return mk(false, 0, 'NO_FLOW_TAB');
  try {
    const r = await chrome.scripting.executeScript({
      target: { tabId }, world: 'MAIN',
      func: async (u, o) => { try { const resp = await fetch(u, { method: o.method || 'POST', headers: o.headers || {}, body: o.body || null, credentials: 'include' }); const t = await resp.text(); return { ok: resp.ok, status: resp.status, text: t }; } catch (e) { return { ok: false, status: 0, text: String(e && e.message || e) }; } },
      args: [url, { method: opts.method, headers: opts.headers, body: opts.body }],
    });
    const res = r && r[0] && r[0].result;
    return res ? mk(res.ok, res.status, res.text) : mk(false, 0, 'NO_RESULT');
  } catch (e) { return mk(false, 0, String(e && e.message || e)); }
}

async function createProject(title, token) {
  const bearer = token || flowKey;
  if (!bearer) return { error: 'NO_FLOW_KEY' };
  try {
    // createProject chạy TRONG TAB (profile sạch) kèm token ĐẦY ĐỦ của account → project chui đúng
    // vào account farm. Cần token đầy đủ (len ~2000, từ session endpoint) + phiên sạch 1-account.
    const resp = await inPageFetch(TRPC_CREATE_PROJECT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: '*/*', authorization: `Bearer ${bearer}` },
      body: JSON.stringify({ json: { projectTitle: title, toolName: 'PINHOLE' } }),
    });
    const text = await resp.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    if (!resp.ok) {
      let msg = '';
      try { const d2 = JSON.parse(text); msg = (d2 && d2.error && (d2.error.message || d2.error.status)) || (d2 && typeof d2.error === 'string' ? d2.error : ''); } catch {}
      return { error: `P${resp.status}: ${msg || String(text).slice(0, 90)}` };
    }
    const pid = deepFindProjectId(data);
    if (!pid) return { error: 'NO_PROJECT_ID · Google trả: ' + JSON.stringify(data).slice(0, 250) };
    return { project_id: pid };
  } catch (e) {
    return { error: e.message || 'TRPC_FAILED' };
  }
}

// ─── Upload ảnh tham chiếu (theo token) ────────────────────

async function uploadImage({ projectId, base64, mime, fileName, token }) {
  const bearer = token || flowKey;
  if (!bearer) return { error: 'NO_FLOW_KEY' };
  const clean = String(base64 || '').replace(/^data:[^;]+;base64,/, '');
  const body = {
    clientContext: { projectId: String(projectId), tool: 'PINHOLE' },
    fileName: fileName || 'ref.png',
    imageBytes: clean,
    isHidden: false,
    isUserUploaded: true,
    mimeType: mime || 'image/png',
  };
  try {
    const resp = await inPageFetch(UPLOAD_IMAGE_URL, {
      method: 'POST',
      headers: { ...API_HEADERS, authorization: `Bearer ${bearer}` },
      body: JSON.stringify(body),
    });
    const text = await resp.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    if (!resp.ok) return { error: extractApiError(data) || `UPLOAD_${resp.status}` };
    const mediaId = data?.media?.name;
    if (!mediaId) return { error: 'NO_MEDIA_ID' };
    return { media_id: mediaId };
  } catch (e) {
    return { error: e.message || 'UPLOAD_FAILED' };
  }
}

// ─── Sinh ảnh ───────────────────────────────────────────────

function genImageUrl(projectId) {
  return `${FLOW_API_BASE}/v1/projects/${projectId}/flowMedia:batchGenerateImages`;
}

function buildImageBody({ prompt, projectId, aspect, modelName, tier, variantCount, refMediaIds }) {
  const n = Math.max(1, Math.min(Number(variantCount) || 1, 4));
  const ts = Date.now();
  const ctx = {
    projectId: String(projectId),
    recaptchaContext: { applicationType: 'RECAPTCHA_APPLICATION_TYPE_WEB', token: '' },
    sessionId: `;${ts}`,
    tool: 'PINHOLE',
    userPaygateTier: tier,
  };
  const refIds = Array.isArray(refMediaIds) ? refMediaIds.filter(Boolean) : [];
  const imageInputs = refIds.length
    ? refIds.map((mid) => ({ name: mid, imageInputType: 'IMAGE_INPUT_TYPE_REFERENCE' }))
    : null;

  const requests = [];
  for (let i = 0; i < n; i++) {
    const item = {
      clientContext: { ...ctx, recaptchaContext: { ...ctx.recaptchaContext }, sessionId: `;${ts + i}` },
      seed: (ts + i * 9973) % 1000000,
      structuredPrompt: { parts: [{ text: prompt }] },
      imageAspectRatio: aspect,
      imageModelName: modelName,
    };
    if (imageInputs) item.imageInputs = imageInputs.slice();
    requests.push(item);
  }
  return {
    clientContext: ctx,
    mediaGenerationContext: { batchId: crypto.randomUUID() },
    useNewMedia: true,
    requests,
  };
}

function extractMediaEntries(data) {
  const media = data?.data?.media;
  if (!Array.isArray(media)) return [];
  const out = [];
  for (const m of media) {
    if (!m || typeof m !== 'object') continue;
    const id = m.name;
    if (typeof id !== 'string' || !id) continue;
    let url = null;
    const gen = m.image?.generatedImage;
    if (gen && typeof gen.fifeUrl === 'string') url = gen.fifeUrl;
    out.push({ media_id: id, url });
  }
  return out;
}

async function fetchToDataUrl(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('IMG_HTTP_' + resp.status);
  const blob = await resp.blob();
  const buf = await blob.arrayBuffer();
  let bin = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 = btoa(bin);
  const mime = blob.type || 'image/png';
  return { dataUrl: `data:${mime};base64,${b64}`, b64, mime };
}

// 2K/4K → độ phân giải super-res của Flow (upscale THẬT, không phải phóng URL).
function _qualityToRes(q) {
  return q === '2048' ? 'UPSAMPLE_IMAGE_RESOLUTION_2K'
       : q === '3840' ? 'UPSAMPLE_IMAGE_RESOLUTION_4K' : null;
}

// Gom mọi URL ảnh trong 1 object (dò response upscale bất kể cấu trúc).
function _collectImageUrls(obj) {
  const out = [];
  (function walk(v) {
    if (!v) return;
    if (typeof v === 'string') {
      if (/^https?:\/\//.test(v) && /(googleusercontent|fife|lh3|flow-content|ggpht|usercontent)/i.test(v)) out.push(v);
    } else if (Array.isArray(v)) { v.forEach(walk); }
    else if (typeof v === 'object') { for (const k in v) walk(v[k]); }
  })(obj);
  return out;
}

// UPSCALE THẬT: gọi /v1/flow/upsampleImage → Flow trả ẢNH ĐÃ NÂNG dưới dạng base64 trong `encodedImage`
// (KHÔNG phải URL). Trả {b64,mime} nếu được, hoặc {url} (dự phòng), hoặc null.
let _lastUpsampleDbg = '';
function _b64Mime(b64) {
  return b64.startsWith('/9j/') ? 'image/jpeg' : b64.startsWith('iVBOR') ? 'image/png' : b64.startsWith('R0lGOD') ? 'image/gif' : 'image/jpeg';
}
async function upsampleImage(mediaId, resolution, token) {
  const body = {
    mediaId,
    targetResolution: resolution,
    clientContext: { recaptchaContext: { applicationType: 'RECAPTCHA_APPLICATION_TYPE_WEB', token: '' } },
  };
  const r = await apiRequestWithCaptcha(`${FLOW_API_BASE}/v1/flow/upsampleImage`, body, CAPTCHA_IMAGE, token);
  if (r.error) { _lastUpsampleDbg = 'ERR ' + r.error; console.warn('[FlowImageGen] upscale lỗi:', r.error); return null; }
  const d = r.data;
  const gotRes = d?.media?.image?.generatedImage?.upsampleMetadata?.imageUpsampleResolution
              || d?.image?.generatedImage?.upsampleMetadata?.imageUpsampleResolution || '?';
  // Ảnh nâng trả thẳng base64 → dùng luôn, khỏi fetch.
  if (typeof d?.encodedImage === 'string' && d.encodedImage.length > 100) {
    _lastUpsampleDbg = 'OK base64 res=' + gotRes;
    const b64 = d.encodedImage;
    return { b64, mime: _b64Mime(b64) };
  }
  // Dự phòng: nếu Flow đổi sang trả URL.
  const direct = d?.media?.image?.generatedImage?.fifeUrl || d?.image?.generatedImage?.fifeUrl;
  if (typeof direct === 'string') { _lastUpsampleDbg = 'OK url res=' + gotRes; return { url: direct }; }
  const urls = _collectImageUrls(d);
  if (urls.length) { _lastUpsampleDbg = 'OK collectUrl res=' + gotRes; return { url: urls[urls.length - 1] }; }
  _lastUpsampleDbg = 'OK no-image res=' + gotRes + ' keys=' + Object.keys(d || {}).join(',');
  return null;
}

async function attachImageData(entries, quality, token) {
  const upRes = _qualityToRes(quality);
  for (const e of entries) {
    if (!e.url) continue;
    const origUrl = e.url;         // URL gốc ĐÃ KÝ — luôn fetch được (KHÔNG chèn =w2048 làm hỏng chữ ký → hết 403).
    // ⭐ 2K/4K: LẤY ẢNH GỐC TRƯỚC (lúc URL ký còn hạn) → LUÔN có ảnh, dù upscale rớt/bị chặn captcha.
    //    Sau đó mới thử upscale để THAY bằng bản 2K. Trước đây upscale trước → chờ lâu → URL gốc hết hạn → 403 → ra trắng.
    if (upRes && e.media_id) {
      try {                                  // 1) ảnh gốc (dự phòng chắc chắn có ảnh)
        const base = await fetchToDataUrl(origUrl);
        e.dataUrl = base.dataUrl; e.b64 = base.b64; e.mime = base.mime;
      } catch (err) { /* gốc lỗi luôn → bước dưới ghi lỗi */ }
      _lastUpsampleDbg = '';
      try {                                  // 2) thử upscale → được thì THAY bằng 2K
        const up = await upsampleImage(e.media_id, upRes, token);
        if (up && up.b64) { e.b64 = up.b64; e.mime = up.mime; e.dataUrl = `data:${up.mime};base64,${up.b64}`; e.upscaled = true; }
        else if (up && up.url) {
          try { const img = await fetchToDataUrl(up.url); e.dataUrl = img.dataUrl; e.b64 = img.b64; e.mime = img.mime; e.upscaled = true; }
          catch (e2) { e.upscaleFailed = true; }   // fetch bản nâng lỗi → GIỮ ảnh gốc đã lấy
        } else { e.upscaleFailed = true; }          // upscale null (captcha rớt…) → GIỮ ảnh gốc
      } catch (err) { _lastUpsampleDbg = 'THROW ' + (err?.message || err); e.upscaleFailed = true; console.warn('[FlowImageGen] upscale throw:', err?.message || err); }
      e._upsDbg = _lastUpsampleDbg;
      if (!e.dataUrl) e.fetchError = e.fetchError || 'FETCH_FAILED';   // gốc + upscale đều lỗi
      continue;
    }
    // 1K (không upscale): fetch gốc như cũ
    try {
      const img = await fetchToDataUrl(origUrl);
      e.dataUrl = img.dataUrl; e.b64 = img.b64; e.mime = img.mime;
    } catch (err) {
      e.fetchError = err.message || 'FETCH_FAILED';
    }
  }
}

// Lỗi có nên thử lại không? Lỗi tạm thời (captcha/mạng/429/401/5xx) → có.
// Lỗi vĩnh viễn (content filter / 400 / prompt bậy) → không, thử lại cũng vô ích.
function isRetryable(err) {
  const e = String(err || '');
  // Không retry: lỗi vĩnh viễn (content filter) HOẶC hết quota ngày (thử lại cũng vô ích cho tới khi reset).
  if (/FILTER|PROMINENT_PEOPLE|SAFETY|INVALID_ARGUMENT|QUOTA|EXHAUSTED|RESOURCE_EXHAUSTED|API_400|API_404/i.test(e)) return false;
  return /CAPTCHA_FAILED|API_401|API_403|API_429|API_5\d\d|Failed to fetch|NetworkError|TIMEOUT|NO_FLOW_KEY|IMG_HTTP_5|API_REQUEST_FAILED/i.test(e);
}

// Ép tab Flow phát 1 request có credentials → webRequest bắt được token ya29 mới.
async function triggerTokenRefresh() {
  try {
    const tabs = await chrome.tabs.query({ url: FLOW_TAB_MATCH });
    if (!tabs.length) { await openFlowTab(false); await sleep(3000); return; }
    await chrome.scripting.executeScript({
      target: { tabId: tabs[0].id },
      func: () => fetch('/fx/tools/flow', { credentials: 'include' }),
    });
    console.log('[FlowImageGen] Đã kích token refresh trên tab Flow');
  } catch (e) { console.warn('[FlowImageGen] refresh token lỗi:', e?.message || e); }
}

// Sinh ảnh với 1 token cụ thể (mặc định primary) — có tự retry + backoff + refresh token.
async function genImage(params) {
  const maxTries = 3;
  let lastErr = 'UNKNOWN';
  for (let attempt = 1; attempt <= maxTries; attempt++) {
    // Đọc lại token mỗi vòng (đường primary có thể vừa được refresh).
    const token = params.token || flowKey;
    const tier = params.tier || (accounts[params.email]?.tier) || paygateTier || 'PAYGATE_TIER_ONE';
    if (!token) {
      lastErr = 'NO_FLOW_KEY';
      if (!params.token) {
        // Thử lấy token qua session trước; nếu không được mới ép refresh trên tab Flow.
        const st = await ensureSessionAccount();
        if (!st) { await triggerTokenRefresh(); await sleep(1500); }
        continue;
      }
      break;
    }
    const body = buildImageBody({ ...params, tier });
    const resp = await apiRequestWithCaptcha(genImageUrl(params.projectId), body, CAPTCHA_IMAGE, token);
    if (!resp.error) {
      const entries = extractMediaEntries(resp);
      if (params.withData) await attachImageData(entries, params.quality, token);
      return { media_entries: entries, attempts: attempt, account: params.email || userEmail || null };
    }
    lastErr = resp.error;
    if (!isRetryable(resp.error) || attempt === maxTries) break;

    // Token hết hạn (chỉ refresh được cho đường primary — pool có token riêng từng account).
    if (/API_401|NO_FLOW_KEY|UNAUTHENT/i.test(resp.error) && !params.token) {
      await triggerTokenRefresh();
    }
    // Backoff: 429 chờ lâu hơn (Google rate-limit), lỗi khác chờ ngắn.
    const wait = /API_429/i.test(resp.error) ? 4000 * attempt : 1200 * attempt;
    console.log(`[FlowImageGen] retry ${attempt}/${maxTries} sau ${wait}ms (${resp.error})`);
    await sleep(wait);
  }
  return { error: lastErr };
}

// ─── Sinh video (Veo) — ASYNC: submit → poll → tải mp4 ───────
// Cùng khuôn clientContext/recaptchaContext/projectId như ảnh, KHÁC ở chỗ BẤT ĐỒNG BỘ:
//   1) POST batchAsyncGenerateVideoReferenceImages  → trả mediaId (đơn hàng)
//   2) POLL batchCheckAsyncVideoGenerationStatus     → tới khi SUCCESSFUL
//   3) tải mp4 từ flow-content.google
const GEN_VIDEO_URL  = `${FLOW_API_BASE}/v1/video:batchAsyncGenerateVideoReferenceImages`;
const POLL_VIDEO_URL = `${FLOW_API_BASE}/v1/video:batchCheckAsyncVideoGenerationStatus`;

// MẶC ĐỊNH NHÚNG CỨNG — payload text/ảnh/poll + 4 mã model đã học sẵn 1 lần. Khách cài về DÙNG NGAY, không cần dạy.
// (token/projectId/prompt/mediaId/seed đều thay lúc chạy; token nhạy cảm đã scrub.)
const DEFAULT_VIDEO = {"genText":{"url":"https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoText","body":"{\"mediaGenerationContext\":{\"batchId\":\"\",\"audioFailurePreference\":\"BLOCK_SILENCED_VIDEOS\"},\"clientContext\":{\"projectId\":\"\",\"tool\":\"PINHOLE\",\"userPaygateTier\":\"PAYGATE_TIER_ONE\",\"sessionId\":\"\",\"recaptchaContext\":{\"token\":\"\",\"applicationType\":\"RECAPTCHA_APPLICATION_TYPE_WEB\"}},\"requests\":[{\"aspectRatio\":\"VIDEO_ASPECT_RATIO_LANDSCAPE\",\"textInput\":{\"structuredPrompt\":{\"parts\":[{\"text\":\"\"}]}},\"videoModelKey\":\"veo_3_1_t2v\",\"seed\":0,\"metadata\":{}}],\"useV2ModelConfig\":true}"},"genImage":{"url":"https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoReferenceImages","body":"{\"mediaGenerationContext\":{\"batchId\":\"\",\"audioFailurePreference\":\"BLOCK_SILENCED_VIDEOS\"},\"clientContext\":{\"projectId\":\"\",\"tool\":\"PINHOLE\",\"userPaygateTier\":\"PAYGATE_TIER_ONE\",\"sessionId\":\"\",\"recaptchaContext\":{\"token\":\"\",\"applicationType\":\"RECAPTCHA_APPLICATION_TYPE_WEB\"}},\"requests\":[{\"aspectRatio\":\"VIDEO_ASPECT_RATIO_LANDSCAPE\",\"textInput\":{\"structuredPrompt\":{\"parts\":[{\"text\":\"\"}]}},\"videoModelKey\":\"veo_3_1_r2v_lite\",\"seed\":0,\"metadata\":{},\"referenceImages\":[{\"mediaId\":\"\",\"imageUsageType\":\"IMAGE_USAGE_TYPE_ASSET\"}]}],\"useV2ModelConfig\":true}"},"poll":{"url":"https://aisandbox-pa.googleapis.com/v1/video:batchCheckAsyncVideoGenerationStatus","body":"{\"media\":[{\"name\":\"\",\"projectId\":\"\"}]}"},"modelKeys":{"omni-flash":"abra_t2v_8s","veo31-fast":"veo_3_1_t2v_fast","veo31-lite":"veo_3_1_t2v_lite","veo31-quality":"veo_3_1_t2v"}};
let videoLearn = { genText: DEFAULT_VIDEO.genText, genImage: DEFAULT_VIDEO.genImage, poll: DEFAULT_VIDEO.poll, modelKeys: { ...DEFAULT_VIDEO.modelKeys } };
let _pendingModelSlug = null;   // đang "dạy model": request gen kế tiếp → lấy videoModelKey lưu vào slug này
chrome.storage.local.get(['videoLearn', 'pendingModelSlug'], (d) => {
  if (d && d.videoLearn) {
    const L = d.videoLearn;   // học của KHÁCH (nếu có) đè lên mặc định — dự phòng khi Flow đổi API
    if (L.genText) videoLearn.genText = L.genText;
    else if (L.gen) videoLearn.genText = L.gen;   // migrate cấu trúc cũ
    if (L.genImage) videoLearn.genImage = L.genImage;
    if (L.poll) videoLearn.poll = L.poll;
    if (L.modelKeys) for (const s of Object.keys(L.modelKeys)) { const v = L.modelKeys[s]; const key = (v && typeof v === 'object') ? (v.image || v.text) : v; if (key) videoLearn.modelKeys[s] = key; }
  }
  if (d && d.pendingModelSlug) _pendingModelSlug = d.pendingModelSlug;   // bền qua SW ngủ dậy
});
function _hasRealRefImage(body) { try { return /"referenceImages"\s*:\s*\[\s*\{[^}]*"mediaId"\s*:\s*"[0-9a-f-]{8,}/i.test(body); } catch (e) { return false; } }
function _extractModelKey(body) { try { const m = body.match(/"videoModelKey"\s*:\s*"([^"]+)"/); return m ? m[1] : null; } catch (e) { return null; } }
try {
  chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
      try {
        if (details.method !== 'POST' || !details.requestBody || !details.requestBody.raw || !details.requestBody.raw[0]) return;
        const url = details.url || '';
        if (!/batchAsyncGenerateVideo|batchCheckAsyncVideoGenerationStatus/i.test(url)) return;
        const bytes = details.requestBody.raw[0].bytes;
        if (!bytes) return;
        const body = new TextDecoder('utf-8').decode(new Uint8Array(bytes));
        if (/CheckAsync|GenerationStatus/i.test(url)) { videoLearn.poll = { url, body, at: Date.now() }; }
        else {
          if (_hasRealRefImage(body)) videoLearn.genImage = { url, body, at: Date.now() };   // ảnh→video
          else videoLearn.genText = { url, body, at: Date.now() };                            // text→video
          // đang dạy model → lấy mã model (dùng chung cả text/ảnh, khác nhau chỉ ở có referenceImages hay không)
          if (_pendingModelSlug) {
            const mk = _extractModelKey(body);
            if (mk) {
              videoLearn.modelKeys[_pendingModelSlug] = mk;
              console.log('[FlowImageGen] HỌC model', _pendingModelSlug, '=', mk);
              _pendingModelSlug = null;
              chrome.storage.local.remove('pendingModelSlug');
            }
          }
        }
        chrome.storage.local.set({ videoLearn });
      } catch (e) {}
    },
    { urls: ['https://aisandbox-pa.googleapis.com/*'] },
    ['requestBody'],
  );
} catch (e) { console.warn('[FlowImageGen] video learn hook lỗi:', e?.message || e); }

function _vDeepSet(obj, keyPred, val) {
  (function w(o) { if (!o || typeof o !== 'object') return; for (const k of Object.keys(o)) { if (keyPred(k)) o[k] = val; else if (o[k] && typeof o[k] === 'object') w(o[k]); } })(obj);
}
function _vDeepSet2(obj, keyPred, fn) {   // đặt giá trị = fn(giá trị hiện tại)
  (function w(o) { if (!o || typeof o !== 'object') return; for (const k of Object.keys(o)) { if (keyPred(k)) o[k] = fn(o[k]); else if (o[k] && typeof o[k] === 'object') w(o[k]); } })(obj);
}
function _vSetPrompt(obj, prompt) {
  let done = false;
  (function w(o) {
    if (!o || typeof o !== 'object' || done) return;
    if (o.structuredPrompt && Array.isArray(o.structuredPrompt.parts)) { o.structuredPrompt.parts.forEach(p => { if (p && typeof p.text === 'string') { p.text = prompt; done = true; } }); }
    for (const k of Object.keys(o)) if (o[k] && typeof o[k] === 'object') w(o[k]);
  })(obj);
  if (!done) _vDeepSet(obj, k => k === 'prompt' || k === 'textInput', prompt);
}
function _vCollectUrls(data) {
  const out = [];
  (function w(v) {
    if (!v) return;
    if (typeof v === 'string') { if (/^https?:\/\//.test(v) && /(\.mp4|flow-content|googlevideo|videoplayback|fife|googleusercontent|servingUri|downloadUri)/i.test(v)) out.push(v); }
    else if (Array.isArray(v)) v.forEach(w);
    else if (typeof v === 'object') for (const k in v) w(v[k]);
  })(data);
  return out;
}
// Dò MỌI URL http (dùng cho response poll video — chỉ có URL media, ít nhiễu).
function _vAnyUrl(data) {
  const out = [];
  (function w(v) {
    if (!v) return;
    if (typeof v === 'string') { if (/^https?:\/\/\S{8,}/.test(v)) out.push(v); }
    else if (Array.isArray(v)) v.forEach(w);
    else if (typeof v === 'object') for (const k in v) w(v[k]);
  })(data);
  return out;
}
// Chọn template đã học theo chế độ: có ảnh → genImage, không → genText.
function _vLearnedFor(imageMediaId) { return imageMediaId ? (videoLearn.genImage || null) : (videoLearn.genText || videoLearn.gen || null); }
// Mirror request video THẬT đã học → chỉ thay prompt/ảnh/token/seed/project/model/độ dài.
function _vBodyFromLearned({ prompt, projectId, imageMediaId, capToken, modelKey, durationSecs }) {
  const tpl = _vLearnedFor(imageMediaId);
  if (!tpl || !tpl.body) return null;
  let body; try { body = JSON.parse(tpl.body); } catch { return null; }
  _vDeepSet(body, k => k === 'token', capToken);
  _vDeepSet(body, k => k === 'projectId', String(projectId));
  _vDeepSet(body, k => k === 'seed', Math.floor(Math.random() * 100000));
  _vDeepSet(body, k => k === 'sessionId', ';' + Date.now());
  if (modelKey) {
    // Vá LOẠI INPUT trong mã: ảnh→video cần r2v, text→video cần t2v (mã học từ chế độ nào cũng tự đổi cho khớp).
    const wantType = imageMediaId ? 'r2v' : 't2v';
    const typed = modelKey.replace(/(^|_)(t2v|r2v|i2v)(?=_|$)/, '$1' + wantType);
    _vDeepSet(body, k => k === 'videoModelKey', typed);
  }
  // Vá ĐỘ DÀI trong videoModelKey (kiểu ..._8s → ..._<dur>s) nếu chọn độ dài khác lúc dạy.
  if (durationSecs) _vDeepSet2(body, k => k === 'videoModelKey', (cur) => (typeof cur === 'string' ? cur.replace(/_(\d+)s\b/, '_' + durationSecs + 's') : cur));
  if (prompt) _vSetPrompt(body, prompt);
  if (imageMediaId) (function w(o) { if (!o || typeof o !== 'object') return; if (Array.isArray(o.referenceImages)) o.referenceImages.forEach(ri => { if (ri && typeof ri === 'object' && 'mediaId' in ri) ri.mediaId = imageMediaId; }); for (const k of Object.keys(o)) if (o[k] && typeof o[k] === 'object') w(o[k]); })(body);
  return body;
}

function videoNotConfigured(which) {
  return { error: 'VIDEO_CHUA_HOC_' + which + ' — hãy tạo 1 video ' + (which === 'image' ? 'ẢNH→VIDEO' : 'TEXT→VIDEO') + ' thật trên Flow 1 lần để app học, rồi thử lại.' };
}

async function submitVideo(token, { prompt, projectId, imageMediaId, modelKey, durationSecs }) {
  overlayTick('Tạo video');
  const requestId = `req_${Date.now()}_${_reqSeq++}`;
  const cap = await solveCaptcha(requestId, CAPTCHA_VIDEO);
  const capToken = cap?.token;
  if (!capToken) return { error: `CAPTCHA_FAILED: ${cap?.error || 'unknown'}` };
  const body = _vBodyFromLearned({ prompt, projectId, imageMediaId, capToken, modelKey, durationSecs });
  if (!body) return videoNotConfigured(imageMediaId ? 'image' : 'text');
  const tpl = _vLearnedFor(imageMediaId);
  const url = (tpl && tpl.url) || GEN_VIDEO_URL;
  try {
    const resp = await inPageFetch(url, { method: 'POST', headers: { ...API_HEADERS, 'content-type': 'text/plain;charset=UTF-8', authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    const text = await resp.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
    if (!resp.ok) return { error: extractApiError(data) || `VIDEO_${resp.status}` };
    const innerErr = extractApiError(data); if (innerErr) return { error: innerErr };
    const first = data && Array.isArray(data.media) && data.media[0];
    const mediaId = first && first.name;
    if (!mediaId) return { error: 'NO_MEDIA_ID · ' + String(text).slice(0, 160) };
    return { mediaId, projectId: (first && first.projectId) || projectId };
  } catch (e) { return { error: e.message || 'VIDEO_REQUEST_FAILED' }; }
}

async function pollVideo(token, { projectId, mediaId }) {
  let url = POLL_VIDEO_URL, body = null;
  if (videoLearn.poll && videoLearn.poll.body) {
    try {
      body = JSON.parse(videoLearn.poll.body);
      url = videoLearn.poll.url || POLL_VIDEO_URL;
      _vDeepSet(body, k => k === 'projectId', String(projectId));
      (function w(o) { if (!o || typeof o !== 'object') return; if (Array.isArray(o.media)) o.media.forEach(m => { if (m && typeof m === 'object') { if ('name' in m) m.name = mediaId; if ('mediaId' in m) m.mediaId = mediaId; } }); for (const k of Object.keys(o)) if (o[k] && typeof o[k] === 'object') w(o[k]); })(body);
    } catch { body = null; }
  }
  if (!body) body = { media: [{ name: mediaId, projectId: String(projectId) }] };
  try {
    const resp = await inPageFetch(url, { method: 'POST', headers: { ...API_HEADERS, 'content-type': 'text/plain;charset=UTF-8', authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    const text = await resp.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
    if (!resp.ok) return { error: extractApiError(data) || `POLL_${resp.status}` };
    const first = data && Array.isArray(data.media) && data.media[0];
    const status = first?.mediaMetadata?.mediaStatus?.mediaGenerationStatus || '';
    const done = /SUCCESSFUL/i.test(status), failed = /FAIL|ERROR|REJECT|BLOCK/i.test(status);
    // Link video nằm trong media[0].video (fifeUrl/servingUri/generatedVideo…). Dò kỹ field đó trước, rồi cả response.
    const vf = first && first.video;
    let videoUrl = null;
    if (vf && typeof vf === 'object') {
      videoUrl = vf.fifeUrl || vf.servingUri || vf.servingUrl || vf.url || vf.downloadUri
        || (vf.generatedVideo && (vf.generatedVideo.fifeUrl || vf.generatedVideo.servingUri || vf.generatedVideo.servingUrl || vf.generatedVideo.url)) || null;
      if (!videoUrl) { const u = _vAnyUrl(vf); if (u.length) videoUrl = u[u.length - 1]; }
    }
    if (!videoUrl) { const u = _vAnyUrl(data); if (u.length) videoUrl = u[u.length - 1]; }
    const credits = (data && typeof data.remainingCredits === 'number') ? data.remainingCredits : null;
    // CHẨN ĐOÁN: khi XONG mà chưa có link → gửi cấu trúc media để tìm field chứa fifeUrl (tải thuần token).
    let pollRaw = null;
    if (done && !videoUrl) { try { pollRaw = JSON.stringify(first).slice(0, 2500); } catch {} }
    return { status, done, failed, credits, videoUrl, pollRaw };
  } catch (e) { return { error: e.message || 'POLL_REQUEST_FAILED' }; }
}

// CHỘP URL file video: khi trang project phát video, trình duyệt GET /video/<mediaId> từ flow-content.google → lưu lại (đầy đủ, không cắt kẻo cụt chữ ký).
let _capturedVideoUrl = null;
let _recentFlowReqs = [];   // ring buffer URL video gần đây (khớp theo mediaId)
function _pushReq(o) { _recentFlowReqs.push(o); if (_recentFlowReqs.length > 14) _recentFlowReqs.shift(); }
try {
  chrome.webRequest.onBeforeRequest.addListener(
    (d) => { if (/GET/i.test(d.method) && /(\.mp4|flow-content\.google|videoplayback|googlevideo)/i.test(d.url)) { _capturedVideoUrl = { url: d.url, at: Date.now() }; _pushReq({ m: 'GET', url: d.url, at: Date.now() }); } },
    { urls: ['https://*.flow-content.google/*', 'https://flow-content.google/*', 'https://*.googleusercontent.com/*', 'https://*.googlevideo.com/*'] },
    [],
  );
} catch (e) { console.warn('[FlowImageGen] video-url hook lỗi:', e && e.message); }

// URL video = flow-content.google/video/<mediaId>?...chữ-ký (Flow cấp khi trang tải). Mở project (FOREGROUND để SPA render)
// → bấm phát card → trình duyệt tải /video/<mediaId> → chộp đúng URL theo mediaId → fetch trong trang.
function _findCapturedVideoUrl(mediaId) {
  const hit = _recentFlowReqs.filter(r => r.url && /\/video\//.test(r.url) && (!mediaId || r.url.includes(mediaId)));
  return hit.length ? hit[hit.length - 1].url.replace(/\.\.\.$/, '') : null;
}
async function _resolveVideoFromTab(projectId, mediaId, wantData) {
  try {
    let tabs = await chrome.tabs.query({ url: FLOW_TAB_MATCH });
    let tabId = tabs && tabs[0] && tabs[0].id;
    if (!tabId) { const t = await openFlowTab(false); tabId = t && t.id; }
    if (!tabId) return null;
    _recentFlowReqs = _recentFlowReqs.filter(r => !r.url || !r.url.includes(mediaId));   // bỏ URL cũ cùng mediaId (nếu có)
    // FOREGROUND: tab nền bị Chrome tạm dừng render SPA → phải đưa ra trước.
    await chrome.tabs.update(tabId, { url: `https://labs.google/fx/tools/flow/project/${projectId}`, active: true });
    await sleep(4500);
    let vurl = null;
    for (let i = 0; i < 24; i++) {   // ~70s
      vurl = _findCapturedVideoUrl(mediaId);
      if (vurl) break;
      try {
        await chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
          func: () => {
            const nap = ms => new Promise(r => setTimeout(r, ms));
            return (async () => {
              for (const v of document.querySelectorAll('video')) { try { v.muted = true; v.preload = 'auto'; const p = v.play(); if (p && p.catch) p.catch(() => {}); } catch (e) {} }
              const cards = Array.from(document.querySelectorAll('img, video, [role="button"]')).filter(el => (el.clientWidth || 0) > 150).slice(0, 6);
              for (const c of cards) { try { ['mouseover', 'mouseenter', 'pointerover'].forEach(ev => c.dispatchEvent(new MouseEvent(ev, { bubbles: true }))); } catch (e) {} }
              await nap(400);
              for (const c of cards) { try { c.click(); } catch (e) {} }
              await nap(500);
              for (const v of document.querySelectorAll('video')) { try { v.muted = true; v.play && v.play().catch(() => {}); } catch (e) {} }
            })();
          },
        });
      } catch (e) { /* trang chưa sẵn */ }
      vurl = _findCapturedVideoUrl(mediaId);
      if (vurl) break;
      // hoặc đọc thẳng <video>.currentSrc khớp mediaId
      try {
        const r2 = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, args: [mediaId], func: (mid) => { for (const v of document.querySelectorAll('video')) { const u = v.currentSrc || v.src; if (u && /^https?:/.test(u) && (!mid || u.includes(mid) || /\/video\//.test(u))) return u; } return null; } });
        const s = (r2 || []).map(x => x && x.result).find(Boolean); if (s) { vurl = s; break; }
      } catch (e) {}
      await sleep(2200);
    }
    if (!vurl) return { url: null };
    if (!wantData) return { url: vurl };
    // Tải file NGAY TRONG TRANG (đúng cookie/referer của Flow → không bị 403).
    try {
      const rr = await chrome.scripting.executeScript({
        target: { tabId },
        func: async (u) => {
          try { const r = await fetch(u, { credentials: 'include' }); if (!r.ok) return { err: 'HTTP_' + r.status }; const b = await r.blob(); const buf = await b.arrayBuffer(); let bin = ''; const a = new Uint8Array(buf); for (let j = 0; j < a.length; j++) bin += String.fromCharCode(a[j]); return { b64: btoa(bin), mime: b.type || 'video/mp4', size: a.length }; }
          catch (e) { return { err: String(e && e.message) }; }
        },
        args: [vurl],
      });
      const data = rr && rr[0] && rr[0].result;
      if (data && data.b64) return { url: vurl, b64: data.b64, mime: data.mime };
      return { url: vurl, fetchErr: data && data.err };
    } catch (e) { return { url: vurl, fetchErr: e && e.message }; }
  } catch (e) { console.warn('[FlowImageGen] resolve video lỗi:', e && e.message); return null; }
}

async function fetchVideoToDataUrl(url) {
  const r = await fetch(url); if (!r.ok) throw new Error('VID_HTTP_' + r.status);
  const b = await r.blob(); const buf = await b.arrayBuffer();
  let bin = ''; const u = new Uint8Array(buf);
  for (let i = 0; i < u.length; i++) bin += String.fromCharCode(u[i]);
  const b64 = btoa(bin); const mime = b.type || 'video/mp4';
  return { b64, mime, dataUrl: `data:${mime};base64,${b64}`, size: u.length };
}

// HÀNG ĐỢI lấy file: bước resolve mở 1 tab Flow ra foreground → chỉ cho 1 video lấy file tại 1 thời điểm
// (submit+poll vẫn chạy SONG SONG nhiều tài khoản). Tránh nhiều tab tranh nhau khi chạy lô lớn.
let _resolveLock = Promise.resolve();
function _resolveVideoQueued(projectId, mediaId, wantData) {
  const prev = _resolveLock;
  let release;
  _resolveLock = new Promise(r => { release = r; });
  return (async () => {
    try { await prev; } catch (e) {}
    try { return await _resolveVideoFromTab(projectId, mediaId, wantData); }
    finally { release(); }
  })();
}

// Tạo 1 video từ ảnh trên 1 token (đã có projectId). Trả {ok,...} | {error} | {quota}.
async function runVideoOnToken(token, params) {
  let projectId = params.projectId;
  if (!projectId) { const pr = await createProject('ChuKienMedia video', token); if (pr.error || !pr.project_id) return { error: pr.error || 'NO_PROJECT' }; projectId = pr.project_id; }
  let imageMediaId = null;
  if (params.image && params.image.base64) {
    const up = await uploadImage({ projectId, base64: params.image.base64, mime: params.image.mime || 'image/png', fileName: (params.sceneId || 'frame') + '.png', token });
    if (up.error) return isQuotaErr(up.error) ? { quota: true, error: 'UPLOAD: ' + up.error } : { error: 'UPLOAD: ' + up.error };
    imageMediaId = up.media_id;
  }
  const sub = await submitVideo(token, { prompt: params.prompt, projectId, imageMediaId, modelKey: params.modelKey, durationSecs: params.durationSecs });
  if (sub.error) return isQuotaErr(sub.error) ? { quota: true, error: sub.error } : sub;
  const started = Date.now(); let videoUrl = null, credits = null, lastP = null, done = false;
  while (Date.now() - started < 360000) {   // chờ tối đa 6 phút
    await sleep(6000);
    const p = await pollVideo(token, { projectId: sub.projectId, mediaId: sub.mediaId });
    lastP = p;
    if (p.credits != null) credits = p.credits;
    if (p.error) return isQuotaErr(p.error) ? { quota: true, error: p.error, mediaId: sub.mediaId } : { error: p.error, mediaId: sub.mediaId };
    if (p.failed) { const fe = 'Flow báo tạo video THẤT BẠI (' + (p.status || '?') + ')'; return isQuotaErr(p.status || fe) ? { quota: true, error: fe, mediaId: sub.mediaId } : { error: fe, mediaId: sub.mediaId }; }
    if (p.done) { videoUrl = p.videoUrl; done = true; break; }
  }
  if (!done) return { error: 'TIMEOUT chờ video (>6 phút)', mediaId: sub.mediaId };
  // Video XONG nhưng poll không trả link.
  let vidData = null;
  if (!videoUrl && _appManaged) {
    // CHẾ ĐỘ FARM: phiên trình duyệt extension KHÁC chủ project → mở trang project sẽ lỗi.
    // → nhờ APP resolve trong Chrome for Testing của CHÍNH tài khoản farm (đúng phiên).
    return { ok: true, needsAppResolve: true, mediaId: sub.mediaId, projectId: sub.projectId, credits, pollRaw: lastP && lastP.pollRaw };
  }
  if (!videoUrl) {
    const rv = await _resolveVideoQueued(sub.projectId, sub.mediaId, params.withData);   // xếp hàng: 1 tab, lần lượt
    if (rv) { videoUrl = rv.url; if (rv.b64) vidData = { b64: rv.b64, mime: rv.mime }; }
  }
  if (!videoUrl && !vidData) return { error: 'Video XONG nhưng chưa lấy được file (thử lại)', mediaId: sub.mediaId };
  let vid = vidData;
  if (!vid && params.withData && videoUrl && !/^blob:/.test(videoUrl)) { try { vid = await fetchVideoToDataUrl(videoUrl); } catch (e) { vid = { fetchError: e.message }; } }
  return { ok: true, mediaId: sub.mediaId, projectId: sub.projectId, videoUrl: /^blob:/.test(videoUrl || '') ? null : videoUrl, video: vid, credits };
}

function _videoResult(r, account) {
  // Khớp đúng shape app đọc: r.ok, r.videoUrl (camelCase), r.video.b64, r.credits, r.account.
  // needsAppResolve + projectId: để app tự resolve video trong Chrome for Testing của tài khoản farm.
  return r.ok
    ? { ok: true, mediaId: r.mediaId, projectId: r.projectId || null, videoUrl: r.videoUrl || null, video: r.video || null, credits: r.credits ?? null, account, needsAppResolve: !!r.needsAppResolve, pollRaw: r.pollRaw || null }
    : { ...r, account };
}

// Sinh video từ ảnh (1 tài khoản primary/session).
async function genVideoFromImage(params) {
  const token = params.token || flowKey || (await ensureSessionAccount());
  if (!token) return { error: 'NO_FLOW_KEY' };
  return _videoResult(await runVideoOnToken(token, params), userEmail);
}
async function genVideo(params) { return genVideoFromImage(params); }

// POOL video: chọn account rảnh (round-robin, bỏ account hết quota / đang bận) → chạy → nhả.
async function genVideoPool(params) {
  if (!poolAccounts().length) return { error: 'NO_ACCOUNTS' };
  if (!pool.busy) pool.busy = new Set();
  const start = Date.now(); const rotated = [];
  while (Date.now() - start < 900000) {   // chờ account rảnh tối đa 15 phút
    const free = poolAvailable().filter((e) => !pool.busy.has(e));
    if (!free.length) {
      if (poolAvailable().length === 0) return { error: 'ALL_ACCOUNTS_EXHAUSTED · tất cả tài khoản đã hết giới hạn hôm nay', rotated };
      await sleep(1500); continue;
    }
    const email = free[pool.cursor % free.length]; pool.cursor++;
    pool.busy.add(email);
    try {
      let projectId;
      try { projectId = await poolEnsureProject(email); }
      catch (e) { const m = 'PROJECT: ' + (e.message || e); if (isQuotaErr(m)) { pool.exhausted.add(email); rotated.push(email); continue; } return { error: m, account: email, rotated }; }
      const r = await runVideoOnToken(accounts[email].token, { ...params, projectId });
      if (r.quota) { pool.exhausted.add(email); rotated.push(email); continue; }   // account này hết quota → thử account khác
      return { ..._videoResult(r, email), rotated };
    } finally { pool.busy.delete(email); }
  }
  return { error: 'TIMEOUT chờ tài khoản rảnh', rotated };
}

async function armVideoLearn() {
  const tabs = await chrome.tabs.query({ url: FLOW_TAB_MATCH });
  if (!tabs.length) { await openFlowTab(true); } else { await chrome.tabs.update(tabs[0].id, { active: true }); }
  return { ok: true, armed: true };
}
// Dạy mã model: đánh dấu request gen kế tiếp là của model <slug>, mở Flow để user tạo 1 video bằng model đó.
async function armVideoModel(slug) {
  _pendingModelSlug = slug || null;
  if (_pendingModelSlug) chrome.storage.local.set({ pendingModelSlug: _pendingModelSlug }); else chrome.storage.local.remove('pendingModelSlug');
  const tabs = await chrome.tabs.query({ url: FLOW_TAB_MATCH });
  if (!tabs.length) { await openFlowTab(true); } else { await chrome.tabs.update(tabs[0].id, { active: true }); }
  return { ok: true, slug: _pendingModelSlug };
}
function videoModelStatus() { return { modelKeys: (videoLearn.modelKeys || {}), pending: _pendingModelSlug }; }
async function videoLearnStatus() {
  const t = !!((videoLearn.genText && videoLearn.genText.body) || (videoLearn.gen && videoLearn.gen.body));
  const im = !!(videoLearn.genImage && videoLearn.genImage.body);
  const poll = !!(videoLearn.poll && videoLearn.poll.body);
  return { text: t, image: im, poll, gen: t || im };   // 'gen' giữ tương thích
}

// ─── POOL: round-robin nhiều tài khoản ─────────────────────

let pool = { cursor: 0, projects: {}, uploads: {}, _proj: {}, _up: {}, exhausted: new Set() };
let _poolAbort = false;   // app bấm Dừng → poolGen BỎ NGAY, khỏi xoay hết account × captcha.

function poolReset() {
  pool = { cursor: 0, projects: {}, uploads: {}, _proj: {}, _up: {}, exhausted: new Set() };
}

function poolAccounts() {
  return accountOrder.filter((e) => accounts[e]?.token);
}
// Account còn dùng được (chưa hết quota trong phiên chạy này).
function poolAvailable() {
  return poolAccounts().filter((e) => !pool.exhausted.has(e));
}
// Lỗi "tài khoản này hết lượt" → cần XOAY sang account khác: quota/429 (giới hạn ngày ảnh) HOẶC hết credit (video).
function isQuotaErr(e) { return /QUOTA|EXHAUSTED|RESOURCE_EXHAUSTED|PER_MODEL_DAILY|API_429|INSUFFICIENT|NO_CREDIT|OUT_OF_CREDIT|NOT_ENOUGH|CREDIT_|PAYGATE|DAILY_LIMIT|LIMIT_EXCEEDED|RATE_LIMIT/i.test(String(e || '')); }

// Đảm bảo account có project (dùng chung Promise để tránh tạo trùng khi chạy song song).
function poolEnsureProject(email) {
  if (pool.projects[email]) return Promise.resolve(pool.projects[email]);
  // Ưu tiên project_id do app tạo sẵn TRONG phiên riêng của account (project chui đúng account).
  if (accounts[email] && accounts[email].projectId) { pool.projects[email] = accounts[email].projectId; return Promise.resolve(accounts[email].projectId); }
  if (!pool._proj[email]) {
    pool._proj[email] = (async () => {
      const r = await createProject('ChuKienMedia pool', accounts[email].token);
      if (r.error || !r.project_id) throw new Error(r.error || 'NO_PROJECT');
      pool.projects[email] = r.project_id;
      return r.project_id;
    })();
  }
  return pool._proj[email];
}

// Đảm bảo 1 ảnh tham chiếu đã upload vào project của account (cache theo email|name).
function poolEnsureRef(email, projectId, ref) {
  const key = email + '|' + ref.name;
  if (pool.uploads[email]?.[ref.name]) return Promise.resolve(pool.uploads[email][ref.name]);
  if (!pool._up[key]) {
    pool._up[key] = (async () => {
      const r = await uploadImage({ projectId, base64: ref.base64, mime: ref.mime, fileName: (ref.name || 'ref') + '.png', token: accounts[email].token });
      if (r.error || !r.media_id) return null;
      (pool.uploads[email] ||= {})[ref.name] = r.media_id;
      return r.media_id;
    })();
  }
  return pool._up[key];
}

// Sinh 1 ảnh qua pool: round-robin; account nào hết quota → tự chuyển account khác.
async function poolGen(params) {
  if (!poolAccounts().length) return { error: 'NO_ACCOUNTS' };
  let lastErr = 'UNKNOWN'; const rotated = [];
  for (let attempt = 0; attempt < poolAccounts().length + 1; attempt++) {
    if (_poolAbort) return { error: 'ĐÃ DỪNG', aborted: true, rotated };   // user bấm Dừng → thoát ngay
    const list = poolAvailable();
    if (!list.length) return { error: 'ALL_ACCOUNTS_EXHAUSTED · tất cả tài khoản đã hết giới hạn hôm nay', lastError: lastErr, rotated };
    const email = list[pool.cursor % list.length];
    pool.cursor++;

    let projectId;
    try { projectId = await poolEnsureProject(email); }
    catch (e) {
      lastErr = 'PROJECT: ' + (e.message || e);
      if (isQuotaErr(lastErr)) { pool.exhausted.add(email); rotated.push(email); continue; }
      return { error: lastErr, account: email, rotated };
    }

    let refMediaIds = [];
    if (Array.isArray(params.refs) && params.refs.length) {
      for (const ref of params.refs) {
        if (!ref?.base64 || !ref?.name) continue;
        const mid = await poolEnsureRef(email, projectId, ref);
        if (mid) refMediaIds.push(mid);
      }
    }

    if (_poolAbort) return { error: 'ĐÃ DỪNG', aborted: true, rotated };   // vừa xong ref/project mà bấm Dừng → khỏi tốn 1 lượt gen
    const res = await genImage({
      prompt: params.prompt, projectId, aspect: params.aspect, modelName: params.modelName,
      tier: accounts[email].tier, variantCount: params.variantCount || 1, quality: params.quality,
      withData: params.withData, refMediaIds, token: accounts[email].token, email,
    });
    if (!res.error) return { ...res, account: email, rotated };
    lastErr = res.error;
    if (isQuotaErr(res.error)) { pool.exhausted.add(email); rotated.push(email); continue; }   // hết quota → chuyển account
    return { ...res, account: email, rotated };   // lỗi khác → trả luôn
  }
  return { error: 'ALL_ACCOUNTS_EXHAUSTED', lastError: lastErr, rotated };
}

// ─── Router dùng chung (cho cả web-postMessage lẫn app-bridge) ───────────

async function handleAction(action, payload) {
  payload = payload || {};
  try { await _readyP; } catch {}   // đảm bảo đã nạp xong kho farm (app-managed) trước khi gen/trả trạng thái
  switch (action) {
    case 'PING':          return { ok: true, ext: true };
    case 'GET_STATUS':    return statusPayload();
    case 'GET_ACCOUNTS':  return { accounts: statusPayload().accounts, count: accountOrder.length };
    case 'SCAN':          await scanAllAccounts(); return statusPayload();
    case 'OPEN_FLOW_TAB': {
      if (payload.url) { const t = await chrome.tabs.create({ url: payload.url, active: true }); return { ok: true, tabId: t?.id }; }
      const tabs = await chrome.tabs.query({ url: FLOW_TAB_MATCH });
      if (tabs.length) { await chrome.tabs.update(tabs[0].id, { active: true }); return { ok: true }; }
      const t = await openFlowTab(true); return { ok: true, tabId: t?.id };
    }
    case 'EXPORT_COOKIES':  return await exportCookies();
    case 'CREATE_PROJECT': return await createProject(payload.title || `ImageGen ${new Date().toISOString().slice(0, 19)}`);
    case 'GEN_IMAGE':      return await genImage(payload);
    case 'UPLOAD_IMAGE':   return await uploadImage(payload);
    case 'POOL_RESET':     poolReset(); return { ok: true, accounts: poolAccounts().length };
    case 'POOL_ABORT':     _poolAbort = !!payload.on; return { ok: true, aborting: _poolAbort };
    case 'SET_ACCOUNTS':   return setAccountsFromApp(payload.accounts);   // app bơm N token (1 tab + N token)
    case 'POOL_GEN':       return await poolGen(payload);
    case 'GET_BEARER':     { const t = await ensureSessionAccount(); return t ? { token: t } : { error: 'NO_TOKEN' }; }
    case 'DOWNLOAD_FILE':  return await downloadFile(payload);
    case 'GEN_VIDEO':      return await genVideo(payload);
    case 'GEN_VIDEO_FROM_IMAGE': return await genVideoFromImage(payload);
    case 'POOL_GEN_VIDEO': return await genVideoPool(payload);
    case 'VIDEO_LEARN_ARM':    return await armVideoLearn();
    case 'VIDEO_LEARN_STATUS': return await videoLearnStatus();
    case 'VIDEO_MODEL_ARM':    return await armVideoModel(payload && payload.slug);
    case 'VIDEO_MODEL_STATUS': return videoModelStatus();
    default:               return { error: 'UNKNOWN_MESSAGE' };
  }
}

// Xuất cookie đăng nhập Google (để app lưu tài khoản dùng lại khi đổi trình duyệt).
async function exportCookies() {
  if (!chrome.cookies) return { error: 'NO_COOKIES_PERMISSION' };
  const domains = ['google.com', 'labs.google', 'accounts.google.com'];
  const seen = {}; const out = [];
  for (const domain of domains) {
    let cks = [];
    try { cks = await chrome.cookies.getAll({ domain }); } catch (e) { continue; }
    for (const c of cks) {
      const k = c.name + '|' + c.domain + '|' + c.path;
      if (seen[k]) continue; seen[k] = 1;
      out.push({ name: c.name, value: c.value, domain: c.domain, path: c.path, secure: c.secure, httpOnly: c.httpOnly, expirationDate: c.expirationDate, sameSite: c.sameSite });
    }
  }
  if (!out.length) return { error: 'NO_COOKIES' };
  const email = accountOrder[0] ? (accounts[accountOrder[0]] || {}).email : (userEmail || null);
  return { cookies: out, email, count: out.length };
}

// Web (chukienmedia.com) gọi qua content-script bridge.js → chrome.runtime.
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  const payload = (msg?.type === 'CREATE_PROJECT') ? { title: msg.title } : (msg?.params || {});
  handleAction(msg?.type, payload).then(reply).catch((e) => reply({ error: e?.message || 'ERR' }));
  return true;
});

// ─── App-bridge: nối vào app Electron (chế độ Chrome Extension) ──────────
// App chạy server 127.0.0.1:8792; extension long-poll lấy lệnh → chạy → trả kết quả.

const APP_BRIDGE = 'http://127.0.0.1:8792';
let _bridgeRunning = false;
const EXT_VER = (() => { try { return chrome.runtime.getManifest().version; } catch { return '0'; } })();   // báo cho app để nhắc cập nhật khi lệch

function bridgePostReply(id, result) {
  fetch(`${APP_BRIDGE}/bridge/reply`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, result }) }).catch(() => {});
}

async function bridgeLoop() {
  if (_bridgeRunning) return;
  _bridgeRunning = true;
  console.log('[FlowImageGen] app-bridge loop → ' + APP_BRIDGE);
  while (_bridgeRunning) {
    try {
      const r = await fetch(`${APP_BRIDGE}/bridge/poll?v=${EXT_VER}`, { method: 'GET' });
      if (!r.ok) { await sleep(2000); continue; }
      const cmd = await r.json();
      if (cmd && cmd.id && cmd.action) {
        // xử lý bất đồng bộ → tiếp tục poll để chạy song song nhiều lệnh
        handleAction(cmd.action, cmd.payload || {})
          .then((result) => bridgePostReply(cmd.id, result))
          .catch((err) => bridgePostReply(cmd.id, { error: err?.message || String(err) }));
      }
    } catch (e) {
      await sleep(2500);   // app chưa mở / bridge tắt → chờ rồi thử lại
    }
  }
}

function bridgePing() { fetch(`${APP_BRIDGE}/bridge/ping?v=${EXT_VER}`).catch(() => {}); }

// Giữ service worker sống + tự khởi động lại vòng lặp mỗi khi SW bị đánh thức.
// (Antidetect như GPM hay để SW ngủ → alarm 30s + mọi event khởi động lại loop.)
function startBridge() { bridgePing(); bridgeLoop(); }
try {
  chrome.alarms.create('flowBridgeKeepAlive', { periodInMinutes: 0.5 });   // 30s: nhỏ nhất cho phép
  chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'flowBridgeKeepAlive') startBridge(); });
} catch (e) { /* alarms có thể chưa sẵn */ }
try { chrome.runtime.onStartup.addListener(startBridge); } catch (e) { /* */ }
try { chrome.runtime.onInstalled.addListener(startBridge); } catch (e) { /* */ }
setInterval(bridgePing, 4000);
startBridge();

console.log('[FlowImageGen] service worker đã tải');
