// Chọn bộ mã hoá video NHANH NHẤT mà máy khách thật sự chạy được.
//
// Trước đây Nova chỉ bật GPU khi process.platform === 'darwin'. Khách Windows dù
// cắm RTX vẫn encode bằng CPU (libx264 -preset medium) — chậm gấp nhiều lần.
//
// Vì sao KHÔNG dò bằng nvidia-smi: nó chỉ nói "máy có card NVIDIA", không nói
// "ffmpeg này encode được". Hai chuyện khác nhau — driver cũ hơn API nvenc mà
// ffmpeg cần, hết phiên encode đồng thời, hoặc bản ffmpeg build thiếu nvenc.
// Nên ở đây encode THẬT một khung 256×144 rồi vứt đi: mất ~200ms, đúng tuyệt đối.
//
// ffmpeg.exe đóng gói (BtbN gpl build) có sẵn: nvenc (NVIDIA), qsv (Intel),
// amf (AMD) — nên phủ được gần như mọi máy Windows, không riêng NVIDIA.
'use strict';
const { spawnSync } = require('child_process');
const { FFMPEG } = require('./ff-path');

// Thứ tự ưu tiên: nhanh & chất lượng tốt trước.
const CANDIDATES = {
  darwin: { h264: ['h264_videotoolbox'], h265: ['hevc_videotoolbox'] },
  win32:  { h264: ['h264_nvenc', 'h264_qsv', 'h264_amf'], h265: ['hevc_nvenc', 'hevc_qsv', 'hevc_amf'] },
  linux:  { h264: ['h264_nvenc', 'h264_qsv'], h265: ['hevc_nvenc', 'hevc_qsv'] },
};

let _compiled = null;                                    // encoder ffmpeg có build kèm
function compiledIn() {
  if (_compiled) return _compiled;
  _compiled = new Set();
  try {
    const r = spawnSync(FFMPEG, ['-hide_banner', '-encoders'], { encoding: 'utf8', timeout: 15000, windowsHide: true });
    for (const line of String(r.stdout || '').split('\n')) {
      const m = line.match(/^\s*[A-Z.]{6}\s+(\S+)/);
      if (m) _compiled.add(m[1]);
    }
  } catch (_) {}
  return _compiled;
}

// Encode thử 1 khung đen rồi vứt (-f null). Chạy được = dùng được.
function probe(enc) {
  try {
    const r = spawnSync(FFMPEG, [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=black:s=256x144:r=30:d=0.1',
      '-c:v', enc, '-frames:v', '1', '-f', 'null', '-',
    ], { encoding: 'utf8', timeout: 25000, windowsHide: true });
    return r.status === 0;
  } catch (_) { return false; }
}

const _cache = new Map();                                // 'h264' → tên encoder | null

/** Trả tên encoder GPU dùng được cho codec ('h264' | 'h265'), hoặc null nếu phải dùng CPU. */
function gpuEncoder(codec = 'h264') {
  const key = codec === 'h265' ? 'h265' : 'h264';
  if (_cache.has(key)) return _cache.get(key);
  const list = (CANDIDATES[process.platform] || {})[key] || [];
  const have = compiledIn();
  let found = null;
  for (const enc of list) {
    if (have.size && !have.has(enc)) continue;           // ffmpeg không có sẵn → khỏi thử
    if (probe(enc)) { found = enc; break; }
  }
  _cache.set(key, found);
  return found;
}

/**
 * Cờ chất lượng theo TỪNG dòng encoder — mỗi hãng một kiểu núm vặn, dùng nhầm
 * thì ffmpeg lặng lẽ bỏ qua rồi cho ra bitrate mặc định (mờ nhoè).
 *   nvenc → -cq   ·  qsv → -global_quality  ·  amf → -qp_i/-qp_p  ·  videotoolbox → chỉ ăn bitrate
 * @param {string} enc  tên encoder (null = CPU)
 * @param {{bitrateK?:number, crf?:number}} o
 */
function qualityArgs(enc, o = {}) {
  const bit = Number(o.bitrateK) || 0;
  const crf = Number.isFinite(Number(o.crf)) ? Number(o.crf) : 20;
  if (!enc) {                                            // CPU
    const a = ['-preset', 'medium'];
    if (bit) a.push('-b:v', bit + 'k', '-maxrate', Math.round(bit * 1.45) + 'k', '-bufsize', Math.round(bit * 2) + 'k');
    else a.push('-crf', String(crf));
    return a;
  }
  if (/videotoolbox/.test(enc)) return ['-b:v', (bit || 8000) + 'k', '-allow_sw', '1', '-realtime', '0'];
  if (/nvenc/.test(enc)) {
    // p5 = cân bằng tốc độ/chất lượng; -rc vbr + -cq cho chất lượng cố định như crf.
    const a = ['-preset', 'p5', '-rc', 'vbr', '-cq', String(crf + 3)];
    if (bit) a.push('-b:v', bit + 'k', '-maxrate', Math.round(bit * 1.45) + 'k', '-bufsize', Math.round(bit * 2) + 'k');
    else a.push('-b:v', '0');                            // 0 = để -cq cầm lái hoàn toàn
    return a;
  }
  if (/qsv/.test(enc)) {
    const a = ['-preset', 'medium'];
    if (bit) a.push('-b:v', bit + 'k', '-maxrate', Math.round(bit * 1.45) + 'k');
    else a.push('-global_quality', String(crf + 4));
    return a;
  }
  if (/amf/.test(enc)) {
    const a = ['-quality', 'balanced'];
    if (bit) a.push('-b:v', bit + 'k', '-maxrate', Math.round(bit * 1.45) + 'k');
    else a.push('-rc', 'cqp', '-qp_i', String(crf + 3), '-qp_p', String(crf + 3));
    return a;
  }
  return bit ? ['-b:v', bit + 'k'] : ['-crf', String(crf)];
}

const NICE = { h264_nvenc: 'NVIDIA NVENC', hevc_nvenc: 'NVIDIA NVENC', h264_qsv: 'Intel QuickSync', hevc_qsv: 'Intel QuickSync', h264_amf: 'AMD AMF', hevc_amf: 'AMD AMF', h264_videotoolbox: 'Apple VideoToolbox', hevc_videotoolbox: 'Apple VideoToolbox' };
const label = (enc) => NICE[enc] || (enc ? enc : 'CPU');

module.exports = { gpuEncoder, qualityArgs, label, probe };
