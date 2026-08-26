/* ══ LẤP ĐỦ GIÂY CHO CLIP ═════════════════════════════════════════════════════
   ffmpeg xin `-t 8` từ nguồn chỉ dài 5 giây thì ra file 5 giây, không báo lỗi.
   Remotion dùng OffthreadVideo KHÔNG lặp — hết clip là ĐỨNG HÌNH ở khung cuối.
   Đã đo: xin 8s từ nguồn 5s → file 5,00s → cảnh chết hình 3 giây.

   Bộ lọc chấm điểm đã loại ứng viên ngắn hơn cảnh, nhưng vẫn lọt hai đường:
     · mọi ứng viên đều ngắn → nơi gọi lùi về lấy cái đầu, thà có còn hơn trống
     · nguồn không khai thời lượng (duration = 0) → bộ lọc bỏ qua

   Nên chốt ở đây: sau khi cắt, file LUÔN đủ giây.
     thiếu ≤ 20%  → làm CHẬM lại (setpts) — chuyển động liền mạch, không thấy mối
     thiếu > 20%  → LẶP (stream_loop) — có mối nối nhưng còn hơn đứng hình
*/
const { spawn } = require('child_process');
const fs = require('fs');
const { FFMPEG, FFPROBE } = require('./ff-path');

function chay(bin, args, hetGio = 120000) {
  return new Promise((res) => {
    const ps = spawn(bin, args, { windowsHide: true });
    let e = '';
    const t = setTimeout(() => { try { ps.kill(); } catch (_) {} res(false); }, hetGio);
    ps.stderr.on('data', (d) => { e += d; });
    ps.on('error', () => { clearTimeout(t); res(false); });
    ps.on('close', (c) => { clearTimeout(t); res(c === 0); });
  });
}

function giayCua(f) {
  try {
    const o = require('child_process').execSync(
      `"${FFPROBE}" -v quiet -print_format json -show_format "${f}"`, { timeout: 20000 }).toString();
    return parseFloat(JSON.parse(o).format.duration) || 0;
  } catch (_) { return 0; }
}

/* Trả { ok, cach, tu, den } — cach = '' nghĩa là vốn đã đủ, không phải làm gì. */
async function lapDuGiay(file, canGiay) {
  const can = Number(canGiay) || 0;
  if (!can || !fs.existsSync(file)) return { ok: false, cach: '' };
  const co = giayCua(file);
  if (!co) return { ok: false, cach: '' };
  if (co >= can - 0.15) return { ok: true, cach: '', tu: co, den: co };   // đã đủ

  const thieu = (can - co) / can;
  const tmp = file.replace(/\.mp4$/i, '') + '_du.mp4';
  let xong = false, cach = '';

  if (thieu <= 0.20) {
    // Làm chậm: giữ nguyên nội dung, kéo dài đúng tỉ lệ. Mắt gần như không nhận ra.
    cach = 'chậm lại';
    xong = await chay(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-i', file,
      '-filter:v', `setpts=${(can / co).toFixed(4)}*PTS`, '-an',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-y', tmp]);
  }
  if (!xong) {
    // Lặp lại từ đầu cho đủ giây. Có mối nối, nhưng còn hơn đứng hình.
    cach = 'lặp';
    xong = await chay(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-stream_loop', '-1', '-i', file,
      '-t', String(can), '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-y', tmp]);
  }
  if (!xong || !fs.existsSync(tmp)) { try { fs.unlinkSync(tmp); } catch (_) {} return { ok: false, cach: '', tu: co, den: co }; }

  const moi = giayCua(tmp);
  if (moi < can - 0.3) { try { fs.unlinkSync(tmp); } catch (_) {} return { ok: false, cach: '', tu: co, den: co }; }
  try { fs.unlinkSync(file); fs.renameSync(tmp, file); } catch (_) { return { ok: false, cach: '', tu: co, den: co }; }
  return { ok: true, cach, tu: +co.toFixed(2), den: +moi.toFixed(2) };
}

module.exports = { lapDuGiay, giayCua };
