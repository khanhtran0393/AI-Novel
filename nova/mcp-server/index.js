#!/usr/bin/env node
/**
 * AI Video Studio — MCP Server (stdio)
 *
 * Cho AI agent (Claude Desktop / Codex / bất kỳ MCP client nào) điều khiển các năng lực
 * dựng video native của AI Video Studio. Server này là tiến trình node RIÊNG, nói chuyện với client
 * qua stdio (JSON-RPC 2.0, mỗi message 1 dòng), rồi chuyển tiếp sang cầu HTTP cục bộ mà app
 * AI Video Studio mở sẵn (mcp-bridge-native.js @ 127.0.0.1:8794).
 *
 *   MCP client  ⇄ (stdio)  index.js  ⇄ (HTTP 8794)  AI Video Studio app  →  FFmpeg / Real-ESRGAN / ...
 *
 * KHÔNG phụ thuộc package ngoài (tự cài đặt JSON-RPC + framing) → chỉ cần `node index.js`.
 * Yêu cầu: app AI Video Studio ĐANG CHẠY (để cầu 8794 sống). Với các tool "nặng" (render/upscale)
 * app còn phải mở cửa sổ chính. Riêng tools/list không cần app chạy.
 */

'use strict';

const http = require('http');

const BRIDGE = process.env.NOVA_MCP_BRIDGE || 'http://127.0.0.1:8794';
const PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = { name: 'nova-studio', version: '1.0.0' };

// mọi log ra STDERR — stdout chỉ dành cho message JSON-RPC.
const logErr = (...a) => { try { process.stderr.write('[nova-mcp] ' + a.join(' ') + '\n'); } catch (_) {} };

// ── HTTP POST tới cầu, không cần fetch (tương thích node cũ) ─────────────────
function bridgePost(route, payload, timeoutMs = 1000 * 60 * 30) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(route, BRIDGE.endsWith('/') ? BRIDGE : BRIDGE + '/'); } catch (e) { return reject(e); }
    const data = Buffer.from(JSON.stringify(payload || {}));
    const req = http.request({
      hostname: u.hostname, port: u.port || 80, path: u.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length },
    }, (res) => {
      let b = ''; res.on('data', (c) => (b += c));
      res.on('end', () => {
        let j = null; try { j = b ? JSON.parse(b) : {}; } catch { j = { error: 'Cầu trả về không phải JSON: ' + b.slice(0, 200) }; }
        if (res.statusCode >= 400 || (j && j.error)) return reject(new Error((j && j.error) || ('HTTP ' + res.statusCode)));
        resolve(j);
      });
    });
    req.on('error', (e) => reject(new Error(
      e.code === 'ECONNREFUSED'
        ? 'Không kết nối được AI Video Studio (cầu ' + BRIDGE + '). Hãy MỞ app AI Video Studio rồi thử lại.'
        : e.message)));
    req.setTimeout(timeoutMs, () => { req.destroy(new Error('Quá thời gian chờ (' + Math.round(timeoutMs / 1000) + 's).')); });
    req.end(data);
  });
}

function bridgeGet(route, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(route, BRIDGE.endsWith('/') ? BRIDGE : BRIDGE + '/'); } catch (e) { return reject(e); }
    const req = http.request({ hostname: u.hostname, port: u.port || 80, path: u.pathname, method: 'GET' }, (res) => {
      let b = ''; res.on('data', (c) => (b += c));
      res.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
    req.end();
  });
}

// ── Định nghĩa tool (name, mô tả, JSON Schema, route cầu) ────────────────────
const TOOLS = [
  {
    name: 'ffmpeg_info',
    description: 'Kiểm tra FFmpeg/ffprobe trong AI Video Studio đã sẵn sàng chưa. Gọi đầu tiên để chắc chắn dựng video được.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    route: '/ffmpeg-info', method: 'POST',
  },
  {
    name: 'probe_media',
    description: 'Đo độ dài (giây) của 1 file ảnh/video trên máy. Dùng để căn thời lượng cảnh trước khi render.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Đường dẫn tuyệt đối tới file media.' } },
      required: ['path'], additionalProperties: false,
    },
    route: '/probe-media', method: 'POST',
  },
  {
    name: 'render_video',
    description:
      'Dựng 1 video MP4 từ danh sách CẢNH (ảnh hoặc video clip) + giọng đọc/nhạc nền/phụ đề, bằng engine FFmpeg của AI Video Studio. ' +
      'Mỗi cảnh có ảnh và thời lượng; có thể thêm hiệu ứng Ken Burns và chuyển cảnh. Trả về đường dẫn file MP4 đã lưu.',
    inputSchema: {
      type: 'object',
      properties: {
        scenes: {
          type: 'array', minItems: 1,
          description: 'Danh sách cảnh theo thứ tự.',
          items: {
            type: 'object',
            properties: {
              image: { type: 'string', description: 'Đường dẫn ảnh (.png/.jpg/.webp) hoặc video clip (.mp4/.mov).' },
              seconds: { type: 'number', description: 'Thời lượng cảnh (giây). Mặc định 4.' },
              effect: { type: 'string', enum: ['none', 'zoom-in', 'zoom-out', 'pan-left', 'pan-right', 'pan-up', 'pan-down', 'random'], description: 'Hiệu ứng Ken Burns cho ảnh tĩnh.' },
              transition: { type: 'string', enum: ['none', 'fade', 'slide', 'wipe', 'dissolve', 'circle'], description: 'Chuyển cảnh sang cảnh kế.' },
              transDur: { type: 'number', description: 'Thời lượng chuyển cảnh (giây, 0.1–2).' },
            },
            required: ['image'], additionalProperties: false,
          },
        },
        output: { type: 'string', description: 'Đường dẫn MP4 để lưu (bắt buộc — server chạy nền không mở hộp thoại được).' },
        voiceover: { type: 'string', description: 'Đường dẫn file giọng đọc (mp3/wav). Video tự kéo dài đủ giọng.' },
        music: { type: 'string', description: 'Đường dẫn nhạc nền. Tự nhỏ + né giọng (ducking).' },
        musicVolume: { type: 'number', description: 'Âm lượng nhạc nền 0–1 (mặc định 0.22).' },
        subtitlesSrt: { type: 'string', description: 'Nội dung phụ đề định dạng SRT (burn cứng vào video).' },
        width: { type: 'number', description: 'Chiều rộng (mặc định 1920).' },
        height: { type: 'number', description: 'Chiều cao (mặc định 1080).' },
        fps: { type: 'number', description: 'FPS (mặc định 30).' },
        vcodec: { type: 'string', enum: ['h264', 'h265'], description: 'Bộ mã hoá (mặc định h264).' },
      },
      required: ['scenes', 'output'], additionalProperties: false,
    },
    route: '/render-video', method: 'POST',
  },
  {
    name: 'upscale_images',
    description: 'Nâng cấp độ phân giải ảnh (Real-ESRGAN, chạy offline trên máy). Nhận danh sách ảnh hoặc thư mục.',
    inputSchema: {
      type: 'object',
      properties: {
        inputs: { type: 'array', items: { type: 'string' }, description: 'Đường dẫn ảnh hoặc thư mục chứa ảnh.' },
        outputDir: { type: 'string', description: 'Thư mục lưu kết quả (mặc định cạnh ảnh gốc).' },
        model: { type: 'string', description: 'Model upscale (mặc định remacri-4x).' },
        target: { type: 'number', description: 'Cạnh dài mục tiêu (px, mặc định 3840).' },
        removeWatermark: { type: 'boolean', description: 'Xoá watermark trước khi nâng cấp.' },
      },
      required: ['inputs'], additionalProperties: false,
    },
    route: '/upscale', method: 'POST',
  },
  {
    name: 'remove_watermark',
    description: 'Xoá watermark/logo khỏi ảnh (WatermarkRemover-AI, chạy local). Nhận 1 file, hoặc cả thư mục nếu folder=true.',
    inputSchema: {
      type: 'object',
      properties: {
        input: { type: 'string', description: 'Đường dẫn file ảnh hoặc thư mục.' },
        output: { type: 'string', description: 'Đường dẫn/thư mục xuất (bỏ trống = tạo bản _wm cạnh ảnh gốc).' },
        folder: { type: 'boolean', description: 'true = xử lý cả thư mục input.' },
      },
      required: ['input'], additionalProperties: false,
    },
    route: '/remove-watermark', method: 'POST',
  },
];
const TOOL_BY_NAME = Object.fromEntries(TOOLS.map((t) => [t.name, t]));

// ── JSON-RPC qua stdio (message phân tách bằng dòng mới) ─────────────────────
function send(msg) { try { process.stdout.write(JSON.stringify(msg) + '\n'); } catch (e) { logErr('send lỗi', e.message); } }
function reply(id, result) { send({ jsonrpc: '2.0', id, result }); }
function replyErr(id, code, message) { send({ jsonrpc: '2.0', id, error: { code, message } }); }

async function handleMessage(msg) {
  const { id, method, params } = msg || {};
  // Notification (không id) → không trả lời.
  const isNotification = (id === undefined || id === null);

  try {
    if (method === 'initialize') {
      return reply(id, { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: SERVER_INFO });
    }
    if (method === 'notifications/initialized' || method === 'initialized') {
      return; // notification
    }
    if (method === 'ping') { return reply(id, {}); }
    if (method === 'tools/list') {
      return reply(id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    }
    if (method === 'tools/call') {
      const name = params && params.name;
      const args = (params && params.arguments) || {};
      const tool = TOOL_BY_NAME[name];
      if (!tool) return replyErr(id, -32602, 'Tool không tồn tại: ' + name);
      try {
        const out = await bridgePost(tool.route, args);
        return reply(id, { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] });
      } catch (e) {
        // Lỗi tool → trả trong content với isError để agent đọc được và tự sửa.
        return reply(id, { content: [{ type: 'text', text: 'Lỗi: ' + String(e && e.message || e) }], isError: true });
      }
    }
    if (isNotification) return;
    return replyErr(id, -32601, 'Method chưa hỗ trợ: ' + method);
  } catch (e) {
    if (!isNotification) replyErr(id, -32603, String(e && e.message || e));
    else logErr('lỗi notification', e && e.message);
  }
}

// đọc stdin theo dòng.
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg = null;
    try { msg = JSON.parse(line); } catch { logErr('JSON hỏng:', line.slice(0, 120)); continue; }
    handleMessage(msg);
  }
});
process.stdin.on('end', () => process.exit(0));

logErr('AI Video Studio MCP server sẵn sàng (cầu ' + BRIDGE + ').');
// Kiểm tra cầu ở nền, chỉ để log — không chặn.
bridgeGet('/health').then((h) => logErr('cầu OK:', JSON.stringify(h))).catch((e) => logErr('cầu chưa sẵn sàng:', e.message, '(mở app AI Video Studio).'));
