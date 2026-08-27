/**
 * Flow Bridge (chế độ Chrome Extension) — server HTTP cục bộ để app nói chuyện với
 * extension "Flow Image Gen" chạy trong Chrome THẬT của người dùng.
 *
 * Vì extension trong Chrome không truy cập được app Electron, ta dùng long-poll:
 *   - App xếp lệnh vào hàng đợi (call(action,payload)).
 *   - Extension GET /bridge/poll  → nhận 1 lệnh {id,action,payload} (chờ tối đa 25s).
 *   - Extension chạy xong POST /bridge/reply {id,result}.
 *   - Extension GET /bridge/ping định kỳ để app biết "đã kết nối".
 * Cổng riêng 8793 để extension Nova không đụng app cũ.
 */

const http = require('http');

const PORT = 8793;
let server = null;
let extLastSeen = 0;
let extVersion = null;   // version extension đang kết nối (báo qua ?v=… lúc poll/ping) → so với bản mới để nhắc cập nhật
function _grabVer(req) { try { const v = new URL(req.url, 'http://x').searchParams.get('v'); if (v) extVersion = v; } catch {} }
let seq = 0;

const pending = new Map();   // id -> { resolve, timer }
const queue = [];            // lệnh chờ extension lấy
let waiters = [];            // long-poll đang treo: { res, timer }

function readBody(req, cb) {
  let b = '';
  req.on('data', (c) => { b += c; if (b.length > 60 * 1024 * 1024) req.destroy(); });
  req.on('end', () => cb(b));
  req.on('error', () => cb(''));
}

function flushToWaiter(cmd) {
  while (waiters.length) {
    const w = waiters.shift();
    clearTimeout(w.timer);
    try { w.res.writeHead(200, { 'content-type': 'application/json' }); w.res.end(JSON.stringify(cmd)); return true; }
    catch { /* waiter chết → thử cái kế */ }
  }
  return false;
}

function handlePoll(req, res) {
  extLastSeen = Date.now(); _grabVer(req);
  if (queue.length) {
    const cmd = queue.shift();
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(cmd));
    return;
  }
  const holder = { res, timer: null };
  holder.timer = setTimeout(() => {
    waiters = waiters.filter((w) => w !== holder);
    try { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); } catch { /* */ }
  }, 25000);
  waiters.push(holder);
}

function handleReply(body) {
  let d; try { d = JSON.parse(body); } catch { return; }
  if (!d || !d.id) return;
  const p = pending.get(d.id);
  if (!p) return;
  pending.delete(d.id);
  clearTimeout(p.timer);
  p.resolve(d.result);
}

function start() {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'content-type');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
      const url = (req.url || '').split('?')[0];
      if (url === '/bridge/poll' && req.method === 'GET') { handlePoll(req, res); return; }
      if (url === '/bridge/reply' && req.method === 'POST') { readBody(req, (b) => { handleReply(b); res.writeHead(200); res.end('{}'); }); return; }
      if (url === '/bridge/ping') { extLastSeen = Date.now(); _grabVer(req); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true })); return; }
      res.writeHead(404); res.end();
    });
    server.on('error', (e) => { console.warn('[flow-bridge] lỗi cổng', PORT, e.message); resolve(0); });
    server.listen(PORT, '127.0.0.1', () => { console.log('[flow-bridge] chạy ở 127.0.0.1:' + PORT); resolve(PORT); });
  });
}

// App gọi 1 lệnh tới extension, chờ kết quả.
function call(action, payload) {
  return new Promise((resolve) => {
    const id = 'c' + (++seq) + '_' + Date.now();
    const timer = setTimeout(() => { if (pending.has(id)) { pending.delete(id); resolve({ error: 'BRIDGE_TIMEOUT' }); } }, 600000);   // 10 phút — video Veo mất 3-6 phút
    pending.set(id, { resolve, timer });
    const cmd = { id, action, payload };
    if (!flushToWaiter(cmd)) queue.push(cmd);
  });
}

function status() {
  // Ngưỡng 35s: service worker (nhất là trong GPM) hay chợp ngủ giữa 2 lần ping/alarm (~30s)
  // → nới rộng để không báo "rớt" oan khi nó chỉ ngủ ngắn rồi tự thức lại.
  return { running: !!server, port: PORT, extensionConnected: (Date.now() - extLastSeen) < 35000, extVersion };
}

module.exports = { start, call, status, PORT };
