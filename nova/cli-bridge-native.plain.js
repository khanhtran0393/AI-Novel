/**
 * CLI Bridge Native — chạy THẲNG trong app (không cần tải/chạy bridge riêng, không terminal).
 * Bọc CLI gói subscription của user (Claude Code / Codex) thành API kiểu OpenAI trên localhost:
 *   - Claude  → 127.0.0.1:8795
 *   - Codex   → 127.0.0.1:8796
 * Renderer gọi y như cũ (provider "CLI tự host" + endpoint localhost:8795, nút Đăng nhập).
 * Yêu cầu: user đã cài Claude Code / Codex CLI (đăng nhập qua nút trong app, khỏi terminal).
 */

const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const MAX_CONCURRENT = 2;
const TIMEOUT_MS = 900000;   // 15 phút — kịch bản dài + prompt phong cách nặng có thể lâu (gói Claude/ChatGPT chậm hơn API)

// GUI app (mở từ Dock/Start) có PATH nghèo → bổ sung nơi hay cài CLI để tìm thấy `claude`/`codex`.
function goodEnv() {
  const home = os.homedir();
  const extra = ['/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', '/bin',
    path.join(home, '.npm-global/bin'), path.join(home, '.local/bin'),
    path.join(home, '.bun/bin'), path.join(home, '.deno/bin')];
  const env = { ...process.env };
  const cur = env.PATH || '';
  env.PATH = [cur, ...extra].filter(Boolean).join(path.delimiter);
  return env;
}

// Lưu 1 data URL / base64 ra file tạm. Trả path hoặc null.
function saveImage(dataUrl) {
  try {
    const s = String(dataUrl || '');
    const m = s.match(/^data:(image\/[a-z0-9.+-]+)?;base64,(.*)$/i);
    const b64 = m ? m[2] : s;
    const ext = (m && m[1] ? m[1].split('/')[1] : 'png').replace('jpeg', 'jpg');
    const f = path.join(os.tmpdir(), 'ckm-img-' + Date.now() + '-' + Math.floor(Math.random() * 1e6) + '.' + ext);
    fs.writeFileSync(f, Buffer.from(b64, 'base64'));
    return f;
  } catch { return null; }
}

// Dựng prompt + tách ảnh (ghi ra file tạm) từ messages kiểu OpenAI/Anthropic.
function buildPrompt(messages) {
  const images = [];
  const text = (messages || []).map((m) => {
    let parts;
    if (typeof m.content === 'string') parts = [m.content];
    else {
      parts = [];
      for (const x of (m.content || [])) {
        if (x.type === 'text' && x.text) parts.push(x.text);
        else if (x.type === 'image_url' && x.image_url && x.image_url.url) { const f = saveImage(x.image_url.url); if (f) { images.push(f); parts.push('[Ảnh đính kèm: ' + f + ']'); } }
        else if (x.type === 'image' && x.source && x.source.data) { const f = saveImage('data:' + (x.source.media_type || 'image/png') + ';base64,' + x.source.data); if (f) { images.push(f); parts.push('[Ảnh đính kèm: ' + f + ']'); } }
        else if (x.text) parts.push(x.text);
      }
    }
    const tag = m.role === 'system' ? '[System]\n' : m.role === 'assistant' ? '[Assistant]\n' : '';
    return tag + parts.join('\n');
  }).join('\n\n');
  return { text, images };
}

// Một "bridge" cho 1 engine (claude/codex) trên 1 cổng.
function createBridge(engine, port) {
  let active = 0;
  const queue = [];
  const acquire = () => new Promise((res) => { const t = () => { if (active < MAX_CONCURRENT) { active++; res(); } else queue.push(t); }; t(); });
  const release = () => { active--; const n = queue.shift(); if (n) n(); };

  function runCLI(promptData, model) {
    const images = (promptData && promptData.images) || [];
    let prompt = (promptData && promptData.text) || String(promptData || '');
    const cleanup = () => { for (const f of images) { try { fs.unlinkSync(f); } catch {} } };
    return acquire().then(() => new Promise((resolve, reject) => {
      let cmd, args, useStdin = true;
      if (engine === 'codex') {
        cmd = 'codex'; args = ['exec', '--skip-git-repo-check'];
        images.forEach((f) => args.push('-i', f));   // Codex: đính ảnh qua -i (nếu bản codex hỗ trợ)
        args.push(prompt); useStdin = false;
      } else {
        cmd = 'claude'; args = ['-p', '--output-format', 'text'];
        if (model === 'opus' || model === 'sonnet') args.push('--model', model);
        if (images.length) {
          args.push('--allowedTools', 'Read');   // chỉ cho phép Read (xem ảnh), không tool khác
          prompt += '\n\nẢNH ĐÍNH KÈM: ' + images.join(' , ')
            + '\nHãy dùng công cụ Read để MỞ XEM từng ảnh trên (Read hiển thị ảnh trực tiếp cho bạn). '
            + 'TUYỆT ĐỐI không chạy lệnh shell (sips/bash/identify…), không hỏi quyền — chỉ Read rồi trả lời yêu cầu.';
        }
      }
      const cp = spawn(cmd, args, { env: goodEnv(), cwd: os.homedir(), shell: process.platform === 'win32' });
      let out = '', err = '', done = false;
      const finish = (fn, v) => { if (done) return; done = true; clearTimeout(timer); release(); cleanup(); fn(v); };
      const timer = setTimeout(() => { try { cp.kill('SIGKILL'); } catch {} finish(reject, new Error('CLI timeout')); }, TIMEOUT_MS);
      cp.stdout.on('data', (d) => (out += d));
      cp.stderr.on('data', (d) => (err += d));
      cp.on('error', (e) => finish(reject, new Error(e.code === 'ENOENT' ? ('Chưa cài ' + cmd + ' CLI trên máy.') : e.message)));
      cp.on('close', (code) => code === 0 ? finish(resolve, out.trim()) : finish(reject, new Error(err.trim() || ('exit ' + code))));
      if (useStdin) { try { cp.stdin.write(prompt); } catch {} }
      try { cp.stdin.end(); } catch {}
    }));
  }

  // ── Đăng nhập (không cần terminal): bắt URL CLI in ra → web → nhận code → stdin ──
  const loginArgs = engine === 'codex' ? ['login'] : ['setup-token'];
  let login = null;
  function cliExists() {
    try {
      const { spawnSync } = require('child_process');
      const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [engine], { env: goodEnv(), shell: process.platform === 'win32' });
      return r.status === 0;
    } catch { return false; }
  }
  function startLoginProc() {
    if (login && login.proc) { try { login.proc.kill('SIGKILL'); } catch {} }
    login = { proc: null, url: null, done: false, error: null, buf: '' };
    // Kiểm CLI có cài chưa (mọi OS) — tránh treo/báo nhầm trên Windows khi thiếu CLI
    if (!cliExists()) {
      login.error = 'Chưa cài ' + (engine === 'codex' ? 'Codex' : 'Claude Code') + ' CLI trên máy này. Xem hướng dẫn cài (nút bên dưới).';
      return;
    }
    const cp = spawn(engine, loginArgs, { env: goodEnv(), shell: process.platform === 'win32' });
    login.proc = cp;
    const onData = (d) => { login.buf += d.toString(); if (!login.url) { const m = login.buf.match(/https?:\/\/[^\s'"]+/); if (m) login.url = m[0]; } };
    cp.stdout.on('data', onData);
    cp.stderr.on('data', onData);
    cp.on('error', (e) => { login.error = e.code === 'ENOENT' ? ('Chưa cài ' + engine + ' CLI trên máy. Cài Claude Code / Codex trước.') : e.message; });
    cp.on('close', (code) => {
      login.done = code === 0;
      if (code !== 0 && !login.error) {
        // Lệnh đăng nhập cần terminal (TTY) → chạy trong app hay lỗi. Đa số máy đã đăng nhập sẵn.
        login.error = 'Đăng nhập trong app không chạy được (lệnh này cần Terminal). '
          + 'NẾU máy bạn ĐÃ đăng nhập ' + (engine === 'codex' ? 'Codex' : 'Claude Code') + ' rồi → bỏ qua, bấm Test là dùng được. '
          + 'CHƯA thì mở Terminal gõ: ' + (engine === 'codex' ? 'codex login' : 'claude') + ' (đăng nhập 1 lần).';
      }
    });
  }

  const cors = (res) => { res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Headers', '*'); res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS'); };
  const sendJSON = (res, obj, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  const readBody = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(b)); });

  const DBG = path.join(os.tmpdir(), 'ckm-cli-debug.txt');
  const dlog = (s) => { try { fs.appendFileSync(DBG, '[' + engine + '] ' + s + '\n'); } catch {} };
  const handler = async (req, res) => {
    cors(res);
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    const p = (req.url || '').split('?')[0];
    dlog('>> ' + req.method + ' ' + p);
    if (req.method === 'POST' && p === '/login/start') { startLoginProc(); return sendJSON(res, { ok: true }); }
    if (req.method === 'GET' && p === '/login/status') { return sendJSON(res, login ? { url: login.url, done: login.done, error: login.error } : { error: 'chưa bắt đầu' }); }
    if (req.method === 'POST' && p === '/login/code') {
      const b = await readBody(req); let code = ''; try { code = JSON.parse(b || '{}').code || ''; } catch {}
      if (!login || !login.proc) return sendJSON(res, { error: 'Chưa bắt đầu đăng nhập.' }, 400);
      try { login.proc.stdin.write(String(code).trim() + '\n'); } catch (e) { return sendJSON(res, { error: e.message }, 500); }
      return sendJSON(res, { ok: true });
    }
    if (req.method === 'POST' && p.includes('/chat/completions')) {
      const body = await readBody(req);
      try {
        const { messages, model } = JSON.parse(body || '{}');
        const pd = buildPrompt(messages);
        dlog('CHAT: ' + pd.images.length + ' ảnh · prompt ' + pd.text.length + ' ký tự');
        const text = await runCLI(pd, model);
        dlog('CLAUDE TRẢ (' + text.length + ' ký tự): ' + text.slice(0, 400).replace(/\n/g, ' '));
        return sendJSON(res, { choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }] });
      } catch (e) {
        dlog('LỖI: ' + String(e.message || e));
        return sendJSON(res, { error: { message: String(e.message || e) } }, 500);
      }
    }
    if (req.method === 'GET' && (p === '/health' || p === '/')) return sendJSON(res, { ok: true, engine, port });
    res.writeHead(404); res.end('not found');
  };

  // Nghe cả IPv4 (127.0.0.1) lẫn IPv6 (::1) → "localhost" luôn trúng bridge này, dù OS phân giải kiểu nào.
  const servers = [];
  for (const host of ['127.0.0.1', '::1']) {
    const s = http.createServer(handler);
    s.on('error', (e) => console.warn(`[cli-bridge ${engine}] ${host}:${port}:`, e.message));
    s.listen(port, host, () => console.log(`[cli-bridge] ${engine} → ${host}:${port}`));
    servers.push(s);
  }
  return servers;
}

let started = false;
let servers = [];
function startAll() {
  if (started) return servers;
  started = true;
  try { servers.push(...createBridge('claude', 8795)); } catch (e) { console.warn('[cli-bridge claude]', e.message); }
  try { servers.push(...createBridge('codex', 8796)); } catch (e) { console.warn('[cli-bridge codex]', e.message); }
  return servers;
}

function stopAll() {
  started = false;
  const owned = servers;
  servers = [];
  for (const server of owned) {
    try { server.close(); } catch (_) {}
    try { server.closeAllConnections && server.closeAllConnections(); } catch (_) {}
  }
}

module.exports = { startAll, stopAll };
